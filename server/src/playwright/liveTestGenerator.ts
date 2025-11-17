import { chromium, Browser, Page } from 'playwright';
import { EventEmitter } from 'events';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  LiveGenerationOptions,
  LiveGenerationState,
  LiveGenerationEvent,
  GenerationStatus,
  RecordedStep,
  AIAction,
  CaptureMode,
  ChatMessage
} from '../../../shared/types.js';
import type { TestMetadata, CredentialRecord } from '../types.js';
import { capturePageState, formatPageStateForAI, resetHashTracking } from './pageStateCapture.js';
import { executeAction, createRecordedStep } from './actionExecutor.js';
import { AGENT_SYSTEM_PROMPT, buildAgentPrompt, generateTestName } from '../ai/agentPrompts.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { AIProvider } from '../ai/index.js';
import { CONFIG } from '../config.js';

const DEFAULT_MAX_STEPS = 20;

type NormalizedGenerationOptions = {
  startUrl: string;
  goal: string;
  maxSteps: number;
  captureMode: CaptureMode;
  successCriteria?: string;
  keepBrowserOpen: boolean;
};

export class LiveTestGenerator extends EventEmitter {
  private sessionId: string;
  private status: GenerationStatus = 'initializing';
  private browser: Browser | null = null;
  private page: Page | null = null;
  private recordedSteps: RecordedStep[] = [];
  private logs: string[] = [];
  private chat: ChatMessage[] = [];
  private startedAt: string;
  private updatedAt: string;
  private currentUrl: string = '';
  private error?: string;
  private storageReady = false;
  private storageErrorLogged = false;
  private screenshotCaptureErrorLogged = false;
  private assetRootDir: string;
  private sessionDir: string;
  private screenshotDir: string;
  private persistedTest?: TestMetadata;
  private credential?: CredentialRecord;

  private options: NormalizedGenerationOptions;
  private provider: AIProvider;
  private apiKey: string;
  private baseUrl?: string;
  private isPaused = false;
  private isRunning = false;
  private nextStepNumber = 1;
  private userCorrections: string[] = [];

  constructor(
    options: LiveGenerationOptions,
    provider: AIProvider,
    apiKey: string,
    baseUrl?: string,
    credential?: CredentialRecord
  ) {
    super();
    this.sessionId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = new Date().toISOString();
    this.updatedAt = this.startedAt;
    this.assetRootDir = path.join(CONFIG.DATA_DIR, 'live-generation');
    this.sessionDir = path.join(this.assetRootDir, this.sessionId);
    this.screenshotDir = path.join(this.sessionDir, 'screenshots');

    // Set defaults
    this.options = {
      startUrl: options.startUrl,
      goal: options.goal,
      maxSteps: options.maxSteps || DEFAULT_MAX_STEPS,
      captureMode: options.captureMode || 'accessibility',
      successCriteria: options.successCriteria?.trim() || undefined,
      keepBrowserOpen: Boolean(options.keepBrowserOpen)
    };

    this.provider = provider;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.credential = credential;

    this.setMaxListeners(100);
  }

  get id(): string {
    return this.sessionId;
  }

  getState(): LiveGenerationState {
    return {
      sessionId: this.sessionId,
      status: this.status,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      startUrl: this.options.startUrl,
      goal: this.options.goal,
      currentUrl: this.currentUrl,
      stepsTaken: this.recordedSteps.length,
      maxSteps: this.options.maxSteps,
      successCriteria: this.options.successCriteria,
      recordedSteps: [...this.recordedSteps],
      logs: [...this.logs],
      chat: [...this.chat],
      error: this.error,
      savedTestId: this.persistedTest?.id,
      keepBrowserOpen: this.options.keepBrowserOpen,
      credentialId: this.credential?.id,
      credentialSummary: this.credential
        ? {
            id: this.credential.id,
            name: this.credential.name,
            username: this.credential.username,
            notes: this.credential.notes
          }
        : undefined
    };
  }

  /**
   * Start the live test generation process
   */
  async start(): Promise<void> {
    try {
      this.isPaused = false;
      this.isRunning = false;
      this.userCorrections = [];
      this.nextStepNumber = Math.max(1, this.recordedSteps.length + 1);

      this.updateStatus('initializing');
      await this.prepareStorage(true);

      // Launch browser in headed mode
      this.browser = await chromium.launch({ headless: false });
      const context = await this.browser.newContext();
      this.page = await context.newPage();
      context.setDefaultTimeout(120000);
      context.setDefaultNavigationTimeout(120000);
      this.page.setDefaultTimeout(120000);
      this.page.setDefaultNavigationTimeout(120000);

      resetHashTracking();

      await this.page.goto(this.options.startUrl, { waitUntil: 'domcontentloaded' });
      this.currentUrl = this.page.url();

      this.updateStatus('running');

      // Run the agent loop
      await this.runAgentLoop();
    } catch (error: any) {
      this.handleError(error);
    }
  }

  /**
   * Main agent loop - iteratively decide and execute actions
   */
  private async runAgentLoop(): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      while (this.nextStepNumber <= this.options.maxSteps) {
        if (this.isPaused) {
          return;
        }

        const step = this.nextStepNumber;
        const maxRetries = 2;
        let retryCount = 0;
        let lastError: string | undefined;
        let actionSucceeded = false;

        while (retryCount <= maxRetries && !actionSucceeded) {
          // Capture page state
          const pageState = await capturePageState(this.page);
          this.currentUrl = pageState.url;

          this.emit('event', {
            type: 'page_changed',
            timestamp: new Date().toISOString(),
            payload: { url: pageState.url, title: pageState.title }
          });

          // Ask AI for next action
          this.updateStatus('thinking');
          const action = await this.decideNextAction(
            pageState.hasChanged ? formatPageStateForAI(pageState) : '(page unchanged)',
            lastError
          );

          if (this.isPaused) {
            return;
          }

          // Check if done
          if (action.action === 'done') {
            if (this.userCorrections.length > 0) {
              this.userCorrections = [];
            }
            this.log(`✓ Goal achieved: ${action.reasoning}`);
            this.updateStatus('completed');
            await this.finalize();
            return;
          }

          // Execute action
          this.updateStatus('running');

          const result = await executeAction(this.page, action);

          if (!result.success) {
            lastError = result.error;
            retryCount++;

            if (retryCount <= maxRetries) {
              this.log(`⚠️ Action failed (attempt ${retryCount}/${maxRetries + 1}): ${result.error}`);
              this.log(`Asking AI to try a different approach...`);
              // Loop continues with lastError passed to AI
              continue;
            } else {
              // All retries exhausted - pause and ask user for help
              await this.handleRetriesExhausted(action, result.error);
              return;
            }
          }

          // Action succeeded
          actionSucceeded = true;

          // Allow page to settle before capturing screenshot
          await this.page.waitForTimeout(500);
          const screenshot = await this.captureStepScreenshot(step);

          // Record step
          const recorded = createRecordedStep(step, action, {
            url: this.currentUrl,
            screenshotPath: screenshot?.path,
            screenshotData: screenshot?.data
          });
          this.recordedSteps.push(recorded);
          this.nextStepNumber = this.recordedSteps.length + 1;
          this.consumeUserCorrection();

          this.emit('event', {
            type: 'step_recorded',
            timestamp: new Date().toISOString(),
            payload: recorded
          });

          this.log(`${step}. ${recorded.qaSummary}`);
          this.touch();
        }
      }

      // Max steps reached
      this.log(`Maximum steps reached`);
      this.updateStatus('failed');
      this.error = 'Maximum steps reached without completing goal';
      await this.finalize();
    } catch (error: any) {
      this.handleError(error);
    } finally {
      this.isRunning = false;
      if (this.status !== 'paused') {
        this.isPaused = false;
      }
    }
  }

  /**
   * Call AI to decide next action
   */
  private async decideNextAction(pageState: string, previousError?: string): Promise<AIAction> {
    const prompt = this.buildContextualPrompt(pageState, previousError);

    this.emit('event', {
      type: 'ai_thinking',
      timestamp: new Date().toISOString(),
      payload: { prompt }
    });

    let responseText: string;

    try {
      switch (this.provider) {
        case 'anthropic':
          responseText = await this.callAnthropic(prompt);
          break;
        case 'openai':
          responseText = await this.callOpenAI(prompt);
          break;
        case 'gemini':
          responseText = await this.callGemini(prompt);
          break;
        default:
          throw new Error(`Unsupported provider: ${this.provider}`);
      }

      // Parse JSON response
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const action: AIAction = JSON.parse(cleaned);

      // Validate action
      if (!action.action || !action.reasoning) {
        throw new Error('Invalid AI response: missing required fields');
      }

      return action;
    } catch (error: any) {
      throw new Error(`AI decision failed: ${error.message}`);
    }
  }

  private buildContextualPrompt(pageState: string, previousError?: string): string {
    let prompt = buildAgentPrompt(
      this.options.goal,
      this.currentUrl,
      pageState,
      this.recordedSteps,
      this.options.successCriteria
    );

    if (this.credential) {
      prompt += `\n\nCREDENTIALS AVAILABLE:\n- Name: ${this.credential.name}\n- Username: ${
        this.credential.username
      }\n- Password: ${this.credential.password}\n${
        this.credential.notes ? `- Notes: ${this.credential.notes}` : ''
      }\nUse these when authentication is required.`;
    }

    if (this.recordedSteps.length > 0) {
      const recentSteps = this.recordedSteps
        .slice(-5)
        .map((step) => `- Step ${step.stepNumber}: ${step.qaSummary}`)
        .join('\n');
      prompt += `\n\nRECENT STEPS COMPLETED:\n${recentSteps}`;
    }

    if (previousError) {
      prompt += `\n\n🚨 PREVIOUS ACTION FAILED:\nError: ${previousError}\n\nThe selector or approach you just tried didn't work. Analyze the error carefully and try a DIFFERENT approach:\n- If "strict mode violation", the selector matched multiple elements - use more specific selectors with exact: true\n- If "timeout", the element may not exist or have a different accessible name\n- Review the error details and adjust your selector accordingly\n- DO NOT repeat the same selector that just failed`;
    }

    if (this.userCorrections.length > 0) {
      const corrections = this.userCorrections
        .map((correction, index) => `${index + 1}. ${correction}`)
        .join('\n');
      prompt += `\n\n⚠️ IMMEDIATE USER CORRECTIONS (handle next, then return to original goal):\n${corrections}\n\nIMPORTANT: After addressing the correction above, CONTINUE pursuing the original goal: "${this.options.goal}"`;
    }

    return prompt;
  }

  private async callAnthropic(prompt: string): Promise<string> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      system: AGENT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }

    return content.text;
  }

  private async callOpenAI(prompt: string): Promise<string> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    return content;
  }

  private async callGemini(prompt: string): Promise<string> {
    const genAI = new GoogleGenAI({ apiKey: this.apiKey });
    const result = await genAI.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt,
      config: {
        systemInstruction: AGENT_SYSTEM_PROMPT,
        responseMimeType: 'application/json'
      }
    });

    const text = result.text;
    if (!text) {
      throw new Error('No response from Gemini');
    }

    return text;
  }

  /**
   * Finalize and cleanup
   */
  private async finalize(): Promise<void> {
    this.emit('event', {
      type: 'completed',
      timestamp: new Date().toISOString(),
      payload: this.getState()
    });

    this.isRunning = false;
    this.isPaused = false;

    if (this.browser) {
      if (this.options.keepBrowserOpen) {
        this.log('Browser left open for inspection.');
      } else {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    }
  }

  updateGoal(newGoal: string): void {
    const trimmed = newGoal.trim();
    if (!trimmed) {
      throw new Error('Goal cannot be empty');
    }

    this.options.goal = trimmed;
    this.log(`Goal updated`);
    this.touch();
  }

  updateMaxSteps(newMaxSteps: number): void {
    if (!Number.isFinite(newMaxSteps) || Number.isNaN(newMaxSteps)) {
      throw new Error('Max steps must be a valid number');
    }

    const rounded = Math.floor(newMaxSteps);
    if (rounded < 1) {
      throw new Error('Max steps must be at least 1');
    }

    if (rounded > 200) {
      throw new Error('Max steps cannot exceed 200');
    }

    this.options.maxSteps = rounded;
    this.nextStepNumber = this.recordedSteps.length + 1;
    this.log(`Max steps updated to ${rounded}`);
    this.touch();
  }

  updateSuccessCriteria(newCriteria: string | undefined): void {
    const trimmed = newCriteria?.trim();
    this.options.successCriteria = trimmed || undefined;
    this.touch();
  }

  updateKeepBrowserOpen(keepOpen: boolean): void {
    this.options.keepBrowserOpen = keepOpen;
    this.log(keepOpen ? 'Will leave browser open when run completes' : 'Browser will close automatically on completion');
    this.touch();
  }

  pause(): void {
    if (this.status !== 'running' && this.status !== 'thinking') {
      return;
    }

    this.isPaused = true;
    this.updateStatus('paused');
  }

  resume(userCorrection?: string): void {
    if (this.status !== 'paused') {
      return;
    }

    const correction = userCorrection?.trim();
    if (correction) {
      this.addChatMessage('user', correction);
      this.userCorrections.push(correction);
      this.log(`User feedback received`);
    }

    // Reset hash tracking to force fresh page state capture
    resetHashTracking();

    this.isPaused = false;
    this.updateStatus('running');
    void this.runAgentLoop();
  }

  async continueWithFeedback(userMessage: string): Promise<void> {
    const trimmed = userMessage.trim();
    if (!trimmed) {
      throw new Error('Message cannot be empty');
    }

    if (this.status === 'running' || this.status === 'thinking' || this.status === 'initializing') {
      throw new Error('Generation must be paused or stopped before sending feedback');
    }

    // Add user message to chat
    this.addChatMessage('user', trimmed);

    // Add to corrections for AI context
    this.userCorrections.push(trimmed);
    this.log(`User: ${trimmed}`);

    // If completed/stopped/failed, re-initialize browser and continue
    if (this.status === 'completed' || this.status === 'stopped' || this.status === 'failed') {
      this.error = undefined;

      // Re-open browser if closed
      if (!this.browser || !this.page) {
        this.browser = await chromium.launch({ headless: false });
        const context = await this.browser.newContext();
        this.page = await context.newPage();
        context.setDefaultTimeout(120000);
        context.setDefaultNavigationTimeout(120000);
        this.page.setDefaultTimeout(120000);
        this.page.setDefaultNavigationTimeout(120000);

        // Navigate to current URL or start URL
        const targetUrl = this.currentUrl || this.options.startUrl;
        await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
        this.currentUrl = this.page.url();
      }

      // Reset hash tracking to force fresh page state capture
      resetHashTracking();

      this.updateStatus('running');
      void this.runAgentLoop();
    } else if (this.status === 'paused') {
      // If paused, resume with the feedback
      this.resume();
    }

    this.touch();
  }

  async deleteStep(stepNumber: number): Promise<void> {
    const index = this.recordedSteps.findIndex((step) => step.stepNumber === stepNumber);
    if (index === -1) {
      throw new Error(`Step ${stepNumber} not found`);
    }

    const [removed] = this.recordedSteps.splice(index, 1);
    await this.deleteScreenshotAsset(removed);

    for (let i = index; i < this.recordedSteps.length; i += 1) {
      this.recordedSteps[i].stepNumber = i + 1;
    }

    this.nextStepNumber = this.recordedSteps.length + 1;
    this.touch();

    this.emit('event', {
      type: 'step_deleted',
      timestamp: new Date().toISOString(),
      payload: { deletedStepNumber: stepNumber }
    });
  }

  async suggestTestName(): Promise<string> {
    if (!this.recordedSteps.length) {
      throw new Error('No recorded steps available for naming');
    }

    const summaries = this.recordedSteps.map((step) => step.qaSummary);
    return generateTestName(this.options.goal, summaries, this.provider, this.apiKey, this.baseUrl);
  }

  /**
   * Stop the generation
   */
  async stop(): Promise<void> {
    this.isPaused = true;
    this.isRunning = false;
    this.updateStatus('stopped');
    this.log('Generation stopped by user request.');
    await this.finalize();
  }

  async restart(): Promise<void> {
    // Stop current execution
    this.isPaused = false;
    this.isRunning = false;

    // Close existing browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }

    // Clear all state
    this.recordedSteps = [];
    this.logs = [];
    this.chat = [];
    this.userCorrections = [];
    this.error = undefined;
    this.nextStepNumber = 1;
    this.persistedTest = undefined;

    // Reset tracking
    resetHashTracking();

    // Restart
    this.log('Restarting generation from beginning...');
    await this.start();
  }

  markTestPersisted(metadata: TestMetadata): void {
    this.persistedTest = metadata;
    this.touch();
  }

  updateStartUrl(newUrl: string): void {
    const trimmed = newUrl.trim();
    if (!trimmed) {
      throw new Error('Start URL cannot be empty');
    }

    this.options.startUrl = trimmed;
    this.log(`Start URL updated`);
    this.touch();
  }

  /**
   * Generate the complete test file code
   */
  generateTestCode(): string {
    const startUrlLiteral = JSON.stringify(this.options.startUrl);
    const stepComments = this.recordedSteps
      .map((step) => `  // ${step.stepNumber}. ${step.qaSummary}`)
      .join('\n');

    const stepCode = this.recordedSteps
      .map((step) => `  ${step.playwrightCode}`)
      .join('\n');

    return `import { test, expect } from '@playwright/test';

test('${this.options.goal}', async ({ page }) => {
  // Navigate to starting URL
  await page.goto(${startUrlLiteral});

${stepComments}

${stepCode}
});`;
  }

  // Helper methods

  private async prepareStorage(clearExisting: boolean = false): Promise<void> {
    this.storageReady = false;

    try {
      await fs.mkdir(this.assetRootDir, { recursive: true });

      if (clearExisting) {
        await fs.rm(this.sessionDir, { recursive: true, force: true });
      }

      await fs.mkdir(this.sessionDir, { recursive: true });
      await fs.mkdir(this.screenshotDir, { recursive: true });

      this.storageReady = true;
      this.storageErrorLogged = false;
      this.screenshotCaptureErrorLogged = false;
    } catch (error) {
      this.storageReady = false;

      if (!this.storageErrorLogged) {
        this.log('⚠️ Unable to store step screenshots for this session.');
        this.storageErrorLogged = true;
      }

      console.error(`[generator] Failed to prepare screenshot storage for session ${this.sessionId}`, error);
    }
  }

  private async captureStepScreenshot(
    stepNumber: number
  ): Promise<{ path: string; data: string } | undefined> {
    if (!this.page || !this.storageReady) {
      return undefined;
    }

    const paddedStep = String(stepNumber).padStart(3, '0');
    const uniqueId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const filename = `step-${paddedStep}-${uniqueId}.png`;
    const filePath = path.join(this.screenshotDir, filename);

    try {
      const buffer = await this.page.screenshot({
        path: filePath,
        fullPage: this.options.captureMode === 'screenshot'
      });

      const dataUri = `data:image/png;base64,${buffer.toString('base64')}`;
      return {
        path: `/api/generate/${this.sessionId}/screenshots/${filename}`,
        data: dataUri
      };
    } catch (error) {
      if (!this.screenshotCaptureErrorLogged) {
        this.log('⚠️ Unable to capture step screenshots. Continuing without images.');
        this.screenshotCaptureErrorLogged = true;
      }
      console.error(
        `[generator] Failed to capture screenshot for session ${this.sessionId} step ${stepNumber}`,
        error
      );
      return undefined;
    }
  }

  private async deleteScreenshotAsset(step: RecordedStep | undefined): Promise<void> {
    if (!step?.screenshotPath) {
      return;
    }

    const filename = path.basename(step.screenshotPath);
    const filePath = path.join(this.screenshotDir, filename);

    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.warn(
          `[generator] Failed to delete screenshot ${filename} for session ${this.sessionId}`,
          error
        );
      }
    }
  }

  private addChatMessage(role: ChatMessage['role'], message: string): ChatMessage {
    const chatMessage: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      message,
      timestamp: new Date().toISOString()
    };

    this.chat.push(chatMessage);
    this.emit('event', {
      type: 'chat',
      timestamp: chatMessage.timestamp,
      payload: chatMessage
    });
    this.touch();
    return chatMessage;
  }

  private consumeUserCorrection(): void {
    if (!this.userCorrections.length) {
      return;
    }

    this.userCorrections.shift();

    if (!this.userCorrections.length) {
      this.log(`✓ User feedback addressed. Resuming original goal: "${this.options.goal}"`);
    }
  }

  private log(message: string): void {
    this.logs.push(message);
    this.emit('event', {
      type: 'log',
      timestamp: new Date().toISOString(),
      payload: { message }
    });
    this.touch();
  }

  private updateStatus(status: GenerationStatus): void {
    this.status = status;
    this.emit('event', {
      type: 'status',
      timestamp: new Date().toISOString(),
      payload: { status }
    });
    this.touch();
  }

  private isTimeoutError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('timeout') ||
      normalized.includes('timed out') ||
      normalized.includes('timedout') ||
      normalized.includes('time out') ||
      normalized.includes('deadline exceeded') ||
      normalized.includes('deadline_exceeded')
    );
  }

  private handleTimeoutError(rawMessage: string): void {
    const friendlyMessage =
      'I timed out while deciding the next step and paused. Please confirm if the success criteria are met or describe the next action you want me to take.';

    console.warn(`[generator] Timeout while deciding next action for session ${this.sessionId}`, rawMessage);

    this.error = undefined;
    this.isRunning = false;
    this.isPaused = true;

    this.log('⚠️ Timed out while deciding the next action. Waiting for your guidance.');
    this.addChatMessage('assistant', friendlyMessage);
    this.updateStatus('paused');
  }

  private async handleRetriesExhausted(failedAction: AIAction, error: string): Promise<void> {
    this.log(`❌ Action failed after 3 attempts: ${error}`);
    this.log(`Browser left open for inspection.`);

    // Generate AI summary of what was tried
    const summary = await this.generateErrorSummary(failedAction, error);

    this.isPaused = true;
    this.isRunning = false;
    this.updateStatus('paused');

    // Add AI message with summary and request for help
    const helpMessage = `I tried multiple approaches but couldn't complete this action:\n\n${summary}\n\nPlease review the browser window and provide guidance on how to proceed, or use the restart button to try a different approach.`;
    this.addChatMessage('assistant', helpMessage);
  }

  private async generateErrorSummary(action: AIAction, error: string): Promise<string> {
    const recentSteps = this.recordedSteps
      .slice(-3)
      .map((step) => `- ${step.qaSummary}`)
      .join('\n');

    const prompt = `You encountered an error while automating a web page. Provide a brief, helpful summary for the user.

Goal: ${this.options.goal}
Recent steps completed:
${recentSteps || 'None yet'}

Last attempted action: ${action.action} ${action.selector || ''} ${action.value || ''}
Error: ${error}

Provide a 2-3 sentence summary explaining:
1. What you were trying to do
2. Why it failed (in simple terms)
3. What might help (e.g., "The field label might be different" or "The element might not be visible yet")

Keep it non-technical and actionable. Do not use markdown.`;

    try {
      let summary = '';
      switch (this.provider) {
        case 'anthropic': {
          const client = new Anthropic({ apiKey: this.apiKey });
          const message = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt }]
          });
          const content = message.content[0];
          if (content.type === 'text') {
            summary = content.text;
          }
          break;
        }
        case 'openai': {
          const client = new OpenAI({ apiKey: this.apiKey });
          const completion = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200
          });
          summary = completion.choices[0]?.message?.content || '';
          break;
        }
        case 'gemini': {
          const genAI = new GoogleGenAI({ apiKey: this.apiKey });
          const result = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
          });
          summary = result.text || '';
          break;
        }
      }
      return summary.trim() || `I attempted to ${action.reasoning || action.action} but encountered: ${error}`;
    } catch {
      return `I attempted to ${action.reasoning || action.action} but encountered: ${error}`;
    }
  }

  private handleError(error: any): void {
    const message =
      error && typeof error.message === 'string' ? error.message : String(error);

    if (this.isTimeoutError(message)) {
      this.handleTimeoutError(message);
      return;
    }

    this.error = message;
    this.isPaused = false;
    this.isRunning = false;
    this.log(`Error: ${message}`);
    this.updateStatus('failed');
    this.emit('event', {
      type: 'error',
      timestamp: new Date().toISOString(),
      payload: { message }
    });
    void this.finalize();
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}
