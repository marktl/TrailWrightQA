import { chromium, Browser, Page } from 'playwright';
import { EventEmitter } from 'events';
import type {
  LiveGenerationOptions,
  LiveGenerationState,
  LiveGenerationEvent,
  GenerationStatus,
  RecordedStep,
  AIAction,
  CaptureMode
} from '../../../shared/types.js';
import { capturePageState, formatPageStateForAI, resetHashTracking } from './pageStateCapture.js';
import { executeAction, createRecordedStep } from './actionExecutor.js';
import { AGENT_SYSTEM_PROMPT, buildAgentPrompt } from '../ai/agentPrompts.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { AIProvider } from '../ai/index.js';

const DEFAULT_MAX_STEPS = 20;

export class LiveTestGenerator extends EventEmitter {
  private sessionId: string;
  private status: GenerationStatus = 'initializing';
  private browser: Browser | null = null;
  private page: Page | null = null;
  private recordedSteps: RecordedStep[] = [];
  private logs: string[] = [];
  private startedAt: string;
  private updatedAt: string;
  private currentUrl: string = '';
  private error?: string;

  private options: Required<LiveGenerationOptions>;
  private provider: AIProvider;
  private apiKey: string;

  constructor(
    options: LiveGenerationOptions,
    provider: AIProvider,
    apiKey: string
  ) {
    super();
    this.sessionId = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = new Date().toISOString();
    this.updatedAt = this.startedAt;

    // Set defaults
    this.options = {
      startUrl: options.startUrl,
      goal: options.goal,
      maxSteps: options.maxSteps || DEFAULT_MAX_STEPS,
      captureMode: options.captureMode || 'accessibility'
    };

    this.provider = provider;
    this.apiKey = apiKey;

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
      currentUrl: this.currentUrl,
      stepsTaken: this.recordedSteps.length,
      maxSteps: this.options.maxSteps,
      recordedSteps: [...this.recordedSteps],
      logs: [...this.logs],
      error: this.error
    };
  }

  /**
   * Start the live test generation process
   */
  async start(): Promise<void> {
    try {
      this.log('Initializing browser...');
      this.updateStatus('initializing');

      // Launch browser in headed mode
      this.browser = await chromium.launch({ headless: false });
      const context = await this.browser.newContext();
      this.page = await context.newPage();

      resetHashTracking();

      this.log(`Navigating to ${this.options.startUrl}...`);
      await this.page.goto(this.options.startUrl, { waitUntil: 'domcontentloaded' });
      this.currentUrl = this.page.url();

      this.log('Starting AI agent loop...');
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

    for (let step = 1; step <= this.options.maxSteps; step++) {
      try {
        this.log(`Step ${step}/${this.options.maxSteps}: Analyzing page...`);

        // Capture page state
        const pageState = await capturePageState(this.page);
        this.currentUrl = pageState.url;

        // Only send to AI if page changed or first step
        if (!pageState.hasChanged && step > 1) {
          this.log('Page unchanged, asking AI to decide next action...');
        }

        this.emit('event', {
          type: 'page_changed',
          timestamp: new Date().toISOString(),
          payload: { url: pageState.url, title: pageState.title }
        });

        // Ask AI for next action
        this.updateStatus('thinking');
        const action = await this.decideNextAction(pageState.hasChanged ? formatPageStateForAI(pageState) : '(page unchanged)');

        // Check if done
        if (action.action === 'done') {
          this.log(`Goal achieved: ${action.reasoning}`);
          this.updateStatus('completed');
          await this.finalize();
          return;
        }

        // Execute action
        this.log(`Executing: ${action.reasoning}`);
        this.updateStatus('running');

        const result = await executeAction(this.page, action);

        if (!result.success) {
          throw new Error(`Action failed: ${result.error}`);
        }

        // Record step
        const recorded = createRecordedStep(step, action);
        this.recordedSteps.push(recorded);

        this.emit('event', {
          type: 'step_recorded',
          timestamp: new Date().toISOString(),
          payload: recorded
        });

        this.log(`✓ ${recorded.qaSummary}`);
        this.touch();

        // Small delay to let page settle
        await this.page.waitForTimeout(500);
      } catch (error: any) {
        this.handleError(error);
        return;
      }
    }

    // Max steps reached
    this.log(`Max steps (${this.options.maxSteps}) reached. Stopping.`);
    this.updateStatus('failed');
    this.error = 'Maximum steps reached without completing goal';
    await this.finalize();
  }

  /**
   * Call AI to decide next action
   */
  private async decideNextAction(pageState: string): Promise<AIAction> {
    const prompt = buildAgentPrompt(
      this.options.goal,
      this.currentUrl,
      pageState,
      this.recordedSteps
    );

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

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Stop the generation
   */
  async stop(): Promise<void> {
    this.log('Stopping generation...');
    this.updateStatus('stopped');
    await this.finalize();
  }

  /**
   * Generate the complete test file code
   */
  generateTestCode(): string {
    const stepComments = this.recordedSteps
      .map((step) => `  // ${step.stepNumber}. ${step.qaSummary}`)
      .join('\n');

    const stepCode = this.recordedSteps
      .map((step) => `  ${step.playwrightCode}`)
      .join('\n');

    return `import { test, expect } from '@playwright/test';

test('${this.options.goal}', async ({ page }) => {
${stepComments}

${stepCode}
});`;
  }

  // Helper methods

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

  private handleError(error: any): void {
    const message = error.message || String(error);
    this.error = message;
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
