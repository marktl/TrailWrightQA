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
    const updates = { ...req.body };

    // If apiKey looks masked (starts with ***), don't update it
    if (updates.apiKey && updates.apiKey.startsWith('***')) {
      delete updates.apiKey;
    }

    await saveConfig(CONFIG.DATA_DIR, updates);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
