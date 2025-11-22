import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RecordModeGenerator } from '../recordModeGenerator';
import { generateCodeFromInteraction } from '../../ai/recordModePrompts.js';
import type { Page, Browser } from 'playwright';

vi.mock('../../ai/recordModePrompts.js', () => ({
  generateCodeFromInteraction: vi.fn(),
}));

describe('RecordModeGenerator', () => {
  let generator: RecordModeGenerator;
  let mockPage: Page;
  let mockBrowser: Browser;
  let exposedFunctions: Record<string, any>;

  beforeEach(() => {
    exposedFunctions = {};
    vi.clearAllMocks();

    mockPage = {
      on: vi.fn(),
      goto: vi.fn(),
      evaluate: vi.fn(),
      screenshot: vi.fn(),
    } as any;
    (mockPage as any).exposeFunction = vi.fn(async (name, fn) => {
      exposedFunctions[name] = fn;
    });
    (mockPage as any).addInitScript = vi.fn();
    (mockPage as any).url = vi.fn().mockReturnValue('https://example.com');
    (mockPage as any).mainFrame = vi.fn();
    (mockPage as any).close = vi.fn();

    mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn(),
    } as any;

    (generateCodeFromInteraction as any).mockResolvedValue({
      playwrightCode: '',
      qaSummary: 'Perform action',
      waitHint: null,
    });
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

    const clickHandler = exposedFunctions.__twRecordClick;

    await clickHandler?.({
      tagName: mockElement.tagName,
      role: 'button',
      ariaLabel: 'Submit',
      textContent: 'Submit'
    });

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

    const inputHandler = exposedFunctions.__twRecordInput;
    const blurHandler = exposedFunctions.__twRecordBlur;

    const stepPromise = new Promise((resolve) => {
      generator.on('step', resolve);
    });

    // Simulate typing then blur
    await inputHandler?.({
      tagName: mockInput.tagName,
      type: 'email',
      ariaLabel: 'Email',
      value: 'test@example.com',
      name: 'email'
    });
    await blurHandler?.({
      tagName: mockInput.tagName,
      type: 'email',
      ariaLabel: 'Email',
      value: 'test@example.com',
      name: 'email'
    });

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

    const changeHandler = exposedFunctions.__twRecordChange;

    const stepPromise = new Promise((resolve) => {
      generator.on('step', resolve);
    });

    await changeHandler?.({
      tagName: mockSelect.tagName,
      ariaLabel: 'Country',
      value: 'USA',
      name: 'country'
    });

    const step = await stepPromise;
    expect(step).toMatchObject({
      interactionType: 'select',
      stepNumber: 1,
    });
    expect(step.qaSummary).toContain('USA');
  });

  it('should capture navigation events', async () => {
    generator = new RecordModeGenerator({
      sessionId: 'test-session-123',
      name: 'Test Recording',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    await generator.start(mockBrowser);

    const navHandler = (mockPage.on as any).mock.calls.find(
      ([event]) => event === 'framenavigated'
    )?.[1];

    const stepPromise = new Promise((resolve) => {
      generator.on('step', resolve);
    });

    const mockFrame = {
      url: () => 'https://example.com/dashboard',
    };

    // Simulate navigation (skip initial page load)
    (generator as any).stepCounter = 1;
    await navHandler?.(mockFrame, (mockPage as any).mainFrame?.());

    const step = await stepPromise;
    expect(step).toMatchObject({
      interactionType: 'navigate',
    });
    expect(step.qaSummary).toContain('dashboard');
  });

  it('should use AI to generate code for interactions', async () => {
    const mockAIResponse = {
      playwrightCode: "await page.getByRole('button', { name: 'Submit' }).click();",
      qaSummary: "Click 'Submit' button",
      waitHint: null,
    };

    (generateCodeFromInteraction as any).mockResolvedValue(mockAIResponse);

    generator = new RecordModeGenerator({
      sessionId: 'test-session-123',
      name: 'Test Recording',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    await generator.start(mockBrowser);

    const clickHandler = exposedFunctions.__twRecordClick;

    const stepPromise = new Promise((resolve) => {
      generator.on('step', resolve);
    });

    const mockElement = {
      tagName: 'BUTTON',
      getAttribute: vi.fn(() => 'Submit'),
      textContent: 'Submit',
    };

    await clickHandler?.({
      tagName: mockElement.tagName,
      ariaLabel: 'Submit',
      textContent: 'Submit',
    });

    const step = await stepPromise;
    expect(step.playwrightCode).toBe(mockAIResponse.playwrightCode);
    expect(step.qaSummary).toBe(mockAIResponse.qaSummary);
  });

  it('should capture screenshots for each step', async () => {
    const mockScreenshotBuffer = Buffer.from('fake-image-data');
    (mockPage as any).screenshot = vi.fn().mockResolvedValue(mockScreenshotBuffer);

    generator = new RecordModeGenerator({
      sessionId: 'test-session-123',
      name: 'Test Recording',
      startUrl: 'https://example.com',
      aiProvider: 'anthropic',
    });

    await generator.start(mockBrowser);

    const stepPromise = new Promise((resolve) => {
      generator.on('step', resolve);
    });

    const clickHandler = exposedFunctions.__twRecordClick;

    await clickHandler?.({
      tagName: 'BUTTON',
      textContent: 'Submit',
      ariaLabel: 'Submit'
    });

    const step = await stepPromise;
    expect(step.screenshotData).toBeDefined();
    expect((mockPage as any).screenshot).toHaveBeenCalledWith({ type: 'jpeg', quality: 80 });
  });
});
