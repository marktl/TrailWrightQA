import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { resolveNpxInvocation } from '../utils/npx.js';

export * from './config.js';
export * from './tests.js';

async function ensurePlaywrightDependencies(dataDir: string): Promise<void> {
  const packageJsonPath = path.join(dataDir, 'package.json');
  const nodeModulesPath = path.join(dataDir, 'node_modules');

  // Check if @playwright/test is already installed
  try {
    await fs.access(path.join(nodeModulesPath, '@playwright', 'test'));
    return; // Already installed
  } catch {
    // Not installed, continue
  }

  // Create minimal package.json if it doesn't exist
  try {
    await fs.access(packageJsonPath);
  } catch {
    const packageJson = {
      name: 'trailwright-data',
      version: '1.0.0',
      private: true,
      description: 'TrailWright user data directory',
      dependencies: {}
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  // Install @playwright/test
  console.log('[storage] Installing Playwright dependencies in data directory...');
  const npx = await resolveNpxInvocation();
  const baseEnv = npx.env ?? process.env;

  return new Promise((resolve, reject) => {
    const proc = spawn(
      npx.command,
      [...npx.argsPrefix, 'npm', 'install', '@playwright/test@^1.56.1', '--save', '--no-audit', '--no-fund'],
      {
        cwd: dataDir,
        env: { ...baseEnv },
        stdio: 'pipe'
      }
    );

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[storage] Playwright dependencies installed successfully');
        resolve();
      } else {
        reject(new Error(`Failed to install Playwright dependencies: ${stderr}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

export async function initStorage(dataDir: string): Promise<void> {
  const testsDir = path.join(dataDir, 'tests');
  const runsDir = path.join(dataDir, 'runs');
  const configPath = path.join(dataDir, 'config.json');

  // Create directories
  await fs.mkdir(testsDir, { recursive: true });
  await fs.mkdir(runsDir, { recursive: true });

  // Create default config if doesn't exist
  try {
    await fs.access(configPath);
  } catch {
    const defaultConfig = {
      apiProvider: 'anthropic',
      apiKey: '',
      defaultBrowser: 'chromium',
      createdAt: new Date().toISOString()
    };
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
  }

  // Ensure Playwright dependencies are installed
  await ensurePlaywrightDependencies(dataDir);
}
