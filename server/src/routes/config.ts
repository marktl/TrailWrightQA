import express from 'express';
import { loadConfig, saveConfig } from '../storage/config.js';
import { CONFIG } from '../config.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const config = await loadConfig(CONFIG.DATA_DIR);
    // Don't send full API key to client, just indicate if set
    res.json({
      ...config,
      apiKey: config.apiKey ? '***' + config.apiKey.slice(-4) : ''
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    await saveConfig(CONFIG.DATA_DIR, req.body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
