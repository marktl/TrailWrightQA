import express from 'express';
import { generateTest } from '../ai/index.js';
import { saveTest, loadTest, listTests, deleteTest } from '../storage/tests.js';
import { loadConfig } from '../storage/config.js';
import { CONFIG } from '../config.js';
import type { Test } from '../../shared/types.js';

const router = express.Router();

// Generate test from AI prompt
router.post('/generate', async (req, res) => {
  try {
    const { prompt, baseUrl } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const config = await loadConfig(CONFIG.DATA_DIR);

    if (!config.apiKey) {
      return res.status(400).json({ error: 'API key not configured' });
    }

    const code = await generateTest({
      provider: config.apiProvider,
      apiKey: config.apiKey,
      prompt,
      baseUrl: baseUrl || config.baseUrl
    });

    res.json({ code });
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

export default router;
