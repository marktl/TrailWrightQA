import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecordModeGenerator } from '../recordModeGenerator';
import type { Page, Browser } from 'playwright';

describe('RecordModeGenerator', () => {
  let generator: RecordModeGenerator;
  let mockPage: Page;
  let mockBrowser: Browser;

  beforeEach(() => {
    mockPage = {
      on: vi.fn(),
      goto: vi.fn(),
      evaluate: vi.fn(),
      screenshot: vi.fn(),
    } as any;

    mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn(),
    } as any;
  });

  afterEach(async () => {
    if (generator) {
      await generator.cleanup();
    }
  });

  it('should initialize with session config', async () => {
    generator = new RecordModeGenerator({
      sessionId: 'test-session-123',
      name: 'Test Recording',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    expect(generator.sessionId).toBe('test-session-123');
    expect(generator.state.mode).toBe('record');
    expect(generator.state.recordingActive).toBe(false);
  });

  it('should start recording and navigate to start URL', async () => {
    generator = new RecordModeGenerator({
      sessionId: 'test-session-123',
      name: 'Test Recording',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    await generator.start(mockBrowser);

    expect(generator.state.recordingActive).toBe(true);
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com');
  });
});
