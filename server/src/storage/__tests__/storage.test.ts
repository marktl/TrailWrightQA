import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initStorage, loadConfig, saveConfig, saveTest, loadTest, listTests } from '../index.js';
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

  it('should save and load test file', async () => {
    await initStorage(testDataDir);

    const test = {
      metadata: {
        id: 'login-test',
        name: 'Login Test',
        description: 'Test user login',
        createdAt: new Date().toISOString()
      },
      code: `import { test } from '@playwright/test';\ntest('login', async ({ page }) => {});`
    };

    await saveTest(testDataDir, test);
    const loaded = await loadTest(testDataDir, 'login-test');

    expect(loaded.metadata.name).toBe('Login Test');
    expect(loaded.code).toContain('test(\'login\'');
  });

  it('should list all tests', async () => {
    await initStorage(testDataDir);

    await saveTest(testDataDir, {
      metadata: { id: 'test1', name: 'Test 1', createdAt: new Date().toISOString() },
      code: 'test code 1'
    });

    await saveTest(testDataDir, {
      metadata: { id: 'test2', name: 'Test 2', createdAt: new Date().toISOString() },
      code: 'test code 2'
    });

    const tests = await listTests(testDataDir);
    expect(tests).toHaveLength(2);
    expect(tests.map(t => t.id)).toContain('test1');
    expect(tests.map(t => t.id)).toContain('test2');
  });
});
