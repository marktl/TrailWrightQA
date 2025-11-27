import type { Browser, Page } from 'playwright';
import { EventEmitter } from 'events';
import type { LiveGenerationState, RecordedStep } from '../../../shared/types.js';
import { generateCodeFromInteraction } from '../ai/recordModePrompts.js';
import { TOOLBAR_HTML, TOOLBAR_LISTENER_SCRIPT, getToolbarUpdateScript, getAssertionModeScript, getShowAssertionModalScript, getHideAssertionModalScript } from './toolbarInjection.js';

export interface RecordModeConfig {
  sessionId: string;
  name: string;
  startUrl: string;
  description?: string;
  aiProvider: 'anthropic' | 'openai' | 'gemini';
  credentialId?: string;
}

interface Variable {
  name: string;
  sampleValue: string;
  type: 'string' | 'number';
}

interface PendingAssertion {
  elementInfo: { role?: string; name?: string; selector: string };
  elementText: string;
  url: string;
  screenshotData?: string;
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
  private variables: Variable[] = [];
  private pendingAssertion?: PendingAssertion;

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
    await this.injectToolbar();

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

    // Use string template for browser code to avoid TypeScript DOM errors
    const eventListenerScript = `
      document.addEventListener('click', (e) => {
        const target = e.target;

        // Ignore clicks on TrailWright toolbar and modal elements
        if (target.closest('#trailwright-recorder-toolbar') ||
            target.closest('#tw-assertion-modal') ||
            target.closest('#tw-modal-backdrop')) {
          return;
        }

        if (target.tagName === 'SELECT' || target.tagName === 'OPTION') return;
        const parentSelect = target.closest('select');
        if (parentSelect) return;

        window.__twRecordClick && window.__twRecordClick({
          tagName: target.tagName,
          type: target.type,
          role: target.getAttribute('role'),
          ariaLabel: target.getAttribute('aria-label'),
          textContent: target.textContent ? target.textContent.trim() : '',
          id: target.id,
          className: target.className
        });
      }, true);

      document.addEventListener('input', (e) => {
        const target = e.target;
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
          window.__twRecordInput && window.__twRecordInput({
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
        const target = e.target;
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
          window.__twRecordBlur && window.__twRecordBlur({
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
        const target = e.target;
        if (target.tagName === 'SELECT') {
          window.__twRecordChange && window.__twRecordChange({
            tagName: target.tagName,
            value: target.value,
            ariaLabel: target.getAttribute('aria-label'),
            name: target.name,
            id: target.id
          });
        }
      }, true);
    `;

    await (this.page as any).addInitScript(eventListenerScript);

    (this.page as any).on('framenavigated', async (frame: any) => {
      await this.handleNavigationEvent(frame);
    });
  }

  private async handleClickEvent(data: any): Promise<void> {
    const elementInfo = await this.captureElementInfo(data);
    const currentUrl = typeof (this.page as any)?.url === 'function' ? this.page!.url() : '';
    const screenshotData = await this.captureScreenshot();

    // If in assertion mode, show modal to let user choose assertion type
    if (this.state.assertionPickerActive) {
      // Store the pending assertion data
      this.pendingAssertion = {
        elementInfo,
        elementText: data?.textContent?.trim() || '',
        url: currentUrl,
        screenshotData
      };

      // Show the assertion type modal
      const elementName = elementInfo.name || elementInfo.role || 'element';
      const elementText = data?.textContent?.trim() || '';
      await this.showAssertionModal(elementName, elementText);
      return;
    }

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

    await this.updateToolbar();
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

    await this.updateToolbar();
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

    await this.updateToolbar();
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

    await this.updateToolbar();
    this.emit('step', step);
  }

  private async captureElementInfo(element: any): Promise<{
    role?: string;
    name?: string;
    selector: string;
  }> {
    const explicitRole = element?.role;
    const ariaLabel = element?.ariaLabel;
    const textContent = element?.textContent;
    const elementName = element?.name; // HTML name attribute (for form fields)
    const elementId = element?.id;
    const displayName = ariaLabel || textContent || elementName || '';
    const tagName = element?.tagName?.toLowerCase?.() || 'div';
    const inputType = element?.type?.toLowerCase?.() || '';

    // Infer implicit ARIA role from tagName when no explicit role is set
    let role = explicitRole;
    if (!role) {
      const roleMap: Record<string, string> = {
        'a': 'link',
        'button': 'button',
        'select': 'combobox',
        'textarea': 'textbox',
        'img': 'img',
        'nav': 'navigation',
        'main': 'main',
        'header': 'banner',
        'footer': 'contentinfo',
        'article': 'article',
        'aside': 'complementary',
        'section': 'region',
      };
      role = roleMap[tagName];

      // Special handling for input types
      if (tagName === 'input') {
        const inputRoleMap: Record<string, string> = {
          'button': 'button',
          'submit': 'button',
          'reset': 'button',
          'checkbox': 'checkbox',
          'radio': 'radio',
          'text': 'textbox',
          'email': 'textbox',
          'password': 'textbox',
          'search': 'searchbox',
          'tel': 'textbox',
          'url': 'textbox',
        };
        role = inputRoleMap[inputType] || 'textbox';
      }
    }

    // Generate selector with priority: role+name > label > id > name attr > tagName
    let selector: string;
    if (role && displayName) {
      // Escape single quotes in the name
      const escapedName = displayName.replace(/'/g, "\\'");
      selector = `getByRole('${role}', { name: '${escapedName}' })`;
    } else if (ariaLabel) {
      const escapedLabel = ariaLabel.replace(/'/g, "\\'");
      selector = `getByLabel('${escapedLabel}')`;
    } else if (elementId) {
      // Use ID selector for unique identification
      selector = `locator('#${elementId}')`;
    } else if (elementName) {
      // Use name attribute selector for form fields
      selector = `locator('[name="${elementName}"]')`;
    } else {
      // Last resort - generic tagName selector
      selector = `locator('${tagName}')`;
    }

    return {
      role,
      name: displayName,
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

  private async injectToolbar(): Promise<void> {
    if (!this.page) return;

    await (this.page as any).exposeFunction('__twStopRecording', async () => {
      await this.stop();
    });

    await (this.page as any).exposeFunction('__twStartAssertion', async () => {
      await this.startAssertionMode();
    });

    await (this.page as any).exposeFunction('__twConfirmAssertion', async (assertionType: string, assertionValue: string) => {
      await this.confirmAssertion(assertionType, assertionValue);
    });

    await (this.page as any).exposeFunction('__twCancelAssertion', async () => {
      await this.cancelAssertion();
    });

    // Inject toolbar using string template to avoid TypeScript DOM errors
    const toolbarInjectionScript = `
      console.log('[TrailWright] Init script running, readyState:', document.readyState);
      function injectToolbar() {
        console.log('[TrailWright] Injecting toolbar...');
        if (document.getElementById('trailwright-recorder-toolbar')) {
          console.log('[TrailWright] Toolbar already exists');
          return;
        }
        var wrapper = document.createElement('div');
        wrapper.innerHTML = ${JSON.stringify(TOOLBAR_HTML)};
        console.log('[TrailWright] Created wrapper with', wrapper.children.length, 'children');
        // Insert all children (toolbar, modal, backdrop, style)
        while (wrapper.firstChild) {
          document.body.insertBefore(wrapper.firstChild, document.body.firstChild);
        }
        console.log('[TrailWright] Toolbar injected successfully');
        eval(${JSON.stringify(TOOLBAR_LISTENER_SCRIPT)});
        console.log('[TrailWright] Listener script executed');
      }
      // Handle both cases: DOM not ready yet, or already loaded
      if (document.readyState === 'loading') {
        console.log('[TrailWright] Waiting for DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', injectToolbar);
      } else {
        injectToolbar();
      }
    `;
    await (this.page as any).addInitScript(toolbarInjectionScript);
  }

  private async updateToolbar(): Promise<void> {
    if (!this.page) return;

    try {
      await (this.page as any).evaluate((script: string) => {
        // eslint-disable-next-line no-eval
        eval(script);
      }, getToolbarUpdateScript(this.stepCounter));
    } catch {
      // Toolbar may not be ready; ignore errors
    }
  }

  async stop(): Promise<void> {
    this.state.recordingActive = false;
    this.state.status = 'paused';
    this.state.updatedAt = new Date().toISOString();

    // Update toolbar to show paused state
    try {
      const pausedScript = `
        var toolbar = document.getElementById('trailwright-recorder-toolbar');
        var stopBtn = document.getElementById('tw-stop-recording');
        var assertBtn = document.getElementById('tw-add-assertion');
        var recordingDot = document.getElementById('tw-recording-dot');
        var stepCount = document.getElementById('tw-step-count');

        if (toolbar) toolbar.style.background = 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)';
        if (recordingDot) { recordingDot.style.background = '#f59e0b'; recordingDot.style.animation = 'none'; }
        if (stepCount) stepCount.textContent = '⏸️ Paused - Edit steps or Resume';
        if (stopBtn) { stopBtn.textContent = '⚠️ Keep window open'; stopBtn.style.cursor = 'default'; stopBtn.style.background = 'rgba(255,255,255,0.4)'; }
        if (assertBtn) assertBtn.style.display = 'none';
      `;
      await (this.page as any).evaluate((script: string) => {
        // eslint-disable-next-line no-eval
        eval(script);
      }, pausedScript);
    } catch {
      // Toolbar may not be ready; ignore errors
    }

    this.emit('stateChange', this.getState());
  }

  async resume(): Promise<void> {
    this.state.recordingActive = true;
    this.state.status = 'running';
    this.state.updatedAt = new Date().toISOString();

    // Restore toolbar to recording state
    try {
      const resumeScript = `
        var toolbar = document.getElementById('trailwright-recorder-toolbar');
        var stopBtn = document.getElementById('tw-stop-recording');
        var assertBtn = document.getElementById('tw-add-assertion');
        var recordingDot = document.getElementById('tw-recording-dot');

        if (toolbar) toolbar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        if (recordingDot) { recordingDot.style.background = '#ef4444'; recordingDot.style.animation = 'tw-pulse 2s infinite'; }
        if (stopBtn) { stopBtn.textContent = 'Pause Recording'; stopBtn.style.cursor = 'pointer'; stopBtn.style.background = 'rgba(255,255,255,0.2)'; }
        if (assertBtn) assertBtn.style.display = '';
      `;
      await (this.page as any).evaluate((script: string) => {
        // eslint-disable-next-line no-eval
        eval(script);
      }, resumeScript);
    } catch {
      // Toolbar may not be ready; ignore errors
    }

    await this.updateToolbar();
    this.emit('stateChange', this.getState());
  }

  private async startAssertionMode(): Promise<void> {
    this.state.assertionPickerActive = true;
    this.state.updatedAt = new Date().toISOString();

    // Update toolbar to show assertion mode
    try {
      await (this.page as any).evaluate((script: string) => {
        // eslint-disable-next-line no-eval
        eval(script);
      }, getAssertionModeScript(true));
    } catch {
      // Toolbar may not be ready; ignore errors
    }

    this.emit('stateChange', this.getState());
  }

  private async endAssertionMode(): Promise<void> {
    this.state.assertionPickerActive = false;
    this.state.updatedAt = new Date().toISOString();

    // Update toolbar back to normal
    try {
      await (this.page as any).evaluate((script: string) => {
        // eslint-disable-next-line no-eval
        eval(script);
      }, getAssertionModeScript(false));
    } catch {
      // Toolbar may not be ready; ignore errors
    }

    await this.updateToolbar();
    this.emit('stateChange', this.getState());
  }

  private async showAssertionModal(elementName: string, elementText: string): Promise<void> {
    if (!this.page) return;

    try {
      await (this.page as any).evaluate((script: string) => {
        // eslint-disable-next-line no-eval
        eval(script);
      }, getShowAssertionModalScript(elementName, elementText));
    } catch (error) {
      console.error('Failed to show assertion modal:', error);
    }
  }

  private async hideAssertionModal(): Promise<void> {
    if (!this.page) return;

    try {
      await (this.page as any).evaluate((script: string) => {
        // eslint-disable-next-line no-eval
        eval(script);
      }, getHideAssertionModalScript());
    } catch (error) {
      console.error('Failed to hide assertion modal:', error);
    }
  }

  private async confirmAssertion(assertionType: string, assertionValue: string): Promise<void> {
    await this.hideAssertionModal();

    if (!this.pendingAssertion) {
      await this.endAssertionMode();
      return;
    }

    const { elementInfo, url, screenshotData, elementText } = this.pendingAssertion;
    const elementName = elementInfo.name || 'element';

    // Generate assertion code and summary based on type
    let playwrightCode: string;
    let qaSummary: string;

    switch (assertionType) {
      case 'text':
        const textToCheck = assertionValue || elementText;
        playwrightCode = `await expect(page.${elementInfo.selector}).toContainText('${textToCheck.replace(/'/g, "\\'")}');`;
        qaSummary = `Verify '${elementName}' contains text "${textToCheck}"`;
        break;
      case 'value':
        playwrightCode = `await expect(page.${elementInfo.selector}).toHaveValue('${assertionValue.replace(/'/g, "\\'")}');`;
        qaSummary = `Verify '${elementName}' has value "${assertionValue}"`;
        break;
      case 'url':
        playwrightCode = `await expect(page).toHaveURL(/${assertionValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/);`;
        qaSummary = `Verify page URL contains "${assertionValue}"`;
        break;
      case 'visible':
      default:
        playwrightCode = `await expect(page.${elementInfo.selector}).toBeVisible();`;
        qaSummary = `Verify '${elementName}' is visible`;
        break;
    }

    const step: RecordedStep = {
      stepNumber: ++this.stepCounter,
      interactionType: 'assert',
      elementInfo,
      qaSummary,
      playwrightCode,
      timestamp: new Date().toISOString(),
      url,
      screenshotData
    };

    this.recordedSteps.push(step);
    this.state.recordedSteps = [...this.recordedSteps];
    this.state.steps = [...this.recordedSteps];
    this.state.stepsTaken = this.recordedSteps.length;
    this.state.updatedAt = new Date().toISOString();

    this.pendingAssertion = undefined;
    await this.endAssertionMode();
    this.emit('step', step);
  }

  private async cancelAssertion(): Promise<void> {
    await this.hideAssertionModal();
    this.pendingAssertion = undefined;
    await this.endAssertionMode();
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
      .map((step, index) => {
        // Strip newlines from qaSummary to avoid breaking single-line comments
        const sanitizedSummary = step.qaSummary.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        const comment = `  // Step ${step.stepNumber}: ${sanitizedSummary}`;
        const code = `  ${step.playwrightCode}`;
        const wait = step.waitCode ? `  ${step.waitCode}` : '';
        // Add 500ms wait between steps (except after the last step)
        const defaultWait = index < this.recordedSteps.length - 1 ? '  await page.waitForTimeout(500);' : '';
        return [comment, code, wait, defaultWait].filter(Boolean).join('\n');
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

  // Step management methods
  deleteStep(stepNumber: number): void {
    const stepIndex = this.recordedSteps.findIndex(s => s.stepNumber === stepNumber);
    if (stepIndex === -1) {
      throw new Error('Step not found');
    }
    this.recordedSteps.splice(stepIndex, 1);
    this.state.recordedSteps = [...this.recordedSteps];
    this.state.steps = [...this.recordedSteps];
    this.state.stepsTaken = this.recordedSteps.length;
    this.state.updatedAt = new Date().toISOString();
    this.emit('stateChange', this.getState());
  }

  updateStep(stepNumber: number, updates: { qaSummary?: string; playwrightCode?: string }): void {
    const stepIndex = this.recordedSteps.findIndex(s => s.stepNumber === stepNumber);
    if (stepIndex === -1) {
      throw new Error('Step not found');
    }
    if (updates.qaSummary !== undefined) {
      this.recordedSteps[stepIndex].qaSummary = updates.qaSummary;
    }
    if (updates.playwrightCode !== undefined) {
      this.recordedSteps[stepIndex].playwrightCode = updates.playwrightCode;
    }
    this.state.recordedSteps = [...this.recordedSteps];
    this.state.steps = [...this.recordedSteps];
    this.state.updatedAt = new Date().toISOString();
    this.emit('stateChange', this.getState());
  }

  // Variable management methods
  getVariables(): Variable[] {
    return [...this.variables];
  }

  setVariable(name: string, sampleValue: string, type: 'string' | 'number' = 'string'): void {
    const existingIndex = this.variables.findIndex(v => v.name === name);
    if (existingIndex >= 0) {
      this.variables[existingIndex] = { name, sampleValue, type };
    } else {
      this.variables.push({ name, sampleValue, type });
    }
  }

  removeVariable(name: string): void {
    this.variables = this.variables.filter(v => v.name !== name);
  }
}
