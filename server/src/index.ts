import express from 'express';
import cors from 'cors';
import { CONFIG } from './config.js';
import { initStorage } from './storage/index.js';
import { ensurePlaywrightConfig } from './playwright/config.js';
import testsRouter from './routes/tests.js';
import runsRouter from './routes/runs.js';

const app = express();

app.use(cors());
app.use(express.json());

// Initialize storage on startup
await initStorage(CONFIG.DATA_DIR);
console.log(`📁 Data directory: ${CONFIG.DATA_DIR}`);

await ensurePlaywrightConfig(CONFIG.DATA_DIR);
console.log(`🎭 Playwright configured`);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/tests', testsRouter);
app.use('/api/runs', runsRouter);

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 TrailWright server running on http://localhost:${CONFIG.PORT}`);
});
