import path from 'path';
import fs from 'fs/promises';

export function generatePlaywrightConfig(dataDir: string): string {
  return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [
    ['html', { outputFolder: 'runs/latest/html-report', open: 'never' }],
    ['json', { outputFile: 'runs/latest/results.json' }]
  ],
});
`;
}

export async function ensurePlaywrightConfig(dataDir: string): Promise<void> {
  const configPath = path.join(dataDir, 'playwright.config.ts');

  try {
    await fs.access(configPath);
  } catch {
    const config = generatePlaywrightConfig(dataDir);
    await fs.writeFile(configPath, config);
  }
}
