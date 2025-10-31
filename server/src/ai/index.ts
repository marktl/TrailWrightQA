import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT, buildTestGenerationPrompt } from './prompts.js';
import type { ChatMessage } from '../types.js';

export type AIProvider = 'anthropic' | 'openai' | 'gemini';

const CHAT_SYSTEM_PROMPT = `You are TrailWright's QA copilot. Provide concise, actionable guidance for Playwright end-to-end tests. Help users adjust selectors, waits, and assertions, and explain how to modify or extend the current scenario. When suggesting changes, reference concrete code snippets or commands. Keep responses under 6 sentences and prefer bullet points when outlining steps.`;

export interface GenerateTestOptions {
  provider: AIProvider;
  apiKey: string;
  prompt: string;
  baseUrl?: string;
}

export interface ChatWithAIOptions {
  provider: AIProvider;
  apiKey: string;
  message: string;
  history?: ChatMessage[];
}

type AssistantOrUserMessage = Omit<ChatMessage, 'role'> & { role: 'user' | 'assistant' };

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
  const genAI = new GoogleGenAI({ apiKey });
  const result = await genAI.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: buildTestGenerationPrompt(userPrompt, baseUrl),
    config: {
      systemInstruction: SYSTEM_PROMPT
    }
  });

  const text = result.text;
  if (!text) {
    throw new Error('No response from Gemini');
  }

  return cleanGeneratedCode(text);
}

const MAX_HISTORY_MESSAGES = 8;

function normalizeHistory(history?: ChatMessage[]): AssistantOrUserMessage[] {
  if (!history?.length) {
    return [];
  }

  return history
    .filter((msg): msg is AssistantOrUserMessage => msg.role === 'user' || msg.role === 'assistant')
    .slice(-MAX_HISTORY_MESSAGES);
}

async function chatWithAnthropic(
  apiKey: string,
  history: AssistantOrUserMessage[],
  message: string
): Promise<string> {
  const client = new Anthropic({ apiKey });
  const conversation = history.map((msg: AssistantOrUserMessage) => ({
    role: msg.role,
    content: msg.message
  }));

  conversation.push({ role: 'user', content: message });

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 800,
    system: CHAT_SYSTEM_PROMPT,
    messages: conversation
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  return textBlock.text.trim();
}

async function chatWithOpenAI(
  apiKey: string,
  history: AssistantOrUserMessage[],
  message: string
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ...history.map((msg: AssistantOrUserMessage) => ({ role: msg.role, content: msg.message })),
    { role: 'user', content: message }
  ];

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages,
    max_tokens: 800
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  return content;
}

async function chatWithGemini(
  apiKey: string,
  history: AssistantOrUserMessage[],
  message: string
): Promise<string> {
  const genAI = new GoogleGenAI({ apiKey });
  const contents = [
    ...history.map((msg: AssistantOrUserMessage) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.message }]
    })),
    { role: 'user', parts: [{ text: message }] }
  ];

  const result = await genAI.models.generateContent({
    model: 'gemini-2.5-pro',
    contents,
    config: {
      systemInstruction: CHAT_SYSTEM_PROMPT
    }
  });

  const text = result.text?.trim();
  if (!text) {
    throw new Error('No response from Gemini');
  }

  return text;
}

export async function chatWithAI(options: ChatWithAIOptions): Promise<string> {
  const { provider, apiKey } = options;
  const message = options.message?.trim();

  if (!message) {
    throw new Error('Message is required');
  }

  const history = normalizeHistory(options.history);

  switch (provider) {
    case 'anthropic':
      return chatWithAnthropic(apiKey, history, message);
    case 'openai':
      return chatWithOpenAI(apiKey, history, message);
    case 'gemini':
      return chatWithGemini(apiKey, history, message);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
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
