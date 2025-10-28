import fs from 'fs/promises';
import path from 'path';

export interface Config {
  apiProvider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  defaultBrowser?: 'chromium' | 'firefox' | 'webkit';
  baseUrl?: string;
}

export async function loadConfig(dataDir: string): Promise<Config> {
  const configPath = path.join(dataDir, 'config.json');
  const content = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

export async function saveConfig(dataDir: string, config: Partial<Config>): Promise<void> {
  const configPath = path.join(dataDir, 'config.json');
  const existing = await loadConfig(dataDir);
  const updated = { ...existing, ...config };
  await fs.writeFile(configPath, JSON.stringify(updated, null, 2));
}
