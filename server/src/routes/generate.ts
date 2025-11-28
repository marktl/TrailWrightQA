import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import type {
  LiveGenerationOptions,
  LiveGenerationState,
  LiveGenerationEvent,
  Test,
  TestMetadata,
  GenerationStatus
} from '../../../shared/types.js';
import { LiveTestGenerator } from '../playwright/liveTestGenerator.js';
import { RecordModeGenerator, type RecordModeConfig } from '../playwright/recordModeGenerator.js';
import { loadConfig } from '../storage/config.js';
import { saveTest } from '../storage/tests.js';
import { getCredentialById } from '../storage/credentials.js';
import { VariableStorage } from '../storage/variables.js';
import { CONFIG } from '../config.js';

const router = express.Router();

// Active generation sessions
const sessions = new Map<string, LiveTestGenerator>();
const persistedSessions = new Map<string, TestMetadata>();
const recordSessions = new Map<string, RecordModeGenerator>();

// Cache for recorded steps (persists even after browser closes)
const recordedStepsCache = new Map<string, { steps: any[], state: any }>();

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
  variables?: TestMetadata['variables'];
  dataSource?: string;
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
  const testId = options.id || existing?.id || `ai-${generator.id}`;
  const testName = options.name?.trim() || existing?.name || formatAutoTestName(state.goal);

  // Get variables from generator if not provided in options
  const generatorVariables = generator.getVariables();
  const variables = options.variables || (generatorVariables.length > 0
    ? generatorVariables.map(v => ({
        name: v.name,
        type: v.type as 'string' | 'number',
        sampleValue: v.sampleValue
      }))
    : undefined);

  const metadata: TestMetadata = {
    id: testId,
    name: testName,
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
    variables,
    dataSource: variables ? `${testId}.csv` : options.dataSource,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  const test: Test = {
    metadata,
    code: generator.generateTestCode({
      testId,
      testName,
      variables,
      metadata: {
        description: metadata.description,
        tags: metadata.tags,
        prompt: metadata.prompt,
        successCriteria: metadata.successCriteria,
        credentialId: metadata.credentialId
      }
    })
  };

  await saveTest(CONFIG.DATA_DIR, test);

  // Create CSV file with sample data if variables are present
  if (variables && variables.length > 0) {
    const variableStorage = new VariableStorage(CONFIG.DATA_DIR);
    const sampleRow: Record<string, string> = {};

    for (const variable of variables) {
      sampleRow[variable.name] = variable.sampleValue || '';
    }

    await variableStorage.writeVariables(testId, [sampleRow]);
  }

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

    // Get selected model for the provider
    const modelKey = `${config.apiProvider}Model` as keyof typeof config;
    const selectedModel = config[modelKey] as string | undefined;

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
      credentialRecord,
      selectedModel
    );
    sessions.set(generator.id, generator);
    console.log(`[generate] Created session ${generator.id}. Total active sessions: ${sessions.size}`);

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

// Start a new record mode session
router.post('/record/start', async (req, res) => {
  try {
    const { name, startUrl, description, credentialId } = req.body ?? {};

    if (!name || !startUrl) {
      return res.status(400).json({
        error: 'Missing required fields: name, startUrl'
      });
    }

    const config = await loadConfig(CONFIG.DATA_DIR);
    const sessionId = `record-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const recordConfig: RecordModeConfig = {
      sessionId,
      name,
      startUrl,
      description,
      aiProvider: config.apiProvider,
      credentialId
    };

    const generator = new RecordModeGenerator(recordConfig);
    recordSessions.set(sessionId, generator);

    const browser = await chromium.launch({ headless: false });
    await generator.start(browser);

    res.json({
      sessionId,
      state: generator.getState()
    });
  } catch (error) {
    console.error('Failed to start recording:', error);
    res.status(500).json({
      error: 'Failed to start recording',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop a record mode session
router.post('/:sessionId/record/stop', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const generator = recordSessions.get(sessionId);

    if (!generator) {
      return res.status(404).json({
        error: 'Recording session not found'
      });
    }

    await generator.stop();

    // Cache the steps and state so they persist even after browser closes
    recordedStepsCache.set(sessionId, {
      steps: generator.getSteps(),
      state: generator.getState()
    });

    res.json({
      state: generator.getState(),
      recordedSteps: generator.getSteps()
    });
  } catch (error) {
    console.error('Failed to stop recording:', error);
    res.status(500).json({
      error: 'Failed to stop recording',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Discard a record mode session (exit without saving)
router.post('/:sessionId/record/discard', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const generator = recordSessions.get(sessionId);

    if (!generator) {
      return res.status(404).json({
        error: 'Recording session not found'
      });
    }

    await generator.discard();

    // Remove from active sessions and cache
    recordSessions.delete(sessionId);
    recordedStepsCache.delete(sessionId);

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to discard recording:', error);
    res.status(500).json({
      error: 'Failed to discard recording',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get current state of a generation session
 */
router.get('/:sessionId/state', (req, res) => {
  const { sessionId } = req.params;
  const recordGenerator = recordSessions.get(sessionId);
  if (recordGenerator) {
    return res.json(recordGenerator.getState());
  }

  // Check cache for stopped record sessions
  const cached = recordedStepsCache.get(sessionId);
  if (cached) {
    return res.json(cached.state);
  }

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
  const recordGenerator = recordSessions.get(sessionId);
  if (recordGenerator) {
    const closeAfterInitial = Boolean(req.headers['x-test-close']);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write('event: state\n');
    res.write(`data: ${JSON.stringify(recordGenerator.getState())}\n\n`);

    if (closeAfterInitial) {
      res.end();
      return;
    }

    const stepHandler = (step: any) => {
      res.write('event: step\n');
      res.write(`data: ${JSON.stringify(step)}\n\n`);
    };

    const stateHandler = (state: any) => {
      res.write('event: state\n');
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    };

    // Forward LiveGenerationEvent-style events (like step_deleted) as unnamed SSE events
    const eventHandler = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    recordGenerator.on('step', stepHandler);
    recordGenerator.on('stateChange', stateHandler);
    recordGenerator.on('event', eventHandler);

    req.on('close', () => {
      recordGenerator.off('step', stepHandler);
      recordGenerator.off('stateChange', stateHandler);
      recordGenerator.off('event', eventHandler);
    });
    return;
  }

  // Check cache for stopped record sessions (browser closed)
  const cached = recordedStepsCache.get(sessionId);
  if (cached) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send cached state and steps, then close
    res.write('event: state\n');
    res.write(`data: ${JSON.stringify(cached.state)}\n\n`);

    // Send all cached steps
    for (const step of cached.steps) {
      res.write('event: step\n');
      res.write(`data: ${JSON.stringify(step)}\n\n`);
    }

    res.end();
    return;
  }

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
    console.log(`[generate] Restart failed: Session ${sessionId} not found. Active sessions: ${Array.from(sessions.keys()).join(', ')}`);
    return res.status(404).json({
      error: 'Session not found - it may have been lost due to server restart. Please start a new session.',
      sessionId
    });
  }

  try {
    await generator.restart();
    persistedSessions.delete(sessionId);
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    console.error(`[generate] Restart error for session ${sessionId}:`, error);
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

router.post('/:sessionId/manual-step', async (req, res) => {
  const { sessionId } = req.params;
  const { instruction } = req.body ?? {};
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!generator.isManualMode()) {
    return res.status(400).json({ error: 'Session is not in manual mode' });
  }

  const trimmed = typeof instruction === 'string' ? instruction.trim() : '';
  if (!trimmed) {
    return res.status(400).json({ error: 'Instruction is required' });
  }

  try {
    await generator.executeManualInstruction(trimmed);
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    console.error(`[generate] Manual step error for session ${sessionId}:`, error);
    res
      .status(400)
      .json({ error: error?.message || 'Unable to execute manual instruction', state: generator.getState() });
  }
});

router.post('/:sessionId/manual-interrupt', (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!generator.isManualMode()) {
    return res.status(400).json({ error: 'Session is not in manual mode' });
  }

  try {
    generator.requestManualInterrupt();
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to interrupt manual instruction' });
  }
});

/**
 * Approve the pending plan and execute it
 */
router.post('/:sessionId/approve-plan', async (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!generator.isManualMode()) {
    return res.status(400).json({ error: 'Session is not in manual mode' });
  }

  try {
    await generator.approvePlan();
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    console.error(`[generate] Approve plan error for session ${sessionId}:`, error);
    res.status(400).json({ error: error?.message || 'Unable to approve plan', state: generator.getState() });
  }
});

/**
 * Reject the pending plan
 */
router.post('/:sessionId/reject-plan', (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!generator.isManualMode()) {
    return res.status(400).json({ error: 'Session is not in manual mode' });
  }

  try {
    generator.rejectPlan();
    res.json({ success: true, state: generator.getState() });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to reject plan' });
  }
});

/**
 * Activate visual element picker - user clicks element in browser to get selector
 */
router.post('/:sessionId/pick-element', async (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const result = await generator.activateElementPicker();
    res.json({ success: true, selector: result.selector });
  } catch (error: any) {
    console.error(`[generate] Element picker error for session ${sessionId}:`, error);
    res.status(500).json({ error: error?.message || 'Failed to activate element picker' });
  }
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

/**
 * Get all variables for a generation session
 */
router.get('/:sessionId/variables', (req, res) => {
  const { sessionId } = req.params;

  // Check record mode sessions first
  const recordGenerator = recordSessions.get(sessionId);
  if (recordGenerator) {
    const variables = recordGenerator.getVariables();
    return res.json({ variables });
  }

  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const variables = generator.getVariables();
  res.json({ variables });
});

/**
 * Add or update a variable
 */
router.post('/:sessionId/variables', (req, res) => {
  const { sessionId } = req.params;
  const { name, sampleValue, type } = req.body ?? {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Variable name is required' });
  }

  if (!sampleValue || typeof sampleValue !== 'string') {
    return res.status(400).json({ error: 'Sample value is required' });
  }

  const varType = type === 'number' ? 'number' : 'string';

  // Check record mode sessions first
  const recordGenerator = recordSessions.get(sessionId);
  if (recordGenerator) {
    try {
      recordGenerator.setVariable(name, sampleValue, varType);
      return res.json({ success: true, variables: recordGenerator.getVariables() });
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Unable to set variable' });
    }
  }

  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!generator.isManualMode()) {
    return res.status(400).json({ error: 'Variables are only supported in step-by-step mode' });
  }

  try {
    generator.setVariable(name, sampleValue, varType);
    res.json({ success: true, variables: generator.getVariables() });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to set variable' });
  }
});

/**
 * Delete a variable
 */
router.delete('/:sessionId/variables/:varName', (req, res) => {
  const { sessionId, varName } = req.params;

  // Check record mode sessions first
  const recordGenerator = recordSessions.get(sessionId);
  if (recordGenerator) {
    recordGenerator.removeVariable(varName);
    return res.json({ success: true, variables: recordGenerator.getVariables() });
  }

  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  generator.removeVariable(varName);
  res.json({ success: true, variables: generator.getVariables() });
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

// Note: DELETE steps route moved below to consolidate with record mode handling

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

router.post('/:sessionId/suggest-tags', async (req, res) => {
  const { sessionId } = req.params;
  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const suggestedTags = await generator.suggestTestTags();
    res.json({ suggestedTags });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to suggest test tags' });
  }
});

/**
 * Resume a paused recording
 */
router.post('/:sessionId/resume', async (req, res) => {
  const { sessionId } = req.params;

  const recordGenerator = recordSessions.get(sessionId);
  if (!recordGenerator) {
    // Check if session is in cache (browser was closed)
    const cached = recordedStepsCache.get(sessionId);
    if (cached) {
      return res.status(400).json({
        error: 'Cannot resume - browser window was closed. Please start a new recording.'
      });
    }
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    await recordGenerator.resume();
    return res.json({ success: true, state: recordGenerator.getState() });
  } catch (error) {
    console.error('Failed to resume recording:', error);
    return res.status(500).json({ error: 'Failed to resume recording' });
  }
});

/**
 * Update a specific step in the recording
 */
router.put('/:sessionId/steps/:stepNumber', async (req, res) => {
  const { sessionId, stepNumber } = req.params;
  const { qaSummary, playwrightCode } = req.body;

  const recordGenerator = recordSessions.get(sessionId);
  if (recordGenerator) {
    try {
      const parsedStep = Number.parseInt(stepNumber, 10);
      if (Number.isNaN(parsedStep)) {
        return res.status(400).json({ error: 'Invalid step number' });
      }

      recordGenerator.updateStep(parsedStep, { qaSummary, playwrightCode });

      // Update cache as well
      const steps = recordGenerator.getSteps();
      recordedStepsCache.set(sessionId, {
        steps: steps,
        state: recordGenerator.getState()
      });

      const updatedStep = steps.find(s => s.stepNumber === parsedStep);
      return res.json({ success: true, step: updatedStep });
    } catch (error: any) {
      console.error('Failed to update step:', error);
      return res.status(error.message === 'Step not found' ? 404 : 500).json({
        error: error.message || 'Failed to update step'
      });
    }
  }

  // Check cache for stopped record sessions (browser closed)
  const cached = recordedStepsCache.get(sessionId);
  if (cached) {
    try {
      const stepIndex = cached.steps.findIndex(s => s.stepNumber === parseInt(stepNumber));

      if (stepIndex === -1) {
        return res.status(404).json({ error: 'Step not found' });
      }

      // Update the cached step
      cached.steps[stepIndex] = {
        ...cached.steps[stepIndex],
        qaSummary: qaSummary || cached.steps[stepIndex].qaSummary,
        playwrightCode: playwrightCode || cached.steps[stepIndex].playwrightCode
      };

      return res.json({ success: true, step: cached.steps[stepIndex] });
    } catch (error) {
      console.error('Failed to update cached step:', error);
      return res.status(500).json({ error: 'Failed to update step' });
    }
  }

  const generator = sessions.get(sessionId);
  if (generator) {
    return res.status(400).json({ error: 'Step editing not supported for AI-driven sessions' });
  }

  return res.status(404).json({ error: 'Session not found' });
});

/**
 * Delete a specific step in the recording
 */
router.delete('/:sessionId/steps/:stepNumber', async (req, res) => {
  const { sessionId, stepNumber } = req.params;

  const recordGenerator = recordSessions.get(sessionId);
  if (recordGenerator) {
    try {
      const parsedStep = Number.parseInt(stepNumber, 10);
      if (Number.isNaN(parsedStep)) {
        return res.status(400).json({ error: 'Invalid step number' });
      }

      recordGenerator.deleteStep(parsedStep);

      const updatedSteps = recordGenerator.getSteps();
      const updatedState = recordGenerator.getState();

      // Update cache as well
      recordedStepsCache.set(sessionId, {
        steps: updatedSteps,
        state: updatedState
      });

      return res.json({
        success: true,
        deletedStepNumber: parsedStep,
        steps: updatedSteps,
        state: updatedState
      });
    } catch (error: any) {
      console.error('Failed to delete step:', error);
      return res.status(error.message === 'Step not found' ? 404 : 500).json({
        error: error.message || 'Failed to delete step'
      });
    }
  }

  // Check cache for stopped record sessions (browser closed)
  const cached = recordedStepsCache.get(sessionId);
  if (cached) {
    try {
      const parsedStep = parseInt(stepNumber, 10);
      const stepIndex = cached.steps.findIndex(s => s.stepNumber === parsedStep);

      if (stepIndex === -1) {
        return res.status(404).json({ error: 'Step not found' });
      }

      // Remove the step from cache
      cached.steps.splice(stepIndex, 1);

      // Renumber remaining steps
      cached.steps.forEach((step, index) => {
        step.stepNumber = index + 1;
      });

      // Update state to reflect new step count
      cached.state.stepsTaken = cached.steps.length;
      cached.state.recordedSteps = [...cached.steps];

      return res.json({
        success: true,
        deletedStepNumber: parsedStep,
        steps: cached.steps,
        state: cached.state
      });
    } catch (error) {
      console.error('Failed to delete cached step:', error);
      return res.status(500).json({ error: 'Failed to delete step' });
    }
  }

  // Check live test generator sessions (step-by-step mode)
  const generator = sessions.get(sessionId);
  if (generator) {
    try {
      const parsedStep = Number.parseInt(stepNumber, 10);
      if (Number.isNaN(parsedStep)) {
        return res.status(400).json({ error: 'Invalid step number' });
      }

      await generator.deleteStep(parsedStep);
      return res.json({ success: true, state: generator.getState() });
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'Unable to delete step' });
    }
  }

  return res.status(404).json({ error: 'Session not found' });
});

/**
 * Save the generated test
 */
router.post('/:sessionId/save', async (req, res) => {
  const { sessionId } = req.params;
  const { name, description, tags, prompt, successCriteria, folder, credentialId } = req.body || {};

  const recordGenerator = recordSessions.get(sessionId);
  if (recordGenerator) {
    try {
      const state = recordGenerator.getState();
      const steps = recordGenerator.getSteps();

      // Create test metadata matching the expected structure
      const metadata: TestMetadata = {
        id: sessionId,
        name: name || state.testName || 'Recorded Test',
        description: description || state.goal || undefined,
        tags: tags || ['ai-generated', 'record-mode'],
        folder: folder || undefined,
        credentialId: credentialId || undefined,
        startUrl: state.startUrl,
        createdAt: state.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: steps.map(step => ({
          number: step.stepNumber,
          qaSummary: step.qaSummary,
          playwrightCode: step.playwrightCode
        }))
      };

      // Generate test code wrapped in test.step() for proper step reporting
      const testSteps = steps
        .map((step, index) => {
          // Strip newlines and escape quotes from qaSummary for use in string literal
          const sanitizedSummary = step.qaSummary.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
          const escapedSummary = sanitizedSummary.replace(/'/g, "\\'");
          const code = `    ${step.playwrightCode}`;
          const wait = step.waitCode ? `    ${step.waitCode}` : '';
          // Add 500ms wait between steps (except after the last step)
          const defaultWait = index < steps.length - 1 ? '    await page.waitForTimeout(500);' : '';
          const innerCode = [code, wait, defaultWait].filter(Boolean).join('\n');
          // Wrap in test.step() so Playwright reports QA summary as step title
          return `  await test.step('${escapedSummary}', async () => {\n${innerCode}\n  });`;
        })
        .join('\n\n');

      // Add initial navigation to startUrl
      const initialNav = `  // Navigate to starting URL\n  await page.goto('${metadata.startUrl}');\n`;

      const testCode = `import { test, expect } from '@playwright/test';

test('${metadata.name}', async ({ page }) => {
${initialNav}
${testSteps}
});`;

      // Use saveTest from storage layer to write file with proper metadata
      await saveTest(CONFIG.DATA_DIR, {
        metadata,
        code: testCode
      });

      await recordGenerator.cleanup();
      recordSessions.delete(sessionId);
      recordedStepsCache.delete(sessionId); // Clear cache after saving

      return res.json({
        success: true,
        test: metadata
      });
    } catch (error) {
      console.error('Failed to save test:', error);
      return res.status(500).json({ error: 'Failed to save test' });
    }
  }

  // Check cache for stopped record sessions (browser closed)
  const cached = recordedStepsCache.get(sessionId);
  if (cached) {
    try {
      const state = cached.state;
      const steps = cached.steps;

      // Create test metadata matching the expected structure
      const metadata: TestMetadata = {
        id: sessionId,
        name: name || state.testName || 'Recorded Test',
        description: description || state.goal || undefined,
        tags: tags || ['ai-generated', 'record-mode'],
        folder: folder || undefined,
        credentialId: credentialId || undefined,
        startUrl: state.startUrl,
        createdAt: state.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: steps.map(step => ({
          number: step.stepNumber,
          qaSummary: step.qaSummary,
          playwrightCode: step.playwrightCode
        }))
      };

      // Generate test code wrapped in test.step() for proper step reporting
      const testSteps = steps
        .map((step, index) => {
          // Strip newlines and escape quotes from qaSummary for use in string literal
          const sanitizedSummary = step.qaSummary.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
          const escapedSummary = sanitizedSummary.replace(/'/g, "\\'");
          const code = `    ${step.playwrightCode}`;
          const wait = step.waitCode ? `    ${step.waitCode}` : '';
          // Add 500ms wait between steps (except after the last step)
          const defaultWait = index < steps.length - 1 ? '    await page.waitForTimeout(500);' : '';
          const innerCode = [code, wait, defaultWait].filter(Boolean).join('\n');
          // Wrap in test.step() so Playwright reports QA summary as step title
          return `  await test.step('${escapedSummary}', async () => {\n${innerCode}\n  });`;
        })
        .join('\n\n');

      // Add initial navigation to startUrl
      const initialNav = `  // Navigate to starting URL\n  await page.goto('${metadata.startUrl}');\n`;

      const testCode = `import { test, expect } from '@playwright/test';

test('${metadata.name}', async ({ page }) => {
${initialNav}
${testSteps}
});`;

      // Use saveTest from storage layer to write file with proper metadata
      await saveTest(CONFIG.DATA_DIR, {
        metadata,
        code: testCode
      });

      recordedStepsCache.delete(sessionId); // Clear cache after saving

      return res.json({
        success: true,
        test: metadata
      });
    } catch (error) {
      console.error('Failed to save test from cache:', error);
      return res.status(500).json({ error: 'Failed to save test' });
    }
  }

  const generator = sessions.get(sessionId);

  if (!generator) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const state = generator.getState();

  const terminalStatuses: GenerationStatus[] = ['completed', 'failed', 'stopped', 'paused'];
  const manualReady = generator.isManualMode() && state.status === 'awaiting_input';

  if (!terminalStatuses.includes(state.status) && !manualReady) {
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

export const generateRouter = router;
export default router;
