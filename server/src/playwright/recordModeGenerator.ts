import type { Browser, Page } from 'playwright';
import { EventEmitter } from 'events';
import type { LiveGenerationState, RecordedStep } from '../../../shared/types.js';
import { generateCodeFromInteraction } from '../ai/recordModePrompts.js';

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
  private initialNavigationDone = false;

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

    await this.setupEventListeners();

    this.state.status = 'running';
    this.state.recordingActive = true;
    this.state.updatedAt = new Date().toISOString();

    await this.page.goto(this.config.startUrl);

    this.emit('stateChange', this.state);
  }

  private async setupEventListeners(): Promise<void> {
    if (!this.page) return;

    await (this.page as any).exposeFunction('__twRecordClick', async (data: any) => {
      await this.handleClickEvent(data);
    });

    await (this.page as any).exposeFunction('__twRecordInput', async (data: any) => {
      await this.handleInputEvent(data);
    });

    await (this.page as any).exposeFunction('__twRecordBlur', async (data: any) => {
      await this.handleBlurEvent(data);
    });

    await (this.page as any).exposeFunction('__twRecordChange', async (data: any) => {
      await this.handleChangeEvent(data);
    });

    await (this.page as any).addInitScript(() => {
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        (window as any).__twRecordClick?.({
          tagName: target.tagName,
          role: target.getAttribute('role'),
          ariaLabel: target.getAttribute('aria-label'),
          textContent: target.textContent?.trim(),
          id: target.id,
          className: target.className
        });
      }, true);

      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
          (window as any).__twRecordInput?.({
            tagName: target.tagName,
            type: target.type,
            value: target.value,
            ariaLabel: target.getAttribute('aria-label'),
            name: target.getAttribute('name'),
            id: target.id
          });
        }
      }, true);

      document.addEventListener('blur', (e) => {
        const target = e.target as HTMLInputElement;
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
          (window as any).__twRecordBlur?.({
            tagName: target.tagName,
            type: target.type,
            value: target.value,
            ariaLabel: target.getAttribute('aria-label'),
            name: target.name,
            id: target.id
          });
        }
      }, true);

      document.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        if (target.tagName === 'SELECT') {
          (window as any).__twRecordChange?.({
            tagName: target.tagName,
            value: target.value,
            ariaLabel: target.getAttribute('aria-label'),
            name: target.name,
            id: target.id
          });
        }
      }, true);
    });

    (this.page as any).on('framenavigated', async (frame: any) => {
      await this.handleNavigationEvent(frame);
    });
  }

  private async handleClickEvent(data: any): Promise<void> {
    const elementInfo = await this.captureElementInfo(data);
    const currentUrl = typeof (this.page as any)?.url === 'function' ? this.page!.url() : '';
    const screenshotData = await this.captureScreenshot();

    const aiResponse = await generateCodeFromInteraction(
      {
        type: 'click',
        element: {
          role: elementInfo.role,
          name: elementInfo.name,
          tagName: data?.tagName
        }
      },
      {
        url: currentUrl,
        stepNumber: this.stepCounter + 1
      },
      this.config.aiProvider
    );

    const step: RecordedStep = {
      stepNumber: ++this.stepCounter,
      interactionType: 'click',
      elementInfo,
      qaSummary: aiResponse.qaSummary,
      playwrightCode: aiResponse.playwrightCode,
      timestamp: new Date().toISOString(),
      url: currentUrl,
      waitCode: aiResponse.waitHint || undefined,
      screenshotData
    };

    this.recordedSteps.push(step);
    this.state.recordedSteps = [...this.recordedSteps];
    this.state.steps = [...this.recordedSteps];
    this.state.stepsTaken = this.recordedSteps.length;
    this.state.updatedAt = new Date().toISOString();

    this.emit('step', step);
  }

  private async handleChangeEvent(data: any): Promise<void> {
    if (data?.tagName !== 'SELECT') return;

    const elementInfo = await this.captureElementInfo(data);
    const selectedValue = data?.value;
    const currentUrl = typeof (this.page as any)?.url === 'function' ? this.page!.url() : '';
    const screenshotData = await this.captureScreenshot();

    const step: RecordedStep = {
      stepNumber: ++this.stepCounter,
      interactionType: 'select',
      elementInfo,
      qaSummary: `Select '${selectedValue}' from ${elementInfo.name || 'dropdown'}`,
      playwrightCode: `await page.${elementInfo.selector}.selectOption('${selectedValue}');`,
      timestamp: new Date().toISOString(),
      url: currentUrl,
      screenshotData
    };

    this.recordedSteps.push(step);
    this.state.recordedSteps = [...this.recordedSteps];
    this.state.steps = [...this.recordedSteps];
    this.state.stepsTaken = this.recordedSteps.length;
    this.state.updatedAt = new Date().toISOString();

    this.emit('step', step);
  }

  private async handleNavigationEvent(frame: any): Promise<void> {
    // Skip the initial navigation to startUrl
    if (!this.initialNavigationDone) {
      this.initialNavigationDone = true;
      if (this.stepCounter === 0) {
        return;
      }
    }

    const mainFrame = typeof (this.page as any)?.mainFrame === 'function' ? this.page!.mainFrame() : undefined;
    if (mainFrame && frame !== mainFrame) return;

    const url = frame?.url ? frame.url() : '';
    const screenshotData = await this.captureScreenshot();

    const step: RecordedStep = {
      stepNumber: ++this.stepCounter,
      interactionType: 'navigate',
      elementInfo: {
        selector: ''
      },
      qaSummary: `Navigate to ${url}`,
      playwrightCode: `await page.goto('${url}');`,
      timestamp: new Date().toISOString(),
      url,
      screenshotData
    };

    this.recordedSteps.push(step);
    this.state.recordedSteps = [...this.recordedSteps];
    this.state.steps = [...this.recordedSteps];
    this.state.stepsTaken = this.recordedSteps.length;
    this.state.updatedAt = new Date().toISOString();

    this.emit('step', step);
  }

  private async handleInputEvent(data: any): Promise<void> {
    const selector = this.generateUniqueSelector(data);
    this.activeInputs.set(selector, {
      value: data?.value || '',
      startTime: Date.now(),
      element: data
    });
  }

  private async handleBlurEvent(data: any): Promise<void> {
    const selector = this.generateUniqueSelector(data);
    const inputData = this.activeInputs.get(selector);

    if (!inputData) return;

    const elementInfo = await this.captureElementInfo(inputData.element);
    const currentUrl = typeof (this.page as any)?.url === 'function' ? this.page!.url() : '';
    const screenshotData = await this.captureScreenshot();

    const step: RecordedStep = {
      stepNumber: ++this.stepCounter,
      interactionType: 'fill',
      elementInfo,
      qaSummary: `Enter '${inputData.value}' into ${elementInfo.name || 'input'}`,
      playwrightCode: `await page.${elementInfo.selector}.fill('${inputData.value}');`,
      timestamp: new Date().toISOString(),
      url: currentUrl,
      screenshotData
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
    const role = element?.role;
    const ariaLabel = element?.ariaLabel;
    const textContent = element?.textContent;
    const name = ariaLabel || textContent || element?.name || '';
    const tagName = element?.tagName?.toLowerCase?.() || 'div';

    const selector = role && name
      ? `getByRole('${role}', { name: '${name}' })`
      : ariaLabel
        ? `getByLabel('${ariaLabel}')`
        : `locator('${tagName}')`;

    return {
      role,
      name,
      selector
    };
  }

  private generateUniqueSelector(element: any): string {
    const label = element?.ariaLabel || element?.name || element?.id || '';
    return `${element?.tagName || 'element'}-${label}`;
  }

  private async captureScreenshot(): Promise<string | undefined> {
    if (!this.page || typeof (this.page as any).screenshot !== 'function') {
      return undefined;
    }

    try {
      const screenshotBuffer = await (this.page as any).screenshot({
        type: 'jpeg',
        quality: 80
      });
      if (!screenshotBuffer) {
        return undefined;
      }

      const buffer = Buffer.isBuffer(screenshotBuffer) ? screenshotBuffer : Buffer.from(screenshotBuffer);
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      return undefined;
    }
  }

  async stop(): Promise<void> {
    this.state.recordingActive = false;
    this.state.status = 'completed';
    this.state.updatedAt = new Date().toISOString();
    this.emit('stateChange', this.getState());
  }

  async generateTestFile(): Promise<string> {
    const imports = `import { test, expect } from '@playwright/test';`;

    const metadata = {
      id: this.sessionId,
      name: this.config.name,
      mode: 'record',
      createdAt: new Date().toISOString()
    };

    const metadataComment = `/**
 * // === TRAILWRIGHT_METADATA ===
 * ${JSON.stringify(metadata, null, 2)}
 */`;

    const testSteps = this.recordedSteps
      .map((step) => {
        const comment = `  // Step ${step.stepNumber}: ${step.qaSummary}`;
        const code = `  ${step.playwrightCode}`;
        const wait = step.waitCode ? `  ${step.waitCode}` : '';
        return [comment, code, wait].filter(Boolean).join('\n');
      })
      .join('\n\n');

    const testBody = `test('${this.config.name}', async ({ page }) => {
${testSteps}
});`;

    return `${metadataComment}\n${imports}\n\n${testBody}\n`;
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
