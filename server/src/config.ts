import os from 'os';
import path from 'path';

export const CONFIG = {
  PORT: process.env.PORT || 3210,
  DATA_DIR: process.env.TRAILWRIGHT_DATA_DIR || path.join(os.homedir(), '.trailwright'),
  NODE_ENV: process.env.NODE_ENV || 'development'
} as const;

export const PATHS = {
  TESTS: path.join(CONFIG.DATA_DIR, 'tests'),
  RUNS: path.join(CONFIG.DATA_DIR, 'runs'),
  CONFIG: path.join(CONFIG.DATA_DIR, 'config.json'),
  PLAYWRIGHT_CONFIG: path.join(CONFIG.DATA_DIR, 'playwright.config.ts')
} as const;
