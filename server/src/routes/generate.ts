import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  LiveGenerationOptions,
  LiveGenerationState,
  LiveGenerationEvent,
  Test
} from '../../../shared/types.js';
import { LiveTestGenerator } from '../playwright/liveTestGenerator.js';
import { loadConfig } from '../storage/config.js';
import { saveTest } from '../storage/tests.js';
import { CONFIG } from '../config.js';

const router = express.Router();

// Active generation sessions
const sessions = new Map<string, LiveTestGenerator>();

// SSE connections for real-time updates
const sseClients = new Map<string, express.Response[]>();

/**
 * Start a new live AI test generation session
 */
router.post('/start', async (req, res) => {
  try {
    const options: LiveGenerationOptions = req.body;

    if (!options.startUrl || !options.goal) {
      return res.status(400).json({ error: 'startUrl and goal are required' });
    }

    // Load config for AI provider
    const config = await loadConfig(CONFIG.DATA_DIR);
    const apiKey = (config.apiKey || '').trim();

    if (!apiKey || /^sk-test/i.test(apiKey)) {
      return res.status(400).json({ error: 'API key not configured' });
    }

    // Create new generation session
    const generator = new LiveTestGenerator(options, config.apiProvider, apiKey, config.baseUrl);
    sessions.set(generator.id, generator);

    // Setup event forwarding to SSE clients
    generator.on('event', (event: LiveGenerationEvent) => {
      const clients = sseClients.get(generator.id) || [];
      const data = JSON.stringify(event);
      clients.forEach((client) => {
        client.write(`data: ${data}\n\n`);
      });
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
  const { name, description, tags } = req.body;

  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const state = generator.getState();

  if (!['completed', 'failed', 'stopped'].includes(state.status)) {
    return res.status(400).json({ error: 'Generation is still in progress' });
  }

  try {
    const code = generator.generateTestCode();
    const now = new Date().toISOString();
    const recordedSteps = state.recordedSteps || [];

    const test: Test = {
      metadata: {
        id: `ai-${sessionId}`,
        name: name || state.recordedSteps[0]?.qaSummary || 'AI Generated Test',
        description: description || `Goal: ${state.stepsTaken} steps`,
        tags: tags || ['ai-generated', 'live-session'],
        prompt: recordedSteps.map((s) => s.qaSummary).join('; ') || undefined,
        steps: recordedSteps.map((step) => ({
          number: step.stepNumber,
          qaSummary: step.qaSummary,
          playwrightCode: step.playwrightCode
        })),
        createdAt: now,
        updatedAt: now
      },
      code
    };

    await saveTest(CONFIG.DATA_DIR, test);

    // Cleanup session
    sessions.delete(sessionId);
    sseClients.delete(sessionId);

    res.json({ success: true, test: test.metadata });
  } catch (error: any) {
    console.error('Failed to save test:', error);
    res.status(500).json({ error: error.message || 'Failed to save test' });
  }
});

export default router;
