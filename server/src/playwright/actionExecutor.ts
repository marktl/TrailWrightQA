import { Locator, Page } from 'playwright';
import type { AIAction, RecordedStep } from '../../../shared/types.js';

/**
 * Check if text matches a pattern (supports both plain text and regex)
 * Regex patterns should be in format: /pattern/ or /pattern/flags
 */
function matchesPattern(text: string | null, pattern: string): boolean {
  if (!text) return false;

  // Check if pattern looks like a regex: /.../ or /.../flags
  const regexMatch = pattern.match(/^\/(.+?)\/([gimsuy]*)$/);
  if (regexMatch) {
    try {
      const [, regexPattern, flags] = regexMatch;
      const regex = new RegExp(regexPattern, flags);
      return regex.test(text);
    } catch {
      // If regex parsing fails, fall back to plain text match
      return text.includes(pattern);
    }
  }

  // Plain text substring match
  return text.includes(pattern);
}

/**
 * Detect if a selector targets a split-field (like SSN or phone)
 * Returns info about the split pattern if detected, null otherwise
 */
interface SplitFieldInfo {
  baseName: string;    // e.g., "ssn" or "phone"
  index: number;       // Current field index (1, 2, 3)
  totalParts: number;  // Total number of parts
  pattern: string;     // Pattern like "ssn{n}" or "phone{n}"
  allSelectors: string[]; // All field selectors
  shouldAutoSplit: boolean; // Whether to auto-split based on field index
}

function detectSplitField(selector: string, value: string): SplitFieldInfo | null {
  // Extract id or name from selector
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
  const nameMatch = selector.match(/\[name=["']([a-zA-Z0-9_-]+)["']\]/);

  const fieldId = idMatch?.[1] || nameMatch?.[1];
  if (!fieldId) return null;

  // Common split-field patterns
  const patterns = [
    // SSN patterns: ssn1, ssn2, ssn3 or ssnConf1, ssnConf2, ssnConf3
    { regex: /^(ssn(?:Conf)?)(\d)$/, parts: 3, lengths: [3, 2, 4] },
    // Phone patterns: phone1, phone2, phone3 or phoneArea, phonePrefix, phoneLine
    { regex: /^(phone)(\d)$/, parts: 3, lengths: [3, 3, 4] },
    // Generic numbered patterns: field1, field2, field3
    { regex: /^([a-zA-Z]+)(\d)$/, parts: null, lengths: null }
  ];

  for (const pattern of patterns) {
    const match = fieldId.match(pattern.regex);
    if (match) {
      const baseName = match[1];
      const currentIndex = parseInt(match[2]);

      // Determine total parts based on value length or pattern
      let totalParts = pattern.parts;
      let splitLengths = pattern.lengths;

      // For SSN pattern specifically
      if (baseName.toLowerCase().includes('ssn')) {
        totalParts = 3;
        splitLengths = [3, 2, 4];
      }

      // Try to infer from value if pattern doesn't specify
      if (!totalParts && value) {
        const parts = value.split(/[-\s./]/);
        if (parts.length > 1) {
          totalParts = parts.length;
          splitLengths = parts.map(p => p.length);
        }
      }

      if (!totalParts) continue;

      // Generate all field selectors
      const allSelectors: string[] = [];
      const selectorType = idMatch ? 'id' : 'name';

      for (let i = 1; i <= totalParts; i++) {
        const fieldName = `${baseName}${i}`;
        allSelectors.push(
          selectorType === 'id'
            ? `#${fieldName}`
            : `[name="${fieldName}"]`
        );
      }

      // Only auto-split when targeting the FIRST field AND value looks like complete data
      // This prevents auto-splitting when correcting individual fields
      const shouldAutoSplit = currentIndex === 1 && value.length >= 7;

      return {
        baseName,
        index: currentIndex,
        totalParts,
        pattern: `${baseName}{n}`,
        allSelectors,
        shouldAutoSplit
      };
    }
  }

  return null;
}

/**
 * Split a value based on common patterns (SSN, phone, etc.)
 */
function splitValue(value: string, totalParts: number, baseName: string): string[] {
  // Remove common separators
  const cleaned = value.replace(/[-\s./()]/g, '');

  // SSN pattern: 3-2-4
  if (baseName.toLowerCase().includes('ssn') && totalParts === 3) {
    if (cleaned.length === 9) {
      return [
        cleaned.substring(0, 3),
        cleaned.substring(3, 5),
        cleaned.substring(5, 9)
      ];
    }
  }

  // Phone pattern: 3-3-4
  if (baseName.toLowerCase().includes('phone') && totalParts === 3) {
    if (cleaned.length === 10) {
      return [
        cleaned.substring(0, 3),
        cleaned.substring(3, 6),
        cleaned.substring(6, 10)
      ];
    }
  }

  // Try to split by existing separators
  const parts = value.split(/[-\s./()]/);
  if (parts.length === totalParts) {
    return parts;
  }

  // Equal split as fallback
  const partLength = Math.ceil(cleaned.length / totalParts);
  const result: string[] = [];
  for (let i = 0; i < totalParts; i++) {
    const start = i * partLength;
    const part = cleaned.substring(start, start + partLength);
    if (part) result.push(part);
  }

  return result;
}

/**
 * Add exact: true to a selector to avoid strict mode violations
 * Works with getByRole, getByLabel, and similar selectors
 */
function addExactToSelector(selector: string): string {
  // Handle getByLabel with positional argument
  // Example: getByLabel('Email') -> getByLabel('Email', { exact: true })
  // Example: getByLabel('Email', { }) -> getByLabel('Email', { exact: true })
  const labelMatch = selector.match(/^getByLabel\((['"][^'"]+['"])(?:,\s*\{([^}]*)\})?\)/);
  if (labelMatch) {
    const [, labelText, existingOptions] = labelMatch;
    if (!existingOptions) {
      // No options object - add one
      return `getByLabel(${labelText}, { exact: true })`;
    } else if (!existingOptions.includes('exact:')) {
      // Has options but no exact - add it
      return `getByLabel(${labelText}, { ${existingOptions.trim()}, exact: true })`;
    }
    // Already has exact
    return selector;
  }

  // Handle getByRole, getByPlaceholder, etc. with name option
  // Example: getByRole('textbox', { name: 'Email*' }) -> getByRole('textbox', { name: 'Email*', exact: true })
  const nameOptionMatch = selector.match(/^(getBy\w+\([^,]+,\s*\{[^}]*name:\s*['"][^'"]+['"])(\s*\})/);
  if (nameOptionMatch) {
    const [, before, after] = nameOptionMatch;
    return `${before}, exact: true${after}`;
  }

  // Already has exact option or doesn't use name/label option
  return selector;
}

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
        try {
          await clickTarget.locator.click();
        } catch (error: any) {
          // Handle strict mode violations by retrying with exact match
          if (error.message?.includes('strict mode violation')) {
            const exactSelector = addExactToSelector(action.selector);
            const retryTarget = await resolveLocator(page, exactSelector);
            action.selector = retryTarget.selectorForCode;
            await retryTarget.locator.click();
          } else {
            throw error;
          }
        }
        break;

      case 'fill':
        if (!action.selector || action.value === undefined) {
          throw new Error('fill action requires selector and value');
        }

        // Check if this is a split-field (like SSN or phone)
        const splitInfo = detectSplitField(action.selector, action.value);

        // Only auto-split if shouldAutoSplit flag is true (targeting first field with full value)
        if (splitInfo && splitInfo.shouldAutoSplit && action.value.length > 3) {
          // This is a split field - fill all parts
          const parts = splitValue(action.value, splitInfo.totalParts, splitInfo.baseName);

          // Fill each part
          for (let i = 0; i < Math.min(parts.length, splitInfo.allSelectors.length); i++) {
            const partSelector = splitInfo.allSelectors[i];
            const partValue = parts[i];

            if (partValue) {
              const locator = page.locator(partSelector);
              await locator.fill(partValue);
            }
          }

          // Keep original selector so generatePlaywrightCode can detect split pattern
          // (no need to update action.selector)
        } else {
          // Normal single-field fill (including when targeting individual split-field parts)
          const fillTarget = await resolveLocator(page, action.selector);
          action.selector = fillTarget.selectorForCode;
          try {
            await fillTarget.locator.fill(action.value);
          } catch (error: any) {
            // Handle strict mode violations by retrying with exact match
            if (error.message?.includes('strict mode violation')) {
              const exactSelector = addExactToSelector(action.selector);
              const retryTarget = await resolveLocator(page, exactSelector);
              action.selector = retryTarget.selectorForCode;
              await retryTarget.locator.fill(action.value);
            } else {
              throw error;
            }
          }
        }
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
        // Wait for page load state or timeout
        if (!action.value) {
          throw new Error('wait action requires a value (load state or milliseconds)');
        }

        // Check if value is a load state
        const loadStates = ['load', 'domcontentloaded', 'networkidle'];
        if (loadStates.includes(action.value.toLowerCase())) {
          await page.waitForLoadState(action.value as 'load' | 'domcontentloaded' | 'networkidle', { timeout: 30000 });
        } else {
          // Fallback to timeout if numeric value provided
          const waitTime = parseInt(action.value);
          if (isNaN(waitTime)) {
            throw new Error(`wait action value must be a load state (load, domcontentloaded, networkidle) or milliseconds. Got: ${action.value}`);
          }
          await page.waitForTimeout(Math.min(waitTime, 5000)); // Max 5 seconds
        }
        break;

      case 'expectVisible':
        if (!action.selector) {
          throw new Error('expectVisible action requires a selector');
        }
        const visibleTarget = await resolveLocator(page, action.selector);
        action.selector = visibleTarget.selectorForCode;
        await visibleTarget.locator.waitFor({ state: 'visible', timeout: 10000 });
        break;

      case 'expectText':
        if (!action.selector || !action.value) {
          throw new Error('expectText action requires selector and value');
        }
        const textTarget = await resolveLocator(page, action.selector);
        action.selector = textTarget.selectorForCode;
        const actualText = await textTarget.locator.textContent();

        // Support both plain text and regex patterns
        const isMatch = matchesPattern(actualText, action.value);
        if (!isMatch) {
          throw new Error(`Expected text "${action.value}" not found. Found: "${actualText}"`);
        }
        break;

      case 'expectValue':
        if (!action.selector || action.value === undefined) {
          throw new Error('expectValue action requires selector and value');
        }
        const valueTarget = await resolveLocator(page, action.selector);
        action.selector = valueTarget.selectorForCode;
        const actualValue = await valueTarget.locator.inputValue();
        if (actualValue !== action.value) {
          throw new Error(`Expected value "${action.value}" but found "${actualValue}"`);
        }
        break;

      case 'expectUrl':
        if (!action.value) {
          throw new Error('expectUrl action requires a URL pattern in value field');
        }
        const currentUrl = page.url();
        const urlMatch = matchesPattern(currentUrl, action.value);
        if (!urlMatch) {
          throw new Error(`Expected URL to contain "${action.value}" but got "${currentUrl}"`);
        }
        break;

      case 'expectTitle':
        if (!action.value) {
          throw new Error('expectTitle action requires expected title in value field');
        }
        const actualTitle = await page.title();
        const titleMatch = matchesPattern(actualTitle, action.value);
        if (!titleMatch) {
          throw new Error(`Expected title to contain "${action.value}" but got "${actualTitle}"`);
        }
        break;

      case 'screenshot':
        // Screenshot is captured automatically after each step
        // This action is primarily for semantic documentation
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

  // Replace standalone locator() calls with page.locator() for chained selectors
  const normalizedSelector = cleaned.replace(/\blocator\(/g, 'page.locator(');

  try {
    const locator: Locator = eval(`page.${normalizedSelector}`);
    return { locator, selectorForCode: normalizedSelector };
  } catch (error) {
    // If eval fails, treat the whole thing as a simple CSS/text selector
    try {
      const locator = page.locator(selectorStr);
      return { locator, selectorForCode: `locator('${selectorStr}')` };
    } catch {
      // Last resort - throw descriptive error
      throw new Error(`Invalid selector: ${selectorStr}. Error: ${error}`);
    }
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

    case 'fill': {
      // Check if this is a split-field fill (selector contains multiple locators)
      const splitInfo = action.selector && detectSplitField(action.selector, action.value || '');

      if (splitInfo && splitInfo.shouldAutoSplit && action.value && action.value.length > 3) {
        // Generate code for split-field
        const parts = splitValue(action.value, splitInfo.totalParts, splitInfo.baseName);
        const lines = splitInfo.allSelectors
          .map((sel, i) => {
            const val = parts[i] || '';
            return `await page.locator('${sel}').fill('${escapeString(val)}');`;
          })
          .join('\n');
        return lines;
      }

      // Normal single-field fill
      return `await page.${action.selector}.fill('${escapeString(action.value || '')}');`;
    }

    case 'select':
      return `await page.${action.selector}.selectOption('${escapeString(action.value || '')}');`;

    case 'press':
      return `await page.keyboard.press('${action.value}');`;

    case 'wait': {
      const loadStates = ['load', 'domcontentloaded', 'networkidle'];
      if (action.value && loadStates.includes(action.value.toLowerCase())) {
        return `await page.waitForLoadState('${action.value}');`;
      }
      return `await page.waitForTimeout(${action.value || 1000});`;
    }

    case 'expectVisible':
      return `await expect(page.${action.selector}).toBeVisible();`;

    case 'expectText': {
      const textPattern = formatPatternForCode(action.value || '');
      return `await expect(page.${action.selector}).toContainText(${textPattern});`;
    }

    case 'expectValue':
      return `await expect(page.${action.selector}).toHaveValue('${escapeString(action.value || '')}');`;

    case 'expectUrl': {
      const urlPattern = formatPatternForCode(action.value || '');
      return `await expect(page).toHaveURL(${urlPattern});`;
    }

    case 'expectTitle': {
      const titlePattern = formatPatternForCode(action.value || '');
      return `await expect(page).toHaveTitle(${titlePattern});`;
    }

    case 'screenshot':
      const screenshotName = action.value || 'screenshot';
      return `await page.screenshot({ path: '${screenshotName}.png' });`;

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
      // Check if this is a split-field
      const splitInfo = action.selector && detectSplitField(action.selector, action.value || '');

      if (splitInfo && splitInfo.shouldAutoSplit && action.value && action.value.length > 3) {
        // Generate QA summary for split field
        const fieldType = splitInfo.baseName.toLowerCase().includes('ssn') ? 'SSN' :
                         splitInfo.baseName.toLowerCase().includes('phone') ? 'Phone' :
                         splitInfo.baseName;
        return `Fill ${fieldType} fields with "${action.value}"`;
      }

      // Normal single field
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

    case 'wait': {
      const loadStates = ['load', 'domcontentloaded', 'networkidle'];
      if (action.value && loadStates.includes(action.value.toLowerCase())) {
        switch (action.value.toLowerCase()) {
          case 'networkidle':
            return 'Wait for page to finish loading (network idle)';
          case 'load':
            return 'Wait for page to load completely';
          case 'domcontentloaded':
            return 'Wait for page content to load';
          default:
            return 'Wait for page to load';
        }
      }
      return `Wait ${action.value}ms`;
    }

    case 'expectVisible': {
      const elementName = extractElementName(action.selector || '');
      return elementName
        ? `Verify "${elementName}" is visible`
        : 'Verify element is visible';
    }

    case 'expectText': {
      const elementName = extractElementName(action.selector || '');
      const expectedText = action.value || '';
      return elementName
        ? `Verify "${elementName}" contains "${expectedText}"`
        : `Verify text contains "${expectedText}"`;
    }

    case 'expectValue': {
      const fieldName = extractElementName(action.selector || '');
      const expectedValue = action.value || '';
      return fieldName
        ? `Verify "${fieldName}" has value "${expectedValue}"`
        : `Verify value is "${expectedValue}"`;
    }

    case 'expectUrl':
      return `Verify URL contains "${action.value}"`;

    case 'expectTitle':
      return `Verify page title contains "${action.value}"`;

    case 'screenshot':
      return action.value ? `Take screenshot: ${action.value}` : 'Take screenshot';

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
 * Format a pattern for code generation - supports both plain text and regex
 * Regex patterns (e.g., "/^Thompson/") are returned as regex literals
 * Plain text is returned as quoted strings
 */
function formatPatternForCode(pattern: string): string {
  // Check if pattern looks like a regex: /.../ or /.../flags
  const regexMatch = pattern.match(/^\/(.+?)\/([gimsuy]*)$/);
  if (regexMatch) {
    // Return as regex literal (no quotes)
    return pattern;
  }

  // Return as quoted string
  return `'${escapeString(pattern)}'`;
}

/**
 * Escape string for code generation
 */
function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/**
 * Escape string for regex patterns (deprecated - use formatPatternForCode instead)
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a recorded step from an executed action
 */
export function createRecordedStep(
  stepNumber: number,
  action: AIAction,
  extras: Partial<Pick<RecordedStep, 'url' | 'screenshotPath' | 'screenshotData'>> = {}
): RecordedStep {
  return {
    stepNumber,
    playwrightCode: generatePlaywrightCode(action),
    qaSummary: generateQASummary(action),
    timestamp: new Date().toISOString(),
    ...extras
  };
}
