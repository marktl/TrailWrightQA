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

  it('should capture click events and emit step', async () => {
    const mockElement = {
      tagName: 'BUTTON',
      getAttribute: vi.fn((attr) => (attr === 'aria-label' ? 'Submit' : null)),
      textContent: 'Submit',
    };

    generator = new RecordModeGenerator({
      sessionId: 'test-session-123',
      name: 'Test Recording',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    const stepPromise = new Promise((resolve) => {
      generator.on('step', resolve);
    });

    await generator.start(mockBrowser);

    // Simulate click event
    const clickHandler = (mockPage.on as any).mock.calls.find(
      ([event]) => event === 'click'
    )?.[1];

    await clickHandler?.({ target: mockElement });

    const step = await stepPromise;
    expect(step).toMatchObject({
      interactionType: 'click',
      stepNumber: 1,
    });
  });

  it('should capture fill events on blur', async () => {
    const mockInput = {
      tagName: 'INPUT',
      getAttribute: vi.fn((attr) => {
        if (attr === 'type') return 'email';
        if (attr === 'aria-label') return 'Email';
        return null;
      }),
      value: 'test@example.com',
    };

    generator = new RecordModeGenerator({
      sessionId: 'test-session-123',
      name: 'Test Recording',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    await generator.start(mockBrowser);

    const inputHandler = (mockPage.on as any).mock.calls.find(
      ([event]) => event === 'input'
    )?.[1];
    const blurHandler = (mockPage.on as any).mock.calls.find(
      ([event]) => event === 'blur'
    )?.[1];

    const stepPromise = new Promise((resolve) => {
      generator.on('step', resolve);
    });

    // Simulate typing then blur
    await inputHandler?.({ target: mockInput, data: 'test@example.com' });
    await blurHandler?.({ target: mockInput });

    const step = await stepPromise;
    expect(step).toMatchObject({
      interactionType: 'fill',
      stepNumber: 1,
    });
    expect(step.qaSummary).toContain('test@example.com');
  });

  it('should capture select dropdown changes', async () => {
    const mockSelect = {
      tagName: 'SELECT',
      getAttribute: vi.fn((attr) => (attr === 'aria-label' ? 'Country' : null)),
      value: 'USA',
      options: [{ value: 'USA', text: 'United States' }],
      selectedIndex: 0,
    };

    generator = new RecordModeGenerator({
      sessionId: 'test-session-123',
      name: 'Test Recording',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    await generator.start(mockBrowser);

    const changeHandler = (mockPage.on as any).mock.calls.find(
      ([event]) => event === 'change'
    )?.[1];

    const stepPromise = new Promise((resolve) => {
      generator.on('step', resolve);
    });

    await changeHandler?.({ target: mockSelect });

    const step = await stepPromise;
    expect(step).toMatchObject({
      interactionType: 'select',
      stepNumber: 1,
    });
    expect(step.qaSummary).toContain('USA');
  });
});
