import fs from 'fs/promises';
import path from 'path';

export interface Config {
  apiProvider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  defaultBrowser?: 'chromium' | 'firefox' | 'webkit';
  defaultStartUrl?: string;
  baseUrl?: string;
  // Model selection per provider
  anthropicModel?: string;
  openaiModel?: string;
  geminiModel?: string;
}

// Available models for each provider
export const AVAILABLE_MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', description: 'Best balance of intelligence, speed, and cost (recommended)' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fast and cost-efficient' },
    { id: 'claude-opus-4-1', name: 'Claude Opus 4.1', description: 'Most capable for complex tasks' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude Sonnet 3.5 (legacy)', description: 'Previous generation' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5 (legacy)', description: 'Previous generation' }
  ],
  openai: [
    { id: 'gpt-5', name: 'GPT-5', description: 'Latest flagship model (recommended)' },
    { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Smaller, faster GPT-5 variant' },
    { id: 'gpt-5-nano', name: 'GPT-5 Nano', description: 'Fastest and most cost-efficient GPT-5' },
    { id: 'o3', name: 'o3', description: 'Latest reasoning model for complex tasks' },
    { id: 'o4-mini', name: 'o4-mini', description: 'Fast reasoning at lower cost' },
    { id: 'gpt-4o', name: 'GPT-4o (legacy)', description: 'Previous generation multimodal' }
  ],
  gemini: [
    { id: 'gemini-3-pro-preview', name: 'Gemini 3.0 Pro Preview', description: 'Best multimodal understanding (latest)' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Advanced reasoning model' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Best price-performance (recommended)' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Fastest and most cost-efficient' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (legacy)', description: 'Previous generation' }
  ]
} as const;

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
