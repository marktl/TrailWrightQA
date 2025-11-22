import { Page } from 'playwright';
import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

declare const window: any;
declare const document: any;

export class PlaywrightMCPAdapter {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private schemas = {
    click: z.object({ selector: z.string() }),
    fill: z.object({ selector: z.string(), value: z.string() }),
    select_option: z.object({ selector: z.string(), value: z.string() }),
    hover: z.object({ selector: z.string() }),
    press_key: z.object({ key: z.string() }),
    scroll: z.object({
      selector: z.string().optional(),
      direction: z.enum(['up', 'down', 'bottom', 'top']).optional()
    }),
    evaluate_javascript: z.object({ script: z.string() }),
    get_page_content: z.object({})
  };

  getTools(): Tool[] {
    return [
      {
        name: 'click',
        description: 'Click an element on the page',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'Playwright selector for the element' }
          },
          required: ['selector']
        }
      },
      {
        name: 'fill',
        description: 'Fill an input field with a value',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'Playwright selector for the input field' },
            value: { type: 'string', description: 'Value to fill' }
          },
          required: ['selector', 'value']
        }
      },
      {
        name: 'select_option',
        description: 'Select an option in a <select> element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'Playwright selector for the select element' },
            value: { type: 'string', description: 'Value of the option to select' }
          },
          required: ['selector', 'value']
        }
      },
      {
        name: 'hover',
        description: 'Hover over an element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: 'Playwright selector for the element' }
          },
          required: ['selector']
        }
      },
      {
        name: 'press_key',
        description: 'Press a specific key on the keyboard',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key to press (e.g., "Enter", "ArrowDown")' }
          },
          required: ['key']
        }
      },
      {
        name: 'scroll',
        description: 'Scroll the page or an element',
        inputSchema: {
          type: 'object',
          properties: {
            selector: {
              type: 'string',
              description: 'Optional selector to scroll into view. If omitted, scrolls the window.'
            },
            direction: { type: 'string', enum: ['up', 'down', 'bottom', 'top'], description: 'Direction to scroll' }
          }
        }
      },
      {
        name: 'evaluate_javascript',
        description: 'Execute JavaScript in the page context',
        inputSchema: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'JavaScript code to execute' }
          },
          required: ['script']
        }
      },
      {
        name: 'get_page_content',
        description: 'Get the full HTML content of the page',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }

  async callTool(name: string, args: any): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
    try {
      switch (name) {
        case 'click': {
          const parsed = this.schemas.click.safeParse(args);
          if (!parsed.success) throw new Error(parsed.error.message);
          await this.page.click(parsed.data.selector);
          return { content: [{ type: 'text', text: `Clicked ${parsed.data.selector}` }] };
        }

        case 'fill': {
          const parsed = this.schemas.fill.safeParse(args);
          if (!parsed.success) throw new Error(parsed.error.message);
          await this.page.fill(parsed.data.selector, parsed.data.value);
          return { content: [{ type: 'text', text: `Filled ${parsed.data.selector} with "${parsed.data.value}"` }] };
        }

        case 'select_option': {
          const parsed = this.schemas.select_option.safeParse(args);
          if (!parsed.success) throw new Error(parsed.error.message);
          await this.page.selectOption(parsed.data.selector, parsed.data.value);
          return { content: [{ type: 'text', text: `Selected "${parsed.data.value}" in ${parsed.data.selector}` }] };
        }

        case 'hover': {
          const parsed = this.schemas.hover.safeParse(args);
          if (!parsed.success) throw new Error(parsed.error.message);
          await this.page.hover(parsed.data.selector);
          return { content: [{ type: 'text', text: `Hovered over ${parsed.data.selector}` }] };
        }

        case 'press_key': {
          const parsed = this.schemas.press_key.safeParse(args);
          if (!parsed.success) throw new Error(parsed.error.message);
          await this.page.keyboard.press(parsed.data.key);
          return { content: [{ type: 'text', text: `Pressed key "${parsed.data.key}"` }] };
        }

        case 'scroll': {
          const parsed = this.schemas.scroll.safeParse(args);
          if (!parsed.success) throw new Error(parsed.error.message);
          if (parsed.data.selector) {
            await this.page.locator(parsed.data.selector).scrollIntoViewIfNeeded();
            return { content: [{ type: 'text', text: `Scrolled ${parsed.data.selector} into view` }] };
          }

          if (parsed.data.direction === 'bottom') {
            await this.page.evaluate(() => (window as any).scrollTo(0, (document as any).body.scrollHeight));
          } else if (parsed.data.direction === 'top') {
            await this.page.evaluate(() => (window as any).scrollTo(0, 0));
          } else if (parsed.data.direction === 'up') {
            await this.page.evaluate(() => (window as any).scrollBy(0, -500));
          } else {
            await this.page.evaluate(() => (window as any).scrollBy(0, 500));
          }
          return { content: [{ type: 'text', text: `Scrolled ${parsed.data.direction || 'down'}` }] };
        }

        case 'evaluate_javascript': {
          const parsed = this.schemas.evaluate_javascript.safeParse(args);
          if (!parsed.success) throw new Error(parsed.error.message);
          const result = await this.page.evaluate(parsed.data.script);
          return { content: [{ type: 'text', text: `Executed script. Result: ${JSON.stringify(result)?.slice(0, 500)}` }] };
        }

        case 'get_page_content': {
          await this.schemas.get_page_content.parseAsync(args || {});
          const content = await this.page.content();
          return { content: [{ type: 'text', text: content.slice(0, 10000) + '... (truncated)' }] };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error executing ${name}: ${error.message}` }]
      };
    }
  }
}
