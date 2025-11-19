import type { RecordedStep } from '../../../shared/types.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { AIProvider } from './index.js';

export const STEP_PLANNER_SYSTEM_PROMPT = `You are a Playwright automation planner. Given a user's instruction for browser automation, you decompose it into atomic, sequential steps.

RESPONSE FORMAT:
You must respond with valid JSON only. No markdown, no explanation outside the JSON.

If you CAN execute the instruction:
{
  "canExecute": true,
  "steps": [
    {
      "description": "Brief description of what this step does",
      "action": "click" | "fill" | "select" | "press" | "goto",
      "selector": "playwright selector if applicable",
      "value": "value if applicable"
    }
  ]
}

If you CANNOT execute (e.g., field not found, instruction unclear):
{
  "canExecute": false,
  "clarificationMessage": "I don't see a 'Last Name' field on this page. Can you describe where it is or what label it has?"
}

GUIDELINES:
1. Break down the instruction into the smallest atomic steps
2. Each step should be ONE action (one click, one fill, one navigation)
3. For "Search Last Name Smith", create 2 steps: fill field, click search button
4. For "Login as admin", create 3 steps: fill username, fill password, click login
5. Use semantic selectors (getByRole, getByLabel) whenever possible
6. If you cannot find an element or the instruction is unclear, respond with canExecute: false
7. Keep descriptions simple and non-technical for QA staff
8. Do NOT execute anything - just plan the steps

EXAMPLES:

User: "Search Last Name Smith"
Page has: input labeled "Last Name" and button "Search"
Response:
{
  "canExecute": true,
  "steps": [
    {
      "description": "Fill 'Last Name' field with 'Smith'",
      "action": "fill",
      "selector": "getByLabel('Last Name')",
      "value": "Smith"
    },
    {
      "description": "Click 'Search' button",
      "action": "click",
      "selector": "getByRole('button', { name: 'Search' })"
    }
  ]
}

User: "Click the submit button"
Page has: no submit button visible
Response:
{
  "canExecute": false,
  "clarificationMessage": "I don't see a submit button on this page. Could you describe what text or label the button has, or provide more details about where it is?"
}`;

export const AGENT_SYSTEM_PROMPT = `You are a Playwright automation agent. You observe web pages and decide the NEXT SINGLE ACTION to achieve the user's goal.

AVAILABLE ACTIONS:
- goto: Navigate to a URL
- click: Click an element
- fill: Fill a text input
- select: Select an option from dropdown
- press: Press a keyboard key (e.g., "Enter", "Escape")
- wait: Wait for a condition (use sparingly)
- done: Goal is achieved, stop automation

SELECTOR PRIORITY (use in this order):
1. getByRole (preferred): page.getByRole('button', { name: 'Submit' })
   - Use { exact: true } if multiple similar elements exist
   - For inputs, specify the accessible name explicitly
2. getByLabel: page.getByLabel('Email')
   - Avoid if label text is ambiguous or applies to multiple fields
3. getByPlaceholder: page.getByPlaceholder('Enter your email')
4. getByText: page.getByText('Click here')
5. CSS selector (last resort): '#submit-btn'

AVOIDING STRICT MODE VIOLATIONS:
- If the page has duplicate fields (e.g., "Password" and "Confirm Password"), use getByRole with exact name
- For form confirmations, look for distinguishing text like "Confirm", "Re-enter", "Verify"
- Example: getByRole('textbox', { name: 'Social Security Number*', exact: true }) vs getByRole('textbox', { name: 'Confirm Your Social Security' })

MULTI-PART INPUT FIELDS (SSN, Phone, Date):
- Some fields split input across multiple inputs (e.g., SSN: ###-##-####)
- Use .nth(index) to target specific inputs: page.locator('input[type="password"]').nth(0) for first SSN segment
- Or use the parent container: page.locator('.ssn.primary input').nth(0)
- Fill each segment separately if needed
- Common patterns: SSN has 3 parts, phone has 3 parts (area, prefix, line)

RESPONSE FORMAT:
You must respond with valid JSON only. No markdown, no explanation outside the JSON.

{
  "action": "click" | "fill" | "select" | "press" | "goto" | "wait" | "done",
  "selector": "playwright selector string (required for click/fill/select)",
  "value": "value to input (required for fill/select/press)",
  "reasoning": "brief explanation for QA staff (1 sentence)"
}

GUIDELINES:
1. Take ONE action at a time
2. Use semantic selectors (getByRole, getByLabel) whenever possible
3. **CRITICAL: If you receive user corrections/feedback with specific instructions (e.g., "click the register button"), you MUST follow that exact instruction as your NEXT action. Do NOT try to complete other steps first.**
4. After handling user corrections, CONTINUE with the original goal
5. Review "RECENT STEPS COMPLETED" to avoid repeating actions or re-filling already completed fields
6. Never re-fill fields that are already filled - check recent steps first
7. If goal is achieved, respond with action: "done"
8. If success criteria is provided and already satisfied, respond with action: "done" and reference the criteria in reasoning
9. If stuck or unable to proceed, respond with action: "done" and explain in reasoning
10. Keep reasoning simple and non-technical for QA staff
11. Always include reasoning field
12. Be conservative with "wait" actions - only use if absolutely necessary

EXAMPLES:
User goal: "Click the login button"
Page shows: button with role="button" name="Login"
Response:
{
  "action": "click",
  "selector": "getByRole('button', { name: 'Login' })",
  "reasoning": "Click the Login button to proceed"
}

User goal: "Enter email address"
Page shows: input with label "Email Address"
Response:
{
  "action": "fill",
  "selector": "getByLabel('Email Address')",
  "value": "test@example.com",
  "reasoning": "Fill in email address field"
}

User goal: "Submit the form"
Current state: Form is filled, submit button visible
Response:
{
  "action": "click",
  "selector": "getByRole('button', { name: 'Submit' })",
  "reasoning": "Submit the completed form"
}

User goal: "Navigate to login page"
Response:
{
  "action": "goto",
  "value": "https://example.com/login",
  "reasoning": "Navigate to the login page"
}`;

export function buildStepPlannerPrompt(
  instruction: string,
  currentUrl: string,
  pageState: string,
  recentSteps: RecordedStep[]
): string {
  const stepsSummary =
    recentSteps.length > 0
      ? recentSteps.slice(-3).map((step) => `${step.stepNumber}. ${step.qaSummary}`).join('\n')
      : 'None yet';

  return `USER INSTRUCTION:
${instruction}

CURRENT URL:
${currentUrl}

CURRENT PAGE STATE:
${pageState}

RECENT STEPS COMPLETED:
${stepsSummary}

Break down this instruction into atomic steps. Respond with JSON only.`;
}

export function buildAgentPrompt(
  goal: string,
  currentUrl: string,
  pageState: string,
  previousSteps: RecordedStep[],
  successCriteria?: string
): string {
  const stepsSummary =
    previousSteps.length > 0
      ? previousSteps.map((step) => `${step.stepNumber}. ${step.qaSummary}`).join('\n')
      : 'None yet';

  const criteriaBlock = successCriteria
    ? `SUCCESS CRITERIA:\n${successCriteria}\n\nIf this criteria is already satisfied, respond with action: "done" and explain briefly.\n`
    : 'SUCCESS CRITERIA:\nNone provided.\n';

  return `USER GOAL:
${goal}

CURRENT URL:
${currentUrl}

${criteriaBlock}
CURRENT PAGE STATE:
${pageState}

STEPS TAKEN SO FAR:
${stepsSummary}

What is the NEXT SINGLE ACTION to progress toward the goal?
Respond with JSON only.`;
}

export async function generateTestName(
  goal: string,
  steps: string[],
  provider: AIProvider,
  apiKey: string,
  baseUrl?: string
): Promise<string> {
  const formattedSteps = steps.length
    ? steps.map((summary, index) => `${index + 1}. ${summary}`).join('\n')
    : 'No steps recorded yet.';

  const prompt = `You are naming an automated QA test.

Goal:
${goal}

Steps accomplished:
${formattedSteps}

Provide a concise test name (2-6 words). Avoid special characters other than spaces, hyphens, or underscores. Respond with the name only.`;

  let response = '';

  switch (provider) {
    case 'anthropic': {
      const client = new Anthropic({ apiKey });
      const completion = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 60,
        messages: [{ role: 'user', content: prompt }]
      });
      const block = completion.content[0];
      if (block?.type !== 'text') {
        throw new Error('Unexpected response from Anthropic while naming test');
      }
      response = block.text;
      break;
    }
    case 'openai': {
      const client = new OpenAI({ apiKey, baseURL: baseUrl });
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60
      });
      response = completion.choices[0]?.message?.content || '';
      break;
    }
    case 'gemini': {
      const genAI = new GoogleGenAI({ apiKey });
      const result = await genAI.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt
      });
      response = result.text || '';
      break;
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }

  if (!response.trim()) {
    throw new Error('AI did not return a test name');
  }

  return response
    .trim()
    .replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9 _-]+/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 60);
}
