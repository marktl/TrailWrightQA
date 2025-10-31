import os from 'os';
import path from 'path';

const DEFAULT_API_PORT = 3210;
const FRONTEND_DEV_PORT = 3000;

function resolveApiPort() {
  const requested =
    process.env.TRAILWRIGHT_API_PORT ||
    process.env.TRAILWRIGHT_PORT ||
    process.env.PORT;

  if (requested) {
    const parsed = Number.parseInt(requested, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      if (parsed === FRONTEND_DEV_PORT) {
        console.warn(
          `[config] Requested API port ${parsed} conflicts with the web client; falling back to ${DEFAULT_API_PORT}.`
        );
        return DEFAULT_API_PORT;
      }
      return parsed;
    }
  }

  return DEFAULT_API_PORT;
}

// Resolve project root - go up from server/dist or server/src to project root
const currentFileDir = path.dirname(new URL(import.meta.url).pathname);
const isInDist = currentFileDir.includes(path.join('server', 'dist'));
const PROJECT_ROOT = isInDist
  ? path.resolve(currentFileDir, '..', '..') // from server/dist to project root
  : path.resolve(currentFileDir, '..', '..'); // from server/src to project root

export const CONFIG = {
  PORT: resolveApiPort(),
  DATA_DIR: process.env.TRAILWRIGHT_DATA_DIR || path.join(os.homedir(), '.trailwright'),
  PROJECT_ROOT,
  NODE_ENV: process.env.NODE_ENV || 'development'
} as const;

export const PATHS = {
  TESTS: path.join(CONFIG.DATA_DIR, 'tests'),
  RUNS: path.join(CONFIG.DATA_DIR, 'runs'),
  CONFIG: path.join(CONFIG.DATA_DIR, 'config.json'),
  PLAYWRIGHT_CONFIG: path.join(CONFIG.DATA_DIR, 'playwright.config.js')
} as const;
