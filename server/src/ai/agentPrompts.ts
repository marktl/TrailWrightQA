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
      "action": "click" | "fill" | "select" | "press" | "goto" | "wait" | "expectVisible" | "expectText" | "expectValue" | "expectUrl" | "expectTitle" | "screenshot",
      "selector": "playwright selector if applicable",
      "value": "value if applicable (for wait action: 'load', 'domcontentloaded', or 'networkidle')"
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
4. For "Login as admin", create steps: fill username, fill password, click login, wait for page load
5. Use semantic selectors (getByRole, getByLabel) whenever possible
6. If you cannot find an element or the instruction is unclear, respond with canExecute: false
7. Keep descriptions simple and non-technical for QA staff
8. Do NOT execute anything - just plan the steps
9. **CRITICAL - Include wait steps:** After form submissions, button clicks that cause navigation, or any action that triggers a page reload/redirect, ALWAYS include a wait step with value 'load', 'domcontentloaded', or 'networkidle'. This prevents tests from failing due to race conditions where elements aren't ready yet.

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
    },
    {
      "description": "Wait for search results to load",
      "action": "wait",
      "value": "networkidle"
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
- goto: Navigate to a URL (automatically waits for 'load' state)
- click: Click an element
- fill: Fill a text input
- select: Select an option from dropdown
- press: Press a keyboard key (e.g., "Enter", "Escape")
- wait: Wait for page load state - use after form submissions, button clicks that cause navigation/reload, or any action that triggers page changes (requires value: 'load', 'domcontentloaded', or 'networkidle')
- expectVisible: Verify an element is visible (requires selector)
- expectText: Verify element contains text (requires selector and value with expected text)
- expectValue: Verify input field has value (requires selector and value with expected value)
- expectUrl: Verify current page URL matches pattern (requires value with expected URL/pattern)
- expectTitle: Verify page title (requires value with expected title)
- screenshot: Take a screenshot for documentation (optional value for screenshot name)
- done: Goal is achieved, stop automation

SELECTOR PRIORITY (use in this order):
**CRITICAL FIRST STEP:** Before choosing any selector, check if the element appears in the "Unlabeled Inputs" section. If it does, ALWAYS use its id or name attribute directly with page.locator() - DO NOT use getByLabel or getByRole for these elements.

1. **Unlabeled inputs (CHECK FIRST)**: If element is in "Unlabeled Inputs" section:
   - Use page.locator('#elementId') or page.locator('[name="elementName"]')
   - Example: Input with id="ssn1" → page.locator('#ssn1')
   - Example: Dropdown with id="ddlSuffix3" → page.locator('#ddlSuffix3')
   - **NEVER use getByLabel/getByRole for elements in "Unlabeled Inputs"**

2. getByRole (for labeled elements): page.getByRole('button', { name: 'Submit' })
   - Use { exact: true } if multiple similar elements exist
   - For inputs, specify the accessible name explicitly

3. getByLabel (for labeled inputs): page.getByLabel('Email')
   - **ONLY use if element is NOT in "Unlabeled Inputs" section**
   - Avoid if label text is ambiguous or applies to multiple fields
   - Use { exact: true } option if multiple fields have similar labels

4. getByPlaceholder: page.getByPlaceholder('Enter your email')

5. getByText: page.getByText('Click here')

6. CSS selector (last resort): '.form-control.ssn'

AVOIDING STRICT MODE VIOLATIONS:
- If the page has duplicate fields (e.g., "Password" and "Confirm Password"), use getByRole with exact name
- For form confirmations, look for distinguishing text like "Confirm", "Re-enter", "Verify"
- Example: getByRole('textbox', { name: 'Social Security Number*', exact: true }) vs getByRole('textbox', { name: 'Confirm Your Social Security' })

MULTI-PART INPUT FIELDS (SSN, Phone, Date):
- Some fields split input across multiple inputs (e.g., SSN: ###-##-####)
- BEST APPROACH: Use individual id/name attributes if available in "Unlabeled Inputs"
  Example SSN pattern: ssn1, ssn2, ssn3 or ssnConf1, ssnConf2, ssnConf3
  - page.locator('#ssn1').fill('555')
  - page.locator('#ssn2').fill('55')
  - page.locator('#ssn3').fill('0985')
- FALLBACK: Use .nth(index) to target specific inputs: page.locator('input[type="password"]').nth(0)
- Or use the parent container: page.locator('.ssn.primary input').nth(0)
- Split values appropriately: "555-55-0985" → ["555", "55", "0985"]
- Common patterns: SSN has 3 parts (3-2-4 digits), phone has 3 parts (area-prefix-line)

RESPONSE FORMAT:
You must respond with valid JSON only. No markdown, no explanation outside the JSON.

{
  "action": "click" | "fill" | "select" | "press" | "goto" | "wait" | "expectVisible" | "expectText" | "expectValue" | "expectUrl" | "expectTitle" | "screenshot" | "done",
  "selector": "playwright selector string (required for click/fill/select/expectVisible/expectText/expectValue)",
  "value": "value to input (required for fill/select/press/expectText/expectValue/expectUrl/expectTitle)",
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
12. **PAGE LOAD WAITING - CRITICAL:**
    - After form submissions (clicking Submit, Save, Continue, etc.), ALWAYS add a wait action for 'load' or 'networkidle'
    - After clicking buttons that trigger navigation or page refresh, ALWAYS add a wait action
    - After login/logout actions, ALWAYS wait for the page to load completely
    - Use wait with value 'networkidle' when you need to ensure all resources have loaded
    - Use wait with value 'load' when you need to ensure the page's load event has fired
    - Use wait with value 'domcontentloaded' as a faster alternative when DOM is sufficient
    - Tests often fail because they try to interact with elements before the page is ready - prevent this with proper waits
13. **VALIDATION BEST PRACTICES:**
    - After critical actions (form submission, purchase, login), use validation actions to verify success
    - Use expectVisible to confirm important elements appear (success messages, confirmation pages, error alerts)
    - Use expectText to verify specific content matches expectations
    - Use expectUrl or expectTitle to confirm navigation to correct pages
    - Include validation steps when the goal mentions "verify", "check", "ensure", or "confirm"

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

User goal: "Submit the form and verify success message appears"
Current state: Form is filled, submit button visible
Step 1 - Click submit:
{
  "action": "click",
  "selector": "getByRole('button', { name: 'Submit' })",
  "reasoning": "Submit the completed form"
}
Step 2 - Wait for page to load:
{
  "action": "wait",
  "value": "networkidle",
  "reasoning": "Wait for page to finish loading after form submission"
}
Step 3 - Verify success:
{
  "action": "expectVisible",
  "selector": "getByText('Success')",
  "reasoning": "Verify success message is displayed"
}

User goal: "Verify search results contain the searched product"
Page shows: Search results page with product listings
Response:
{
  "action": "expectText",
  "selector": "getByRole('heading', { name: /search results/i })",
  "value": "teddy bear",
  "reasoning": "Verify search results contain the searched product"
}

User goal: "Check that we're on the checkout page"
Current URL: https://example.com/checkout
Response:
{
  "action": "expectUrl",
  "value": "/checkout",
  "reasoning": "Verify we navigated to the checkout page"
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

export async function generateTestTags(
  goal: string,
  steps: string[],
  startUrl: string,
  provider: AIProvider,
  apiKey: string,
  baseUrl?: string
): Promise<string[]> {
  const formattedSteps = steps.length
    ? steps.map((summary, index) => `${index + 1}. ${summary}`).join('\n')
    : 'No steps recorded yet.';

  const prompt = `You are categorizing an automated QA test with relevant tags.

Goal:
${goal}

Starting URL:
${startUrl}

Steps accomplished:
${formattedSteps}

Provide 3-5 relevant tags that describe what this test does. Tags should be:
- Descriptive (e.g., "login", "checkout", "form-validation")
- Lowercase with hyphens for multi-word tags (e.g., "user-registration")
- Focused on test purpose, area, or functionality
- Include one tag for the general category (e.g., "authentication", "e-commerce", "search")

Always include "ai-generated" as one of the tags.

Respond with comma-separated tags only (no explanations).`;

  let response = '';

  switch (provider) {
    case 'anthropic': {
      const client = new Anthropic({ apiKey });
      const completion = await client.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }]
      });
      const block = completion.content[0];
      if (block?.type !== 'text') {
        throw new Error('Unexpected response from Anthropic while generating tags');
      }
      response = block.text;
      break;
    }
    case 'openai': {
      const client = new OpenAI({ apiKey, baseURL: baseUrl });
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100
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
    return ['ai-generated'];
  }

  // Parse comma-separated tags
  const tags = response
    .trim()
    .split(',')
    .map((tag) =>
      tag
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    )
    .filter((tag) => tag.length > 0 && tag.length <= 30);

  // Ensure ai-generated is always included
  if (!tags.includes('ai-generated')) {
    tags.unshift('ai-generated');
  }

  return tags.slice(0, 6); // Max 6 tags
}
