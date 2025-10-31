import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { generateTest } from '../ai/index.js';
import { saveTest, loadTest, listTests, deleteTest } from '../storage/tests.js';
import { loadConfig } from '../storage/config.js';
import { CONFIG } from '../config.js';
import { resolveNpxInvocation } from '../utils/npx.js';
import type { Test } from '../types.js';

const router = express.Router();

function buildGeneratedTest(prompt: string, code: string): Test {
  const normalizedPrompt = (prompt ?? '').toString().trim();
  const now = new Date().toISOString();
  const idSuffix = Math.random().toString(36).slice(2, 8);
  const id = `test-${now.replace(/[:.]/g, '-')}-${idSuffix}`;
  const summarySource = normalizedPrompt
    ? normalizedPrompt.split(/\s+/).slice(0, 8).join(' ')
    : 'AI generated test';
  const baseName = summarySource || 'Generated test';
  const name = baseName.charAt(0).toUpperCase() + baseName.slice(1);
  const description = normalizedPrompt
    ? (normalizedPrompt.length > 140
        ? `${normalizedPrompt.slice(0, 137)}...`
        : normalizedPrompt)
    : 'Generated Playwright scenario.';

  return {
    metadata: {
      id,
      name,
      description,
      prompt: normalizedPrompt || undefined,
      tags: ['ai-generated'],
      createdAt: now,
      updatedAt: now
    },
    code
  };
}

// Generate test from AI prompt
router.post('/generate', async (req, res) => {
  try {
    const { prompt, baseUrl } = req.body;
    const rawPrompt = typeof prompt === 'string' ? prompt : '';
    const trimmedPrompt = rawPrompt.trim();

    if (!trimmedPrompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const config = await loadConfig(CONFIG.DATA_DIR);
    const apiKey = (config.apiKey || '').trim();

    if (!apiKey || /^sk-test/i.test(apiKey)) {
      return res.status(400).json({ error: 'API key not configured' });
    }

    const code = await generateTest({
      provider: config.apiProvider,
      apiKey,
      prompt: trimmedPrompt,
      baseUrl: baseUrl || config.baseUrl
    });

    const test = buildGeneratedTest(trimmedPrompt, code);
    await saveTest(CONFIG.DATA_DIR, test);

    res.status(201).json({ test });
  } catch (err: any) {
    console.error('Test generation error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate test' });
  }
});

// List all tests
router.get('/', async (req, res) => {
  try {
    const tests = await listTests(CONFIG.DATA_DIR);
    res.json({ tests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single test
router.get('/:id', async (req, res) => {
  try {
    const test = await loadTest(CONFIG.DATA_DIR, req.params.id);
    res.json({ test });
  } catch (err: any) {
    res.status(404).json({ error: 'Test not found' });
  }
});

// Save test
router.post('/', async (req, res) => {
  try {
    const test: Test = req.body;

    if (!test.metadata.id || !test.code) {
      return res.status(400).json({ error: 'Invalid test data' });
    }

    if (!test.metadata.createdAt) {
      test.metadata.createdAt = new Date().toISOString();
    }
    test.metadata.updatedAt = new Date().toISOString();

    await saveTest(CONFIG.DATA_DIR, test);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete test
router.delete('/:id', async (req, res) => {
  try {
    await deleteTest(CONFIG.DATA_DIR, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Launch Playwright codegen to record a new test
router.post('/record', async (req, res) => {
  try {
    const { url } = req.body;
    const config = await loadConfig(CONFIG.DATA_DIR);
    const startUrl = url || config.baseUrl || 'about:blank';

    // Create a new test file for recording
    const now = new Date().toISOString();
    const idSuffix = Math.random().toString(36).slice(2, 8);
    const testId = `test-${now.replace(/[:.]/g, '-')}-${idSuffix}`;
    const testFileName = `${testId}.spec.ts`;
    const testFilePath = path.join(CONFIG.DATA_DIR, 'tests', testFileName);

    // Create an empty starter test file for codegen to write to
    const fs = await import('fs/promises');
    const starterTemplate = `import { test, expect } from '@playwright/test';

test('recorded test', async ({ page }) => {
  // Your recorded actions will appear here
});
`;
    await fs.writeFile(testFilePath, starterTemplate, 'utf-8');

    const npx = await resolveNpxInvocation();
    const baseEnv = npx.env ?? process.env;

    console.log(`[codegen] Launching Playwright codegen at ${startUrl}, output to ${testFileName}`);

    // Launch codegen with --output to save directly to file
    spawn(
      npx.command,
      [
        ...npx.argsPrefix,
        'playwright',
        'codegen',
        startUrl,
        '--target=typescript',
        '--output',
        testFilePath
      ],
      {
        cwd: CONFIG.DATA_DIR,
        env: { ...baseEnv },
        detached: true,
        stdio: 'ignore'
      }
    ).unref();

    res.json({
      success: true,
      testId,
      message: `Playwright Inspector launched. Record your test steps - they'll be saved automatically to ${testFileName}`
    });
  } catch (err: any) {
    console.error('Codegen launch error:', err);
    res.status(500).json({ error: err.message || 'Failed to launch codegen' });
  }
});

// Launch Playwright inspector to edit/debug an existing test
router.post('/:id/edit', async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await loadTest(CONFIG.DATA_DIR, testId);

    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const testFile = path.join(CONFIG.DATA_DIR, 'tests', `${testId}.spec.ts`);

    console.log(`[edit] Opening test file ${testId} in system editor`);

    // Open file in default system editor
    let command: string;
    let args: string[];

    if (process.platform === 'win32') {
      // On Windows, use 'start' to open with default editor
      command = 'cmd';
      args = ['/c', 'start', '', testFile];
    } else if (process.platform === 'darwin') {
      // On macOS, use 'open'
      command = 'open';
      args = [testFile];
    } else {
      // On Linux, use 'xdg-open'
      command = 'xdg-open';
      args = [testFile];
    }

    spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    }).unref();

    res.json({
      success: true,
      filePath: testFile,
      message: `Test file opened in your default editor. Make your changes and save the file.`
    });
  } catch (err: any) {
    console.error('Edit launch error:', err);
    res.status(500).json({ error: err.message || 'Failed to open editor' });
  }
});

// Finalize a recorded test by adding metadata
router.post('/:id/finalize', async (req, res) => {
  try {
    const testId = req.params.id;
    const { name, description, tags } = req.body;

    const testFile = path.join(CONFIG.DATA_DIR, 'tests', `${testId}.spec.ts`);

    // Read the raw generated code
    const fs = await import('fs/promises');
    let code: string;
    try {
      code = await fs.readFile(testFile, 'utf-8');
    } catch {
      return res.status(404).json({ error: 'Test file not found. Make sure you recorded something and closed the inspector.' });
    }

    // Create test with metadata
    const test: Test = {
      metadata: {
        id: testId,
        name: name || 'Recorded Test',
        description: description || 'Recorded with Playwright Inspector',
        tags: tags || ['recorded'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      code: code.trim()
    };

    // Save with proper metadata wrapper
    await saveTest(CONFIG.DATA_DIR, test);

    res.json({ success: true, test: test.metadata });
  } catch (err: any) {
    console.error('Finalize error:', err);
    res.status(500).json({ error: err.message || 'Failed to finalize test' });
  }
});

export default router;
