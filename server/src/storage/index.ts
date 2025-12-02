import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { resolveNpxInvocation } from '../utils/npx.js';
import { ensureCredentialHelper } from './credentialBridge.js';

export * from './config.js';
export * from './tests.js';
export * from './credentials.js';
export * from './variables.js';

async function ensurePlaywrightDependencies(dataDir: string): Promise<void> {
  if (
    process.env.TRAILWRIGHT_SKIP_PLAYWRIGHT_INSTALL === '1' ||
    process.env.VITEST === '1' ||
    process.env.VITEST === 'true'
  ) {
    return;
  }
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

  // Ensure dataDir exists before spawning (spawn requires cwd to exist)
  await fs.mkdir(dataDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn(
      npx.command,
      [...npx.argsPrefix, 'npm', 'install', '@playwright/test@^1.56.1', 'csv-parse@^5.5.0', '--save', '--no-audit', '--no-fund'],
      {
        cwd: dataDir,
        env: { ...baseEnv },
        stdio: 'pipe',
        shell: process.platform === 'win32'
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
  const testDataDir = path.join(dataDir, 'test-data');
  const configPath = path.join(dataDir, 'config.json');

  // Check for custom test directory from environment variable
  const envTestsDir = process.env.TRAILWRIGHT_TESTS_DIR?.trim();

  // Create directories
  await fs.mkdir(testsDir, { recursive: true });
  await fs.mkdir(runsDir, { recursive: true });
  await fs.mkdir(testDataDir, { recursive: true });

  // If custom test directory is set via env var, ensure it exists
  if (envTestsDir) {
    await fs.mkdir(envTestsDir, { recursive: true });
  }

  // Create default config if doesn't exist
  let configExists = false;
  try {
    await fs.access(configPath);
    configExists = true;
  } catch {
    const defaultConfig: Record<string, any> = {
      apiProvider: 'anthropic',
      apiKey: '',
      defaultBrowser: 'chromium',
      createdAt: new Date().toISOString()
    };
    // Apply env var test directory on first run
    if (envTestsDir) {
      defaultConfig.testDirectory = envTestsDir;
      console.log(`[storage] Using custom test directory from TRAILWRIGHT_TESTS_DIR: ${envTestsDir}`);
    }
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
  }

  // If config exists but testDirectory not set, and env var is provided, update config
  if (configExists && envTestsDir) {
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      if (!config.testDirectory) {
        config.testDirectory = envTestsDir;
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        console.log(`[storage] Applied TRAILWRIGHT_TESTS_DIR to existing config: ${envTestsDir}`);
      }
    } catch (err) {
      console.error('[storage] Failed to update config with TRAILWRIGHT_TESTS_DIR:', err);
    }
  }

  // Ensure Playwright dependencies are installed
  await ensurePlaywrightDependencies(dataDir);
  await ensureCredentialHelper(dataDir);
}
