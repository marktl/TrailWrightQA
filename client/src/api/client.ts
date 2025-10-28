const API_BASE = '/api';

export async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  getConfig: () => fetchApi<any>('/config'),
  saveConfig: (config: any) => fetchApi('/config', {
    method: 'POST',
    body: JSON.stringify(config),
  }),
  listTests: () => fetchApi<{ tests: any[] }>('/tests'),
  getTest: (id: string) => fetchApi<{ test: any }>(`/tests/${id}`),
  saveTest: (test: any) => fetchApi('/tests', {
    method: 'POST',
    body: JSON.stringify(test),
  }),
  generateTest: (prompt: string, baseUrl?: string) => fetchApi<{ code: string }>('/tests/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, baseUrl }),
  }),
  deleteTest: (id: string) => fetchApi(`/tests/${id}`, { method: 'DELETE' }),
  runTest: (testId: string) => fetchApi<{ result: any }>('/runs', {
    method: 'POST',
    body: JSON.stringify({ testId }),
  }),
  listRuns: (testId?: string) => fetchApi<{ runs: any[] }>(`/runs${testId ? `?testId=${testId}` : ''}`),
  getRun: (runId: string) => fetchApi<{ result: any }>(`/runs/${runId}`),
  openTrace: (runId: string) => fetchApi('/runs/' + runId + '/trace', { method: 'POST' }),
};
