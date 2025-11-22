import type { Browser, Page } from 'playwright';
import { EventEmitter } from 'events';
import type { LiveGenerationState, RecordedStep } from '../../../shared/types.js';

export interface RecordModeConfig {
  sessionId: string;
  name: string;
  startUrl: string;
  description?: string;
  aiProvider: 'anthropic' | 'openai' | 'gemini';
  credentialId?: string;
}

export class RecordModeGenerator extends EventEmitter {
  public sessionId: string;
  public state: LiveGenerationState;
  private page?: Page;
  private browser?: Browser;
  private config: RecordModeConfig;
  private recordedSteps: RecordedStep[] = [];
  private stepCounter = 0;
  private activeInputs = new Map<string, { value: string; startTime: number; element: any }>();

  constructor(config: RecordModeConfig) {
    super();
    this.sessionId = config.sessionId;
    this.config = config;

    const now = new Date().toISOString();
    this.state = {
      sessionId: config.sessionId,
      status: 'initializing',
      startedAt: now,
      updatedAt: now,
      startUrl: config.startUrl,
      goal: config.description ?? '',
      currentUrl: '',
      stepsTaken: 0,
      maxSteps: 0,
      recordedSteps: [],
      logs: [],
      chat: [],
      mode: 'record',
      recordingActive: false,
      assertionPickerActive: false,
      testName: config.name,
      createdAt: now
    } as LiveGenerationState;
  }

  async start(browser: Browser): Promise<void> {
    this.browser = browser;
    this.page = await browser.newPage();

    this.setupEventListeners();

    this.state.status = 'running';
    this.state.recordingActive = true;
    this.state.updatedAt = new Date().toISOString();

    await this.page.goto(this.config.startUrl);

    this.emit('stateChange', this.state);
  }

  private setupEventListeners(): void {
    if (!this.page) return;

    // Click events
    (this.page as any).on('click', async (event: any) => {
      await this.handleClickEvent(event);
    });

    // Input events (track but don't record yet)
    (this.page as any).on('input', async (event: any) => {
      await this.handleInputEvent(event);
    });

    // Blur events (finalize input recording)
    (this.page as any).on('blur', async (event: any) => {
      await this.handleBlurEvent(event);
    });
  }

  private async handleClickEvent(event: any): Promise<void> {
    const elementInfo = await this.captureElementInfo(event.target);
    const currentUrl = typeof (this.page as any)?.url === 'function' ? this.page!.url() : '';

    const step: RecordedStep = {
      stepNumber: ++this.stepCounter,
      interactionType: 'click',
      elementInfo,
      qaSummary: `Click ${elementInfo.name || 'element'}`,
      playwrightCode: `await page.${elementInfo.selector}.click();`,
      timestamp: new Date().toISOString(),
      url: currentUrl
    };

    this.recordedSteps.push(step);
    this.state.recordedSteps = [...this.recordedSteps];
    this.state.steps = [...this.recordedSteps];
    this.state.stepsTaken = this.recordedSteps.length;
    this.state.updatedAt = new Date().toISOString();

    this.emit('step', step);
  }

  private async handleInputEvent(event: any): Promise<void> {
    const selector = await this.generateUniqueSelector(event.target);
    this.activeInputs.set(selector, {
      value: event.target?.value || event.data || '',
      startTime: Date.now(),
      element: event.target
    });
  }

  private async handleBlurEvent(event: any): Promise<void> {
    const selector = await this.generateUniqueSelector(event.target);
    const inputData = this.activeInputs.get(selector);

    if (!inputData) return;

    const elementInfo = await this.captureElementInfo(inputData.element);
    const currentUrl = typeof (this.page as any)?.url === 'function' ? this.page!.url() : '';

    const step: RecordedStep = {
      stepNumber: ++this.stepCounter,
      interactionType: 'fill',
      elementInfo,
      qaSummary: `Enter '${inputData.value}' into ${elementInfo.name || 'input'}`,
      playwrightCode: `await page.${elementInfo.selector}.fill('${inputData.value}');`,
      timestamp: new Date().toISOString(),
      url: currentUrl
    };

    this.recordedSteps.push(step);
    this.state.recordedSteps = [...this.recordedSteps];
    this.state.steps = [...this.recordedSteps];
    this.state.stepsTaken = this.recordedSteps.length;
    this.state.updatedAt = new Date().toISOString();
    this.activeInputs.delete(selector);

    this.emit('step', step);
  }

  private async captureElementInfo(element: any): Promise<{
    role?: string;
    name?: string;
    selector: string;
  }> {
    const role = element?.getAttribute?.('role');
    const ariaLabel = element?.getAttribute?.('aria-label');
    const name = ariaLabel || element?.textContent?.trim() || '';

    const selector = role && name
      ? `getByRole('${role}', { name: '${name}' })`
      : `locator('${element?.tagName?.toLowerCase?.() || 'div'}')`;

    return {
      role,
      name,
      selector
    };
  }

  private async generateUniqueSelector(element: any): Promise<string> {
    const label = element?.getAttribute?.('aria-label') || element?.getAttribute?.('name') || '';
    return `${element?.tagName || 'element'}-${label}`;
  }

  async cleanup(): Promise<void> {
    if (this.page && typeof (this.page as any).close === 'function') {
      await this.page.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }

  getState(): LiveGenerationState {
    return { ...this.state, recordedSteps: [...this.recordedSteps] };
  }

  getSteps(): RecordedStep[] {
    return [...this.recordedSteps];
  }
}
