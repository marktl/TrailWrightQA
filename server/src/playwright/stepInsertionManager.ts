import { chromium, Browser, Page } from 'playwright';
import { EventEmitter } from 'events';
import type { AIAction, RecordedStep } from '../../../shared/types.js';
import type { Test } from '../types.js';
import { capturePageState, formatPageStateForAI } from './pageStateCapture.js';
import { executeAction, generatePlaywrightCode, generateQASummary } from './actionExecutor.js';
import { AGENT_SYSTEM_PROMPT, buildAgentPrompt } from '../ai/agentPrompts.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { AIProvider } from '../ai/index.js';

/**
 * Manages step insertion by replaying test up to insertion point,
 * capturing browser context, and generating new steps with AI
 */
export class StepInsertionManager extends EventEmitter {
  private sessionId: string;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private provider: AIProvider;
  private apiKey: string;
  private test: Test;
  private insertAfterStep: number;
  private currentUrl: string = '';
  private variableValues: Map<string, string> = new Map();

  constructor(
    test: Test,
    insertAfterStep: number,
    provider: AIProvider,
    apiKey: string
  ) {
    super();
    this.test = test;
    this.insertAfterStep = insertAfterStep;
    this.provider = provider;
    this.apiKey = apiKey;
    this.sessionId = `insert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Load sample values for variables from test metadata
   */
  private async loadVariableSampleValues(): Promise<void> {
    if (!this.test.metadata.variables || this.test.metadata.variables.length === 0) {
      return;
    }

    // Try to load from CSV data file if it exists
    if (this.test.metadata.dataSource) {
      try {
        const { VariableStorage } = await import('../storage/variables.js');
        const { CONFIG } = await import('../config.js');
        const storage = new VariableStorage(CONFIG.DATA_DIR);
        const data = await storage.readVariables(this.test.metadata.id);

        if (data && data.length > 0) {
          // Use first row of CSV data as sample values
          const firstRow = data[0];
          for (const [key, value] of Object.entries(firstRow)) {
            this.variableValues.set(key, String(value));
          }
          return;
        }
      } catch (error) {
        console.warn('Failed to load variable data from CSV:', error);
        // Fall through to use sampleValue from metadata
      }
    }

    // Fallback to sampleValue from metadata
    for (const variable of this.test.metadata.variables) {
      if (variable.sampleValue) {
        this.variableValues.set(variable.name, variable.sampleValue);
      }
    }
  }

  /**
   * Resolve variable placeholders in a string with actual values
   */
  private resolveVariables(text: string): string {
    let resolved = text;

    console.log(`[StepInsertion] Resolving variables in: "${text}"`);
    console.log(`[StepInsertion] Available variables:`, Array.from(this.variableValues.entries()));

    // Replace {{variableName}} with actual values
    for (const [name, value] of this.variableValues.entries()) {
      const placeholder = `{{${name}}}`;
      const before = resolved;
      resolved = resolved.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      if (before !== resolved) {
        console.log(`[StepInsertion] Replaced ${placeholder} with "${value}"`);
      }
    }

    console.log(`[StepInsertion] Resolved result: "${resolved}"`);
    return resolved;
  }

  /**
   * Check if a string contains variable placeholders
   */
  private hasVariablePlaceholders(text: string): boolean {
    return /\{\{[^}]+\}\}/.test(text);
  }

  /**
   * Initialize browser and replay test up to insertion point
   */
  async initialize(): Promise<void> {
    // Load variable sample values first
    await this.loadVariableSampleValues();

    // Launch browser in headed mode
    this.browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await this.browser.newContext();
    this.page = await context.newPage();
    this.currentUrl = this.test.metadata.startUrl || '';

    // Navigate to start URL
    if (this.currentUrl) {
      await this.page.goto(this.currentUrl, { waitUntil: 'domcontentloaded' });
    }

    // Execute all steps up to the insertion point
    const stepsToExecute = this.test.metadata.steps?.slice(0, this.insertAfterStep) || [];

    for (const step of stepsToExecute) {
      // Parse the playwright code to determine action type
      // This is a simplified approach - we execute the code directly
      try {
        // Resolve any variable placeholders in the playwright code before execution
        const resolvedCode = this.resolveVariables(step.playwrightCode);
        console.log(`[StepInsertion] Executing step ${step.number}: "${step.qaSummary}"`);
        console.log(`[StepInsertion] Original code: ${step.playwrightCode}`);
        console.log(`[StepInsertion] Resolved code: ${resolvedCode}`);

        // Execute the playwright code with resolved variables
        await this.executeStepCode(resolvedCode);

        // Wait a bit for page to stabilize
        await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await this.page.waitForTimeout(500);
      } catch (error: any) {
        console.error(`Failed to execute step ${step.number}:`, error);
        throw new Error(`Failed to replay test up to step ${this.insertAfterStep}: ${error.message}`);
      }
    }

    // Update current URL
    this.currentUrl = this.page.url();
  }

  /**
   * Execute a step's Playwright code
   * Parses and executes common Playwright patterns
   */
  private async executeStepCode(playwrightCode: string): Promise<void> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    // Remove 'await ' and 'page.' prefix if present
    let code = playwrightCode.trim().replace(/^await\s+/, '');
    code = code.replace(/^page\./, '');

    try {
      // Parse common Playwright patterns and execute them

      // Handle goto
      if (code.startsWith('goto(')) {
        const urlMatch = code.match(/goto\(['"](.+?)['"]/);
        if (urlMatch) {
          await this.page.goto(urlMatch[1], { waitUntil: 'domcontentloaded' });
          return;
        }
      }

      // Handle click
      if (code.includes('.click()')) {
        const locator = this.parseLocator(code.replace('.click()', ''));
        await locator.click();
        return;
      }

      // Handle fill
      const fillMatch = code.match(/(.+)\.fill\(['"](.+?)['"]\)/);
      if (fillMatch) {
        const locator = this.parseLocator(fillMatch[1]);
        await locator.fill(fillMatch[2]);
        return;
      }

      // Handle selectOption
      const selectMatch = code.match(/(.+)\.selectOption\(['"](.+?)['"]\)/);
      if (selectMatch) {
        const locator = this.parseLocator(selectMatch[1]);
        await locator.selectOption(selectMatch[2]);
        return;
      }

      // Handle press
      const pressMatch = code.match(/keyboard\.press\(['"](.+?)['"]\)/);
      if (pressMatch) {
        await this.page.keyboard.press(pressMatch[1]);
        return;
      }

      // Handle waitForTimeout
      const waitMatch = code.match(/waitForTimeout\((\d+)\)/);
      if (waitMatch) {
        await this.page.waitForTimeout(parseInt(waitMatch[1]));
        return;
      }

      throw new Error(`Unsupported Playwright code pattern: ${code}`);
    } catch (error: any) {
      throw new Error(`Failed to execute code "${playwrightCode}": ${error.message}`);
    }
  }

  /**
   * Parse a locator string and return a Playwright Locator
   */
  private parseLocator(locatorStr: string): any {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    const trimmed = locatorStr.trim();

    // Handle getByRole
    const roleMatch = trimmed.match(/getByRole\(['"](\w+)['"],\s*\{[^}]*name:\s*['"](.+?)['"]/);
    if (roleMatch) {
      return this.page.getByRole(roleMatch[1] as any, { name: roleMatch[2] });
    }

    // Handle simple getByRole without options
    const simpleRoleMatch = trimmed.match(/getByRole\(['"](\w+)['"]\)/);
    if (simpleRoleMatch) {
      return this.page.getByRole(simpleRoleMatch[1] as any);
    }

    // Handle getByLabel
    const labelMatch = trimmed.match(/getByLabel\(['"](.+?)['"]\)/);
    if (labelMatch) {
      return this.page.getByLabel(labelMatch[1]);
    }

    // Handle getByPlaceholder
    const placeholderMatch = trimmed.match(/getByPlaceholder\(['"](.+?)['"]\)/);
    if (placeholderMatch) {
      return this.page.getByPlaceholder(placeholderMatch[1]);
    }

    // Handle getByText
    const textMatch = trimmed.match(/getByText\(['"](.+?)['"]\)/);
    if (textMatch) {
      return this.page.getByText(textMatch[1]);
    }

    // Handle getByTestId
    const testIdMatch = trimmed.match(/getByTestId\(['"](.+?)['"]\)/);
    if (testIdMatch) {
      return this.page.getByTestId(testIdMatch[1]);
    }

    // Handle locator
    const locatorMatch = trimmed.match(/locator\(['"](.+?)['"]\)/);
    if (locatorMatch) {
      return this.page.locator(locatorMatch[1]);
    }

    throw new Error(`Unsupported locator pattern: ${trimmed}`);
  }

  /**
   * Generate a new step from user prompt using AI with current page context
   */
  async generateStepFromPrompt(prompt: string): Promise<{ qaSummary: string; playwrightCode: string }> {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }

    // Store original prompt for QA summary
    const originalPrompt = prompt;

    // Resolve variables for AI execution (e.g., {{productName}} -> "Teddy Bear")
    const resolvedPrompt = this.resolveVariables(prompt);

    // Capture current page state
    const pageState = await capturePageState(this.page);
    const formattedState = formatPageStateForAI(pageState);

    // Build contextual prompt for AI using resolved values
    const contextualPrompt = this.buildPromptWithContext(resolvedPrompt, formattedState);

    // Call AI to generate action
    const action = await this.callAI(contextualPrompt);

    // Execute the action to validate it works (using resolved values)
    const result = await executeAction(this.page, action);
    if (!result.success) {
      // Try one retry with error context
      const retryPrompt = `${contextualPrompt}\n\nPREVIOUS ATTEMPT FAILED:\nError: ${result.error}\nGenerate a different approach that will work.`;
      const retryAction = await this.callAI(retryPrompt);
      const retryResult = await executeAction(this.page, retryAction);

      if (!retryResult.success) {
        throw new Error(`Failed to generate working step: ${retryResult.error}`);
      }

      // After successful execution, restore variable placeholders in the action
      if (retryAction.value && this.hasVariablePlaceholders(originalPrompt)) {
        retryAction.value = this.restoreVariablePlaceholders(retryAction.value, originalPrompt);
      }

      // Use retry action if successful
      const playwrightCode = generatePlaywrightCode(retryAction);
      const qaSummary = this.generateQASummaryWithVariables(retryAction, originalPrompt);
      return { qaSummary, playwrightCode };
    }

    // After successful execution, restore variable placeholders in the action
    if (action.value && this.hasVariablePlaceholders(originalPrompt)) {
      action.value = this.restoreVariablePlaceholders(action.value, originalPrompt);
    }

    // Generate code and summary from successful action (now with placeholders restored)
    const playwrightCode = generatePlaywrightCode(action);
    const qaSummary = this.generateQASummaryWithVariables(action, originalPrompt);

    return { qaSummary, playwrightCode };
  }

  /**
   * Restore variable placeholders in generated values
   */
  private restoreVariablePlaceholders(generatedValue: string, originalPrompt: string): string {
    let result = generatedValue;

    console.log(`[StepInsertion] Restoring placeholders in: "${generatedValue}"`);
    console.log(`[StepInsertion] Original prompt: "${originalPrompt}"`);

    // For each variable, if the generated value contains the resolved value,
    // replace it back with the placeholder
    for (const [name, value] of this.variableValues.entries()) {
      const placeholder = `{{${name}}}`;
      if (originalPrompt.includes(placeholder) && generatedValue.includes(value)) {
        const before = result;
        result = result.replace(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), placeholder);
        if (before !== result) {
          console.log(`[StepInsertion] Restored "${value}" back to ${placeholder}`);
        }
      }
    }

    console.log(`[StepInsertion] Restored result: "${result}"`);
    return result;
  }

  /**
   * Generate QA summary that preserves variable placeholders from original prompt
   */
  private generateQASummaryWithVariables(action: AIAction, originalPrompt: string): string {
    const baseSummary = generateQASummary(action);

    // If original prompt had variables and base summary has resolved values, restore placeholders
    if (this.hasVariablePlaceholders(originalPrompt)) {
      return this.restoreVariablePlaceholders(baseSummary, originalPrompt);
    }

    return baseSummary;
  }

  /**
   * Build contextual prompt with page state and previous steps
   */
  private buildPromptWithContext(userPrompt: string, pageState: string): string {
    const previousSteps = this.test.metadata.steps?.slice(0, this.insertAfterStep) || [];
    const stepsList = previousSteps
      .map(step => `- Step ${step.number}: ${step.qaSummary}`)
      .join('\n');

    return `
You are a Playwright test automation expert. Generate a Playwright action based on the current page state and user instruction.

CURRENT PAGE URL: ${this.currentUrl}

PREVIOUS STEPS:
${stepsList || 'None'}

USER INSTRUCTION:
${userPrompt}

CURRENT PAGE STATE (Accessibility Tree):
${pageState}

Generate the next action to fulfill the user's instruction. Return your response as JSON:
{
  "action": "click|fill|select|press|goto|wait|expectVisible|expectText|done",
  "selector": "page.getByRole(...) or page.getByLabel(...) - omit for goto/press/wait/done",
  "value": "value for fill/select/press/wait actions (for wait: 'load', 'domcontentloaded', or 'networkidle')",
  "reasoning": "Brief explanation of why this action"
}

Rules:
- Use Playwright's recommended locators (getByRole, getByLabel, getByPlaceholder, getByText)
- Be specific with selectors to avoid ambiguity
- If instruction requires multiple actions, implement just the FIRST action needed
- **CRITICAL**: After form submissions, button clicks that trigger navigation/reload, or any action that causes page changes, include a wait action with value 'load', 'domcontentloaded', or 'networkidle' to ensure page is ready before next step
- Tests often fail because they interact with elements before the page is fully loaded - always wait after navigation-triggering actions
- Return ONLY valid JSON, no markdown formatting
`;
  }

  /**
   * Call AI provider to generate action
   */
  private async callAI(prompt: string): Promise<AIAction> {
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
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Check if browser is ready
   */
  isReady(): boolean {
    return this.browser !== null && this.page !== null;
  }

  /**
   * Get available variables and their sample values
   */
  getVariables(): Array<{ name: string; sampleValue: string }> {
    return Array.from(this.variableValues.entries()).map(([name, sampleValue]) => ({
      name,
      sampleValue
    }));
  }
}
