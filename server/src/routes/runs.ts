import express from 'express';
import { spawn } from 'child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { CONFIG } from '../config.js';
import { getRunResult, listRuns } from '../playwright/runner.js';
import {
  startLiveRun,
  getLiveRunSession,
  getLiveRunState,
  subscribeToLiveRun,
  controlLiveRun,
  addChatToLiveRun,
  RunControlAction
} from '../playwright/liveRunManager.js';
import type { LiveRunEvent } from '../playwright/liveRunManager.js';
import type { LiveRunState } from '../types.js';
import { loadConfig } from '../storage/config.js';
import { chatWithAI } from '../ai/index.js';
import { resolveNpxInvocation } from '../utils/npx.js';

const router = express.Router();

// Start a new test run with live streaming
router.post('/', async (req, res) => {
  try {
    const { testId } = req.body;

    if (!testId || typeof testId !== 'string') {
      return res.status(400).json({ error: 'testId is required' });
    }

    const headedPreference =
      typeof req.body.headed === 'boolean'
        ? req.body.headed
        : typeof req.body.headed === 'string'
          ? req.body.headed.toLowerCase() !== 'false'
          : undefined;

    let speedPreference: number | undefined;
    if (typeof req.body.speed === 'number') {
      speedPreference = req.body.speed;
    } else if (typeof req.body.speed === 'string') {
      const parsed = Number.parseFloat(req.body.speed);
      if (Number.isFinite(parsed)) {
        speedPreference = parsed;
      }
    }

    if (typeof speedPreference === 'number') {
      speedPreference = Math.min(2, Math.max(0.5, speedPreference));
    }

    const keepBrowserOpen =
      typeof req.body.keepBrowserOpen === 'boolean'
        ? req.body.keepBrowserOpen
        : typeof req.body.keepBrowserOpen === 'string'
          ? req.body.keepBrowserOpen.toLowerCase() !== 'false'
          : false;

    const stopOnFailure =
      typeof req.body.stopOnFailure === 'boolean'
        ? req.body.stopOnFailure
        : typeof req.body.stopOnFailure === 'string'
          ? req.body.stopOnFailure.toLowerCase() !== 'false'
          : false;

    const viewportSize = req.body.viewportSize && typeof req.body.viewportSize === 'object'
      ? {
          width: Number.parseInt(req.body.viewportSize.width, 10),
          height: Number.parseInt(req.body.viewportSize.height, 10)
        }
      : undefined;

    const session = await startLiveRun(CONFIG.DATA_DIR, testId, {
      headed: headedPreference,
      speed: speedPreference,
      keepOpen: keepBrowserOpen,
      stopOnFailure,
      viewportSize
    });
    return res.status(202).json({ runId: session.id });
  } catch (err: any) {
    console.error('Test run error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to start test run' });
  }
});

// List historical runs
router.get('/', async (req, res) => {
  try {
    const { testId } = req.query;
    const runs = await listRuns(CONFIG.DATA_DIR, testId as string | undefined);
    res.json({ runs });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unable to list runs' });
  }
});

// Get run state (live if available, otherwise synthesized from stored result)
router.get('/:runId', async (req, res) => {
  const { runId } = req.params;

  const state = getLiveRunState(runId);
  if (state) {
    return res.json({ run: state });
  }

  try {
    const result = await getRunResult(CONFIG.DATA_DIR, runId);
    const fallbackState: LiveRunState = {
      runId,
      testId: result.testId,
      status:
        result.status === 'passed'
          ? 'completed'
          : result.status === 'stopped'
            ? 'stopped'
            : 'failed',
      startedAt: result.startedAt,
      updatedAt: result.endedAt,
      logs: result.logs ?? [],
      steps: result.steps ?? [],
      chat: [],
      result
    };
    return res.json({ run: fallbackState });
  } catch {
    return res.status(404).json({ error: 'Run not found' });
  }
});

// Server-sent events stream for live updates
router.get('/:runId/stream', (req, res) => {
  const { runId } = req.params;
  const session = getLiveRunSession(runId);

  if (!session) {
    const state = getLiveRunState(runId);
    if (!state) {
      return res.status(404).json({ error: 'Run not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'hydrate', payload: state })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'result', payload: state.result })}\n\n`);
    res.end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let closed = false;

  const heartbeat = setInterval(() => {
    if (!closed) {
      res.write(': heartbeat\n\n');
    }
  }, 15000);

  const send = (event: LiveRunEvent | { type: 'hydrate'; payload: LiveRunState }) => {
    if (!closed) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  send({ type: 'hydrate', payload: session.getState() });

  const unsubscribe = subscribeToLiveRun(runId, (event) => {
    send(event);
  });

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// Run controls (play/pause/stop)
router.post('/:runId/control', async (req, res) => {
  const { runId } = req.params;
  const { action } = req.body;

  if (!action || !['pause', 'resume', 'stop'].includes(action)) {
    return res.status(400).json({ error: 'Invalid control action' });
  }

  try {
    await controlLiveRun(runId, action as RunControlAction);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Unable to update run state' });
  }
});

// AI chat during run
router.post('/:runId/chat', async (req, res) => {
  const { runId } = req.params;
  const { message } = req.body;
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';

  if (!trimmedMessage) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const session = getLiveRunSession(runId);
  if (!session) {
    return res.status(404).json({ error: 'Run not found or already finished' });
  }

  const previousChat = session.getState().chat;
  const userMessage = addChatToLiveRun(runId, 'user', trimmedMessage);

  try {
    const config = await loadConfig(CONFIG.DATA_DIR);
    const apiKey = (config.apiKey ?? '').trim();

    if (!apiKey) {
      addChatToLiveRun(
        runId,
        'assistant',
        'AI provider is not configured. Update Settings to chat during a run.'
      );
      return res.status(400).json({ error: 'AI provider not configured' });
    }

    const responseText = await chatWithAI({
      provider: config.apiProvider,
      apiKey,
      message: trimmedMessage,
      history: previousChat
    });

    const assistantMessage = addChatToLiveRun(runId, 'assistant', responseText);
    res.json({ messages: session.getState().chat, assistant: assistantMessage, user: userMessage });
  } catch (err: any) {
    const errorMessage = err?.message || 'Assistant failed to respond';
    addChatToLiveRun(runId, 'assistant', `Assistant error: ${errorMessage}`);
    res.status(500).json({ error: errorMessage });
  }
});

// Open trace viewer for a run
router.post('/:runId/trace', async (req, res) => {
  try {
    const result = await getRunResult(CONFIG.DATA_DIR, req.params.runId);

    if (!result.tracePath) {
      return res.status(404).json({ error: 'No trace available for this run' });
    }

    // Spawn trace viewer in background
    const npx = await resolveNpxInvocation();
    const baseEnv = npx.env ?? process.env;
    spawn(npx.command, [...npx.argsPrefix, 'playwright', 'show-trace', result.tracePath], {
      detached: true,
      stdio: 'ignore',
      env: { ...baseEnv }
    }).unref();

    res.json({ success: true, message: 'Trace viewer opened' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unable to open trace viewer' });
  }
});

router.get('/:runId/artifacts/:fileName', async (req, res) => {
  const { runId, fileName } = req.params;
  const safeName = path.basename(fileName);
  const runDir = path.join(CONFIG.DATA_DIR, 'runs', runId);
  const filePath = path.join(runDir, safeName);

  try {
    await fs.access(filePath);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Artifact not found' });
  }
});

export default router;
