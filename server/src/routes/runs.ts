import express from 'express';
import { runTest, getRunResult, listRuns } from '../playwright/runner.js';
import { CONFIG } from '../config.js';
import { spawn } from 'child_process';

const router = express.Router();

// Run a test
router.post('/', async (req, res) => {
  try {
    const { testId } = req.body;

    if (!testId) {
      return res.status(400).json({ error: 'testId is required' });
    }

    const result = await runTest({
      dataDir: CONFIG.DATA_DIR,
      testId
    });

    res.json({ result });
  } catch (err: any) {
    console.error('Test run error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all runs or runs for specific test
router.get('/', async (req, res) => {
  try {
    const { testId } = req.query;
    const runs = await listRuns(CONFIG.DATA_DIR, testId as string);
    res.json({ runs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single run result
router.get('/:runId', async (req, res) => {
  try {
    const result = await getRunResult(CONFIG.DATA_DIR, req.params.runId);
    res.json({ result });
  } catch (err: any) {
    res.status(404).json({ error: 'Run not found' });
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
    spawn('npx', ['playwright', 'show-trace', result.tracePath], {
      detached: true,
      stdio: 'ignore'
    }).unref();

    res.json({ success: true, message: 'Trace viewer opened' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
