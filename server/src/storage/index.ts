import fs from 'fs/promises';
import path from 'path';

export * from './config.js';
export * from './tests.js';

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
}
