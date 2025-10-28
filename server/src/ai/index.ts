import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildTestGenerationPrompt } from './prompts.js';

export type AIProvider = 'anthropic' | 'openai' | 'gemini';

export interface GenerateTestOptions {
  provider: AIProvider;
  apiKey: string;
  prompt: string;
  baseUrl?: string;
}

export async function generateTest(options: GenerateTestOptions): Promise<string> {
  const { provider, apiKey, prompt, baseUrl } = options;

  switch (provider) {
    case 'anthropic':
      return generateWithAnthropic(apiKey, prompt, baseUrl);
    case 'openai':
      return generateWithOpenAI(apiKey, prompt, baseUrl);
    case 'gemini':
      return generateWithGemini(apiKey, prompt, baseUrl);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

async function generateWithAnthropic(
  apiKey: string,
  userPrompt: string,
  baseUrl?: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: buildTestGenerationPrompt(userPrompt, baseUrl)
    }]
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  return cleanGeneratedCode(content.text);
}

async function generateWithOpenAI(
  apiKey: string,
  userPrompt: string,
  baseUrl?: string
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildTestGenerationPrompt(userPrompt, baseUrl) }
    ],
    max_tokens: 4000
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  return cleanGeneratedCode(content);
}

async function generateWithGemini(
  apiKey: string,
  userPrompt: string,
  baseUrl?: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

  const result = await model.generateContent([
    SYSTEM_PROMPT,
    buildTestGenerationPrompt(userPrompt, baseUrl)
  ]);

  const response = result.response;
  const text = response.text();

  return cleanGeneratedCode(text);
}

function cleanGeneratedCode(code: string): string {
  // Remove markdown code fences if present
  let cleaned = code.replace(/```typescript\n?/g, '').replace(/```\n?/g, '');

  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();

  // Ensure it starts with import
  if (!cleaned.startsWith('import')) {
    throw new Error('Generated code does not start with import statement');
  }

  return cleaned;
}
