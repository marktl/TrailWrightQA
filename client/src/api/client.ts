import type {
  LiveRunState,
  RunLogEntry,
  StepSummary,
  ChatMessage,
  RunResult,
  RunStatus,
  LiveGenerationOptions,
  LiveGenerationState,
  LiveGenerationEvent,
  RecordedStep,
  VariableDefinition,
  VariableRow
} from '../../../shared/types';

const API_BASE = '/api';

export type ApiTestMetadata = {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  successCriteria?: string;
  tags?: string[];
  steps?: ApiTestStepMetadata[];
  createdAt: string;
  updatedAt?: string;
  folder?: string | null;
  lastRunAt?: string;
  lastRunStatus?: RunResult['status'];
  lastRunId?: string;
  credentialId?: string;
  startUrl?: string;
};

export type ApiTestStepMetadata = {
  number: number;
  qaSummary: string;
  playwrightCode: string;
};

export type ApiTest = {
  metadata: ApiTestMetadata;
  code: string;
};

export type ApiCredential = {
  id: string;
  name: string;
  username: string;
  password: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
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
  exportTest: async (id: string): Promise<Blob> => {
    const response = await fetch(`${API_BASE}/tests/${id}/export`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.blob();
  },
  importTestArchive: async (file: File | Blob) => {
    const response = await fetch(`${API_BASE}/tests/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip'
      },
      body: file
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Import failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  },
  getVariables: (testId: string) =>
    fetchApi<{ rows: VariableRow[] }>(`/tests/${testId}/variables`),
  saveVariables: (
    testId: string,
    payload: { rows: VariableRow[]; variables?: VariableDefinition[] }
  ) =>
    fetchApi<{ rows: VariableRow[] }>(`/tests/${testId}/variables`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  importVariables: (
    testId: string,
    payload: {
      csvContent: string;
      columnMapping?: Record<string, string | null>;
      mode?: 'replace' | 'append';
      variables?: VariableDefinition[];
    }
  ) =>
    fetchApi<{ rows: VariableRow[]; rowCount: number }>(`/tests/${testId}/variables/import`, {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  exportVariables: async (testId: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/tests/${testId}/variables/export`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.text();
  },
  recordTest: (url?: string, viewportSize?: { width: number; height: number }) =>
    fetchApi<{ success: boolean; testId: string; message: string }>('/tests/record', {
      method: 'POST',
      body: JSON.stringify({ url, viewportSize })
    }),
  finalizeTest: (id: string, metadata: { name?: string; description?: string; tags?: string[] }) =>
    fetchApi<{ success: boolean; test: ApiTestMetadata }>(`/tests/${id}/finalize`, {
      method: 'POST',
      body: JSON.stringify(metadata)
    }),
  updateTestMetadata: (id: string, metadata: Partial<ApiTestMetadata>) =>
    fetchApi<{ success: boolean; test: ApiTestMetadata }>(`/tests/${id}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(metadata)
    }),
  updateTestSteps: (
    id: string,
    steps: Array<{ number: number; qaSummary: string; playwrightCode: string }>
  ) =>
    fetchApi<{ success: boolean }>(`/tests/${id}/steps`, {
      method: 'PUT',
      body: JSON.stringify({ steps })
    }),
  generateStepFromPrompt: (prompt: string) =>
    fetchApi<{ qaSummary: string; playwrightCode: string }>('/ai/generate-step', {
      method: 'POST',
      body: JSON.stringify({ prompt })
    }),

  // Step insertion with browser context
  startStepInsertion: (testId: string, insertAfterStep: number) =>
    fetchApi<{ success: boolean; sessionId: string; message: string }>(`/tests/${testId}/insert/start`, {
      method: 'POST',
      body: JSON.stringify({ insertAfterStep })
    }),
  generateStepWithContext: (sessionId: string, prompt: string) =>
    fetchApi<{ success: boolean; qaSummary: string; playwrightCode: string }>(`/tests/insert/${sessionId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ prompt })
    }),
  closeStepInsertion: (sessionId: string) =>
    fetchApi<{ success: boolean }>(`/tests/insert/${sessionId}/close`, {
      method: 'POST'
    }),
  runTest: (
    testId: string,
    options?: {
      headed?: boolean;
      speed?: number;
      keepBrowserOpen?: boolean;
      stopOnFailure?: boolean;
      viewportSize?: { width: number; height: number };
    }
  ) =>
    fetchApi<{ runId: string }>('/runs', {
      method: 'POST',
      body: JSON.stringify({ testId, ...(options ?? {}) })
    }),
  listRuns: (testId?: string) =>
    fetchApi<{ runs: RunResult[] }>(`/runs${testId ? `?testId=${testId}` : ''}`),
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
  restartGeneration: (sessionId: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/restart`, {
      method: 'POST'
    }),
  pauseGeneration: (sessionId: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/pause`, {
      method: 'POST'
    }),
  resumeGeneration: (sessionId: string, userCorrection?: string) => {
    const body = userCorrection?.trim()
      ? JSON.stringify({ userCorrection: userCorrection.trim() })
      : JSON.stringify({});

    return fetchApi<{ success: boolean; state: LiveGenerationState }>(
      `/generate/${sessionId}/resume`,
      {
        method: 'POST',
        body
      }
    );
  },
  updateGenerationGoal: (sessionId: string, goal: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/goal`, {
      method: 'PATCH',
      body: JSON.stringify({ goal })
    }),
  updateGenerationSuccessCriteria: (sessionId: string, successCriteria: string | undefined) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(
      `/generate/${sessionId}/success-criteria`,
      {
        method: 'PATCH',
        body: JSON.stringify({ successCriteria })
      }
    ),
  updateGenerationMaxSteps: (sessionId: string, maxSteps: number) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/max-steps`, {
      method: 'PATCH',
      body: JSON.stringify({ maxSteps })
    }),
  updateGenerationKeepBrowserOpen: (sessionId: string, keepBrowserOpen: boolean) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(
      `/generate/${sessionId}/keep-browser-open`,
      {
        method: 'PATCH',
        body: JSON.stringify({ keepBrowserOpen })
      }
    ),
  updateGenerationStartUrl: (sessionId: string, startUrl: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/start-url`, {
      method: 'PATCH',
      body: JSON.stringify({ startUrl })
    }),
  sendGenerationChat: (sessionId: string, message: string) =>
    fetchApi<{ success: boolean; chat: ChatMessage[]; state: LiveGenerationState }>(
      `/generate/${sessionId}/chat`,
      {
        method: 'POST',
        body: JSON.stringify({ message })
      }
    ),
  sendManualInstruction: (sessionId: string, instruction: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/manual-step`, {
      method: 'POST',
      body: JSON.stringify({ instruction })
    }),
  interruptManualInstruction: (sessionId: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/manual-interrupt`, {
      method: 'POST'
    }),
  approvePlan: (sessionId: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/approve-plan`, {
      method: 'POST'
    }),
  rejectPlan: (sessionId: string) =>
    fetchApi<{ success: boolean; state: LiveGenerationState }>(`/generate/${sessionId}/reject-plan`, {
      method: 'POST'
    }),
  pickElement: (sessionId: string) =>
    fetchApi<{ success: boolean; selector: string; description?: string }>(`/generate/${sessionId}/pick-element`, {
      method: 'POST'
    }),
  deleteGenerationStep: (sessionId: string, stepNumber: number) =>
    fetchApi<{
      success: boolean;
      state?: LiveGenerationState;
      steps?: RecordedStep[];
      deletedStepNumber?: number;
    }>(
      `/generate/${sessionId}/steps/${stepNumber}`,
      {
        method: 'DELETE'
      }
    ),
  getSuggestedTestName: (sessionId: string) =>
    fetchApi<{ suggestedName: string }>(`/generate/${sessionId}/suggest-name`, {
      method: 'POST'
    }),
  getSuggestedTestTags: (sessionId: string) =>
    fetchApi<{ suggestedTags: string[] }>(`/generate/${sessionId}/suggest-tags`, {
      method: 'POST'
    }),
  saveGeneratedTest: (
    sessionId: string,
    metadata: {
      name?: string;
      description?: string;
      tags?: string[];
      folder?: string;
      credentialId?: string;
    }
  ) =>
    fetchApi<{ success: boolean; test: ApiTestMetadata }>(`/generate/${sessionId}/save`, {
      method: 'POST',
      body: JSON.stringify(metadata)
    }),

  // Variable management for generation sessions
  getGenerationVariables: (sessionId: string) =>
    fetchApi<{ variables: Array<{ name: string; type: string; sampleValue?: string }> }>(
      `/generate/${sessionId}/variables`
    ),
  setGenerationVariable: (
    sessionId: string,
    variable: { name: string; sampleValue: string; type?: 'string' | 'number' }
  ) =>
    fetchApi<{
      success: boolean;
      variables: Array<{ name: string; type: string; sampleValue?: string }>;
    }>(`/generate/${sessionId}/variables`, {
      method: 'POST',
      body: JSON.stringify(variable)
    }),
  deleteGenerationVariable: (sessionId: string, varName: string) =>
    fetchApi<{
      success: boolean;
      variables: Array<{ name: string; type: string; sampleValue?: string }>;
    }>(`/generate/${sessionId}/variables/${varName}`, {
      method: 'DELETE'
    }),

  // Test variable data management
  getTestVariables: (testId: string) =>
    fetchApi<{
      variables: Array<{ name: string; type?: string; sampleValue?: string }>;
      data: Array<Record<string, string>>;
    }>(`/tests/${testId}/variables`),

  updateTestVariables: (testId: string, update: { data: Array<Record<string, string>> }) =>
    fetchApi<{ success: boolean }>(`/tests/${testId}/variables`, {
      method: 'PUT',
      body: JSON.stringify(update)
    }),

  exportTestVariables: async (testId: string): Promise<string> => {
    const response = await fetch(`${API_BASE}/tests/${testId}/variables/export`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }
    return response.text();
  },

  importTestVariables: (
    testId: string,
    importData: {
      csvContent: string;
      mapping: Record<string, string | null>;
      mode: 'replace' | 'append' | 'merge';
    }
  ) =>
    fetchApi<{ success: boolean }>(`/tests/${testId}/variables/import`, {
      method: 'POST',
      body: JSON.stringify(importData)
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
  },

  listCredentials: () => fetchApi<{ credentials: ApiCredential[] }>('/credentials'),
  createCredential: (credential: { name: string; username: string; password: string; notes?: string }) =>
    fetchApi<{ credential: ApiCredential }>('/credentials', {
      method: 'POST',
      body: JSON.stringify(credential)
    }),
  updateCredential: (
    id: string,
    credential: { name: string; username: string; password?: string; notes?: string }
  ) =>
    fetchApi<{ credential: ApiCredential }>(`/credentials/${id}`, {
      method: 'PUT',
      body: JSON.stringify(credential)
    }),
  deleteCredential: (id: string) =>
    fetchApi(`/credentials/${id}`, {
      method: 'DELETE'
    })
};
