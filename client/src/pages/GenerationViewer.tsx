import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ApiTestMetadata, ApiCredential } from '../api/client';
import type {
  LiveGenerationState,
  LiveGenerationEvent,
  RecordedStep,
  ChatMessage
} from '../../../shared/types';

const CATEGORY_DATALIST_ID = 'generation-category-options';

export default function GenerationViewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [state, setState] = useState<LiveGenerationState | null>(null);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const [deletingStepNumber, setDeletingStepNumber] = useState<number | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [sessionConfigEditing, setSessionConfigEditing] = useState(false);
  const [sessionConfigPrompt, setSessionConfigPrompt] = useState('');
  const [sessionConfigMaxSteps, setSessionConfigMaxSteps] = useState('');
  const [sessionConfigUrl, setSessionConfigUrl] = useState('');
  const [sessionConfigSuccessCriteria, setSessionConfigSuccessCriteria] = useState('');
  const [sessionConfigError, setSessionConfigError] = useState<string | null>(null);
  const [savingSessionConfig, setSavingSessionConfig] = useState(false);
  const [updatingKeepBrowserOpen, setUpdatingKeepBrowserOpen] = useState(false);
  const [activeScreenshotIndex, setActiveScreenshotIndex] = useState<number | null>(null);
  const [savedTest, setSavedTest] = useState<ApiTestMetadata | null>(null);
  const [autoSaveNotice, setAutoSaveNotice] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveForm, setSaveForm] = useState({
    name: '',
    description: '',
    tagsInput: 'ai-generated, live-session',
    folder: '',
    credentialId: ''
  });
  const [saveModalError, setSaveModalError] = useState<string | null>(null);
  const [savingTest, setSavingTest] = useState(false);

  function addCategoryOption(name?: string | null) {
    const trimmed = name?.trim();
    if (!trimmed) {
      return;
    }
    setCategoryOptions((prev) => {
      if (prev.includes(trimmed)) {
        return prev;
      }
      return [...prev, trimmed].sort((a, b) => a.localeCompare(b));
    });
  }

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
      setSessionConfigPrompt(initialState.goal);
      setSessionConfigMaxSteps(String(initialState.maxSteps ?? ''));
      setSessionConfigUrl(initialState.startUrl || '');
      if (initialState.error) {
        setError(initialState.error);
      }
      if (initialState.savedTestId) {
        void hydrateSavedTest(initialState.savedTestId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load generation state';
      setError(message);
    }
  }

  async function hydrateSavedTest(testId: string) {
    try {
      const { test } = await api.getTest(testId);
      setSavedTest(test.metadata);
    } catch (err) {
      console.warn('Unable to load auto-saved test metadata', err);
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

      case 'auto_saved': {
        const metadata = event.payload?.metadata as ApiTestMetadata | undefined;
        if (metadata) {
          setSavedTest(metadata);
          setState((prev) => (prev ? { ...prev, savedTestId: metadata.id } : prev));
          setAutoSaveNotice(`Auto-saved as "${metadata.name}"`);
          setTimeout(() => {
            setAutoSaveNotice(null);
          }, 6000);
        }
        break;
      }

      case 'error':
        setError(event.payload.message);
        break;

      default:
        break;
    }
  }

  useEffect(() => {
    const savedId = state?.savedTestId;
    if (!savedId || savedTest?.id === savedId) {
      return;
    }
    void hydrateSavedTest(savedId);
  }, [state?.savedTestId, savedTest?.id]);

  useEffect(() => {
    let cancelled = false;
    api
      .listCredentials()
      .then(({ credentials: list }) => {
        if (!cancelled) {
          setCredentials(list);
        }
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .listTests()
      .then(({ tests }) => {
        if (cancelled) {
          return;
        }
        const options = Array.from(
          new Set(
            tests
              .map((test) => test.folder?.trim())
              .filter((name): name is string => Boolean(name))
          )
        ).sort((a, b) => a.localeCompare(b));
        setCategoryOptions(options);
      })
      .catch((err) => {
        console.warn('Failed to load categories', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sessionConfigEditing) {
      return;
    }
    if (state) {
      setSessionConfigPrompt(state.goal);
      setSessionConfigMaxSteps(String(state.maxSteps ?? ''));
      setSessionConfigUrl(state.startUrl || '');
      setSessionConfigSuccessCriteria(state.successCriteria || '');
    }
  }, [sessionConfigEditing, state?.goal, state?.maxSteps, state?.startUrl, state?.successCriteria]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [state?.chat]);

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
    if (!targetStep || (!targetStep.screenshotData && !targetStep.screenshotPath)) {
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
      const step = steps[i];
      if (step?.screenshotData || step?.screenshotPath) {
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
      const step = steps[i];
      if (step?.screenshotData || step?.screenshotPath) {
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
    if (currentStep && (currentStep.screenshotData || currentStep.screenshotPath)) {
      return;
    }

    for (let i = activeScreenshotIndex + 1; i < steps.length; i += 1) {
      const step = steps[i];
      if (step?.screenshotData || step?.screenshotPath) {
        setActiveScreenshotIndex(i);
        return;
      }
    }

    for (let i = activeScreenshotIndex - 1; i >= 0; i -= 1) {
      const step = steps[i];
      if (step?.screenshotData || step?.screenshotPath) {
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
      const trimmed = chatInput.trim();
      if (stepMode) {
        await api.sendManualInstruction(sessionId, trimmed);
      } else {
        const { state: updatedState } = await api.sendGenerationChat(sessionId, trimmed);
        setState(updatedState);
      }
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

  async function handleInterrupt() {
    if (!sessionId || isInterrupting) return;

    setIsInterrupting(true);
    try {
      await api.interruptManualInstruction(sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to interrupt instruction';
      setError(message);
    } finally {
      setIsInterrupting(false);
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

  function handleEnableSessionConfigEditing() {
    if (!state) return;
    const confirmed = window.confirm(
      'Updating the starting URL or goal will restart this AI session. Continue?'
    );
    if (!confirmed) {
      return;
    }
    setSessionConfigPrompt(state.goal);
    setSessionConfigMaxSteps(String(state.maxSteps ?? ''));
    setSessionConfigUrl(state.startUrl || '');
    setSessionConfigSuccessCriteria(state.successCriteria || '');
    setSessionConfigError(null);
    setSessionConfigEditing(true);
  }

  function handleCancelSessionConfigEditing() {
    if (savingSessionConfig) return;
    setSessionConfigEditing(false);
    setSessionConfigError(null);
    setSessionConfigPrompt(state?.goal || '');
    setSessionConfigMaxSteps(String(state?.maxSteps ?? ''));
    setSessionConfigUrl(state?.startUrl || '');
    setSessionConfigSuccessCriteria(state?.successCriteria || '');
  }

  async function handleSaveSessionConfig() {
    if (!sessionId || !state || savingSessionConfig) {
      return;
    }

    const trimmedPrompt = sessionConfigPrompt.trim();
    const parsedMaxSteps = Number.parseInt(sessionConfigMaxSteps, 10);
    const trimmedUrl = sessionConfigUrl.trim();
    const trimmedSuccess = sessionConfigSuccessCriteria.trim();
    const promptChanged = trimmedPrompt !== state.goal;
    const maxStepsChanged = !Number.isNaN(parsedMaxSteps) && parsedMaxSteps !== state.maxSteps;
    const urlChanged = trimmedUrl !== (state.startUrl || '');
    const successChanged = trimmedSuccess !== (state.successCriteria || '');

    if (!trimmedPrompt) {
      setSessionConfigError('Original prompt cannot be empty.');
      return;
    }

    if (!trimmedUrl) {
      setSessionConfigError('Starting URL is required.');
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

    if (!promptChanged && !maxStepsChanged && !urlChanged && !successChanged) {
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
      if (urlChanged) {
        const { state: updatedState } = await api.updateGenerationStartUrl(sessionId, trimmedUrl);
        setState(updatedState);
      }
      if (successChanged) {
        const { state: updatedState } = await api.updateGenerationSuccessCriteria(
          sessionId,
          trimmedSuccess || undefined
        );
        setState(updatedState);
      }

      setSessionConfigPrompt(trimmedPrompt);
      setSessionConfigMaxSteps(String(parsedMaxSteps));
      setSessionConfigUrl(trimmedUrl);
      setSessionConfigSuccessCriteria(trimmedSuccess);

      if (promptChanged || urlChanged) {
        const restarted = await performRestart(true);
        if (!restarted) {
          setSessionConfigError('Failed to restart after updating settings. Please restart manually.');
          return;
        }
      }

      setSessionConfigEditing(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update session configuration.';
      setSessionConfigError(message);
    } finally {
      setSavingSessionConfig(false);
    }
  }

  async function handleToggleKeepBrowserOpen(nextValue: boolean) {
    if (!sessionId) return;
    setUpdatingKeepBrowserOpen(true);
    try {
      const { state: updatedState } = await api.updateGenerationKeepBrowserOpen(sessionId, nextValue);
      setState(updatedState);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update browser preference.';
      setError(message);
    } finally {
      setUpdatingKeepBrowserOpen(false);
    }
  }

  async function handleSave() {
    if (!sessionId || isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveModalError(null);

    let suggestedName = savedTest?.name || steps[0]?.qaSummary || 'AI Generated Test';

    try {
      if (!savedTest && steps.length > 0) {
        const { suggestedName: aiSuggestedName } = await api.getSuggestedTestName(sessionId);
        if (aiSuggestedName?.trim()) {
          suggestedName = aiSuggestedName.trim();
        }
      }
      setSaveForm({
        name: suggestedName,
        description: savedTest?.description || state?.goal || '',
        tagsInput: (savedTest?.tags ?? ['ai-generated', 'live-session']).join(', '),
        folder: savedTest?.folder || '',
        credentialId: savedTest?.credentialId || state?.credentialId || ''
      });
      setSaveModalOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to prepare save form';
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function submitSaveForm() {
    if (!sessionId) return;
    const trimmedName = saveForm.name.trim();
    if (!trimmedName) {
      setSaveModalError('Test name is required.');
      return;
    }

    const tags = saveForm.tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    setSavingTest(true);
    setSaveModalError(null);

    try {
      const { test } = await api.saveGeneratedTest(sessionId, {
        name: trimmedName,
        description: saveForm.description.trim() || undefined,
        tags: tags.length ? tags : undefined,
        folder: saveForm.folder.trim() || undefined,
        credentialId: saveForm.credentialId || undefined
      });
      setSavedTest(test);
      addCategoryOption(test.folder);
      setState((prev) => (prev ? { ...prev, savedTestId: test.id } : prev));
      setAutoSaveNotice(`Saved as "${test.name}"`);
      setSaveModalOpen(false);
      setTimeout(() => setAutoSaveNotice(null), 5000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save test';
      setSaveModalError(message);
    } finally {
      setSavingTest(false);
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

  const stepMode = state?.mode === 'manual';
  const statusColors = {
    initializing: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    thinking: 'bg-purple-100 text-purple-800',
    paused: 'bg-amber-100 text-amber-800',
    awaiting_input: 'bg-teal-100 text-teal-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800'
  };

  const statusColor = state ? statusColors[state.status] ?? 'bg-gray-100 text-gray-800' : 'bg-gray-100 text-gray-800';
  const isRunning = state?.status === 'running' || state?.status === 'thinking';
  const isPaused = state?.status === 'paused';
  const waitingForInstruction = stepMode && state?.status === 'awaiting_input';
  const feedbackDisabled = !state || state.status === 'initializing' || isRunning;
  const composerDisabled = stepMode ? !waitingForInstruction || sendingChat : feedbackDisabled;
  const canPause = !stepMode && Boolean(isRunning);
  const canInterrupt = Boolean(stepMode && state && (state.status === 'running' || state.status === 'thinking'));
  const canStop = Boolean(!stepMode && state && (isRunning || isPaused));
  const canRestart = Boolean(state && state.status !== 'initializing' && !stepMode);
  const canSave = stepMode
    ? Boolean(state && steps.length > 0)
    : Boolean(state && (state.status === 'completed' || state.status === 'failed' || state.status === 'stopped'));
  const composerPlaceholder = stepMode
    ? waitingForInstruction
      ? 'Example: Complete the registration form with the provided test data…'
      : 'Waiting for the previous instruction to complete…'
    : feedbackDisabled
      ? 'Pause the generation to provide feedback...'
      : 'Describe the next action you want the AI to take...';
  const sendButtonLabel = stepMode ? (sendingChat ? 'Running…' : 'Run Instruction') : sendingChat ? 'Sending…' : 'Send Feedback';
  const statusLabel =
    state?.status === 'awaiting_input'
      ? 'AWAITING NEXT STEP'
      : state?.status?.toUpperCase() ?? 'STATUS';

  const activeScreenshotStep =
    activeScreenshotIndex !== null ? steps[activeScreenshotIndex] : null;

  const screenshotProgress = (() => {
    if (activeScreenshotIndex === null) {
      return { total: 0, position: 0 };
    }

    let total = 0;
    let position = 0;

    steps.forEach((step, idx) => {
      if (step.screenshotData || step.screenshotPath) {
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
        {autoSaveNotice && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {autoSaveNotice}
          </div>
        )}

        {savedTest && (
          <div className="mb-4 flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 md:flex-row md:items-center md:justify-between">
            <div>
              Auto-saved as <span className="font-semibold">{savedTest.name}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!canSave || isSaving}
                className="rounded-md border border-emerald-400 px-3 py-1 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? 'Updating…' : 'Rename / Update Meta'}
              </button>
              <button
                onClick={() => navigate('/')}
                className="rounded-md border border-transparent px-3 py-1 text-sm font-medium text-emerald-900 hover:underline"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        )}

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

        {state && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Session Setup</h2>
              {sessionConfigEditing ? (
                <div className="flex gap-2">
                  <button
                    onClick={handleCancelSessionConfigEditing}
                    className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                    disabled={savingSessionConfig}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveSessionConfig}
                    disabled={savingSessionConfig}
                    className="px-4 py-1.5 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingSessionConfig ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleEnableSessionConfigEditing}
                  className="px-3 py-1 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded"
                >
                  Edit settings
                </button>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Starting URL
                </p>
                {sessionConfigEditing ? (
                  <input
                    type="url"
                    value={sessionConfigUrl}
                    onChange={(e) => setSessionConfigUrl(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                    placeholder="https://example.com/login"
                    disabled={savingSessionConfig}
                  />
                ) : (
                  <p className="text-sm font-mono text-blue-600 break-all">{state.startUrl}</p>
                )}
              </div>
              {!stepMode && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Max Steps
                  </p>
                  {sessionConfigEditing ? (
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={sessionConfigMaxSteps}
                      onChange={(e) => setSessionConfigMaxSteps(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      disabled={savingSessionConfig}
                    />
                  ) : (
                    <p className="text-sm text-gray-900">
                      {state.maxSteps}{' '}
                      <span className="text-xs text-gray-500">(current session limit)</span>
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="mt-4 space-y-3">
              {(!stepMode || !sessionConfigEditing) && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Goal
                  </p>
                  {sessionConfigEditing ? (
                    <textarea
                      value={sessionConfigPrompt}
                      onChange={(e) => setSessionConfigPrompt(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                      rows={3}
                      disabled={savingSessionConfig}
                    />
                  ) : (
                    <p className="text-sm text-gray-900 whitespace-pre-line">{state.goal}</p>
                  )}
                </div>
              )}
              {!stepMode && (
                <>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Success Criteria
                    </p>
                    {sessionConfigEditing ? (
                      <textarea
                        value={sessionConfigSuccessCriteria}
                        onChange={(e) => setSessionConfigSuccessCriteria(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                        rows={3}
                        disabled={savingSessionConfig}
                      />
                    ) : (
                      <p className="text-sm text-gray-900 whitespace-pre-line">
                        {state.successCriteria || 'Not specified'}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Credential
                    </p>
                    {state.credentialSummary ? (
                      <p className="text-sm text-gray-900">
                        {state.credentialSummary.name}{' '}
                        <span className="text-xs text-gray-500">
                          ({state.credentialSummary.username})
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500">Not attached</p>
                    )}
                    <p className="text-xs text-gray-400">Add or change the credential when saving.</p>
                  </div>
                </>
              )}
            </div>
            {sessionConfigError && (
              <p className="mt-3 text-sm text-red-600">{sessionConfigError}</p>
            )}
            {!stepMode && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={state.keepBrowserOpen ?? false}
                    onChange={(e) => handleToggleKeepBrowserOpen(e.target.checked)}
                    className="mt-1 rounded"
                    disabled={updatingKeepBrowserOpen}
                  />
                  <span className="text-sm text-gray-800">
                    Leave the Chromium window open after generation completes
                    <span className="block text-xs text-gray-500">
                      Use this to inspect the final state before saving the test.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Status Bar */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColor}`}>
                {statusLabel}
              </span>
              <div className="text-sm text-gray-600">
                <span className="font-medium">{state?.stepsTaken || 0}</span> / {state?.maxSteps || 20} steps
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {canInterrupt && (
                <button
                  onClick={handleInterrupt}
                  disabled={isInterrupting}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  {isInterrupting ? 'Interrupting…' : 'Interrupt'}
                </button>
              )}
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

        {/* Guidance / Manual Panel */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {stepMode ? 'Step-by-step Builder' : 'Guidance & Feedback'}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {stepMode
                  ? waitingForInstruction
                    ? 'Describe what the browser should do next (you can include multiple actions). I will keep going until it is done.'
                    : 'Working on your instruction. Use Interrupt if you need to stop early.'
                  : feedbackDisabled
                    ? 'Pause or stop the generation to provide updated instructions.'
                    : 'Share feedback to steer the next actions before resuming.'}
              </p>
            </div>
            {!stepMode && isPaused && (
              <button
                onClick={handleResume}
                disabled={isResuming}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {isResuming ? 'Resuming…' : 'Resume Test'}
              </button>
            )}
          </div>

          {!stepMode && (
            <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Original Prompt
              </p>
              <p className="mt-2 text-sm text-gray-900 whitespace-pre-line">
                {state?.goal || '—'}
              </p>
            </div>
          )}

          {/* Chat Messages */}
          <div ref={chatRef} className="mb-4 space-y-3 max-h-[360px] overflow-y-auto pr-1">
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
                {stepMode
                  ? 'No instructions yet. Describe the first action to perform.'
                  : 'No feedback yet. Pause the test to provide guidance.'}
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
                if (e.key === 'Enter' && !e.shiftKey && !composerDisabled && chatInput.trim()) {
                  e.preventDefault();
                  void handleSendChat();
                }
              }}
              disabled={composerDisabled}
              placeholder={composerPlaceholder}
              className={`w-full min-h-[90px] rounded-lg border px-3 py-2 text-sm ${
                composerDisabled
                  ? 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                  : 'border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-500'
              }`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSendChat}
                disabled={sendingChat || !chatInput.trim() || composerDisabled}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendButtonLabel}
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
                  {step.url && (
                    <div className="mt-2 mb-1 text-xs text-gray-500 truncate" title={step.url}>
                      <span className="font-medium">URL:</span> {step.url}
                    </div>
                  )}
                  {(step.screenshotData || step.screenshotPath) && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => openScreenshotModal(index)}
                        className="group w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 hover:border-blue-400"
                        aria-label={`View screenshot for step ${step.stepNumber}`}
                      >
                        <img
                          src={step.screenshotData || step.screenshotPath}
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
      {saveModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Save Test to Library
                </h3>
                <p className="text-sm text-gray-500">
                  Add metadata so QA teammates can search, filter, and rerun it later.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!savingTest) {
                    setSaveModalOpen(false);
                  }
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">Test Name</label>
                <input
                  type="text"
                  value={saveForm.name}
                  onChange={(e) => setSaveForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-gray-700">Category / Suite</label>
                  <input
                    type="text"
                    value={saveForm.folder}
                    onChange={(e) =>
                      setSaveForm((prev) => ({ ...prev, folder: e.target.value }))
                    }
                    list={categoryOptions.length > 0 ? CATEGORY_DATALIST_ID : undefined}
                    placeholder={
                      categoryOptions.length ? 'Select or create a category' : 'e.g., Authentication'
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  />
                  {categoryOptions.length > 0 && (
                    <datalist id={CATEGORY_DATALIST_ID}>
                      {categoryOptions.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    Choose an existing category or type a new name.
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Tags</label>
                  <input
                    type="text"
                    value={saveForm.tagsInput}
                    onChange={(e) =>
                      setSaveForm((prev) => ({ ...prev, tagsInput: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    placeholder="ai-generated, smoke, login"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={saveForm.description}
                  onChange={(e) =>
                    setSaveForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  placeholder="Optional summary for teammates"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Default Credential</label>
                <select
                  value={saveForm.credentialId}
                  onChange={(e) =>
                    setSaveForm((prev) => ({ ...prev, credentialId: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">No credential</option>
                  {credentials.map((credential) => (
                    <option key={credential.id} value={credential.id}>
                      {credential.name} · {credential.username}
                    </option>
                  ))}
                </select>
              </div>
              {saveModalError && (
                <p className="text-sm text-red-600">{saveModalError}</p>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!savingTest) {
                      setSaveModalOpen(false);
                    }
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  disabled={savingTest}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void submitSaveForm()}
                  disabled={savingTest}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingTest ? 'Saving…' : 'Save Test'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {activeScreenshotIndex !== null &&
        activeScreenshotStep &&
        (activeScreenshotStep.screenshotData || activeScreenshotStep.screenshotPath) && (
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
                {activeScreenshotStep.url && (
                  <p className="mt-2 text-sm text-gray-300 break-all">
                    <span className="font-medium text-gray-400">URL:</span> {activeScreenshotStep.url}
                  </p>
                )}
              </div>
              <div className="relative overflow-hidden rounded-lg bg-black">
                <img
                  src={activeScreenshotStep.screenshotData || activeScreenshotStep.screenshotPath}
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
    </div>
  );
}
