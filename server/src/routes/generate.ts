import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  LiveGenerationOptions,
  LiveGenerationState,
  LiveGenerationEvent,
  Test,
  TestMetadata
} from '../../../shared/types.js';
import { LiveTestGenerator } from '../playwright/liveTestGenerator.js';
import { loadConfig } from '../storage/config.js';
import { saveTest } from '../storage/tests.js';
import { getCredentialById } from '../storage/credentials.js';
import { CONFIG } from '../config.js';

const router = express.Router();

// Active generation sessions
const sessions = new Map<string, LiveTestGenerator>();
const persistedSessions = new Map<string, TestMetadata>();

// SSE connections for real-time updates
const sseClients = new Map<string, express.Response[]>();

type PersistOptions = {
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  prompt?: string;
  successCriteria?: string;
  folder?: string;
  credentialId?: string;
};

function formatAutoTestName(goal: string): string {
  const trimmed = goal.trim() || 'AI generated test';
  const snippet = trimmed.slice(0, 42).replace(/\s+/g, ' ');
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  return `${snippet} (${timestamp})`;
}

function summarizeTags(tags?: string[]): string[] {
  if (tags?.length) {
    return tags;
  }
  return ['ai-generated', 'live-session'];
}

async function persistGeneratorTest(
  generator: LiveTestGenerator,
  options: PersistOptions = {}
): Promise<TestMetadata> {
  const state = generator.getState();
  if (!state.recordedSteps?.length) {
    throw new Error('No recorded steps to save yet');
  }

  const existing = persistedSessions.get(generator.id);
  const now = new Date().toISOString();
  const metadata: TestMetadata = {
    id: options.id || existing?.id || `ai-${generator.id}`,
    name: options.name?.trim() || existing?.name || formatAutoTestName(state.goal),
    description:
      options.description?.trim() || existing?.description || `Goal: ${state.goal}`,
    tags: summarizeTags(options.tags ?? existing?.tags),
    prompt: options.prompt?.trim() || state.goal,
    successCriteria:
      options.successCriteria?.trim() || existing?.successCriteria || state.successCriteria,
    folder: options.folder ?? existing?.folder,
    credentialId: options.credentialId ?? state.credentialId,
    startUrl: state.startUrl,
    steps: state.recordedSteps.map((step) => ({
      number: step.stepNumber,
      qaSummary: step.qaSummary,
      playwrightCode: step.playwrightCode
    })),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  const test: Test = {
    metadata,
    code: generator.generateTestCode()
  };

  await saveTest(CONFIG.DATA_DIR, test);
  persistedSessions.set(generator.id, metadata);
  generator.markTestPersisted(metadata);
  return metadata;
}

function broadcastSessionEvent(sessionId: string, event: LiveGenerationEvent): void {
  const clients = sseClients.get(sessionId) || [];
  const data = JSON.stringify(event);
  clients.forEach((client) => client.write(`data: ${data}\n\n`));
}

async function handleAutoSave(generator: LiveTestGenerator): Promise<void> {
  if (persistedSessions.has(generator.id)) {
    return;
  }

  try {
    const metadata = await persistGeneratorTest(generator);
    broadcastSessionEvent(generator.id, {
      type: 'auto_saved',
      timestamp: new Date().toISOString(),
      payload: { metadata }
    });
  } catch (error) {
    console.error('Failed to auto-save generated test:', error);
  }
}

/**
 * Start a new live AI test generation session
 */
router.post('/start', async (req, res) => {
  try {
    const options: LiveGenerationOptions = req.body;

    if (!options.startUrl || !options.goal) {
      return res.status(400).json({ error: 'startUrl and goal are required' });
    }
    const trimmedCredentialId =
      typeof options.credentialId === 'string' && options.credentialId.trim()
        ? options.credentialId.trim()
        : undefined;

    // Load config for AI provider
    const config = await loadConfig(CONFIG.DATA_DIR);
    const apiKey = (config.apiKey || '').trim();

    if (!apiKey || /^sk-test/i.test(apiKey)) {
      return res.status(400).json({ error: 'API key not configured' });
    }

    // Create new generation session
    let credentialRecord = undefined;
    if (trimmedCredentialId) {
      credentialRecord = await getCredentialById(CONFIG.DATA_DIR, trimmedCredentialId);
      if (!credentialRecord) {
        return res.status(404).json({ error: 'Credential not found' });
      }
      options.credentialId = credentialRecord.id;
    }

    const generator = new LiveTestGenerator(
      options,
      config.apiProvider,
      apiKey,
      config.baseUrl,
      credentialRecord
    );
    sessions.set(generator.id, generator);

    // Setup event forwarding to SSE clients
    generator.on('event', (event: LiveGenerationEvent) => {
      broadcastSessionEvent(generator.id, event);

      if (event.type === 'completed') {
        void handleAutoSave(generator);
      }
    });

    // Start generation asynchronously
    void generator.start();

    res.json({
      sessionId: generator.id,
      state: generator.getState()
    });
  } catch (error: any) {
    console.error('Failed to start generation:', error);
    res.status(500).json({ error: error.message || 'Failed to start generation' });
  }
});

/**
 * Get current state of a generation session
 */
router.get('/:sessionId/state', (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({ state: generator.getState() });
});

/**
 * Subscribe to live updates via Server-Sent Events (SSE)
 */
router.get('/:sessionId/events', (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Add client to list
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, []);
  }
  sseClients.get(sessionId)!.push(res);

  // Send initial state
  const initialState = generator.getState();
  res.write(`data: ${JSON.stringify({
    type: 'initial_state',
    timestamp: new Date().toISOString(),
    payload: initialState
  })}\n\n`);

  // Cleanup on disconnect
  req.on('close', () => {
    const clients = sseClients.get(sessionId);
    if (clients) {
      const index = clients.indexOf(res);
      if (index !== -1) {
        clients.splice(index, 1);
      }
      if (clients.length === 0) {
        sseClients.delete(sessionId);
      }
    }
  });
});

/**
 * Serve stored screenshots for a generation session
 */
router.get('/:sessionId/screenshots/:fileName', async (req, res) => {
  const { sessionId, fileName } = req.params;
  const sanitized = path.basename(fileName);
  const filePath = path.join(
    CONFIG.DATA_DIR,
    'live-generation',
    sessionId,
    'screenshots',
    sanitized
  );

  try {
    await fs.access(filePath);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'Screenshot not found' });
  }
});

/**
 * Stop a running generation session
 */
router.post('/:sessionId/stop', async (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  await generator.stop();

  res.json({ success: true, state: generator.getState() });
});

/**
 * Restart generation from beginning
 */
router.post('/:sessionId/restart', async (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    await generator.restart();
    persistedSessions.delete(sessionId);
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to restart generation' });
  }
});

router.post('/:sessionId/pause', (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  generator.pause();
  res.json({ success: true, state: generator.getState() });
});

router.post('/:sessionId/resume', (req, res) => {
  const { sessionId } = req.params;
  const { userCorrection } = req.body ?? {};
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  generator.resume(typeof userCorrection === 'string' ? userCorrection : undefined);
  res.json({ success: true, state: generator.getState() });
});

router.patch('/:sessionId/goal', (req, res) => {
  const { sessionId } = req.params;
  const { goal } = req.body;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    generator.updateGoal(goal);
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to update goal' });
  }
});

router.patch('/:sessionId/success-criteria', (req, res) => {
  const { sessionId } = req.params;
  const { successCriteria } = req.body;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    generator.updateSuccessCriteria(successCriteria);
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to update success criteria' });
  }
});

router.patch('/:sessionId/max-steps', (req, res) => {
  const { sessionId } = req.params;
  const { maxSteps } = req.body ?? {};
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const parsed = Number(maxSteps);

  if (!Number.isFinite(parsed)) {
    return res.status(400).json({ error: 'Max steps must be a number' });
  }

  try {
    generator.updateMaxSteps(parsed);
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to update max steps' });
  }
});

router.patch('/:sessionId/start-url', (req, res) => {
  const { sessionId } = req.params;
  const { startUrl } = req.body ?? {};
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!startUrl || typeof startUrl !== 'string') {
    return res.status(400).json({ error: 'startUrl is required' });
  }

  try {
    generator.updateStartUrl(startUrl);
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to update start URL' });
  }
});

router.patch('/:sessionId/keep-browser-open', (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const keep = Boolean(req.body?.keepBrowserOpen);
  generator.updateKeepBrowserOpen(keep);
  res.json({ success: true, state: generator.getState() });
});

router.post('/:sessionId/chat', async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    await generator.continueWithFeedback(message);
    const state = generator.getState();
    res.json({ success: true, chat: state.chat, state });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to process message' });
  }
});

router.delete('/:sessionId/steps/:stepNumber', async (req, res) => {
  const { sessionId, stepNumber } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const parsedStep = Number.parseInt(stepNumber, 10);
    if (Number.isNaN(parsedStep)) {
      return res.status(400).json({ error: 'Invalid step number' });
    }

    await generator.deleteStep(parsedStep);
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to delete step' });
  }
});

router.post('/:sessionId/suggest-name', async (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const suggestedName = await generator.suggestTestName();
    res.json({ suggestedName });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to suggest test name' });
  }
});

/**
 * Save the generated test
 */
router.post('/:sessionId/save', async (req, res) => {
  const { sessionId } = req.params;
  const { name, description, tags, prompt, successCriteria, folder, credentialId } = req.body || {};

  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const state = generator.getState();

  if (!['completed', 'failed', 'stopped'].includes(state.status)) {
    return res.status(400).json({ error: 'Generation is still in progress' });
  }

  try {
    const metadata = await persistGeneratorTest(generator, {
      name,
      description,
      tags,
      prompt,
      successCriteria,
      folder,
      credentialId
    });

    broadcastSessionEvent(sessionId, {
      type: 'auto_saved',
      timestamp: new Date().toISOString(),
      payload: { metadata }
    });

    res.json({ success: true, test: metadata });
  } catch (error: any) {
    console.error('Failed to save test:', error);
    res.status(500).json({ error: error.message || 'Failed to save test' });
  }
});

export default router;
