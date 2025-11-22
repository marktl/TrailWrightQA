import { Page } from 'playwright';
import crypto from 'crypto';

export interface PageState {
  url: string;
  title: string;
  accessibilityTree: string;
  unlabeledInputs?: string;  // Supplementary info for inputs without accessible names
  hash: string;
  hasChanged: boolean;
}

interface SimplifiedA11yNode {
  role?: string;
  name?: string;
  value?: string;
  id?: string;        // HTML id attribute - useful for unlabeled inputs
  htmlName?: string;  // HTML name attribute - useful for unlabeled inputs
  children?: SimplifiedA11yNode[];
}

/**
 * Simplify accessibility tree to reduce token count
 * Keeps only interactive elements and their labels
 */
function simplifyA11yTree(node: any): SimplifiedA11yNode | null {
  if (!node) {
    return null;
  }

  // Only keep interactive elements
  const interactiveRoles = new Set([
    'button',
    'link',
    'textbox',
    'searchbox',
    'combobox',
    'listbox',
    'option',
    'checkbox',
    'radio',
    'switch',
    'slider',
    'spinbutton',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'treeitem'
  ]);

  const isInteractive = node.role && interactiveRoles.has(node.role);
  const hasName = node.name && node.name.trim().length > 0;

  // Skip non-interactive elements unless they have a meaningful name
  if (!isInteractive && !hasName) {
    // But still process children
    if (node.children) {
      const children = node.children
        .map((child: any) => simplifyA11yTree(child))
        .filter((child: any) => child !== null);
      if (children.length === 1) {
        return children[0];
      } else if (children.length > 1) {
        return { children };
      }
    }
    return null;
  }

  const simplified: SimplifiedA11yNode = {};

  if (node.role) {
    simplified.role = node.role;
  }
  if (node.name) {
    simplified.name = node.name;
  }
  if (node.value) {
    simplified.value = node.value;
  }

  if (node.children && node.children.length > 0) {
    const children = node.children
      .map((child: any) => simplifyA11yTree(child))
      .filter((child: any) => child !== null);
    if (children.length > 0) {
      simplified.children = children;
    }
  }

  return simplified;
}

/**
 * Compute hash of page state for change detection
 */
function computeHash(url: string, a11yTree: string): string {
  return crypto
    .createHash('sha256')
    .update(`${url}::${a11yTree}`)
    .digest('hex')
    .slice(0, 16);
}

let lastHash: string | null = null;

/**
 * Capture unlabeled form inputs with their HTML attributes
 * This supplements the accessibility tree for inputs that lack accessible names
 */
async function captureUnlabeledInputs(page: Page): Promise<string> {
  try {
    interface UnlabeledInput {
      id?: string;
      name?: string;
      type?: string;
      placeholder?: string;
      className?: string;
    }

    const unlabeled = await page.evaluate(`
      (() => {
        const inputs = [];

        // Find all form inputs
        const elements = document.querySelectorAll('input, select, textarea');

        elements.forEach((el) => {
          const input = el;

          // Check if input has an accessible label
          const id = input.id;
          const hasLabel = id && document.querySelector('label[for="' + id + '"]');
          const hasAriaLabel = input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby');

          // Only include if no accessible name (no label association)
          if (!hasLabel && !hasAriaLabel) {
            inputs.push({
              id: input.id || undefined,
              name: input.getAttribute('name') || undefined,
              type: input.getAttribute('type') || input.tagName.toLowerCase(),
              placeholder: input.getAttribute('placeholder') || undefined,
              className: input.className || undefined
            });
          }
        });

        return inputs;
      })()
    `) as UnlabeledInput[];

    if (unlabeled.length === 0) {
      return '';
    }

    return JSON.stringify(unlabeled, null, 2);
  } catch (error) {
    // Don't fail page state capture if this fails
    return '';
  }
}

/**
 * Capture current page state using accessibility tree
 * Only returns full state if page has changed (hash-based)
 */
export async function capturePageState(page: Page): Promise<PageState> {
  const url = page.url();
  const title = await page.title();

  // Get accessibility snapshot
  const a11ySnapshot = await page.accessibility.snapshot();
  const simplified = simplifyA11yTree(a11ySnapshot);
  const a11yTree = JSON.stringify(simplified, null, 2);

  // Get supplementary info for unlabeled inputs
  const unlabeledInputs = await captureUnlabeledInputs(page);

  // Compute hash (include unlabeled inputs in hash)
  const hash = computeHash(url, a11yTree + unlabeledInputs);
  const hasChanged = hash !== lastHash;

  if (hasChanged) {
    lastHash = hash;
  }

  return {
    url,
    title,
    accessibilityTree: a11yTree,
    unlabeledInputs: unlabeledInputs || undefined,
    hash,
    hasChanged
  };
}

/**
 * Reset hash tracking (call when starting new session)
 */
export function resetHashTracking(): void {
  lastHash = null;
}

/**
 * Format page state as readable text for AI
 */
export function formatPageStateForAI(state: PageState): string {
  let output = `URL: ${state.url}
Title: ${state.title}

Interactive Elements:
${state.accessibilityTree}`;

  // Include unlabeled inputs if present
  if (state.unlabeledInputs && state.unlabeledInputs.trim().length > 0) {
    output += `

Unlabeled Inputs (use id or name attribute to target):
${state.unlabeledInputs}`;
  }

  return output;
}
