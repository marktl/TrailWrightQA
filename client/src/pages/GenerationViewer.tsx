import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type {
  LiveGenerationState,
  LiveGenerationEvent,
  RecordedStep,
  ChatMessage
} from '../../../shared/types';

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
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [deletingStepNumber, setDeletingStepNumber] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [editingSessionConfig, setEditingSessionConfig] = useState(false);
  const [sessionConfigPrompt, setSessionConfigPrompt] = useState('');
  const [sessionConfigMaxSteps, setSessionConfigMaxSteps] = useState('');
  const [sessionConfigError, setSessionConfigError] = useState<string | null>(null);
  const [savingSessionConfig, setSavingSessionConfig] = useState(false);
  const [activeScreenshotIndex, setActiveScreenshotIndex] = useState<number | null>(null);

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
        setState((prev) =>
          prev
            ? {
                ...prev,
                stepsTaken: prev.stepsTaken + 1,
                recordedSteps: [...prev.recordedSteps, event.payload]
              }
            : null
        );
        break;

      case 'step_deleted':
        if (typeof event.payload?.deletedStepNumber !== 'number') {
          break;
        }
        setSteps((prev) =>
          prev
            .filter((step) => step.stepNumber !== event.payload.deletedStepNumber)
            .map((step, index) => ({ ...step, stepNumber: index + 1 }))
        );
        setState((prev) => {
          if (!prev) {
            return prev;
          }

          const updatedRecordedSteps = prev.recordedSteps
            .filter((step) => step.stepNumber !== event.payload.deletedStepNumber)
            .map((step, index) => ({ ...step, stepNumber: index + 1 }));

          return {
            ...prev,
            stepsTaken: Math.max(0, prev.stepsTaken - 1),
            recordedSteps: updatedRecordedSteps
          };
        });
        break;

      case 'page_changed':
        setState((prev) => (prev ? { ...prev, currentUrl: event.payload.url } : null));
        break;

      case 'chat':
        setState((prev) => {
          if (!prev || !event.payload) {
            return prev;
          }
          const chatMessage = event.payload as ChatMessage;
          return {
            ...prev,
            chat: [...(prev.chat ?? []), chatMessage]
          };
        });
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

  async function handlePause() {
    if (!sessionId || isPausing) return;

    setIsPausing(true);
    try {
      await api.pauseGeneration(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to pause generation';
      setError(message);
    } finally {
      setIsPausing(false);
    }
  }

  async function handleResume() {
    if (!sessionId || isResuming) return;

    setIsResuming(true);
    try {
      await api.resumeGeneration(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resume generation';
      setError(message);
    } finally {
      setIsResuming(false);
    }
  }

  async function handleDeleteStep(stepNumber: number) {
    if (!sessionId) return;

    const confirmed = window.confirm(`Delete step ${stepNumber}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }

    setDeletingStepNumber(stepNumber);
    try {
      await api.deleteGenerationStep(sessionId, stepNumber);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete step';
      setError(message);
    } finally {
      setDeletingStepNumber(null);
    }
  }

  function openScreenshotModal(index: number) {
    const targetStep = steps[index];
    if (!targetStep?.screenshotPath) {
      return;
    }
    setActiveScreenshotIndex(index);
  }

  function closeScreenshotModal() {
    setActiveScreenshotIndex(null);
  }

  function showPreviousScreenshot() {
    if (activeScreenshotIndex === null) {
      return;
    }

    for (let i = activeScreenshotIndex - 1; i >= 0; i -= 1) {
      if (steps[i]?.screenshotPath) {
        setActiveScreenshotIndex(i);
        return;
      }
    }
  }

  function showNextScreenshot() {
    if (activeScreenshotIndex === null) {
      return;
    }

    for (let i = activeScreenshotIndex + 1; i < steps.length; i += 1) {
      if (steps[i]?.screenshotPath) {
        setActiveScreenshotIndex(i);
        return;
      }
    }
  }

  useEffect(() => {
    if (activeScreenshotIndex === null) {
      return;
    }

    const currentStep = steps[activeScreenshotIndex];
    if (currentStep && currentStep.screenshotPath) {
      return;
    }

    for (let i = activeScreenshotIndex + 1; i < steps.length; i += 1) {
      if (steps[i]?.screenshotPath) {
        setActiveScreenshotIndex(i);
        return;
      }
    }

    for (let i = activeScreenshotIndex - 1; i >= 0; i -= 1) {
      if (steps[i]?.screenshotPath) {
        setActiveScreenshotIndex(i);
        return;
      }
    }

    setActiveScreenshotIndex(null);
  }, [activeScreenshotIndex, steps]);

  async function handleSendChat() {
    if (!sessionId || !chatInput.trim() || sendingChat) return;

    setSendingChat(true);
    try {
      const { state: updatedState } = await api.sendGenerationChat(sessionId, chatInput.trim());
      setState(updatedState);
      setChatInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message';
      setError(message);
    } finally {
      setSendingChat(false);
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

  async function performRestart(skipConfirm = false): Promise<boolean> {
    if (!sessionId || isRestarting) return false;

    if (!skipConfirm) {
      const confirmed = window.confirm(
        'Are you sure you want to restart?\n\nThis will:\n- Delete all current test steps\n- Clear the AI conversation\n- Start generation from the beginning\n\nThis action cannot be undone.'
      );

      if (!confirmed) {
        return false;
      }
    }

    setIsRestarting(true);
    try {
      const { state: updatedState } = await api.restartGeneration(sessionId);
      setState(updatedState);
      setSteps([]);
      setLogs(updatedState.logs || []);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restart generation';
      setError(message);
      return false;
    } finally {
      setIsRestarting(false);
    }
  }

  function handleRestart() {
    void performRestart(false);
  }

  function openSessionConfigEditor() {
    if (!state) return;

    setSessionConfigPrompt(state.goal);
    setSessionConfigMaxSteps(String(state.maxSteps ?? ''));
    setSessionConfigError(null);
    setEditingSessionConfig(true);
  }

  function closeSessionConfigEditor() {
    if (savingSessionConfig) return;
    setEditingSessionConfig(false);
    setSessionConfigError(null);
  }

  async function handleSaveSessionConfig() {
    if (!sessionId || !state || savingSessionConfig) {
      return;
    }

    const trimmedPrompt = sessionConfigPrompt.trim();
    const parsedMaxSteps = Number.parseInt(sessionConfigMaxSteps, 10);
    const promptChanged = trimmedPrompt !== state.goal;
    const maxStepsChanged = !Number.isNaN(parsedMaxSteps) && parsedMaxSteps !== state.maxSteps;

    if (!trimmedPrompt) {
      setSessionConfigError('Original prompt cannot be empty.');
      return;
    }

    if (Number.isNaN(parsedMaxSteps)) {
      setSessionConfigError('Max steps must be a whole number.');
      return;
    }

    if (parsedMaxSteps < 1 || parsedMaxSteps > 200) {
      setSessionConfigError('Max steps must be between 1 and 200.');
      return;
    }

    if (!promptChanged && !maxStepsChanged) {
      setSessionConfigError('No changes to save.');
      return;
    }

    setSavingSessionConfig(true);
    setSessionConfigError(null);

    try {
      if (promptChanged) {
        const { state: updatedState } = await api.updateGenerationGoal(sessionId, trimmedPrompt);
        setState(updatedState);
      }

      if (maxStepsChanged) {
        const { state: updatedState } = await api.updateGenerationMaxSteps(sessionId, parsedMaxSteps);
        setState(updatedState);
      }

      setSessionConfigPrompt(trimmedPrompt);
      setSessionConfigMaxSteps(String(parsedMaxSteps));

      if (promptChanged) {
        const restarted = await performRestart(true);
        if (!restarted) {
          setSessionConfigError('Failed to restart after updating the prompt. Please restart manually.');
          return;
        }
      }

      setEditingSessionConfig(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update session configuration.';
      setSessionConfigError(message);
    } finally {
      setSavingSessionConfig(false);
    }
  }

  async function handleSave() {
    if (!sessionId || isSaving) return;

    setIsSaving(true);
    setSaveError(null);

    let suggestedName = steps[0]?.qaSummary || 'AI Generated Test';

    try {
      if (steps.length > 0) {
        const { suggestedName: aiSuggestedName } = await api.getSuggestedTestName(sessionId);
        if (aiSuggestedName?.trim()) {
          suggestedName = aiSuggestedName.trim();
        }
      }
    } catch (err) {
      console.warn('Failed to fetch AI suggested test name', err);
    }

    const testName = window.prompt('Give your test a name:', suggestedName);

    if (!testName) {
      setIsSaving(false);
      return;
    }

    const trimmedName = testName.trim();
    if (!trimmedName) {
      setIsSaving(false);
      return;
    }

    try {
      const { test } = await api.saveGeneratedTest(sessionId, {
        name: trimmedName,
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
    paused: 'bg-amber-100 text-amber-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800'
  };

  const statusColor = state ? statusColors[state.status] ?? 'bg-gray-100 text-gray-800' : 'bg-gray-100 text-gray-800';
  const isRunning = state?.status === 'running' || state?.status === 'thinking';
  const isPaused = state?.status === 'paused';
  const feedbackDisabled = !state || state.status === 'initializing' || isRunning;
  const canPause = Boolean(isRunning);
  const canStop = Boolean(state && (isRunning || isPaused));
  const canRestart = Boolean(state && state.status !== 'initializing');
  const canSave = state && (state.status === 'completed' || state.status === 'failed' || state.status === 'stopped');

  const activeScreenshotStep =
    activeScreenshotIndex !== null ? steps[activeScreenshotIndex] : null;

  const screenshotProgress = (() => {
    if (activeScreenshotIndex === null) {
      return { total: 0, position: 0 };
    }

    let total = 0;
    let position = 0;

    steps.forEach((step, idx) => {
      if (step.screenshotPath) {
        total += 1;
        if (idx === activeScreenshotIndex) {
          position = total;
        }
      }
    });

    return { total, position };
  })();

  const hasPreviousScreenshot =
    activeScreenshotIndex !== null && screenshotProgress.position > 1;
  const hasNextScreenshot =
    activeScreenshotIndex !== null && screenshotProgress.position < screenshotProgress.total;

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

        {/* Session Setup */}
        {state && state.startUrl && state.goal && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Session Setup</h2>
              <button
                onClick={openSessionConfigEditor}
                className="px-3 py-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
              >
                Edit
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Starting URL
                </p>
                <p className="text-sm font-mono text-blue-600">{state.startUrl}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Max Steps
                </p>
                <p className="text-sm text-gray-900">
                  {state.maxSteps}{' '}
                  <span className="text-xs text-gray-500">(current session limit)</span>
                </p>
              </div>
              <p className="text-xs text-gray-500">
                Updating the original prompt will restart the session and clear current progress.
              </p>
            </div>
          </div>
        )}

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
            <div className="flex flex-wrap items-center gap-3">
              {canPause && (
                <button
                  onClick={handlePause}
                  disabled={isPausing}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50"
                >
                  {isPausing ? 'Pausing…' : 'Pause'}
                </button>
              )}
              {canStop && (
                <button
                  onClick={handleStop}
                  disabled={isStopping}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {isStopping ? 'Stopping…' : 'Stop'}
                </button>
              )}
              {canRestart && (
                <button
                  onClick={handleRestart}
                  disabled={isRestarting}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
                >
                  {isRestarting ? 'Restarting…' : 'Restart'}
                </button>
              )}
              {canSave && (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Save Test'}
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

          {state?.successCriteria && (
            <div className="mt-4 p-3 bg-green-50 border border-green-100 rounded-lg">
              <p className="text-xs font-semibold uppercase tracking-wide text-green-700">
                Success Criteria
              </p>
              <p className="mt-1 text-sm text-green-900 whitespace-pre-line">
                {state.successCriteria}
              </p>
            </div>
          )}
        </div>

        {/* Guidance Panel */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Guidance & Feedback</h2>
              <p className="text-sm text-gray-600 mt-1">
                {feedbackDisabled
                  ? 'Pause or stop the generation to provide updated instructions.'
                  : 'Share feedback to steer the next actions before resuming.'}
              </p>
            </div>
            {isPaused && (
              <button
                onClick={handleResume}
                disabled={isResuming}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {isResuming ? 'Resuming…' : 'Resume Test'}
              </button>
            )}
          </div>

          <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Original Prompt
            </p>
            <p className="mt-2 text-sm text-gray-900 whitespace-pre-line">
              {state?.goal || '—'}
            </p>
          </div>

          {/* Chat Messages */}
          <div className="mb-4 space-y-3 max-h-[360px] overflow-y-auto pr-1">
            {state?.chat && state.chat.length > 0 ? (
              state.chat.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-3 rounded-lg ${
                    msg.role === 'user'
                      ? 'bg-blue-50 border border-blue-100 ml-8'
                      : msg.role === 'assistant'
                        ? 'bg-gray-50 border border-gray-100 mr-8'
                        : 'bg-slate-100 border border-slate-200'
                  }`}
                >
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    {msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'AI' : 'System'}
                  </p>
                  <p className="text-sm text-gray-900 whitespace-pre-line">{msg.message}</p>
                </div>
              ))
            ) : (
              <p className="text-gray-500 text-sm italic text-center py-8">
                No feedback yet. Pause the test to provide guidance.
              </p>
            )}
          </div>

          {/* Chat Input */}
          <div className="space-y-3">
            {isRunning && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <span>Generation is live.</span>
                <span>Use Pause or Stop above before adding feedback.</span>
              </div>
            )}
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !feedbackDisabled && chatInput.trim()) {
                  e.preventDefault();
                  void handleSendChat();
                }
              }}
              disabled={feedbackDisabled}
              placeholder={
                feedbackDisabled
                  ? 'Pause the generation to provide feedback...'
                  : 'Describe the next action you want the AI to take...'
              }
              className={`w-full min-h-[90px] rounded-lg border px-3 py-2 text-sm ${
                feedbackDisabled
                  ? 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                  : 'border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-500'
              }`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSendChat}
                disabled={sendingChat || !chatInput.trim() || feedbackDisabled}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendingChat ? 'Sending…' : 'Send Feedback'}
              </button>
              <button
                type="button"
                onClick={() => setChatInput('')}
                disabled={sendingChat || chatInput.trim().length === 0}
                className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Logs Section (Collapsed) */}
          <div className="mt-6 border-t pt-4">
            <button
              type="button"
              onClick={() => setLogsExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between"
            >
              <div>
                <h3 className="text-sm font-semibold text-gray-900">System Logs</h3>
                <p className="text-xs text-gray-500">{logs.length} entries</p>
              </div>
              <svg
                className={`h-4 w-4 text-gray-600 transition-transform ${logsExpanded ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {logsExpanded && (
              <div className="mt-3 bg-gray-900 text-green-400 font-mono text-xs max-h-[200px] overflow-y-auto px-3 py-2 rounded">
                {logs.length === 0 ? (
                  <p className="text-gray-500">Waiting for logs...</p>
                ) : (
                  logs.map((log, index) => (
                    <div key={index} className="mb-1">
                      {log}
                    </div>
                  ))
                )}
                {isRunning && <div className="animate-pulse mt-2">▊</div>}
              </div>
            )}
          </div>
        </div>

        {/* Steps Panel */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Test Steps ({steps.length})
          </h2>
          {steps.length === 0 ? (
            <p className="text-gray-500 text-sm">No steps recorded yet...</p>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {steps.map((step, index) => (
                <div
                  key={step.stepNumber}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-sm font-medium text-gray-900">
                      Step {step.stepNumber}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">
                        {new Date(step.timestamp).toLocaleTimeString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteStep(step.stepNumber)}
                        disabled={deletingStepNumber === step.stepNumber}
                        className="p-1.5 rounded hover:bg-red-50 text-red-500 disabled:opacity-40"
                        title={`Delete step ${step.stepNumber}`}
                      >
                        {deletingStepNumber === step.stepNumber ? (
                          <span className="block h-4 w-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" aria-hidden="true"></span>
                        ) : (
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                        <span className="sr-only">Delete step {step.stepNumber}</span>
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 mb-2">{step.qaSummary}</p>
                  {step.screenshotPath && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => openScreenshotModal(index)}
                        className="group w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 hover:border-blue-400"
                        aria-label={`View screenshot for step ${step.stepNumber}`}
                      >
                        <img
                          src={step.screenshotPath}
                          alt={`Screenshot for step ${step.stepNumber}`}
                          loading="lazy"
                          className="max-h-48 w-full object-contain bg-gray-200 transition duration-150 group-hover:scale-[1.02]"
                        />
                        <div className="px-3 py-2 text-center text-xs font-medium text-blue-600">
                          Click to view larger
                        </div>
                      </button>
                    </div>
                  )}
                  <code className="block text-xs bg-gray-100 text-gray-800 p-2 rounded font-mono overflow-x-auto">
                    {step.playwrightCode}
                  </code>
                </div>
              ))}
            </div>
          )}
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
      {activeScreenshotIndex !== null && activeScreenshotStep?.screenshotPath && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
          role="dialog"
          aria-modal="true"
          onClick={closeScreenshotModal}
        >
          <div
            className="relative w-full max-w-5xl overflow-hidden rounded-xl bg-gray-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeScreenshotModal}
              className="absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Close screenshot viewer"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <div className="space-y-5 p-6 text-gray-100">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">
                  Step {activeScreenshotStep.stepNumber} of {steps.length}
                </p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {activeScreenshotStep.qaSummary}
                </p>
              </div>
              <div className="relative overflow-hidden rounded-lg bg-black">
                <img
                  src={activeScreenshotStep.screenshotPath}
                  alt={`Screenshot for step ${activeScreenshotStep.stepNumber}`}
                  className="max-h-[70vh] w-full object-contain"
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={showPreviousScreenshot}
                  disabled={!hasPreviousScreenshot}
                  className="rounded-lg border border-white/20 px-4 py-2 font-medium text-white transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-gray-500"
                >
                  Previous
                </button>
                <span className="text-gray-300">
                  Screenshot {screenshotProgress.position} of {screenshotProgress.total}
                </span>
                <button
                  type="button"
                  onClick={showNextScreenshot}
                  disabled={!hasNextScreenshot}
                  className="rounded-lg border border-white/20 px-4 py-2 font-medium text-white transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-gray-500"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editingSessionConfig && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-xl rounded-lg bg-white shadow-2xl">
            <div className="border-b px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">Edit Session Setup</h3>
              <p className="mt-1 text-sm text-gray-600">
                Updating the original prompt restarts the session. Max steps can be adjusted without clearing progress.
              </p>
            </div>
            <div className="space-y-4 px-6 py-4">
              <div>
                <label
                  htmlFor="session-config-prompt"
                  className="text-xs font-medium text-gray-500 uppercase tracking-wide"
                >
                  Original Prompt
                </label>
                <textarea
                  id="session-config-prompt"
                  value={sessionConfigPrompt}
                  onChange={(e) => setSessionConfigPrompt(e.target.value)}
                  className="mt-2 w-full min-h-[120px] rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="Describe the outcome you want the AI to achieve..."
                  disabled={savingSessionConfig}
                />
              </div>
              <div>
                <label
                  htmlFor="session-config-max-steps"
                  className="text-xs font-medium text-gray-500 uppercase tracking-wide"
                >
                  Max Steps
                </label>
                <input
                  id="session-config-max-steps"
                  type="number"
                  min={1}
                  max={200}
                  value={sessionConfigMaxSteps}
                  onChange={(e) => setSessionConfigMaxSteps(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                  disabled={savingSessionConfig}
                />
                <p className="mt-1 text-xs text-gray-500">
                  The AI stops automatically after reaching this limit.
                </p>
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Changes to the prompt restart the generator and remove current steps and chat.
              </div>
              {sessionConfigError && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {sessionConfigError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
              <button
                type="button"
                onClick={closeSessionConfigEditor}
                disabled={savingSessionConfig}
                className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveSessionConfig()}
                disabled={savingSessionConfig}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {savingSessionConfig ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
