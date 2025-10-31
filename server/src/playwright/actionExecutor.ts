import { Locator, Page } from 'playwright';
import type { AIAction, RecordedStep } from '../../../shared/types.js';

/**
 * Execute an AI-decided action in Playwright
 * Returns the executed action and any error
 */
export async function executeAction(
  page: Page,
  action: AIAction
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (action.action) {
      case 'goto':
        if (!action.value) {
          throw new Error('goto action requires a URL in value field');
        }
        await page.goto(action.value, { waitUntil: 'domcontentloaded' });
        break;

      case 'click':
        if (!action.selector) {
          throw new Error('click action requires a selector');
        }
        const clickTarget = await resolveLocator(page, action.selector);
        action.selector = clickTarget.selectorForCode;
        await clickTarget.locator.click();
        break;

      case 'fill':
        if (!action.selector || action.value === undefined) {
          throw new Error('fill action requires selector and value');
        }
        const fillTarget = await resolveLocator(page, action.selector);
        action.selector = fillTarget.selectorForCode;
        await fillTarget.locator.fill(action.value);
        break;

      case 'select':
        if (!action.selector || !action.value) {
          throw new Error('select action requires selector and value');
        }
        const selectTarget = await resolveLocator(page, action.selector);
        action.selector = selectTarget.selectorForCode;
        await selectTarget.locator.selectOption(action.value);
        break;

      case 'press':
        if (!action.value) {
          throw new Error('press action requires a key in value field');
        }
        await page.keyboard.press(action.value);
        break;

      case 'wait':
        // Simple wait - could be enhanced to wait for specific conditions
        const waitTime = action.value ? parseInt(action.value) : 1000;
        await page.waitForTimeout(Math.min(waitTime, 5000)); // Max 5 seconds
        break;

      case 'done':
        // No action needed
        break;

      default:
        throw new Error(`Unknown action type: ${action.action}`);
    }

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || String(error)
    };
  }
}

/**
 * Resolve selector string to a Locator
 * Handles getByRole, getByLabel, etc. with graceful fallbacks
 */
async function resolveLocator(
  page: Page,
  selectorStr: string
): Promise<{ locator: Locator; selectorForCode: string }> {
  const cleaned = selectorStr.replace(/^page\./, '');

  const labelMatch = cleaned.match(/^getByLabel\((['"])(.+?)\1\)$/);
  if (labelMatch) {
    const labelText = labelMatch[2];
    const accessibleLocator = page.getByLabel(labelText);

    try {
      await accessibleLocator.first().waitFor({ state: 'attached', timeout: 750 });
      return { locator: accessibleLocator, selectorForCode: cleaned };
    } catch {
      const fallback = await createLabelFallbackLocator(page, labelText);
      if (fallback) {
        return fallback;
      }
    }
  }

  try {
    const locator: Locator = eval(`page.${cleaned}`);
    return { locator, selectorForCode: cleaned };
  } catch {
    const locator = page.locator(selectorStr);
    return { locator, selectorForCode: cleaned };
  }
}

/**
 * Attempt to resolve an input associated with a label when getByLabel fails
 */
async function createLabelFallbackLocator(
  page: Page,
  labelText: string
): Promise<{ locator: Locator; selectorForCode: string } | null> {
  const normalized = labelText.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  const labelSelector = `label:has-text("${escapeForDoubleQuotedString(normalized)}")`;
  const labels = page.locator(labelSelector);
  const labelCount = await labels.count();
  if (labelCount === 0) {
    return null;
  }

  for (let index = 0; index < labelCount; index++) {
    const currentLabel = labels.nth(index);
    const forAttr = await currentLabel.getAttribute('for');

    if (forAttr) {
      const attrValue = escapeForDoubleQuotedString(forAttr);
      const byId = page.locator(`[id="${attrValue}"]`);
      if (await byId.count()) {
        return {
          locator: byId,
          selectorForCode: `locator('[id="${attrValue}"]')`
        };
      }

      const byName = page.locator(`[name="${attrValue}"]`);
      if (await byName.count()) {
        return {
          locator: byName,
          selectorForCode: `locator('[name="${attrValue}"]')`
        };
      }
    }

    const nested = currentLabel.locator('input,textarea,select');
    if (await nested.count()) {
      return {
        locator: nested.first(),
        selectorForCode: `locator('${labelSelector}').nth(${index}).locator('input,textarea,select')`
      };
    }

    const sibling = currentLabel.locator(
      'xpath=following::*[self::input or self::textarea or self::select][1]'
    );
    if (await sibling.count()) {
      return {
        locator: sibling.first(),
        selectorForCode: `locator('${labelSelector}').nth(${index}).locator('xpath=following::*[self::input or self::textarea or self::select][1]')`
      };
    }
  }

  return null;
}

function escapeForDoubleQuotedString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Generate Playwright code string from AI action
 */
export function generatePlaywrightCode(action: AIAction): string {
  switch (action.action) {
    case 'goto':
      return `await page.goto('${action.value}');`;

    case 'click':
      return `await page.${action.selector}.click();`;

    case 'fill':
      return `await page.${action.selector}.fill('${escapeString(action.value || '')}');`;

    case 'select':
      return `await page.${action.selector}.selectOption('${escapeString(action.value || '')}');`;

    case 'press':
      return `await page.keyboard.press('${action.value}');`;

    case 'wait':
      return `await page.waitForTimeout(${action.value || 1000});`;

    case 'done':
      return '// Test goal achieved';

    default:
      return `// Unknown action: ${action.action}`;
  }
}

/**
 * Generate QA-friendly summary from AI action
 * Uses templates to create simple, non-technical descriptions
 */
export function generateQASummary(action: AIAction): string {
  // If AI provided good reasoning, use it
  if (action.reasoning && action.reasoning.length > 0) {
    return action.reasoning;
  }

  // Otherwise generate from action
  switch (action.action) {
    case 'goto':
      return `Navigate to ${action.value}`;

    case 'click': {
      const elementName = extractElementName(action.selector || '');
      return elementName ? `Click "${elementName}"` : 'Click element';
    }

    case 'fill': {
      const fieldName = extractElementName(action.selector || '');
      const value = action.value || '';
      return fieldName
        ? `Fill "${fieldName}" with "${value}"`
        : `Enter "${value}"`;
    }

    case 'select': {
      const fieldName = extractElementName(action.selector || '');
      const value = action.value || '';
      return fieldName
        ? `Select "${value}" from "${fieldName}"`
        : `Select "${value}"`;
    }

    case 'press':
      return `Press ${action.value} key`;

    case 'wait':
      return 'Wait for page to load';

    case 'done':
      return 'Goal achieved';

    default:
      return `Perform ${action.action} action`;
  }
}

/**
 * Extract human-readable element name from selector
 * Examples:
 *   getByRole('button', { name: 'Submit' }) -> Submit
 *   getByLabel('Email Address') -> Email Address
 */
function extractElementName(selector: string): string | null {
  // Extract from name property
  const nameMatch = selector.match(/name:\s*['"]([^'"]+)['"]/);
  if (nameMatch) {
    return nameMatch[1];
  }

  // Extract from getByLabel
  const labelMatch = selector.match(/getByLabel\(['"]([^'"]+)['"]\)/);
  if (labelMatch) {
    return labelMatch[1];
  }

  // Extract from getByPlaceholder
  const placeholderMatch = selector.match(/getByPlaceholder\(['"]([^'"]+)['"]\)/);
  if (placeholderMatch) {
    return placeholderMatch[1];
  }

  // Extract from label fallback selectors
  const hasTextMatch = selector.match(/label:has-text\(["']([^"']+)["']\)/);
  if (hasTextMatch) {
    return hasTextMatch[1];
  }

  // Extract from getByText
  const textMatch = selector.match(/getByText\(['"]([^'"]+)['"]\)/);
  if (textMatch) {
    return textMatch[1];
  }

  return null;
}

/**
 * Escape string for code generation
 */
function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/**
 * Create a recorded step from an executed action
 */
export function createRecordedStep(
  stepNumber: number,
  action: AIAction
): RecordedStep {
  return {
    stepNumber,
    playwrightCode: generatePlaywrightCode(action),
    qaSummary: generateQASummary(action),
    timestamp: new Date().toISOString()
  };
}
