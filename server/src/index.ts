import express from 'express';
import cors from 'cors';
import { CONFIG } from './config.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 TrailWright server running on http://localhost:${CONFIG.PORT}`);
});
