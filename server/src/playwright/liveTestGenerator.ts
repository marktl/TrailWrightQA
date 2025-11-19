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
  ChatMessage,
  ViewportSize,
  GenerationMode,
  StepPlan,
  PlannedStep
} from '../../../shared/types.js';
import type { TestMetadata, CredentialRecord } from '../types.js';
import { capturePageState, formatPageStateForAI, resetHashTracking } from './pageStateCapture.js';
import { executeAction, createRecordedStep, generatePlaywrightCode, generateQASummary } from './actionExecutor.js';
import { AGENT_SYSTEM_PROMPT, STEP_PLANNER_SYSTEM_PROMPT, buildAgentPrompt, buildStepPlannerPrompt, generateTestName } from '../ai/agentPrompts.js';
import { TestCodeGenerator } from './testCodeGenerator.js';
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
  viewportSize?: ViewportSize;
  mode: GenerationMode;
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
  private mode: GenerationMode;

  private options: NormalizedGenerationOptions;
  private provider: AIProvider;
  private apiKey: string;
  private baseUrl?: string;
  private isPaused = false;
  private isRunning = false;
  private nextStepNumber = 1;
  private userCorrections: string[] = [];
  private beforeManualInterventionState?: any;
  private pendingManualAction?: { action: AIAction; playwrightCode: string; qaSummary: string };
  private activeManualInstruction?: string;
  private manualInterruptRequested = false;
  private variables: Map<string, { name: string; type: string; sampleValue?: string }> = new Map();
  private originalManualInstruction?: string; // Stores instruction with {{placeholders}}
  private pendingPlan?: StepPlan; // For manual mode: plan awaiting user approval

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
    this.mode = options.mode === 'manual' ? 'manual' : 'auto';
    this.options = {
      startUrl: options.startUrl,
      goal: options.goal,
      maxSteps: options.maxSteps || DEFAULT_MAX_STEPS,
      captureMode: options.captureMode || 'accessibility',
      successCriteria: options.successCriteria?.trim() || undefined,
      keepBrowserOpen: Boolean(options.keepBrowserOpen),
      viewportSize: options.viewportSize,
      mode: this.mode
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

  isManualMode(): boolean {
    return this.mode === 'manual';
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
        : undefined,
      mode: this.mode,
      pendingPlan: this.pendingPlan
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
      const contextOptions: any = {};
      if (this.options.viewportSize) {
        contextOptions.viewport = this.options.viewportSize;
      }
      const context = await this.browser.newContext(contextOptions);
      this.page = await context.newPage();
      // Reduced timeouts for faster failure detection and user feedback
      context.setDefaultTimeout(30000); // 30 seconds for element operations
      context.setDefaultNavigationTimeout(60000); // 60 seconds for page loads
      this.page.setDefaultTimeout(30000);
      this.page.setDefaultNavigationTimeout(60000);

      resetHashTracking();

      await this.page.goto(this.options.startUrl, { waitUntil: 'domcontentloaded' });
      this.currentUrl = this.page.url();

      if (this.isManualMode()) {
        this.log('Step-by-step builder ready. Describe what should happen next and I will execute each action until it is complete.');
        this.addChatMessage(
          'assistant',
          'Step-by-step mode engaged. Describe the next browser behavior (e.g., "Fill out the entire registration form with..."). I will keep going until it is complete. Use the Interrupt button if you need me to pause.'
        );
        this.enterManualAwaitingState();
        return;
      }

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
  private async runAgentLoop(options?: { singleStep?: boolean; manualInstruction?: string }): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    if (this.isRunning) {
      if (options?.manualInstruction) {
        throw new Error('Already executing an action');
      }
      return;
    }

    this.isRunning = true;
    const manualInstruction = options?.manualInstruction?.trim();
    const enforceSingleStep = Boolean(options?.singleStep && !manualInstruction);

    try {
      while (this.nextStepNumber <= this.options.maxSteps) {
        if (manualInstruction && this.manualInterruptRequested) {
          const interrupted = this.clearManualInstruction() || manualInstruction;
          this.log(`⏹️ Step-by-step instruction interrupted: "${interrupted}"`);
          this.addChatMessage('assistant', 'Interrupt acknowledged. Describe the next action when you are ready.');
          this.enterManualAwaitingState();
          this.touch();
          return;
        }

        if (this.isPaused && !manualInstruction) {
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
            if (manualInstruction) {
              const finishedInstruction = this.clearManualInstruction() || manualInstruction;
              const reasoning =
                action.reasoning?.trim() ||
                `I believe "${manualInstruction}" is already complete.`;
              this.log(`✓ Finished step-by-step instruction: "${finishedInstruction}"`);
              this.addChatMessage(
                'assistant',
                `${reasoning}\n\nDescribe the next browser action when you're ready.`
              );
              this.enterManualAwaitingState();
              return;
            } else {
              if (this.userCorrections.length > 0) {
                this.userCorrections = [];
              }
              this.log(`✓ Goal achieved: ${action.reasoning}`);
              this.updateStatus('completed');
              await this.finalize();
              return;
            }
          }

          // Execute action
          this.updateStatus('running');

          const result = await executeAction(this.page, action);

          if (!result.success) {
            lastError = result.error;
            retryCount++;

            // Capture screenshot of failure for debugging
            const failureScreenshot = await this.captureFailureScreenshot(step, retryCount);

            if (retryCount <= maxRetries) {
              this.log(`⚠️ Action failed (attempt ${retryCount}/${maxRetries + 1}): ${result.error}`);
              this.log(`Asking AI to try a different approach...`);
              // Loop continues with lastError and screenshot passed to AI
              continue;
            } else if (manualInstruction) {
              await this.handleManualInstructionFailure(
                manualInstruction,
                action,
                result.error,
                failureScreenshot
              );
              return;
            } else {
              // All retries exhausted - pause and ask user for help
              await this.handleRetriesExhausted(action, result.error, failureScreenshot);
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

          // If using variables in manual mode, inject placeholders back into code
          if (this.variables.size > 0 && manualInstruction) {
            recorded.playwrightCode = this.injectPlaceholdersIntoCode(recorded.playwrightCode);
          }

          this.recordedSteps.push(recorded);
          this.nextStepNumber = this.recordedSteps.length + 1;
          this.consumeUserCorrection();

          this.emit('event', {
            type: 'step_recorded',
            timestamp: new Date().toISOString(),
            payload: recorded
          });

          this.log(`${step}. ${recorded.qaSummary}`);

          if (manualInstruction) {
            this.addChatMessage('assistant', `Step recorded: ${recorded.qaSummary}`);
          }

          if (enforceSingleStep) {
            this.enterManualAwaitingState();
            this.touch();
            return;
          }

          this.touch();
        }
      }

      // Max steps reached
      this.log(`Maximum steps reached`);
      this.updateStatus('failed');
      this.error = 'Maximum steps reached without completing goal';
      await this.finalize();
    } catch (error: any) {
      if (manualInstruction) {
              await this.handleManualUnexpectedError(manualInstruction, error);
      } else {
        this.handleError(error);
      }
    } finally {
      this.isRunning = false;
      if (this.status === 'awaiting_input') {
        this.isPaused = true;
      } else if (this.status !== 'paused') {
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
    const manualInstruction = this.activeManualInstruction?.trim();
    const effectiveGoal = manualInstruction
      ? `Step-by-step instruction: ${manualInstruction}\n\nOriginal session goal: ${this.options.goal}`
      : this.options.goal;

    let prompt = buildAgentPrompt(
      effectiveGoal,
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

    if (manualInstruction) {
      prompt += `\n\nSTEP-BY-STEP COLLABORATION CONTEXT:\n- Follow this instruction precisely: ${manualInstruction}\n- Continue taking actions until this instruction is fully satisfied (it may require multiple steps)\n- When you believe the instruction is complete, respond with {"action":"done"} and briefly explain what was achieved\n- Do not pursue other goals until the user provides another instruction`;

      if (previousError) {
        prompt += `\n\n🚨 PREVIOUS ACTION FAILED:\nError: ${previousError}\nReview the error and adjust your next attempt while still pursuing the user's step-by-step instruction.`;
      }

      return prompt;
    }

    // User corrections take priority over error context
    if (this.userCorrections.length > 0) {
      const corrections = this.userCorrections
        .map((correction, index) => `${index + 1}. ${correction}`)
        .join('\n');
      prompt += `\n\n🚨 CRITICAL USER INSTRUCTIONS - FOLLOW IMMEDIATELY:\n${corrections}\n\n>>> YOUR VERY NEXT ACTION MUST ADDRESS THE USER INSTRUCTION ABOVE <<<\n>>> DO NOT attempt any other actions until the user instruction is completed <<<\n>>> If the instruction says "click register", your next action MUST be clicking register <<<\n>>> User instructions override any previous errors - try the action the user requested <<<\n\nAfter completing the user instruction, CONTINUE pursuing the original goal: "${this.options.goal}"`;
    } else if (previousError) {
      // Only show error context if there are no user corrections
      prompt += `\n\n🚨 PREVIOUS ACTION FAILED:\nError: ${previousError}\n\nThe selector or approach you just tried didn't work. Analyze the error carefully and try a DIFFERENT approach:\n- If "strict mode violation", the selector matched multiple elements - use more specific selectors with exact: true\n- If "timeout", the element may not exist or have a different accessible name\n- Review the error details and adjust your selector accordingly\n- DO NOT repeat the same selector that just failed`;
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
    this.clearManualInstruction();
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
    if (this.isManualMode()) {
      this.log('Pause requested but step-by-step sessions already wait between actions.');
      return;
    }
    if (this.status !== 'running' && this.status !== 'thinking') {
      return;
    }

    this.isPaused = true;
    this.updateStatus('paused');
  }

  resume(userCorrection?: string): void {
    if (this.isManualMode()) {
      this.log('Resume requested but step-by-step sessions run only when you send a new instruction.');
      return;
    }
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

  async executeManualInstruction(instruction: string): Promise<void> {
    if (!this.isManualMode()) {
      throw new Error('This session is not in manual mode.');
    }

    const trimmed = instruction.trim();
    if (!trimmed) {
      throw new Error('Instruction cannot be empty');
    }

    // Add user message to chat
    this.addChatMessage('user', trimmed);

    // Create plan instead of executing directly
    await this.createStepPlan(trimmed);
  }

  requestManualInterrupt(): void {
    if (!this.isManualMode()) {
      throw new Error('This session is not in manual mode.');
    }

    if (!this.activeManualInstruction) {
      this.log('Interrupt requested but no step-by-step instruction is running.');
      return;
    }

    if (this.manualInterruptRequested) {
      return;
    }

    this.manualInterruptRequested = true;
    this.log(`Interrupt requested for current instruction: "${this.activeManualInstruction}"`);
    this.addChatMessage('assistant', 'Interrupt received. I will wrap up the current action and pause.');
  }

  async continueWithFeedback(userMessage: string): Promise<void> {
    const trimmed = userMessage.trim();
    if (!trimmed) {
      throw new Error('Message cannot be empty');
    }

    if (this.status === 'running' || this.status === 'thinking' || this.status === 'initializing') {
      throw new Error('Generation must be paused or stopped before sending feedback');
    }

    // Add user message to chat AND log (always)
    this.addChatMessage('user', trimmed);
    this.log(`User: ${trimmed}`);

    // Check if user is indicating they manually performed the action
    const isDoneIndicator = /^(done|completed|finished|did it)$/i.test(trimmed);

    if (isDoneIndicator && this.beforeManualInterventionState) {
      // User manually performed the action - infer what they did
      this.log('Analyzing what you did...');

      const inference = await this.inferUserAction();

      if (inference) {
        const { action, confidence } = inference;

        // Generate Playwright code for the inferred action
        const playwrightCode = generatePlaywrightCode(action);
        const qaSummary = generateQASummary(action);

        // Ask user to confirm
        const confirmMessage = `I observed that you ${qaSummary.toLowerCase()}.\n\nGenerated code:\n\`\`\`typescript\n${playwrightCode}\n\`\`\`\n\nIs this correct? Reply "yes" to record this step and continue, or describe what actually happened.`;
        this.addChatMessage('assistant', confirmMessage);

        // Store the pending action for confirmation
        this.pendingManualAction = { action, playwrightCode, qaSummary };

        this.touch();
        return;
      } else {
        this.addChatMessage(
          'assistant',
          'I couldn\'t detect what changed. Could you describe what you did? For example: "I filled the SSN confirmation field with 123-45-6789"'
        );
        this.touch();
        return;
      }
    }

    // Check if user is confirming the inferred action
    const isConfirmation = /^(yes|correct|that's right|looks good)$/i.test(trimmed);

    if (isConfirmation && this.pendingManualAction) {
      // Record the step
      const { action, qaSummary } = this.pendingManualAction;
      const step = this.nextStepNumber;

      const screenshot = await this.captureStepScreenshot(step);
      const recorded = createRecordedStep(step, action, {
        url: this.currentUrl,
        screenshotPath: screenshot?.path,
        screenshotData: screenshot?.data
      });

      this.recordedSteps.push(recorded);
      this.nextStepNumber = this.recordedSteps.length + 1;

      this.emit('event', {
        type: 'step_recorded',
        timestamp: new Date().toISOString(),
        payload: recorded
      });

      this.log(`${step}. ${recorded.qaSummary} (manually performed)`);

      // Clear state
      this.beforeManualInterventionState = undefined;
      this.pendingManualAction = undefined;

      // Add success message and continue
      this.addChatMessage('assistant', 'Step recorded! Continuing automation...');

      // Reset hash tracking to force fresh page state capture
      resetHashTracking();

      this.updateStatus('running');
      void this.runAgentLoop();
      this.touch();
      return;
    }

    // Regular feedback - add to corrections for AI context
    this.userCorrections.push(trimmed);

    // If completed/stopped/failed, re-initialize browser and continue
    if (this.status === 'completed' || this.status === 'stopped' || this.status === 'failed') {
      this.error = undefined;

      // Re-open browser if closed
      if (!this.browser || !this.page) {
        this.browser = await chromium.launch({ headless: false });
        const contextOptions: any = {};
        if (this.options.viewportSize) {
          contextOptions.viewport = this.options.viewportSize;
        }
        const context = await this.browser.newContext(contextOptions);
        this.page = await context.newPage();
        context.setDefaultTimeout(30000);
        context.setDefaultNavigationTimeout(60000);
        this.page.setDefaultTimeout(30000);
        this.page.setDefaultNavigationTimeout(60000);

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
    const cancelledInstruction = this.clearManualInstruction();
    if (cancelledInstruction) {
      this.log(`Step-by-step instruction "${cancelledInstruction}" canceled because the session stopped.`);
    }
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
    this.clearManualInstruction();

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
   * Add or update a variable for this test
   */
  setVariable(name: string, sampleValue: string, type: 'string' | 'number' = 'string'): void {
    const trimmedName = name.trim();
    const trimmedValue = sampleValue.trim();

    if (!trimmedName) {
      throw new Error('Variable name cannot be empty');
    }

    if (!trimmedValue) {
      throw new Error('Sample value cannot be empty');
    }

    this.variables.set(trimmedName, { name: trimmedName, type, sampleValue: trimmedValue });
    this.log(`Variable "${trimmedName}" set with sample value: "${trimmedValue}"`);
    this.touch();
  }

  /**
   * Remove a variable
   */
  removeVariable(name: string): void {
    if (this.variables.delete(name)) {
      this.log(`Variable "${name}" removed`);
      this.touch();
    }
  }

  /**
   * Get all variables as array
   */
  getVariables(): Array<{ name: string; type: string; sampleValue?: string }> {
    return Array.from(this.variables.values());
  }

  /**
   * Create a step plan from user instruction (planning phase for manual mode)
   */
  async createStepPlan(instruction: string): Promise<StepPlan> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    if (this.isRunning) {
      throw new Error('Cannot create plan while another action is running');
    }

    const trimmed = instruction.trim();
    if (!trimmed) {
      throw new Error('Instruction cannot be empty');
    }

    // Validate variables
    const validation = this.validateVariables(trimmed);
    if (!validation.valid) {
      const missing = validation.missing.join(', ');
      throw new Error(
        `Cannot create plan: missing sample values for variables: ${missing}. ` +
          `Please set sample values for these variables before using them.`
      );
    }

    // Store original instruction with placeholders
    this.originalManualInstruction = trimmed;

    // Resolve variables for AI execution
    const resolved = this.resolveVariables(trimmed);

    // Capture current page state
    const pageState = await capturePageState(this.page);
    this.currentUrl = pageState.url;

    // Ask AI to create plan
    this.updateStatus('thinking');
    this.log(`Creating plan for: "${trimmed}"`);

    const prompt = buildStepPlannerPrompt(
      resolved,
      this.currentUrl,
      formatPageStateForAI(pageState),
      this.recordedSteps
    );

    try {
      let responseText: string;

      switch (this.provider) {
        case 'anthropic':
          responseText = await this.callAnthropicPlanner(prompt);
          break;
        case 'openai':
          responseText = await this.callOpenAIPlanner(prompt);
          break;
        case 'gemini':
          responseText = await this.callGeminiPlanner(prompt);
          break;
        default:
          throw new Error(`Unsupported provider: ${this.provider}`);
      }

      // Parse JSON response
      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const planResponse = JSON.parse(cleaned);

      if (!planResponse.canExecute) {
        // AI needs clarification
        const clarificationMessage = planResponse.clarificationMessage || 'I cannot execute this instruction. Please provide more details.';
        this.addChatMessage('assistant', clarificationMessage);
        this.enterManualAwaitingState();
        throw new Error(clarificationMessage);
      }

      // Create plan with unique IDs
      const plan: StepPlan = {
        id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        originalInstruction: trimmed,
        steps: planResponse.steps.map((step: any, index: number) => ({
          id: `step-${index}-${Math.random().toString(36).slice(2, 6)}`,
          description: step.description,
          action: step.action,
          selector: step.selector,
          value: step.value
        })),
        canExecute: true,
        timestamp: new Date().toISOString()
      };

      this.pendingPlan = plan;
      this.touch();

      // Emit plan_ready event
      this.emit('event', {
        type: 'plan_ready',
        timestamp: new Date().toISOString(),
        payload: plan
      });

      // Update chat
      const stepsList = plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n');
      this.addChatMessage('assistant', `I will perform the following steps:\n\n${stepsList}\n\nProceed?`);

      this.enterManualAwaitingState();
      return plan;
    } catch (error: any) {
      this.enterManualAwaitingState();
      throw new Error(`Failed to create plan: ${error.message}`);
    }
  }

  /**
   * Approve and execute the pending plan
   */
  async approvePlan(): Promise<void> {
    if (!this.pendingPlan) {
      throw new Error('No pending plan to approve');
    }

    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const plan = this.pendingPlan;
    this.log(`Plan approved. Executing ${plan.steps.length} steps...`);

    this.addChatMessage('user', 'Proceed');
    this.pendingPlan = undefined; // Clear pending plan before execution

    // Emit plan_approved event
    this.emit('event', {
      type: 'plan_approved',
      timestamp: new Date().toISOString(),
      payload: { planId: plan.id }
    });

    this.updateStatus('running');

    // Execute each planned step
    for (let i = 0; i < plan.steps.length; i++) {
      const plannedStep = plan.steps[i];
      const stepNumber = this.nextStepNumber;

      this.log(`Executing step ${i + 1}/${plan.steps.length}: ${plannedStep.description}`);

      // Convert planned step to AIAction
      const action: AIAction = {
        action: plannedStep.action,
        selector: plannedStep.selector,
        value: plannedStep.value,
        reasoning: plannedStep.description
      };

      // Execute the action
      const result = await executeAction(this.page, action);

      if (!result.success) {
        // Step failed
        this.log(`❌ Step failed: ${result.error}`);
        this.addChatMessage('assistant', `Step "${plannedStep.description}" failed: ${result.error}\n\nPlease provide a new instruction or adjust your approach.`);
        this.enterManualAwaitingState();
        return;
      }

      // Step succeeded - record it
      await this.page.waitForTimeout(500);
      const screenshot = await this.captureStepScreenshot(stepNumber);

      const recorded = createRecordedStep(stepNumber, action, {
        url: this.currentUrl,
        screenshotPath: screenshot?.path,
        screenshotData: screenshot?.data
      });

      // Inject placeholders back if using variables
      if (this.variables.size > 0) {
        recorded.playwrightCode = this.injectPlaceholdersIntoCode(recorded.playwrightCode);
      }

      this.recordedSteps.push(recorded);
      this.nextStepNumber = this.recordedSteps.length + 1;

      this.emit('event', {
        type: 'step_recorded',
        timestamp: new Date().toISOString(),
        payload: recorded
      });

      this.log(`${stepNumber}. ${recorded.qaSummary}`);
      this.addChatMessage('assistant', `Step recorded: ${recorded.qaSummary}`);
      this.touch();
    }

    // All steps completed successfully
    this.log(`✓ All ${plan.steps.length} steps completed`);
    this.addChatMessage('assistant', `All steps completed successfully.\n\nDescribe the next browser action when you're ready.`);
    this.enterManualAwaitingState();
  }

  /**
   * Reject the pending plan
   */
  rejectPlan(): void {
    if (!this.pendingPlan) {
      throw new Error('No pending plan to reject');
    }

    const planId = this.pendingPlan.id;
    this.pendingPlan = undefined;
    this.log('Plan rejected by user');

    this.addChatMessage('user', 'Cancel');
    this.addChatMessage('assistant', 'Plan cancelled. Describe a new instruction when you\'re ready.');

    // Emit plan_rejected event
    this.emit('event', {
      type: 'plan_rejected',
      timestamp: new Date().toISOString(),
      payload: { planId }
    });

    this.enterManualAwaitingState();
    this.touch();
  }

  /**
   * Call AI provider for planning (Anthropic)
   */
  private async callAnthropicPlanner(prompt: string): Promise<string> {
    const client = new Anthropic({ apiKey: this.apiKey });
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      system: STEP_PLANNER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }

    return content.text;
  }

  /**
   * Call AI provider for planning (OpenAI)
   */
  private async callOpenAIPlanner(prompt: string): Promise<string> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: STEP_PLANNER_SYSTEM_PROMPT },
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

  /**
   * Call AI provider for planning (Gemini)
   */
  private async callGeminiPlanner(prompt: string): Promise<string> {
    const genAI = new GoogleGenAI({ apiKey: this.apiKey });
    const result = await genAI.models.generateContent({
      model: 'gemini-2.5-pro',
      contents: prompt,
      config: {
        systemInstruction: STEP_PLANNER_SYSTEM_PROMPT,
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
   * Detect variable placeholders in instruction ({{varName}})
   */
  private detectVariables(instruction: string): string[] {
    const placeholderPattern = /\{\{(\w+)\}\}/g;
    const matches = instruction.matchAll(placeholderPattern);
    const variables = new Set<string>();

    for (const match of matches) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }

  /**
   * Validate that all variables in instruction have sample values
   */
  private validateVariables(instruction: string): { valid: boolean; missing: string[] } {
    const detectedVars = this.detectVariables(instruction);
    const missing: string[] = [];

    for (const varName of detectedVars) {
      const variable = this.variables.get(varName);
      if (!variable || !variable.sampleValue) {
        missing.push(varName);
      }
    }

    return { valid: missing.length === 0, missing };
  }

  /**
   * Resolve variable placeholders with sample values
   * e.g., "Search for {{product}}" -> "Search for teddy bear"
   */
  private resolveVariables(instruction: string): string {
    return instruction.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      const variable = this.variables.get(varName);
      return variable?.sampleValue || match;
    });
  }

  /**
   * Inject variable placeholders back into generated code
   * Replaces sample values with {{varName}} in code strings
   */
  private injectPlaceholdersIntoCode(code: string): string {
    let result = code;

    // For each variable, replace its sample value with the placeholder
    for (const [varName, variable] of this.variables.entries()) {
      if (!variable.sampleValue) continue;

      // Escape special regex characters in the sample value
      const escapedValue = variable.sampleValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Replace occurrences in string literals (single and double quotes)
      // Match: fill('sampleValue') -> fill('{{varName}}')
      const singleQuotePattern = new RegExp(`'([^']*?)${escapedValue}([^']*?)'`, 'g');
      const doubleQuotePattern = new RegExp(`"([^"]*?)${escapedValue}([^"]*?)"`, 'g');

      result = result.replace(singleQuotePattern, (match, before, after) => {
        return `'${before}{{${varName}}}${after}'`;
      });

      result = result.replace(doubleQuotePattern, (match, before, after) => {
        return `"${before}{{${varName}}}${after}"`;
      });
    }

    return result;
  }

  /**
   * Generate the complete test file code
   */
  generateTestCode(options?: {
    testId?: string;
    testName?: string;
    variables?: TestMetadata['variables'];
    metadata?: Partial<TestMetadata>;
  }): string {
    const generator = new TestCodeGenerator();

    // Use variables from options, or convert from this session's variable map
    const variables =
      options?.variables ||
      (this.variables.size > 0
        ? Array.from(this.variables.values()).map((v) => ({
            name: v.name,
            type: v.type as 'string' | 'number',
            sampleValue: v.sampleValue
          }))
        : undefined);

    return generator.generateTestFile({
      testId: options?.testId || this.sessionId,
      testName: options?.testName || this.options.goal,
      startUrl: this.options.startUrl,
      steps: this.recordedSteps,
      variables,
      metadata: options?.metadata
    });
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

  private async captureFailureScreenshot(
    stepNumber: number,
    retryNumber: number
  ): Promise<string | undefined> {
    if (!this.page || !this.storageReady) {
      return undefined;
    }

    const paddedStep = String(stepNumber).padStart(3, '0');
    const uniqueId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const filename = `failure-step-${paddedStep}-retry-${retryNumber}-${uniqueId}.png`;
    const filePath = path.join(this.screenshotDir, filename);

    try {
      const buffer = await this.page.screenshot({
        path: filePath,
        fullPage: true // Always full page for failure analysis
      });

      return buffer.toString('base64');
    } catch (error) {
      console.error(
        `[generator] Failed to capture failure screenshot for session ${this.sessionId} step ${stepNumber} retry ${retryNumber}`,
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

    const removed = this.userCorrections.shift();

    if (!this.userCorrections.length) {
      if (this.isManualMode() && removed) {
        this.log(`✓ Finished step-by-step instruction: "${removed}"`);
      } else {
        this.log(`✓ User feedback addressed. Resuming original goal: "${this.options.goal}"`);
      }
    }
  }

  private clearManualInstruction(): string | undefined {
    const instruction = this.activeManualInstruction;
    this.activeManualInstruction = undefined;
    this.manualInterruptRequested = false;
    return instruction;
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

  private enterManualAwaitingState(): void {
    this.isPaused = true;
    this.manualInterruptRequested = false;
    this.updateStatus('awaiting_input');
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

  private async handleRetriesExhausted(failedAction: AIAction, error: string, screenshot?: string): Promise<void> {
    if (this.isManualMode()) {
      // Fallback safeguard - manual mode should use handleManualInstructionFailure instead
      await this.handleManualInstructionFailure('step-by-step instruction', failedAction, error, screenshot);
      return;
    }

    this.log(`❌ Action failed after 3 attempts: ${error}`);
    this.log(`Browser left open for manual intervention.`);

    // Capture "before" state for comparison after user acts
    const beforeState = this.page ? await this.capturePageStateSnapshot() : undefined;

    // Store for later comparison
    this.beforeManualInterventionState = beforeState;

    // Generate AI summary of what was tried (with visual context if available)
    const summary = await this.generateErrorSummary(failedAction, error, screenshot);

    this.isPaused = true;
    this.isRunning = false;
    this.updateStatus('paused');

    // Add AI message with manual intervention request
    const helpMessage = `I tried multiple approaches but couldn't complete this action:\n\n${summary}\n\n**What you can do:**\n1. Manually perform the action in the visible browser window\n2. Once you've completed the action, type "done" and I'll observe what you did\n3. I'll generate the test code for your action and ask you to confirm\n4. Then we'll continue with the rest of the test\n\nOr, provide specific guidance on which selector to use, or use the restart button.`;
    this.addChatMessage('assistant', helpMessage);
  }

  private async handleManualInstructionFailure(
    instruction: string,
    failedAction: AIAction,
    error: string,
    screenshot?: string
  ): Promise<void> {
    const failedInstruction = this.clearManualInstruction() || instruction;
    this.log(`Step-by-step instruction "${failedInstruction}" failed: ${error}`);
    const summary = screenshot
      ? await this.generateErrorSummary(failedAction, error, screenshot)
      : error;
    const message =
      summary && summary !== error
        ? `I couldn't complete "${failedInstruction}". ${summary}`
        : `I couldn't complete "${failedInstruction}". Error: ${error}`;
    this.addChatMessage('assistant', `${message}\n\nTry describing the element differently or reference its label/text.`);
    this.enterManualAwaitingState();
  }

  private async handleManualUnexpectedError(instruction: string, error: any): Promise<void> {
    const failedInstruction = this.clearManualInstruction() || instruction;
    const message = error && typeof error.message === 'string' ? error.message : String(error);
    this.log(`Step-by-step instruction "${failedInstruction}" encountered an error: ${message}`);
    this.addChatMessage(
      'assistant',
      `Something went wrong while executing "${failedInstruction}". ${message}\nPlease adjust the instruction and try again.`
    );
    this.enterManualAwaitingState();
  }

  private async generateErrorSummary(action: AIAction, error: string, screenshot?: string): Promise<string> {
    const recentSteps = this.recordedSteps
      .slice(-3)
      .map((step) => `- ${step.qaSummary}`)
      .join('\n');

    const textPrompt = `You encountered an error while automating a web page. Provide a brief, helpful summary for the user.

Goal: ${this.options.goal}
Recent steps completed:
${recentSteps || 'None yet'}

Last attempted action: ${action.action} ${action.selector || ''} ${action.value || ''}
Error: ${error}

${screenshot ? 'A screenshot of the page at the time of failure is provided. Analyze it to understand what elements are visible and suggest the correct selector.' : ''}

Provide a 2-3 sentence summary explaining:
1. What you were trying to do
2. Why it failed (in simple terms)
3. What might help (e.g., "The field label might be different", specific selector to try, or "The element might not be visible yet")

Keep it non-technical and actionable. Do not use markdown.`;

    try {
      let summary = '';
      switch (this.provider) {
        case 'anthropic': {
          const client = new Anthropic({ apiKey: this.apiKey });
          const content: Anthropic.MessageParam['content'] = screenshot
            ? [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot } },
                { type: 'text', text: textPrompt }
              ]
            : textPrompt;

          const message = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 300,
            messages: [{ role: 'user', content }]
          });
          const responseContent = message.content[0];
          if (responseContent.type === 'text') {
            summary = responseContent.text;
          }
          break;
        }
        case 'openai': {
          const client = new OpenAI({ apiKey: this.apiKey });
          const messages: OpenAI.Chat.ChatCompletionMessageParam[] = screenshot
            ? [
                {
                  role: 'user',
                  content: [
                    { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot}` } },
                    { type: 'text', text: textPrompt }
                  ]
                }
              ]
            : [{ role: 'user', content: textPrompt }];

          const completion = await client.chat.completions.create({
            model: 'gpt-4o',
            messages,
            max_tokens: 300
          });
          summary = completion.choices[0]?.message?.content || '';
          break;
        }
        case 'gemini': {
          const genAI = new GoogleGenAI({ apiKey: this.apiKey });
          const parts = screenshot
            ? [{ inlineData: { mimeType: 'image/png', data: screenshot } }, { text: textPrompt }]
            : textPrompt;

          const result = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: parts
          });
          summary = result.text || '';
          break;
        }
      }
      return summary.trim() || `I attempted to ${action.reasoning || action.action} but encountered: ${error}`;
    } catch (err) {
      console.error('[generator] Failed to generate error summary:', err);
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

  private async capturePageStateSnapshot(): Promise<any> {
    if (!this.page) return null;

    try {
      return await this.page.evaluate(() => {
        // Capture form values, URL, and key page elements
        const formData: Record<string, any> = {};
        document.querySelectorAll('input, textarea, select').forEach((el: any) => {
          const id = el.id || el.name || el.className;
          if (id) {
            formData[id] = el.value || el.checked || el.selectedOptions?.[0]?.text;
          }
        });

        return {
          url: window.location.href,
          title: document.title,
          formData,
          visibleText: document.body.innerText.slice(0, 5000) // First 5000 chars
        };
      });
    } catch (error) {
      console.error('[generator] Failed to capture page snapshot:', error);
      return null;
    }
  }

  private async inferUserAction(): Promise<{ action: AIAction; confidence: string } | null> {
    if (!this.page || !this.beforeManualInterventionState) {
      return null;
    }

    const afterState = await this.capturePageStateSnapshot();
    if (!afterState) return null;

    const before = this.beforeManualInterventionState;
    const after = afterState;

    // Detect changes
    const changes: string[] = [];

    if (before.url !== after.url) {
      changes.push(`URL changed from "${before.url}" to "${after.url}"`);
    }

    // Check form data changes
    const allKeys = new Set([...Object.keys(before.formData || {}), ...Object.keys(after.formData || {})]);
    for (const key of allKeys) {
      const beforeVal = before.formData?.[key];
      const afterVal = after.formData?.[key];
      if (beforeVal !== afterVal) {
        changes.push(`Field "${key}" changed from "${beforeVal}" to "${afterVal}"`);
      }
    }

    if (changes.length === 0) {
      return null;
    }

    // Use AI to infer the action
    const prompt = `A user manually performed an action in a browser. Based on the observed changes, infer what Playwright action they performed.

URL before: ${before.url}
URL after: ${after.url}

Changes detected:
${changes.join('\n')}

Provide a JSON response with the most likely action:
{
  "action": "click" | "fill" | "select" | "goto",
  "selector": "best Playwright selector for the element",
  "value": "value if fill/select, otherwise empty",
  "reasoning": "brief explanation of what you think happened",
  "confidence": "high" | "medium" | "low"
}`;

    try {
      let responseText = '';
      switch (this.provider) {
        case 'anthropic': {
          const client = new Anthropic({ apiKey: this.apiKey });
          const message = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 500,
            messages: [{ role: 'user', content: prompt }]
          });
          const content = message.content[0];
          if (content.type === 'text') {
            responseText = content.text;
          }
          break;
        }
        case 'openai': {
          const client = new OpenAI({ apiKey: this.apiKey });
          const completion = await client.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 500,
            response_format: { type: 'json_object' }
          });
          responseText = completion.choices[0]?.message?.content || '';
          break;
        }
        case 'gemini': {
          const genAI = new GoogleGenAI({ apiKey: this.apiKey });
          const result = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
          });
          responseText = result.text || '';
          break;
        }
      }

      const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const inference = JSON.parse(cleaned);

      return {
        action: inference as AIAction,
        confidence: inference.confidence || 'medium'
      };
    } catch (error) {
      console.error('[generator] Failed to infer user action:', error);
      return null;
    }
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}
