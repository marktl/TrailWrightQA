import express from 'express';
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
    const generator = new LiveTestGenerator(options, config.apiProvider, apiKey);
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

  if (state.status !== 'completed' && state.status !== 'failed') {
    return res.status(400).json({ error: 'Generation is still in progress' });
  }

  try {
    const code = generator.generateTestCode();
    const now = new Date().toISOString();

    const test: Test = {
      metadata: {
        id: `ai-${sessionId}`,
        name: name || state.recordedSteps[0]?.qaSummary || 'AI Generated Test',
        description: description || `Goal: ${state.stepsTaken} steps`,
        tags: tags || ['ai-generated', 'live-session'],
        prompt: state.recordedSteps.map((s) => s.qaSummary).join('; ') || undefined,
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
