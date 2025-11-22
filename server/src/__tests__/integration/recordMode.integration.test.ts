import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { RecordModeGenerator } from '../../playwright/recordModeGenerator.js';

describe('Record Mode Integration', () => {
  let browser: Browser | null;

  beforeAll(async () => {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      console.warn('Skipping integration test, unable to launch browser:', error);
      browser = null;
    }
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('should record a simple form interaction', async () => {
    if (!browser) {
      return;
    }

    const generator = new RecordModeGenerator({
      sessionId: 'integration-test',
      name: 'Form Test',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    const steps: any[] = [];
    generator.on('step', (step) => steps.push(step));

    await generator.start(browser);

    // Wait for page to load
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Simulate user interactions programmatically
    const page = (generator as any).page;
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('aria-label', 'Username');
      document.body.appendChild(input);

      input.focus();
      input.value = 'testuser';
      input.blur();
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0].interactionType).toBe('fill');
    expect(steps[0].playwrightCode).toContain('fill');

    await generator.cleanup();
  }, 30000);
});
