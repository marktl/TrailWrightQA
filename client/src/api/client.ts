import type {
  LiveRunState,
  RunLogEntry,
  StepSummary,
  ChatMessage,
  RunResult,
  RunStatus,
  LiveGenerationOptions,
  LiveGenerationState,
  LiveGenerationEvent
} from '../../../shared/types';

const API_BASE = '/api';

export type ApiTestMetadata = {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
};

export type ApiTest = {
  metadata: ApiTestMetadata;
  code: string;
};

export type RunControlAction = 'pause' | 'resume' | 'stop';

export type RunStreamEvent =
  | { type: 'hydrate'; payload: LiveRunState }
  | { type: 'status'; payload: { status: RunStatus; timestamp: string } }
  | { type: 'log'; payload: RunLogEntry }
  | { type: 'step'; payload: StepSummary }
  | { type: 'chat'; payload: ChatMessage }
  | { type: 'result'; payload: RunResult }
  | { type: 'error'; payload: { message: string; timestamp: string } };

export async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  getConfig: () => fetchApi<any>('/config'),
  saveConfig: (config: any) =>
    fetchApi('/config', {
      method: 'POST',
      body: JSON.stringify(config)
    }),
  healthCheck: () => fetchApi<{ status: string; timestamp: string }>('/health'),
  listTests: () => fetchApi<{ tests: ApiTestMetadata[] }>('/tests'),
  getTest: (id: string) => fetchApi<{ test: ApiTest }>(`/tests/${id}`),
  saveTest: (test: ApiTest) =>
    fetchApi('/tests', {
      method: 'POST',
      body: JSON.stringify(test)
    }),
  generateTest: (prompt: string, baseUrl?: string) =>
    fetchApi<{ test: ApiTest }>('/tests/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt, baseUrl })
    }),
  deleteTest: (id: string) => fetchApi(`/tests/${id}`, { method: 'DELETE' }),
  recordTest: (url?: string) =>
    fetchApi<{ success: boolean; testId: string; message: string }>('/tests/record', {
      method: 'POST',
      body: JSON.stringify({ url })
    }),
  finalizeTest: (id: string, metadata: { name?: string; description?: string; tags?: string[] }) =>
    fetchApi<{ success: boolean; test: ApiTestMetadata }>(`/tests/${id}/finalize`, {
      method: 'POST',
      body: JSON.stringify(metadata)
    }),
  editTest: (id: string) =>
    fetchApi<{ success: boolean; filePath: string; message: string }>(`/tests/${id}/edit`, {
      method: 'POST'
    }),
  runTest: (testId: string) =>
    fetchApi<{ runId: string }>('/runs', {
      method: 'POST',
      body: JSON.stringify({ testId })
    }),
  listRuns: (testId?: string) =>
    fetchApi<{ runs: any[] }>(`/runs${testId ? `?testId=${testId}` : ''}`),
  getRun: (runId: string) => fetchApi<{ run: LiveRunState }>(`/runs/${runId}`),
  controlRun: (runId: string, action: RunControlAction) =>
    fetchApi<{ success: boolean }>(`/runs/${runId}/control`, {
      method: 'POST',
      body: JSON.stringify({ action })
    }),
  sendRunChat: (runId: string, message: string) =>
    fetchApi<{
      messages: ChatMessage[];
      assistant?: ChatMessage;
      user?: ChatMessage;
    }>(`/runs/${runId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message })
    }),
  openTrace: (runId: string) => fetchApi(`/runs/${runId}/trace`, { method: 'POST' }),
  connectToRunStream: (runId: string, onEvent: (event: RunStreamEvent) => void): EventSource => {
    const source = new EventSource(`${API_BASE}/runs/${runId}/stream`);

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as RunStreamEvent;
        onEvent(parsed);
      } catch (err) {
        console.error('Failed to parse run stream event', err);
      }
    };

    source.onerror = (err) => {
      console.error('Run stream error', err);
    };

    return source;
  },

  // Live AI Generation
  startGeneration: (options: LiveGenerationOptions) =>
    fetchApi<{ sessionId: string; state: LiveGenerationState }>('/generate/start', {
      method: 'POST',
      body: JSON.stringify(options)
    }),
  getGenerationState: (sessionId: string) =>
    fetchApi<{ state: LiveGenerationState }>(`/generate/${sessionId}/state`),
  stopGeneration: (sessionId: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/stop`, {
      method: 'POST'
    }),
  saveGeneratedTest: (
    sessionId: string,
    metadata: { name?: string; description?: string; tags?: string[] }
  ) =>
    fetchApi<{ success: boolean; test: ApiTestMetadata }>(`/generate/${sessionId}/save`, {
      method: 'POST',
      body: JSON.stringify(metadata)
    }),
  connectToGenerationEvents: (
    sessionId: string,
    onEvent: (event: LiveGenerationEvent) => void
  ): EventSource => {
    const source = new EventSource(`${API_BASE}/generate/${sessionId}/events`);

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LiveGenerationEvent;
        onEvent(parsed);
      } catch (err) {
        console.error('Failed to parse generation event', err);
      }
    };

    source.onerror = (err) => {
      console.error('Generation stream error', err);
    };

    return source;
  }
};
