// server/src/playwright/recordingCapture.ts
import type { Page } from 'playwright';
import type { RecordedStep } from '../../../shared/types.js';
import { EventEmitter } from 'events';

export class RecordingCapture extends EventEmitter {
  private page: Page;
  private isRecording = false;
  private listenersInjected = false;
  private stepCounter = 0;
  private activeInputs = new Map<string, { value: string; startTime: number; element: any }>();

  constructor(page: Page, private startingStepNumber: number = 1) {
    super();
    this.page = page;
    this.stepCounter = startingStepNumber - 1;
  }

  async start(): Promise<void> {
    if (this.isRecording) return;

    this.isRecording = true;

    if (!this.listenersInjected) {
      await this.injectEventListeners();
      this.listenersInjected = true;
    }

    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.isRecording) return;
    this.isRecording = false;
    this.emit('stopped');
  }

  isActive(): boolean {
    return this.isRecording;
  }

  getStepCounter(): number {
    return this.stepCounter;
  }

  setStepCounter(value: number): void {
    this.stepCounter = value;
  }

  private async injectEventListeners(): Promise<void> {
    // Expose handler functions
    await (this.page as any).exposeFunction('__twHybridRecordClick', async (data: any) => {
      if (!this.isRecording) return;
      await this.handleClickEvent(data);
    });

    await (this.page as any).exposeFunction('__twHybridRecordInput', async (data: any) => {
      if (!this.isRecording) return;
      await this.handleInputEvent(data);
    });

    await (this.page as any).exposeFunction('__twHybridRecordBlur', async (data: any) => {
      if (!this.isRecording) return;
      await this.handleBlurEvent(data);
    });

    await (this.page as any).exposeFunction('__twHybridRecordChange', async (data: any) => {
      if (!this.isRecording) return;
      await this.handleChangeEvent(data);
    });

    // Inject event listeners via addInitScript
    const eventListenerScript = `
      if (window !== window.top) return;

      function isTrailWrightElement(el) {
        return el && (
          el.closest('#trailwright-recorder-toolbar') ||
          el.closest('#tw-assertion-modal') ||
          el.closest('#tw-modal-backdrop') ||
          el.closest('#trailwright-element-picker-overlay') ||
          el.closest('#tw-hybrid-record-indicator')
        );
      }

      document.addEventListener('click', (e) => {
        const target = e.target;
        if (isTrailWrightElement(target)) return;
        if (target.tagName === 'SELECT' || target.tagName === 'OPTION') return;
        const parentSelect = target.closest('select');
        if (parentSelect) return;

        window.__twHybridRecordClick && window.__twHybridRecordClick({
          tagName: target.tagName,
          type: target.type,
          role: target.getAttribute('role'),
          ariaLabel: target.getAttribute('aria-label'),
          textContent: target.textContent ? target.textContent.trim() : '',
          id: target.id,
          name: target.getAttribute('name'),
          className: target.className
        });
      }, true);

      document.addEventListener('input', (e) => {
        const target = e.target;
        if (isTrailWrightElement(target)) return;
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
          window.__twHybridRecordInput && window.__twHybridRecordInput({
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
        if (isTrailWrightElement(target)) return;
        if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
          window.__twHybridRecordBlur && window.__twHybridRecordBlur({
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
          window.__twHybridRecordChange && window.__twHybridRecordChange({
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
  }

  private async handleClickEvent(data: any): Promise<void> {
    const elementInfo = this.captureElementInfo(data);
    const currentUrl = this.page.url();
    const screenshotData = await this.captureScreenshot();

    let clickTarget = elementInfo.name || elementInfo.role;
    if (!clickTarget) {
      const idMatch = elementInfo.selector.match(/#([^'"]+)/);
      const nameMatch = elementInfo.selector.match(/\[name="([^"]+)"\]/);
      const textMatch = elementInfo.selector.match(/getByText\('([^']+)'\)/);
      if (idMatch) clickTarget = idMatch[1];
      else if (nameMatch) clickTarget = nameMatch[1];
      else if (textMatch) clickTarget = textMatch[1];
      else clickTarget = data?.tagName?.toLowerCase() || 'element';
    }

    const step: RecordedStep = {
      stepNumber: ++this.stepCounter,
      interactionType: 'click',
      elementInfo,
      qaSummary: `Click '${clickTarget}'`,
      playwrightCode: `await page.${elementInfo.selector}.click();`,
      timestamp: new Date().toISOString(),
      url: currentUrl,
      screenshotData
    };

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

    const elementInfo = this.captureElementInfo(inputData.element);
    const currentUrl = this.page.url();
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

    this.activeInputs.delete(selector);
    this.emit('step', step);
  }

  private async handleChangeEvent(data: any): Promise<void> {
    if (data?.tagName !== 'SELECT') return;

    const elementInfo = this.captureElementInfo(data);
    const selectedValue = data?.value;
    const currentUrl = this.page.url();
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

    this.emit('step', step);
  }

  private captureElementInfo(element: any): { role?: string; name?: string; selector: string } {
    const explicitRole = element?.role;
    const ariaLabel = element?.ariaLabel;
    const rawTextContent = element?.textContent;
    const elementName = element?.name;
    const elementId = element?.id;
    const tagName = element?.tagName?.toLowerCase?.() || 'div';
    const inputType = element?.type?.toLowerCase?.() || '';

    const MAX_TEXT_LENGTH = 80;
    let textContent: string | undefined;
    if (rawTextContent) {
      const sanitized = rawTextContent.replace(/\s+/g, ' ').trim();
      if (sanitized.length <= MAX_TEXT_LENGTH && !sanitized.includes('You must enter')) {
        textContent = sanitized;
      }
    }

    const accessibleName = ariaLabel || textContent || '';
    const displayName = accessibleName || elementName || '';

    let role = explicitRole;
    if (!role) {
      const roleMap: Record<string, string> = {
        'a': 'link', 'button': 'button', 'select': 'combobox',
        'textarea': 'textbox', 'img': 'img'
      };
      role = roleMap[tagName];

      if (tagName === 'input') {
        const inputRoleMap: Record<string, string> = {
          'button': 'button', 'submit': 'button', 'checkbox': 'checkbox',
          'radio': 'radio', 'text': 'textbox', 'email': 'textbox',
          'password': 'textbox', 'search': 'searchbox'
        };
        role = inputRoleMap[inputType] || 'textbox';
      }
    }

    let selector: string;
    if (role && accessibleName) {
      const escapedName = accessibleName.replace(/'/g, "\\'");
      selector = `getByRole('${role}', { name: '${escapedName}' })`;
    } else if (ariaLabel) {
      selector = `getByLabel('${ariaLabel.replace(/'/g, "\\'")}')`;
    } else if (elementId) {
      selector = `locator('#${elementId}')`;
    } else if (elementName) {
      selector = `locator('[name="${elementName}"]')`;
    } else if (textContent && textContent.length <= 50) {
      selector = `getByText('${textContent.replace(/'/g, "\\'")}')`;
    } else {
      selector = `locator('${tagName}')`;
      console.warn(`[RecordingCapture] Warning: Generic selector '${tagName}' generated - may be ambiguous`);
    }

    return { role, name: displayName, selector };
  }

  private generateUniqueSelector(element: any): string {
    const label = element?.ariaLabel || element?.name || element?.id || '';
    return `${element?.tagName || 'element'}-${label}`;
  }

  private async captureScreenshot(): Promise<string | undefined> {
    try {
      const buffer = await this.page.screenshot({ type: 'jpeg', quality: 80 });
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch {
      return undefined;
    }
  }
}
