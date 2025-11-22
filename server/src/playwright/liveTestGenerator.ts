import { chromium, Browser, Page } from 'playwright';
import { EventEmitter } from 'events';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
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
import { AGENT_SYSTEM_PROMPT, STEP_PLANNER_SYSTEM_PROMPT, buildAgentPrompt, buildStepPlannerPrompt, generateTestName, generateTestTags } from '../ai/agentPrompts.js';
import { TestCodeGenerator } from './testCodeGenerator.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { AIProvider } from '../ai/index.js';
import { CONFIG } from '../config.js';
import { PlaywrightMCPAdapter } from './mcpAdapter.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_MAX_STEPS = 20;

type ToolCall = { name: string; args: any };
type AIResponse = { text?: string; toolCalls?: ToolCall[] };
type MCPFallbackResult = {
  success: boolean;
  recordedAction?: AIAction;
  playwrightCodeOverride?: string;
  qaSummaryOverride?: string;
};

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
  private model?: string;
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
  private pickedSelector?: string; // Stores selector from visual element picker
  private mcpAdapter?: PlaywrightMCPAdapter;

  constructor(
    options: LiveGenerationOptions,
    provider: AIProvider,
    apiKey: string,
    baseUrl?: string,
    credential?: CredentialRecord,
    model?: string
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
    this.model = model;
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

      // Initialize MCP Adapter
      this.mcpAdapter = new PlaywrightMCPAdapter(this.page);

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
        let playwrightCodeOverride: string | undefined;
        let qaSummaryOverride: string | undefined;
        let actionForRecording: AIAction | undefined;

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
          pageState.hasChanged ? formatPageStateForAI(pageState) : '(page unchanged)'
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
          // Fallback to MCP if standard action fails
          this.log(`⚠️ Standard action failed: ${result.error}`);
          this.log(`🛠️ Attempting fallback with MCP tools...`);

          const mcpResult = await this.attemptMCPFallback(step, result.error || 'Unknown error');

          if (mcpResult.success) {
            actionForRecording = mcpResult.recordedAction ?? action;
            playwrightCodeOverride = mcpResult.playwrightCodeOverride;
            qaSummaryOverride = mcpResult.qaSummaryOverride;
            this.log(`✓ MCP fallback succeeded`);
          } else {
            // MCP failed - pause and ask user for help
            const failureScreenshot = await this.captureFailureScreenshot(step, 999);

            if (manualInstruction) {
              await this.handleManualInstructionFailure(
                manualInstruction,
                action,
                result.error || 'Action failed',
                failureScreenshot
              );
            } else {
              await this.handleRetriesExhausted(action, result.error || 'Action failed', failureScreenshot);
            }
            return;
          }
        } else {
          // Action succeeded
          actionForRecording = action;
        }

        // Allow page to settle before capturing screenshot
        await this.page.waitForTimeout(500);
        const screenshot = await this.captureStepScreenshot(step);

        if (!actionForRecording && !playwrightCodeOverride) {
          actionForRecording = action;
        }

        // Record step
        const recorded = actionForRecording
          ? createRecordedStep(step, actionForRecording, {
            url: this.currentUrl,
            screenshotPath: screenshot?.path,
            screenshotData: screenshot?.data
          })
          : {
            stepNumber: step,
            playwrightCode: playwrightCodeOverride || '',
            qaSummary: qaSummaryOverride || 'MCP fallback action',
            timestamp: new Date().toISOString(),
            url: this.currentUrl,
            screenshotPath: screenshot?.path,
            screenshotData: screenshot?.data
          };

        if (playwrightCodeOverride) {
          recorded.playwrightCode = playwrightCodeOverride;
        }
        if (qaSummaryOverride) {
          recorded.qaSummary = qaSummaryOverride;
        }

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
  private async decideNextAction(pageState: string, previousError?: string, screenshot?: string, tools?: Tool[]): Promise<AIAction> {
    const prompt = this.buildContextualPrompt(pageState, previousError, screenshot);

    this.emit('event', {
      type: 'ai_thinking',
      timestamp: new Date().toISOString(),
      payload: { prompt, hasScreenshot: !!screenshot, hasTools: !!tools }
    });

    let response: AIResponse;

    try {
      switch (this.provider) {
        case 'anthropic':
          response = await this.callAnthropic(prompt, screenshot, tools);
          break;
        case 'openai':
          response = await this.callOpenAI(prompt, screenshot, tools);
          break;
        case 'gemini':
          response = await this.callGemini(prompt, screenshot, tools);
          break;
        default:
          throw new Error(`Unsupported provider: ${this.provider}`);
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        throw new Error('Received tool calls when JSON action was expected');
      }

      const responseText = response.text;
      if (!responseText) {
        throw new Error('AI returned an empty response');
      }

      // Parse JSON response
      const cleaned = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      let action: AIAction;
      try {
        action = JSON.parse(cleaned);
      } catch (parseError: any) {
        this.log(`⚠️ JSON parse error in agent decision: ${parseError.message}`);
        this.log(`Raw response (first 500 chars): ${responseText.slice(0, 500)}`);
        throw new Error(`Invalid JSON from AI: ${parseError.message}`);
      }

      // Validate action
      if (!action.action || !action.reasoning) {
        throw new Error('Invalid AI response: missing required fields');
      }

      return action;
    } catch (error: any) {
      throw new Error(`AI decision failed: ${error.message}`);
    }
  }

  private buildContextualPrompt(pageState: string, previousError?: string, screenshot?: string): string {
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

    const chatHistory = this.formatChatHistoryForPrompt();
    if (chatHistory) {
      prompt += `\n\nCHAT HISTORY:\n${chatHistory}\n\nUse the conversation above to stay consistent with prior user feedback and assistant responses.`;
    }

    if (this.credential) {
      prompt += `\n\nCREDENTIALS AVAILABLE:\n- Name: ${this.credential.name}\n- Username: ${this.credential.username
        }\n- Password: ${this.credential.password}\n${this.credential.notes ? `- Notes: ${this.credential.notes}` : ''
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
        prompt += `\n\n🚨 PREVIOUS ACTION FAILED:\nError: ${previousError}${screenshot ? '\n📸 A screenshot of the page at the time of failure is provided. Use it to visually identify elements and their exact labels/text.' : ''
          }\nReview the error and adjust your next attempt while still pursuing the user's step-by-step instruction.`;
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
      prompt += `\n\n🚨 PREVIOUS ACTION FAILED:\nError: ${previousError}${screenshot ? '\n📸 A screenshot of the page at the time of failure is provided. Use it to visually identify elements, their exact labels/text, and understand the page layout.' : ''
        }\n\nThe selector or approach you just tried didn't work. Analyze the error carefully and try a DIFFERENT approach:\n- If "strict mode violation", the selector matched multiple elements - use more specific selectors with exact: true\n- If "timeout", the element may not exist or have a different accessible name\n- Review the error details and adjust your selector accordingly\n- DO NOT repeat the same selector that just failed${screenshot ? '\n- Use the screenshot to verify element labels and choose the correct selector' : ''
        }`;
    }

    return prompt;
  }

  private async callAnthropic(prompt: string, screenshot?: string, tools?: Tool[]): Promise<AIResponse> {
    const client = new Anthropic({ apiKey: this.apiKey });

    // Build message content with optional screenshot
    const messageContent: Anthropic.MessageParam['content'] = screenshot
      ? [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshot } },
        { type: 'text', text: prompt }
      ]
      : prompt;

    // Use response prefilling for JSON output when no tools are provided
    const messages: Anthropic.MessageParam[] = tools && tools.length > 0
      ? [{ role: 'user', content: messageContent }]
      : [
          { role: 'user', content: messageContent },
          { role: 'assistant', content: '{' } // Prefill to force JSON
        ];

    const params: any = {
      model: this.model || 'claude-sonnet-4-5',
      max_tokens: 2000, // Increased for complex actions
      system: AGENT_SYSTEM_PROMPT,
      messages
    };

    if (tools && tools.length > 0) {
      params.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema
      }));
    }

    const message = await client.messages.create(params);

    let text: string | undefined;
    const toolCalls: ToolCall[] = [];

    for (const block of message.content) {
      if (block.type === 'text' && !text) {
        text = block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({ name: block.name, args: block.input });
      }
    }

    // Prepend opening brace if we used prefilling (no tools)
    if (text && (!tools || tools.length === 0)) {
      text = '{' + text;
    }

    return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
  }

  private async callOpenAI(prompt: string, screenshot?: string, tools?: Tool[]): Promise<AIResponse> {
    const client = new OpenAI({ apiKey: this.apiKey, baseURL: this.baseUrl });

    // Build messages with optional screenshot
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = screenshot
      ? [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshot}` } },
            { type: 'text', text: prompt }
          ]
        }
      ]
      : [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ];

    const params: any = {
      model: this.model || 'gpt-5',
      messages,
      max_tokens: 2000,
    };

    if (tools && tools.length > 0) {
      params.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }
      }));
      // If tools are present, we don't force JSON object response format as it conflicts with tool_calls
    } else {
      params.response_format = { type: 'json_object' };
    }

    const completion = await client.chat.completions.create(params);

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error('No response from OpenAI');
    }

    let text: string | undefined;
    const messageContent: any = message.content as any;
    if (typeof messageContent === 'string') {
      text = messageContent;
    } else if (Array.isArray(messageContent)) {
      text = messageContent
        .map((part: any) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return part.text;
          return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
    }

    const toolCalls: ToolCall[] = [];
    if (message.tool_calls) {
      for (const call of message.tool_calls as any[]) {
        const fn = (call as any).function || (call as any).function_call;
        let args: any;
        try {
          args = fn?.arguments ? JSON.parse(fn.arguments) : {};
        } catch {
          args = fn?.arguments || {};
        }
        toolCalls.push({
          name: fn?.name || 'unknown',
          args
        });
      }
    }

    return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
  }

  private async callGemini(prompt: string, screenshot?: string, tools?: Tool[]): Promise<AIResponse> {
    const genAI = new GoogleGenAI({ apiKey: this.apiKey });

    // Build content parts with optional screenshot
    const parts = screenshot
      ? [
        { inlineData: { mimeType: 'image/png', data: Buffer.from(screenshot, 'base64') } },
        { text: prompt }
      ]
      : [{ text: prompt }];

    const request: any = {
      model: this.model || 'gemini-2.5-flash',
      contents: [{ role: 'user', parts }], // The SDK expects 'contents' to be an array of Content objects
      generationConfig: {
        systemInstruction: AGENT_SYSTEM_PROMPT,
      }
    };

    if (tools && tools.length > 0) {
      // Gemini tool format
      request.tools = [{
        function_declarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }))
      }];
    } else {
      request.generationConfig.responseMimeType = 'application/json';
    }

    const result = await genAI.models.generateContent(request);

    const toolCalls: ToolCall[] = [];

    // @ts-ignore - functionCalls() might be missing from type definition but exists at runtime or we check candidates
    const functionCalls = typeof (result as any).functionCalls === 'function' ? (result as any).functionCalls() : undefined;
    const candidates = (result as any).candidates || (result as any).response?.candidates;

    if (functionCalls && functionCalls.length > 0) {
      for (const call of functionCalls as any[]) {
        toolCalls.push({ name: call.name || 'unknown', args: call.args || {} });
      }
    } else if (candidates && candidates[0]?.content?.parts) {
      const candidateParts = candidates[0].content.parts;
      for (const part of candidateParts as any[]) {
        if (part.functionCall) {
          toolCalls.push({ name: part.functionCall.name || 'unknown', args: part.functionCall.args || {} });
        }
      }
    }

    let text: string | undefined = (result as any).text;
    if (!text && candidates && candidates[0]?.content?.parts) {
      const candidateParts = candidates[0].content.parts;
      text = candidateParts
        .map((part: any) => part.text || '')
        .filter(Boolean)
        .join('\n')
        .trim();
    }

    return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
  }

  /**
   * Attempt to recover from a failure using MCP tools
   */
  private async attemptMCPFallback(stepNumber: number, error: string): Promise<MCPFallbackResult> {
    if (!this.mcpAdapter) return { success: false };

    // Capture screenshot for context
    const screenshot = await this.captureFailureScreenshot(stepNumber, 999); // 999 to indicate fallback
    const pageState = await capturePageState(this.page!);
    const formattedState = formatPageStateForAI(pageState);

    const tools = this.mcpAdapter.getTools();

    const prompt = `The previous action failed with error: "${error}".
      
      Current Page State:
      ${formattedState}
      
      Please use the provided tools to accomplish the goal or fix the error.
      Goal: ${this.options.goal}
      
      Analyze the error and the page state, then call the appropriate tool to proceed.
      If you cannot fix it, do not call any tools.`;

    this.log(`🛠️ MCP Fallback: Asking AI to use tools...`);

    try {
      let response: AIResponse;
      switch (this.provider) {
        case 'anthropic':
          response = await this.callAnthropic(prompt, screenshot, tools);
          break;
        case 'openai':
          response = await this.callOpenAI(prompt, screenshot, tools);
          break;
        case 'gemini':
          response = await this.callGemini(prompt, screenshot, tools);
          break;
        default:
          return { success: false };
      }

      const toolCalls = response.toolCalls || [];

      if (!toolCalls.length) {
        if (response.text) {
          this.log(`MCP Fallback response was text: ${response.text.substring(0, 120)}...`);
        } else {
          this.log(`MCP Fallback: AI decided not to use any tools.`);
        }
        return { success: false };
      }

      let recordedAction: AIAction | undefined;
      let playwrightCodeOverride: string | undefined;
      let qaSummaryOverride: string | undefined;
      const executedNames: string[] = [];

      // Execute tools
      for (const call of toolCalls) {
        this.log(`🛠️ Executing tool: ${call.name} with args ${JSON.stringify(call.args)}`);
        const result = await this.mcpAdapter.callTool(call.name, call.args);

        if (result.isError) {
          this.log(`❌ Tool execution failed: ${result.content[0].text}`);
          return { success: false };
        }

        executedNames.push(call.name);
        this.log(`✓ Tool output: ${result.content[0].text}`);

        const mapped = this.mapToolCallToRecording(call);
        if (mapped?.action && !recordedAction) {
          recordedAction = mapped.action;
        }
        if (mapped?.playwrightCode) {
          playwrightCodeOverride = mapped.playwrightCode;
        }
        if (mapped?.qaSummary) {
          qaSummaryOverride = mapped.qaSummary;
        }
      }

      if (!qaSummaryOverride && executedNames.length) {
        qaSummaryOverride = `MCP fallback executed: ${executedNames.join(', ')}`;
      }

      // Update current URL after fallback actions
      if (this.page) {
        this.currentUrl = this.page.url();
      }

      return {
        success: true,
        recordedAction,
        playwrightCodeOverride,
        qaSummaryOverride
      };

    } catch (err: any) {
      this.log(`❌ MCP Fallback error: ${err.message}`);
      return { success: false };
    }
  }

  /**
   * Map an MCP tool call to an AIAction or explicit code/summary for recording
   */
  private mapToolCallToRecording(call: ToolCall): {
    action?: AIAction;
    playwrightCode?: string;
    qaSummary?: string;
  } | null {
    const args = call.args || {};
    const selector = typeof args.selector === 'string' ? args.selector : undefined;

    switch (call.name) {
      case 'click':
        if (!selector) return null;
        return {
          action: { action: 'click', selector, reasoning: `MCP fallback: click ${selector}` }
        };

      case 'fill':
        if (!selector || typeof args.value !== 'string') return null;
        return {
          action: { action: 'fill', selector, value: args.value, reasoning: `MCP fallback: fill ${selector}` }
        };

      case 'select_option':
        if (!selector || typeof args.value !== 'string') return null;
        return {
          action: { action: 'select', selector, value: args.value, reasoning: `MCP fallback: select option ${args.value}` }
        };

      case 'press_key': {
        const key = typeof args.key === 'string' ? args.key : undefined;
        if (!key) return null;
        return {
          action: { action: 'press', value: key, reasoning: `MCP fallback: press key ${key}` }
        };
      }

      case 'hover': {
        if (!selector) return null;
        return {
          playwrightCode: `await page.hover(${JSON.stringify(selector)});`,
          qaSummary: `Hover ${selector}`
        };
      }

      case 'scroll': {
        if (selector) {
          return {
            playwrightCode: `await page.locator(${JSON.stringify(selector)}).scrollIntoViewIfNeeded();`,
            qaSummary: `Scroll ${selector} into view`
          };
        }

        const direction = typeof args.direction === 'string' ? args.direction : 'down';
        let scrollCode = '';
        if (direction === 'bottom') {
          scrollCode = `await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));`;
        } else if (direction === 'top') {
          scrollCode = `await page.evaluate(() => window.scrollTo(0, 0));`;
        } else if (direction === 'up') {
          scrollCode = `await page.evaluate(() => window.scrollBy(0, -500));`;
        } else {
          scrollCode = `await page.evaluate(() => window.scrollBy(0, 500));`;
        }
        return {
          playwrightCode: scrollCode,
          qaSummary: `Scroll ${direction}`
        };
      }

      case 'evaluate_javascript': {
        if (typeof args.script !== 'string') return null;
        const script = args.script.trim();
        return {
          playwrightCode: `await page.evaluate(() => { ${script} });`,
          qaSummary: 'Execute custom script via MCP fallback'
        };
      }

      case 'get_page_content':
        return {
          playwrightCode: `const content = await page.content();\nconsole.log(content);`,
          qaSummary: 'Capture page content via MCP fallback'
        };

      default:
        return null;
    }
  }

  /**
   * Finalize and cleanup
   * @param closeBrowser - If true, close the browser regardless of failure state. If false, keep it open. If undefined, use smart logic based on status.
   */
  private async finalize(closeBrowser?: boolean): Promise<void> {
    this.clearManualInstruction();
    this.emit('event', {
      type: 'completed',
      timestamp: new Date().toISOString(),
      payload: this.getState()
    });

    this.isRunning = false;
    this.isPaused = false;

    if (this.browser) {
      // Determine whether to close browser
      let shouldClose = false;

      if (closeBrowser === true) {
        // Explicit request to close (e.g., user stop, restart)
        shouldClose = true;
      } else if (closeBrowser === false) {
        // Explicit request to keep open
        shouldClose = false;
      } else {
        // Smart logic: keep open on failures/errors, close on success (unless keepBrowserOpen)
        const isFailed = this.status === 'failed' || this.error !== undefined;
        if (isFailed) {
          shouldClose = false; // Keep browser open on failures so user can see what went wrong
        } else {
          shouldClose = !this.options.keepBrowserOpen; // On success, respect keepBrowserOpen setting
        }
      }

      if (shouldClose) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
        this.log('Browser closed.');
      } else {
        this.log('Browser left open for inspection.');
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
    return generateTestName(this.options.goal, summaries, this.provider, this.apiKey, this.baseUrl, this.model);
  }

  async suggestTestTags(): Promise<string[]> {
    if (!this.recordedSteps.length) {
      throw new Error('No recorded steps available for tagging');
    }

    const summaries = this.recordedSteps.map((step) => step.qaSummary);
    return generateTestTags(
      this.options.goal,
      summaries,
      this.options.startUrl,
      this.provider,
      this.apiKey,
      this.baseUrl,
      this.model
    );
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
    await this.finalize(true); // Close browser on user stop
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

  /**
   * Cleanup resources (e.g., when user leaves the generation screen)
   * Closes the browser unconditionally
   */
  async cleanup(): Promise<void> {
    this.isRunning = false;
    this.isPaused = false;
    this.clearManualInstruction();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.log('Browser closed on session cleanup.');
    }
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
   * Activate visual element picker - injects UI overlay on page for user to click target element
   */
  async activateElementPicker(): Promise<{ selector: string; description: string }> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    // Inject script to handle element picking
    const pickedElement = await this.page.evaluate(`
      new Promise((resolve) => {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'trailwright-element-picker-overlay';
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.3); z-index: 999999; pointer-events: none;';

        // Create global cursor style
        const style = document.createElement('style');
        style.id = 'trailwright-element-picker-style';
        style.textContent = '* { cursor: crosshair !important; }';
        document.head.appendChild(style);

        // Create banner
        const banner = document.createElement('div');
        banner.textContent = 'Click any element to select it';
        banner.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; font-family: system-ui, sans-serif; font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000000; pointer-events: none;';

        document.body.appendChild(overlay);
        document.body.appendChild(banner);

        let highlightBorder = null;

        function cleanup() {
          overlay.remove();
          banner.remove();
          if (highlightBorder) {
            highlightBorder.remove();
          }
          const style = document.getElementById('trailwright-element-picker-style');
          if (style) style.remove();
          
          document.removeEventListener('mouseover', handleHover);
          document.removeEventListener('click', handleClick);
        }

        function handleHover(e) {
          if (highlightBorder) highlightBorder.remove();
          
          const target = e.target;
          if (target === overlay || target === banner) return;

          const rect = target.getBoundingClientRect();
          highlightBorder = document.createElement('div');
          highlightBorder.style.cssText = 'position: fixed; top: ' + rect.top + 'px; left: ' + rect.left + 'px; width: ' + rect.width + 'px; height: ' + rect.height + 'px; border: 2px solid #2563eb; background: rgba(37, 99, 235, 0.1); pointer-events: none; z-index: 1000000;';
          document.body.appendChild(highlightBorder);
        }

        function handleClick(e) {
          e.preventDefault();
          e.stopPropagation();
          
          const target = e.target;
          const info = {
            tagName: target.tagName.toLowerCase(),
            id: target.id,
            name: target.getAttribute('name'),
            type: target.getAttribute('type'),
            placeholder: target.getAttribute('placeholder'),
            textContent: target.textContent ? target.textContent.trim().slice(0, 50) : undefined,
            dataTestId: target.getAttribute('data-testid') || target.getAttribute('data-test-id') || target.getAttribute('data-test'),
            ariaLabel: target.getAttribute('aria-label'),
            alt: target.getAttribute('alt'),
            href: target.getAttribute('href'),
            role: target.getAttribute('role'),
            title: target.getAttribute('title')
          };
          
          cleanup();
          resolve(info);
        }

        document.addEventListener('mouseover', handleHover);
        document.addEventListener('click', handleClick, { capture: true, once: true });
      })
    `) as any;

    // Generate Playwright selector from captured element info
    let selector: string;
    let description: string;

    const {
      tagName, id, name, type, placeholder, textContent,
      dataTestId, ariaLabel, alt, href, role, title
    } = pickedElement;

    // Helper to escape quotes
    const escape = (str: string) => str.replace(/'/g, "\\'");

    // 1. Data Test IDs (Highest Priority)
    if (dataTestId) {
      selector = `getByTestId('${escape(dataTestId)}')`;
      description = `Element with test ID '${dataTestId}'`;
    }
    // 2. ID (if valid identifier)
    else if (id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
      selector = `locator('#${id}')`;
      description = `Element with ID '#${id}'`;
    }
    // 3. Role-based selectors (Accessibility friendly)
    else if (tagName === 'button' || (role === 'button')) {
      if (textContent) {
        selector = `getByRole('button', { name: '${escape(textContent)}' })`;
        description = `Button '${textContent}'`;
      } else if (ariaLabel) {
        selector = `getByRole('button', { name: '${escape(ariaLabel)}' })`;
        description = `Button '${ariaLabel}'`;
      } else {
        selector = `getByRole('button')`;
        description = 'Button';
      }
    }
    else if (tagName === 'a' || role === 'link') {
      if (textContent) {
        selector = `getByRole('link', { name: '${escape(textContent)}' })`;
        description = `Link '${textContent}'`;
      } else if (ariaLabel) {
        selector = `getByRole('link', { name: '${escape(ariaLabel)}' })`;
        description = `Link '${ariaLabel}'`;
      } else if (href) {
        selector = `locator('a[href="${escape(href)}"]')`;
        description = `Link to '${href}'`;
      } else {
        selector = `getByRole('link')`;
        description = 'Link';
      }
    }
    // 4. Input fields
    else if (tagName === 'input') {
      if (placeholder) {
        selector = `getByPlaceholder('${escape(placeholder)}')`;
        description = `Input with placeholder '${placeholder}'`;
      } else if (ariaLabel) {
        selector = `getByLabel('${escape(ariaLabel)}')`;
        description = `Input '${ariaLabel}'`;
      } else if (name) {
        selector = `locator('input[name="${escape(name)}"]')`;
        description = `Input '${name}'`;
      } else if (type === 'submit') {
        selector = `locator('input[type="submit"]')`;
        description = 'Submit input';
      } else {
        selector = `locator('input')`;
        description = 'Input field';
      }
    }
    // 5. Images
    else if (tagName === 'img' && alt) {
      selector = `getByAltText('${escape(alt)}')`;
      description = `Image '${alt}'`;
    }
    // 6. Text Content (as fallback for non-interactive elements)
    else if (textContent && textContent.length < 30) {
      selector = `getByText('${escape(textContent)}')`;
      description = `Text '${textContent}'`;
    }
    // 7. Generic Fallbacks
    else if (tagName) {
      selector = `locator('${tagName}')`;
      description = `<${tagName}> element`;
    } else {
      selector = `locator('body')`;
      description = 'Body element';
    }

    this.pickedSelector = selector;
    this.log(`Element picked: ${selector}`);

    return { selector, description };
  }

  /**
   * Get the currently picked selector (if any)
   */
  getPickedSelector(): string | undefined {
    return this.pickedSelector;
  }

  /**
   * Clear the picked selector
   */
  clearPickedSelector(): void {
    this.pickedSelector = undefined;
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

    let prompt = buildStepPlannerPrompt(
      resolved,
      this.currentUrl,
      formatPageStateForAI(pageState),
      this.recordedSteps
    );

    const chatHistory = this.formatChatHistoryForPrompt();
    if (chatHistory) {
      prompt += `\n\nCHAT HISTORY:\n${chatHistory}\n\nUse this dialogue to stay aligned with previous user feedback while planning.`;
    }

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
      const cleaned = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      let planResponse;
      try {
        planResponse = JSON.parse(cleaned);
      } catch (parseError: any) {
        // Log the malformed JSON for debugging
        this.log(`⚠️ JSON parse error: ${parseError.message}`);
        this.log(`Raw response (first 500 chars): ${responseText.slice(0, 500)}`);
        this.log(`Cleaned JSON (first 500 chars): ${cleaned.slice(0, 500)}`);
        throw new Error(`Invalid JSON from AI: ${parseError.message}`);
      }

      if (!planResponse.canExecute) {
        // AI needs clarification - this is normal workflow, not an error
        const clarificationMessage = planResponse.clarificationMessage || 'I cannot execute this instruction. Please provide more details.';
        this.addChatMessage('assistant', clarificationMessage);
        this.enterManualAwaitingState();
        // Return a non-executable plan instead of throwing
        const clarificationPlan: StepPlan = {
          id: `plan-clarification-${Date.now()}`,
          originalInstruction: trimmed,
          steps: [],
          canExecute: false,
          clarificationMessage,
          timestamp: new Date().toISOString()
        };
        return clarificationPlan;
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
      // Log the actual error for debugging
      this.log(`Error creating plan: ${error.message}`);

      // Add a user-friendly message to chat instead of throwing
      this.addChatMessage('assistant', 'I encountered an issue analyzing the page. Please try rephrasing your instruction or describe what you see on the page.', true);
      this.enterManualAwaitingState();

      // Return a non-executable plan instead of throwing
      const errorPlan: StepPlan = {
        id: `plan-error-${Date.now()}`,
        originalInstruction: instruction,
        steps: [],
        canExecute: false,
        clarificationMessage: 'Failed to analyze the page. Please try again with a different instruction.',
        timestamp: new Date().toISOString()
      };
      return errorPlan;
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

    // Execute each planned step with MCP fallback
    for (let i = 0; i < plan.steps.length; i++) {
      const plannedStep = plan.steps[i];
      const stepNumber = this.nextStepNumber;

      this.log(`Executing step ${i + 1}/${plan.steps.length}: ${plannedStep.description}`);

      let actionForRecording: AIAction | undefined = {
        action: plannedStep.action,
        selector: plannedStep.selector,
        value: plannedStep.value,
        reasoning: plannedStep.description
      };
      let playwrightCodeOverride: string | undefined;
      let qaSummaryOverride: string | undefined;

      const result = await executeAction(this.page, actionForRecording);

      if (!result.success) {
        this.log(`⚠️ Planned step failed: ${result.error}. Trying MCP fallback...`);
        const mcpResult = await this.attemptMCPFallback(stepNumber, result.error || 'Unknown error');

        if (mcpResult.success) {
          actionForRecording = mcpResult.recordedAction ?? actionForRecording;
          playwrightCodeOverride = mcpResult.playwrightCodeOverride;
          qaSummaryOverride = mcpResult.qaSummaryOverride;
          this.log(`✓ MCP fallback succeeded for planned step`);
        } else {
          this.log(`❌ Step failed after MCP fallback: ${result.error}`);
          this.addChatMessage(
            'assistant',
            `I wasn't able to complete the step "${plannedStep.description}".\n\nPlease provide clearer guidance about which element to interact with, or try using the Pick Element tool to select it visually from the browser.`,
            true
          );
          this.enterManualAwaitingState();
          this.touch();
          return;
        }
      }

      // Step succeeded - record it
      await this.page.waitForTimeout(500);
      const screenshot = await this.captureStepScreenshot(stepNumber);

      const recorded = createRecordedStep(stepNumber, actionForRecording, {
        url: this.currentUrl,
        screenshotPath: screenshot?.path,
        screenshotData: screenshot?.data
      });

      if (playwrightCodeOverride) {
        recorded.playwrightCode = playwrightCodeOverride;
      }
      if (qaSummaryOverride) {
        recorded.qaSummary = qaSummaryOverride;
      }

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

    // Use response prefilling to ensure valid JSON output
    const message = await client.messages.create({
      model: this.model || 'claude-sonnet-4-5',
      max_tokens: 4000, // Increased for complex forms
      system: STEP_PLANNER_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' } // Prefill to force JSON
      ]
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }

    // Prepend the opening brace that was prefilled
    return '{' + content.text;
  }

  /**
   * Call AI provider for planning (OpenAI)
   */
  private async callOpenAIPlanner(prompt: string): Promise<string> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const completion = await client.chat.completions.create({
      model: this.model || 'gpt-5',
      messages: [
        { role: 'system', content: STEP_PLANNER_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 2000,
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
      model: this.model || 'gemini-2.5-flash',
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

  private formatChatHistoryForPrompt(): string | undefined {
    if (!this.chat.length) {
      return undefined;
    }

    const relevant = this.chat.filter((msg) => msg.role === 'user' || msg.role === 'assistant');
    if (!relevant.length) {
      return undefined;
    }

    return relevant
      .map((msg) => `${msg.role === 'user' ? 'User' : 'AI'}: ${msg.message}`)
      .join('\n');
  }

  private addChatMessage(role: ChatMessage['role'], message: string, isError: boolean = false): ChatMessage {
    const chatMessage: ChatMessage = {
      id: `chat-${Date.now()}-${crypto.randomUUID()}`,
      role,
      message,
      timestamp: new Date().toISOString(),
      isError
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
    this.addChatMessage('assistant', friendlyMessage, true);
    this.updateStatus('paused');
  }

  private async handleRetriesExhausted(failedAction: AIAction, error: string, screenshot?: string): Promise<void> {
    if (this.isManualMode()) {
      // Fallback safeguard - manual mode should use handleManualInstructionFailure instead
      await this.handleManualInstructionFailure('step-by-step instruction', failedAction, error, screenshot);
      return;
    }

    this.log(`❌ Action failed after MCP fallback: ${error}`);
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
    this.addChatMessage('assistant', helpMessage, true);
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
      : null;
    const message = summary && summary !== error
      ? `I wasn't able to process the step "${failedInstruction}". ${summary}`
      : `I wasn't able to process the step "${failedInstruction}".`;
    this.addChatMessage('assistant', `${message}\n\nTry describing the element more clearly, reference its label or visible text, or use the Pick Element tool to select it visually from the browser.`, true);
    this.enterManualAwaitingState();
  }

  private async handleManualUnexpectedError(instruction: string, error: any): Promise<void> {
    const failedInstruction = this.clearManualInstruction() || instruction;
    const message = error && typeof error.message === 'string' ? error.message : String(error);
    this.log(`Step-by-step instruction "${failedInstruction}" encountered an error: ${message}`);
    this.addChatMessage(
      'assistant',
      `I encountered an issue while executing "${failedInstruction}".\n\nTry providing more specific details about the element you want to interact with, or use the Pick Element tool to select it visually from the browser.`,
      true
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
            model: this.model || 'claude-sonnet-4-5',
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
            model: this.model || 'gpt-5',
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
            model: this.model || 'gemini-2.5-flash',
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
      return await this.page.evaluate(`
        (() => {
          // Capture form values, URL, and key page elements
          const formData = {};
          document.querySelectorAll('input, textarea, select').forEach((el) => {
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
        })()
      `);
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
            model: this.model || 'claude-sonnet-4-5',
            max_tokens: 500,
            messages: [
              { role: 'user', content: prompt },
              { role: 'assistant', content: '{' } // Prefill to force JSON
            ]
          });
          const content = message.content[0];
          if (content.type === 'text') {
            responseText = '{' + content.text;
          }
          break;
        }
        case 'openai': {
          const client = new OpenAI({ apiKey: this.apiKey });
          const completion = await client.chat.completions.create({
            model: this.model || 'gpt-5',
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
            model: this.model || 'gemini-2.5-flash',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
          });
          responseText = result.text || '';
          break;
        }
      }

      const cleaned = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

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
