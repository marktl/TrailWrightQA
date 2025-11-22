import type { AIProvider } from './index.js';

interface InteractionEvent {
  type: 'click' | 'fill' | 'select' | 'navigate';
  element?: {
    role?: string;
    name?: string;
    tagName?: string;
    type?: string;
  };
  value?: string;
  url?: string;
}

export interface AICodeResponse {
  playwrightCode: string;
  qaSummary: string;
  waitHint: string | null;
}

export async function generateCodeFromInteraction(
  interaction: InteractionEvent,
  context: {
    url: string;
    stepNumber: number;
    networkDelay?: number;
  },
  provider: AIProvider
): Promise<AICodeResponse> {
  // Placeholder AI call; will be replaced with real provider integration
  const fallback = buildFallbackResponse(interaction);
  return parseAIResponse(JSON.stringify(fallback));
}

function buildFallbackResponse(interaction: InteractionEvent): AICodeResponse {
  switch (interaction.type) {
    case 'click':
      return {
        playwrightCode: `await page.getByRole('${interaction.element?.role || 'button'}', { name: '${interaction.element?.name || 'element'}' }).click();`,
        qaSummary: `Click '${interaction.element?.name || 'element'}'`,
        waitHint: null
      };
    case 'fill':
      return {
        playwrightCode: `await page.getByLabel('${interaction.element?.name || 'input'}').fill('${interaction.value ?? ''}');`,
        qaSummary: `Enter '${interaction.value ?? ''}'`,
        waitHint: null
      };
    case 'select':
      return {
        playwrightCode: `await page.getByLabel('${interaction.element?.name || 'select'}').selectOption('${interaction.value ?? ''}');`,
        qaSummary: `Select '${interaction.value ?? ''}'`,
        waitHint: null
      };
    case 'navigate':
      return {
        playwrightCode: `await page.goto('${interaction.url || ''}');`,
        qaSummary: `Navigate to ${interaction.url || 'page'}`,
        waitHint: null
      };
    default:
      return {
        playwrightCode: '',
        qaSummary: 'Perform action',
        waitHint: null
      };
  }
}

function parseAIResponse(response: string): AICodeResponse {
  try {
    const parsed = JSON.parse(response);
    return {
      playwrightCode: parsed.playwrightCode || '',
      qaSummary: parsed.qaSummary || 'Perform action',
      waitHint: parsed.waitHint || null
    };
  } catch (error) {
    throw new Error('Failed to parse AI response: ' + error);
  }
}
