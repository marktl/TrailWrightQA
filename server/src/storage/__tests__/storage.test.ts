import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initStorage, loadConfig, saveConfig } from '../index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Storage', () => {
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = path.join(os.tmpdir(), 'trailwright-test-' + Date.now());
  });

  afterEach(async () => {
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  it('should create data directories on init', async () => {
    await initStorage(testDataDir);

    const testsDir = await fs.stat(path.join(testDataDir, 'tests'));
    const runsDir = await fs.stat(path.join(testDataDir, 'runs'));
    const configFile = await fs.stat(path.join(testDataDir, 'config.json'));

    expect(testsDir.isDirectory()).toBe(true);
    expect(runsDir.isDirectory()).toBe(true);
    expect(configFile.isFile()).toBe(true);
  });

  it('should save and load config', async () => {
    await initStorage(testDataDir);

    const config = { apiProvider: 'openai', apiKey: 'sk-test' };
    await saveConfig(testDataDir, config);

    const loaded = await loadConfig(testDataDir);
    expect(loaded.apiProvider).toBe('openai');
    expect(loaded.apiKey).toBe('sk-test');
  });
});
