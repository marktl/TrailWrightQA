import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { LiveGenerationState, LiveGenerationEvent, RecordedStep } from '../../../shared/types';

export default function GenerationViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<LiveGenerationState | null>(null);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided');
      return;
    }

    // Load initial state
    void loadInitialState();

    // Connect to SSE stream
    const eventSource = api.connectToGenerationEvents(sessionId, handleEvent);

    return () => {
      eventSource.close();
    };
  }, [sessionId]);

  async function loadInitialState() {
    if (!sessionId) return;

    try {
      const { state: initialState } = await api.getGenerationState(sessionId);
      setState(initialState);
      setSteps(initialState.recordedSteps || []);
      setLogs(initialState.logs || []);
      if (initialState.error) {
        setError(initialState.error);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load generation state';
      setError(message);
    }
  }

  function handleEvent(event: LiveGenerationEvent) {
    switch (event.type) {
      case 'initial_state':
        if (event.payload) {
          setState(event.payload);
          setSteps(event.payload.recordedSteps || []);
          setLogs(event.payload.logs || []);
        }
        break;

      case 'status':
        setState((prev) => (prev ? { ...prev, status: event.payload.status } : null));
        break;

      case 'log':
        setLogs((prev) => [...prev, event.payload.message]);
        break;

      case 'step_recorded':
        setSteps((prev) => [...prev, event.payload]);
        setState((prev) => (prev ? { ...prev, stepsTaken: prev.stepsTaken + 1 } : null));
        break;

      case 'page_changed':
        setState((prev) => (prev ? { ...prev, currentUrl: event.payload.url } : null));
        break;

      case 'completed':
        setState(event.payload);
        setSteps(event.payload.recordedSteps || []);
        setLogs(event.payload.logs || []);
        break;

      case 'error':
        setError(event.payload.message);
        break;

      default:
        break;
    }
  }

  async function handleStop() {
    if (!sessionId || isStopping) return;

    setIsStopping(true);
    try {
      await api.stopGeneration(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop generation';
      setError(message);
    } finally {
      setIsStopping(false);
    }
  }

  async function handleSave() {
    if (!sessionId || isSaving) return;

    const testName = window.prompt(
      'Give your test a name:',
      steps[0]?.qaSummary || 'AI Generated Test'
    );

    if (!testName) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const { test } = await api.saveGeneratedTest(sessionId, {
        name: testName,
        tags: ['ai-generated', 'live-session']
      });

      alert(`Test "${test.name}" saved successfully!`);
      navigate('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save test';
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid Session</h1>
          <p className="text-gray-600 mb-4">No session ID provided</p>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (!state && !error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading generation session...</p>
        </div>
      </div>
    );
  }

  const statusColors = {
    initializing: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    thinking: 'bg-purple-100 text-purple-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800'
  };

  const statusColor = state ? statusColors[state.status] : 'bg-gray-100 text-gray-800';
  const canStop = state && (state.status === 'running' || state.status === 'thinking');
  const canSave = state && (state.status === 'completed' || state.status === 'failed' || state.status === 'stopped');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Live AI Test Generation</h1>
            <p className="text-sm text-gray-600 mt-1">Session: {sessionId.slice(0, 16)}...</p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-gray-600 hover:text-gray-900"
          >
            ← Back to Home
          </button>
        </div>

        {/* Status Bar */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor}`}>
                {state?.status.toUpperCase()}
              </span>
              <div className="text-sm text-gray-600">
                <span className="font-medium">{state?.stepsTaken || 0}</span> / {state?.maxSteps || 20} steps
              </div>
            </div>
            <div className="flex gap-3">
              {canStop && (
                <button
                  onClick={handleStop}
                  disabled={isStopping}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {isStopping ? 'Stopping...' : 'Stop Generation'}
                </button>
              )}
              {canSave && (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Test'}
                </button>
              )}
            </div>
          </div>

          {state?.currentUrl && (
            <div className="mt-4 text-sm">
              <span className="text-gray-600">Current URL:</span>{' '}
              <span className="font-mono text-blue-600">{state.currentUrl}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Steps Panel */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Test Steps ({steps.length})
            </h2>
            {steps.length === 0 ? (
              <p className="text-gray-500 text-sm">No steps recorded yet...</p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {steps.map((step) => (
                  <div
                    key={step.stepNumber}
                    className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-medium text-gray-900">
                        Step {step.stepNumber}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(step.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{step.qaSummary}</p>
                    <code className="block text-xs bg-gray-100 text-gray-800 p-2 rounded font-mono overflow-x-auto">
                      {step.playwrightCode}
                    </code>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Logs Panel */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">System Logs</h2>
            <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-xs max-h-[600px] overflow-y-auto">
              {logs.length === 0 ? (
                <p className="text-gray-500">Waiting for logs...</p>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="mb-1">
                    {log}
                  </div>
                ))
              )}
              {state?.status === 'running' && (
                <div className="animate-pulse mt-2">▊</div>
              )}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-red-600 text-xl">⚠</span>
              <div>
                <h3 className="font-semibold text-red-900">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Save Error */}
        {saveError && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-red-600 text-xl">⚠</span>
              <div>
                <h3 className="font-semibold text-red-900">Save Failed</h3>
                <p className="text-sm text-red-700 mt-1">{saveError}</p>
              </div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {state?.status === 'completed' && !error && (
          <div className="mt-6 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-green-600 text-xl">✓</span>
              <div>
                <h3 className="font-semibold text-green-900">Generation Complete!</h3>
                <p className="text-sm text-green-700 mt-1">
                  Successfully generated {steps.length} test steps. Click "Save Test" to add it to your library.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
