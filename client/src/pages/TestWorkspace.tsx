import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type {
  ApiTest,
  RunStreamEvent,
  RunControlAction,
  ApiCredential
} from '../api/client';
import type {
  LiveRunState,
  StepSummary,
  RunStatus,
  RunResult,
  RunScreenshot,
  StepCounts
} from '../../../shared/types';
import { SCREEN_SIZE_PRESETS } from '../constants/screenSizes';
import { VariableDataGrid } from '../components/VariableDataGrid';
import { CSVImportModal } from '../components/CSVImportModal';
import type { VariableDefinition, VariableRow, ColumnMapping, ImportMode } from '../components/CSVImportModal';

const statusLabels: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  completed: 'Completed',
  failed: 'Failed'
};

const statusStyles: Record<RunStatus, string> = {
  queued: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700',
  paused: 'bg-amber-100 text-amber-700',
  stopped: 'bg-orange-100 text-orange-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700'
};

const stepStatusStyles = {
  pending: 'border-blue-200 bg-blue-50',
  passed: 'border-emerald-200 bg-emerald-50',
  failed: 'border-red-200 bg-red-50'
} as const;

function formatTimestamp(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function formatDuration(ms?: number) {
  if (!ms || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function formatRunResultStatus(status: RunResult['status']): string {
  switch (status) {
    case 'passed':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'partial':
      return 'Partial';
    case 'stopped':
      return 'Stopped';
    default:
      return status;
  }
}

function summarizeStepData(
  steps?: StepSummary[],
  existingCounts?: StepCounts,
  failedStepTitles?: string[]
): { counts?: StepCounts; failedTitles?: string[] } {
  if (existingCounts || (failedStepTitles && failedStepTitles.length > 0)) {
    return {
      counts: existingCounts ? { ...existingCounts } : undefined,
      failedTitles: failedStepTitles && failedStepTitles.length ? [...failedStepTitles] : undefined
    };
  }

  if (!steps || steps.length === 0) {
    return { counts: undefined, failedTitles: undefined };
  }

  const counts: StepCounts = { total: steps.length, passed: 0, failed: 0, pending: 0 };
  const failed = new Set<string>();

  for (const step of steps) {
    if (step.status === 'passed') {
      counts.passed += 1;
    } else if (step.status === 'failed') {
      counts.failed += 1;
      if (step.title) {
        failed.add(step.title);
      }
    } else {
      counts.pending += 1;
    }
  }

  return {
    counts,
    failedTitles: failed.size ? Array.from(failed) : undefined
  };
}

export default function TestWorkspace() {
  const navigate = useNavigate();
  const { testId } = useParams();

  const [test, setTest] = useState<ApiTest | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [goal, setGoal] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [code, setCode] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaMessage, setMetaMessage] = useState<string | null>(null);
  const [folder, setFolder] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [credentialLoadError, setCredentialLoadError] = useState<string | null>(null);

  const [runs, setRuns] = useState<RunResult[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);

  const [headed, setHeaded] = useState(true);
  const [headedNotice, setHeadedNotice] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [keepBrowserOpen, setKeepBrowserOpen] = useState(false);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [selectedScreenSize, setSelectedScreenSize] = useState('');
  const [startingRun, setStartingRun] = useState(false);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runState, setRunState] = useState<LiveRunState | null>(null);
  const [pendingAction, setPendingAction] = useState<RunControlAction | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logsRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const runDetailsRef = useRef<HTMLDivElement>(null);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenUrl, setRegenUrl] = useState('');
  const [regenMaxSteps, setRegenMaxSteps] = useState('20');
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [startingGeneration, setStartingGeneration] = useState(false);
  const [defaultStartUrl, setDefaultStartUrl] = useState('');

  // Tab and variable data management
  const [activeTab, setActiveTab] = useState<'details' | 'data'>('details');
  const [variables, setVariables] = useState<VariableDefinition[]>([]);
  const [variableData, setVariableData] = useState<VariableRow[]>([]);
  const [loadingVariables, setLoadingVariables] = useState(false);
  const [showCSVImport, setShowCSVImport] = useState(false);

  // Step editing state
  const [editedSteps, setEditedSteps] = useState<Array<{ number: number; qaSummary: string; playwrightCode: string }>>([]);
  const [stepsModified, setStepsModified] = useState(false);
  const [savingSteps, setSavingSteps] = useState(false);
  const [insertAfterStep, setInsertAfterStep] = useState<number | null>(null);
  const [insertPrompt, setInsertPrompt] = useState('');
  const [insertingSteps, setInsertingSteps] = useState(false);
  const [insertedStepsPreview, setInsertedStepsPreview] = useState<Array<{ qaSummary: string; playwrightCode: string }>>([]);
  const [insertionSessionId, setInsertionSessionId] = useState<string | null>(null);
  const [initializingInsertion, setInitializingInsertion] = useState(false);
  const [insertionError, setInsertionError] = useState<string | null>(null);

  const refreshRuns = useCallback(async () => {
    if (!testId) return;
    try {
      const { runs } = await api.listRuns(testId);
      setRuns(runs);
    } catch (err) {
      console.error('Failed to refresh runs', err);
    }
  }, [testId]);

  const loadVariables = useCallback(async () => {
    if (!testId) return;
    setLoadingVariables(true);
    try {
      const response = await api.getTestVariables(testId);
      setVariables(response.variables as VariableDefinition[] || []);
      setVariableData(response.data || []);
    } catch (err) {
      console.error('Failed to load variables', err);
      setVariables([]);
      setVariableData([]);
    } finally {
      setLoadingVariables(false);
    }
  }, [testId]);

  const handleDataChange = useCallback(async (newData: VariableRow[]) => {
    if (!testId) return;
    await api.updateTestVariables(testId, { data: newData });
    setVariableData(newData);
  }, [testId]);

  const handleExportCSV = useCallback(async () => {
    if (!testId) return;
    try {
      const csvContent = await api.exportTestVariables(testId);
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${test?.metadata.name || testId}-data.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export CSV', err);
      setError(err instanceof Error ? err.message : 'Failed to export CSV');
    }
  }, [testId, test]);

  const handleImportCSV = useCallback(async (csvContent: string, mapping: ColumnMapping, mode: ImportMode) => {
    if (!testId) return;
    await api.importTestVariables(testId, { csvContent, mapping, mode });
    await loadVariables();
  }, [testId, loadVariables]);

  useEffect(() => {
    if (!testId) return;
    let cancelled = false;

    async function load() {
      if (!testId) return;
      try {
        const { test } = await api.getTest(testId);
        if (cancelled) return;
        setTest(test);
        setName(test.metadata.name);
        setDescription(test.metadata.description || '');
        setTagsInput((test.metadata.tags || []).join(', '));
        setGoal(test.metadata.prompt || '');
        setSuccessCriteria(test.metadata.successCriteria || '');
        setCode(test.code);
        setFolder(test.metadata.folder || '');
        setCredentialId(test.metadata.credentialId || '');
      } catch (err) {
        console.error('Failed to load test', err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [testId]);

  useEffect(() => {
    let cancelled = false;
    api
      .getConfig()
      .then((config) => {
        if (!cancelled) {
          setDefaultStartUrl(config?.defaultStartUrl || '');
        }
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCredentialLoadError(null);
    setLoadingCredentials(true);
    api
      .listCredentials()
      .then(({ credentials: list }) => {
        if (!cancelled) {
          setCredentials(list);
        }
      })
      .catch((err) => {
        console.error('Failed to load credentials', err);
        if (!cancelled) {
          setCredentialLoadError('Unable to load credentials');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCredentials(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!testId) return;
    let cancelled = false;
    setLoadingRuns(true);

    async function load() {
      try {
        const { runs } = await api.listRuns(testId);
        if (cancelled) return;
        setRuns(runs);
      } catch (err) {
        console.error('Failed to load runs', err);
      } finally {
        if (!cancelled) {
          setLoadingRuns(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [testId]);

  // Load variables when Data tab is selected
  useEffect(() => {
    if (activeTab === 'data' && testId) {
      void loadVariables();
    }
  }, [activeTab, testId, loadVariables]);

  // Initialize edited steps when test is loaded
  useEffect(() => {
    if (test?.metadata?.steps) {
      setEditedSteps([...test.metadata.steps]);
      setStepsModified(false);
    }
  }, [test?.metadata?.steps]);

  const handleStreamEvent = useCallback((event: RunStreamEvent) => {
    if (event.type === 'hydrate') {
      setRunState(event.payload);
      return;
    }

    setRunState((current) => {
      if (!current) {
        return current;
      }

      switch (event.type) {
        case 'status':
          return {
            ...current,
            status: event.payload.status,
            updatedAt: event.payload.timestamp
          };
        case 'log': {
          const logs = [...current.logs, event.payload];
          if (logs.length > 500) {
            logs.splice(0, logs.length - 500);
          }
          return { ...current, logs };
        }
        case 'step': {
          const steps = [...current.steps];
          const index = steps.findIndex((step) => step.id === event.payload.id);
          if (index >= 0) {
            steps[index] = { ...steps[index], ...event.payload };
          } else {
            steps.unshift(event.payload);
          }
          return { ...current, steps };
        }
        case 'chat': {
          const chat = [...current.chat, event.payload];
          if (chat.length > 200) {
            chat.splice(0, chat.length - 200);
          }
          return { ...current, chat };
        }
        case 'result':
          void refreshRuns();
          return { ...current, result: event.payload };
        case 'error':
          return current;
        default:
          return current;
      }
    });
  }, []);

  const liveStatuses: RunStatus[] = ['queued', 'running', 'paused'];
  const shouldStream = Boolean(
    activeRunId && (!runState || liveStatuses.includes(runState.status))
  );

  useEffect(() => {
    if (!activeRunId || !shouldStream) {
      return undefined;
    }

    const source = api.connectToRunStream(activeRunId, (event) => {
      if (event.type === 'error') {
        setError(event.payload?.message || 'Run disconnected unexpectedly');
      }
      handleStreamEvent(event);
    });

    source.onerror = (err) => {
      console.error('Run stream error', err);
    };

    return () => {
      source.close();
    };
  }, [activeRunId, shouldStream, handleStreamEvent]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [runState?.logs]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [runState?.chat]);

  async function handleSaveMetadata() {
    if (!test || !testId) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setMetaMessage('Name is required');
      return;
    }

    const tags = tagsInput
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    setSavingMeta(true);
    setMetaMessage(null);

    try {
      await api.saveTest({
        metadata: {
          ...test.metadata,
          name: trimmedName,
          description: description.trim() || undefined,
          tags,
          prompt: goal.trim() || undefined,
          successCriteria: successCriteria.trim() || undefined,
          folder: folder.trim() || undefined,
          credentialId: credentialId || undefined,
          updatedAt: new Date().toISOString()
        },
        code
      });
      setMetaMessage('Saved');
      setTest((prev) =>
        prev
          ? {
            ...prev,
            metadata: {
              ...prev.metadata,
              name: trimmedName,
              description: description.trim() || undefined,
              tags,
              folder: folder.trim() || undefined,
              credentialId: credentialId || undefined
            }
          }
          : prev
      );
      setTimeout(() => setMetaMessage(null), 2500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save metadata';
      setMetaMessage(message);
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleStartRun() {
    if (!testId) return;
    setStartingRun(true);
    setError(null);

    try {
      const viewportSize = selectedScreenSize
        ? SCREEN_SIZE_PRESETS.find((p) => p.id === selectedScreenSize)?.viewport
        : undefined;

      const { runId } = await api.runTest(testId, { headed, speed, keepBrowserOpen, stopOnFailure, viewportSize });
      setActiveRunId(runId);
      setRunState(null);
      setTimeout(() => {
        void refreshRuns();
      }, 500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start run';
      setError(message);
    } finally {
      setStartingRun(false);
    }
  }

  async function handleSelectRun(runId: string) {
    setActiveRunId(runId);
    setRunState(null);
    setError(null);
    try {
      const { run } = await api.getRun(runId);
      setRunState(run);
      runDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.warn('Unable to load run details', err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to load run details. Ensure the run files still exist.';
      setError(message);
    }
  }

  async function handleControl(action: RunControlAction) {
    if (!activeRunId) return;
    setPendingAction(action);
    try {
      await api.controlRun(activeRunId, action);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to update run state. Ensure the process is still active.';
      setError(message);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleSendChat(event: FormEvent) {
    event.preventDefault();
    if (!activeRunId) {
      setError('Start or select a run before chatting with the assistant.');
      return;
    }
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    try {
      setSendingChat(true);
      setError(null);
      const response = await api.sendRunChat(activeRunId, trimmed);
      setChatInput('');
      setRunState((prev) =>
        prev
          ? {
            ...prev,
            chat: response.messages ?? prev.chat
          }
          : prev
      );
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to send message to AI assistant.';
      setError(message);
    } finally {
      setSendingChat(false);
    }
  }

  async function handleGenerateFromGoal() {
    if (!goal.trim()) {
      setRegenMessage('Goal is empty.');
      return;
    }

    const targetUrl = regenUrl.trim() || defaultStartUrl.trim();
    if (!targetUrl) {
      setRegenMessage('Enter a starting URL.');
      return;
    }

    const maxStepsNumber = Number.parseInt(regenMaxSteps, 10) || 20;

    setStartingGeneration(true);
    setRegenMessage(null);

    try {
      const { sessionId } = await api.startGeneration({
        startUrl: targetUrl,
        goal: goal.trim(),
        successCriteria: successCriteria.trim() || undefined,
        maxSteps: maxStepsNumber
      });
      setShowRegenModal(false);
      navigate(`/generate/${sessionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start AI generation';
      setRegenMessage(message);
    } finally {
      setStartingGeneration(false);
    }
  }

  async function handleOpenTrace(targetRunId?: string) {
    const runId = targetRunId ?? activeRunId;
    if (!runId) return;
    try {
      await api.openTrace(runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to open Playwright trace';
      setError(message);
    }
  }

  function handleDeleteStep(stepNumber: number) {
    const updatedSteps = editedSteps
      .filter(s => s.number !== stepNumber)
      .map((s, index) => ({
        ...s,
        number: index + 1  // Renumber steps
      }));
    setEditedSteps(updatedSteps);
    setStepsModified(true);
  }

  async function handleSaveSteps() {
    if (!testId || !test) return;

    setSavingSteps(true);
    try {
      // Regenerate test code with updated steps
      await api.updateTestSteps(testId, editedSteps);

      // Refresh test data
      const { test: updatedTest } = await api.getTest(testId);
      setTest(updatedTest);
      setStepsModified(false);

      // Show success message
      setMetaMessage('Steps saved successfully!');
      setTimeout(() => setMetaMessage(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save steps';
      setMetaMessage(`Error: ${message}`);
    } finally {
      setSavingSteps(false);
    }
  }

  async function handleOpenInsertModal(afterStepNumber: number) {
    if (!testId) return;

    setInsertAfterStep(afterStepNumber);
    setInsertPrompt('');
    setInsertedStepsPreview([]);
    setInsertionError(null);
    setInitializingInsertion(true);

    try {
      // Start insertion session - this will replay the test and open browser
      const response = await api.startStepInsertion(testId, afterStepNumber);
      setInsertionSessionId(response.sessionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start insertion session';
      setInsertionError(message);
      setMetaMessage(`Error: ${message}`);
      setTimeout(() => setMetaMessage(null), 5000);
    } finally {
      setInitializingInsertion(false);
    }
  }

  async function handleCloseInsertModal() {
    // Close insertion session if active
    if (insertionSessionId) {
      try {
        await api.closeStepInsertion(insertionSessionId);
      } catch (err) {
        console.error('Failed to close insertion session:', err);
      }
      setInsertionSessionId(null);
    }

    setInsertAfterStep(null);
    setInsertPrompt('');
    setInsertedStepsPreview([]);
    setInsertionError(null);
  }

  async function handleGenerateInsertStep(event: FormEvent) {
    event.preventDefault();
    if (!insertPrompt.trim() || !insertionSessionId) return;

    setInsertingSteps(true);
    setInsertionError(null);

    try {
      // Use AI with browser context to generate Playwright code
      const response = await api.generateStepWithContext(insertionSessionId, insertPrompt.trim());

      // Add to preview
      setInsertedStepsPreview((prev) => [
        ...prev,
        {
          qaSummary: response.qaSummary,
          playwrightCode: response.playwrightCode
        }
      ]);

      // Clear prompt for next instruction
      setInsertPrompt('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate step';
      setInsertionError(message);
      setMetaMessage(`Error: ${message}`);
      setTimeout(() => setMetaMessage(null), 5000);
    } finally {
      setInsertingSteps(false);
    }
  }

  async function handleConfirmInsertSteps() {
    if (insertAfterStep === null || insertedStepsPreview.length === 0) return;

    // Insert the generated steps after the specified step
    const insertIndex = insertAfterStep; // Insert after this step number
    const beforeSteps = editedSteps.slice(0, insertIndex);
    const afterSteps = editedSteps.slice(insertIndex);

    // Add new steps without numbers (will renumber below)
    const newSteps = insertedStepsPreview.map((step) => ({
      number: 0, // Temporary
      qaSummary: step.qaSummary,
      playwrightCode: step.playwrightCode
    }));

    // Combine and renumber all steps
    const combined = [...beforeSteps, ...newSteps, ...afterSteps].map((step, index) => ({
      ...step,
      number: index + 1
    }));

    setEditedSteps(combined);
    setStepsModified(true);

    // Close the modal and cleanup session
    await handleCloseInsertModal();
  }

  const logItems = useMemo(() => runState?.logs ?? [], [runState?.logs]);
  const chatItems = useMemo(() => runState?.chat ?? [], [runState?.chat]);
  const stepsForDisplay = useMemo(() => {
    if (runState?.steps && runState.steps.length > 0) {
      return runState.steps;
    }
    if (runState?.result?.steps && runState.result.steps.length > 0) {
      return runState.result.steps;
    }
    return [] as StepSummary[];
  }, [runState?.steps, runState?.result?.steps]);

  const orderedSteps = useMemo(() => {
    if (!stepsForDisplay) {
      return [] as StepSummary[];
    }
    return [...stepsForDisplay].sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return aTime - bTime;
    });
  }, [stepsForDisplay]);
  const screenshotDetails: RunScreenshot[] = useMemo(() => {
    if (runState?.result?.screenshots) {
      return runState.result.screenshots;
    }
    if (runState?.result?.screenshotPaths) {
      return runState.result.screenshotPaths.map((path, index) => ({
        path,
        stepTitle: `Screenshot ${index + 1}`,
        testTitle: undefined,
        description: undefined,
        capturedAt: undefined,
        attachmentName: undefined
      }));
    }
    return [];
  }, [runState?.result?.screenshots, runState?.result?.screenshotPaths]);
  const runStepSummary = useMemo(
    () =>
      summarizeStepData(
        stepsForDisplay,
        runState?.result?.stepCounts,
        runState?.result?.failedStepTitles
      ),
    [stepsForDisplay, runState?.result?.stepCounts, runState?.result?.failedStepTitles]
  );

  const currentStatus: RunStatus = runState?.status ?? 'queued';
  const testTitle = name || test?.metadata.name || 'Test Workspace';
  const historyTotals = useMemo(() => {
    return runs.reduce(
      (acc, run) => {
        if (run.status === 'passed') acc.passed += 1;
        else if (run.status === 'failed') acc.failed += 1;
        else if (run.status === 'stopped') acc.stopped += 1;
        else if (run.status === 'partial') acc.partial += 1;
        else if (run.status === 'skipped') acc.skipped += 1;
        return acc;
      },
      { passed: 0, failed: 0, stopped: 0, partial: 0, skipped: 0 }
    );
  }, [runs]);

  const topFailingSteps = useMemo(() => {
    const counter = new Map<string, number>();
    runs.forEach((run) => {
      const summary = summarizeStepData(run.steps, run.stepCounts, run.failedStepTitles);
      const failedTitles = summary.failedTitles ?? [];
      failedTitles.forEach((title) => {
        counter.set(title, (counter.get(title) ?? 0) + 1);
      });
    });
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [runs]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to Dashboard
          </button>
          <div className="text-sm text-gray-500">
            {test ? `Test ID: ${test.metadata.id}` : 'Loading test…'}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-6">
            <div className="rounded-lg bg-white p-6 shadow" ref={runDetailsRef}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <img src="/favicon.png" alt="TrailWright Logo" className="h-8 w-8 object-contain" />
                    <h1 className="text-3xl font-bold text-gray-900">{testTitle}</h1>
                  </div>
                  <p className="text-sm text-gray-500">Prompt, run, and review in one window.</p>
                </div>
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${statusStyles[currentStatus]}`}
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
                  {statusLabels[currentStatus]}
                </span>
              </div>

              {/* Tab Navigation */}
              <div className="flex border-b border-gray-200 mb-4">
                <button
                  onClick={() => setActiveTab('details')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'details'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                  Details
                </button>
                <button
                  onClick={() => setActiveTab('data')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'data'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                  Data {variables.length > 0 && `(${variables.length})`}
                </button>
              </div>

              {/* Details Tab */}
              {activeTab === 'details' && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Tags (comma separated)</label>
                      <input
                        type="text"
                        value={tagsInput}
                        onChange={(e) => setTagsInput(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Category / Suite</label>
                      <input
                        type="text"
                        value={folder}
                        onChange={(e) => setFolder(e.target.value)}
                        placeholder="e.g., Authentication"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500">Organize tests by product area or release suite.</p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Default Credential</label>
                      {credentialLoadError ? (
                        <p className="text-xs text-red-600">{credentialLoadError}</p>
                      ) : (
                        <select
                          value={credentialId}
                          disabled={loadingCredentials}
                          onChange={(e) => setCredentialId(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">No credential</option>
                          {credentials.map((cred) => (
                            <option key={cred.id} value={cred.id}>
                              {cred.name} · {cred.username}
                            </option>
                          ))}
                        </select>
                      )}
                      <p className="text-xs text-gray-500">
                        Manage credentials in Settings. They are injected at runtime.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    <label className="text-sm font-medium text-gray-700">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {goal && goal !== description && (
                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-700">Goal</label>
                        <button
                          type="button"
                          onClick={() => {
                            setRegenUrl(defaultStartUrl || '');
                            setRegenMaxSteps('20');
                            setRegenMessage(null);
                            setShowRegenModal(true);
                          }}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800"
                        >
                          Copy to new AI test
                        </button>
                      </div>
                      <textarea
                        value={goal}
                        readOnly
                        rows={2}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600"
                      />
                    </div>
                  )}

                  {successCriteria && (
                    <div className="mt-4 space-y-2">
                      <label className="text-sm font-medium text-gray-700">Success Criteria</label>
                      <textarea
                        value={successCriteria}
                        readOnly
                        rows={3}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600"
                      />
                    </div>
                  )}

                  <div className="mt-4 flex items-center justify-between">
                    <button
                      onClick={handleSaveMetadata}
                      disabled={savingMeta}
                      className="rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {savingMeta ? 'Saving…' : 'Save Details'}
                    </button>
                    {metaMessage && (
                      <span className="text-sm text-gray-600">{metaMessage}</span>
                    )}
                  </div>
                </>
              )}

              {/* Data Tab */}
              {activeTab === 'data' && (
                <div className="space-y-4">
                  {loadingVariables ? (
                    <p className="text-sm text-gray-500">Loading variable data...</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-gray-600">
                          Manage test data for parameterized tests. Variables must be defined during test creation.
                        </p>
                        <button
                          onClick={() => setShowCSVImport(true)}
                          disabled={variables.length === 0}
                          className="text-sm px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Import CSV
                        </button>
                      </div>
                      <VariableDataGrid
                        testId={testId || ''}
                        variables={variables}
                        data={variableData}
                        onDataChange={handleDataChange}
                        onExportCSV={handleExportCSV}
                      />
                    </>
                  )}
                </div>
              )}

            </div>

            <div className="rounded-lg bg-white p-6 shadow">
              <h2 className="text-lg font-semibold text-gray-900">Run Options</h2>
              <p className="text-sm text-gray-500">TrailWright executes tests locally using your browser.</p>

              <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={headed}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setHeaded(next);
                    setHeadedNotice(
                      next ? null : 'Headless runs will not capture screenshots.'
                    );
                  }}
                  className="mt-1 rounded"
                />
                <span>
                  Show browser window (headed mode)
                  {!headed && (
                    <span className="mt-1 block text-xs text-red-600">
                      Screenshots are disabled while headless is selected.
                    </span>
                  )}
                </span>
              </label>

              <div className="mt-4">
                <div className="flex items-center justify-between text-sm text-gray-700">
                  <span>Slow motion factor</span>
                  <span className="font-medium text-gray-900">
                    {speed === 1 ? 'Off' : `${speed.toFixed(1)}x`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="mt-2 w-full"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Slower</span>
                  <span>Normal</span>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Screen Size</label>
                <select
                  value={selectedScreenSize}
                  onChange={(e) => setSelectedScreenSize(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Default (Browser default)</option>
                  {SCREEN_SIZE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Run test with specific viewport size
                </p>
              </div>

              <button
                onClick={handleStartRun}
                disabled={startingRun || !test}
                className="mt-6 w-full rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {startingRun ? 'Starting…' : 'Start Run'}
              </button>
              {headedNotice && (
                <p className="mt-2 text-xs text-red-600">{headedNotice}</p>
              )}
              <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={keepBrowserOpen}
                  onChange={(e) => setKeepBrowserOpen(e.target.checked)}
                  className="mt-1 rounded"
                  disabled={!headed}
                />
                <span>
                  Leave browser open when run finishes (headed mode only)
                  <span className="block text-xs text-gray-500">
                    Uses Playwright debug mode so you can keep the window open after completion.
                  </span>
                </span>
              </label>
              <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={stopOnFailure}
                  onChange={(e) => setStopOnFailure(e.target.checked)}
                  className="mt-1 rounded"
                />
                <span>
                  Stop test on first failure
                  <span className="block text-xs text-gray-500">
                    Automatically stop test execution when any step fails instead of continuing.
                  </span>
                </span>
              </label>
            </div>

            <div className="rounded-lg bg-white p-6 shadow">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Test</h2>
                {runState?.result && (
                  <span className="text-sm text-gray-500">
                    Finished {formatTimestamp(runState.result.endedAt)} · {formatDuration(runState.result.duration)}
                  </span>
                )}
              </div>

              {activeRunId ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => handleControl('resume')}
                      disabled={currentStatus !== 'paused' || pendingAction !== null}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40"
                    >
                      Resume
                    </button>
                    <button
                      onClick={() => handleControl('pause')}
                      disabled={currentStatus !== 'running' || pendingAction !== null}
                      className="rounded-lg bg-amber-500 px-4 py-2 text-white disabled:opacity-40"
                    >
                      Pause
                    </button>
                    <button
                      onClick={() => handleControl('stop')}
                      disabled={!['running', 'paused', 'queued'].includes(currentStatus) || pendingAction !== null}
                      className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-40"
                    >
                      Stop
                    </button>
                    <button
                      onClick={() => handleOpenTrace()}
                      disabled={!runState?.result?.tracePath}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 disabled:opacity-40"
                    >
                      Open Trace
                    </button>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                    {runStepSummary.counts ? (
                      <>
                        <div className="flex flex-wrap items-center gap-4">
                          <span className="flex items-center gap-1 text-emerald-700">
                            ✓ {runStepSummary.counts.passed} passed
                          </span>
                          <span className="flex items-center gap-1 text-red-700">
                            ✗ {runStepSummary.counts.failed} failed
                          </span>
                          <span className="flex items-center gap-1 text-gray-700">
                            Σ {runStepSummary.counts.total} steps
                          </span>
                        </div>
                        {runStepSummary.failedTitles && runStepSummary.failedTitles.length > 0 && (
                          <p className="mt-2 text-xs text-red-700">
                            Failed at: {runStepSummary.failedTitles.slice(0, 3).join(', ')}
                            {runStepSummary.failedTitles.length > 3 ? '…' : ''}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-600">Step outcomes will appear once telemetry is available.</p>
                    )}
                    {runState?.result?.errorSummary && (
                      <p className="mt-2 text-xs text-amber-700">
                        What went wrong: {runState.result.errorSummary}
                      </p>
                    )}
                  </div>

                  {/* Test Steps with Real-Time Status */}
                  <div className="space-y-3">
                    {editedSteps && editedSteps.length > 0 ? (
                      editedSteps.map((step) => {
                        // Find matching runtime step by title (qaSummary)
                        const runtimeStep = orderedSteps.find(s => s.title === step.qaSummary);
                        const status = runtimeStep?.status || 'pending';
                        const error = runtimeStep?.error;

                        // Determine if step is currently running (has started but not finished)
                        const isRunning = runtimeStep?.startedAt && status === 'pending';

                        // Find screenshots for this step
                        const stepScreenshots = screenshotDetails.filter(s => s.stepTitle === step.qaSummary);

                        return (
                          <div
                            key={step.number}
                            className={`border-2 rounded-lg p-4 ${status === 'passed'
                                ? 'border-emerald-400 bg-emerald-50'
                                : status === 'failed'
                                  ? 'border-red-400 bg-red-50'
                                  : isRunning
                                    ? 'border-amber-400 bg-amber-50'
                                    : 'border-gray-200 bg-white'
                              }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                                    {step.number}
                                  </span>
                                  <p className="font-medium text-gray-900">{step.qaSummary}</p>
                                </div>
                                {runtimeStep?.startedAt && (
                                  <p className="text-xs text-gray-500 ml-8">
                                    {formatTimestamp(runtimeStep.startedAt)}
                                  </p>
                                )}
                              </div>
                              <div className="flex-shrink-0">
                                {status === 'passed' && (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                    ✓ Pass
                                  </span>
                                )}
                                {status === 'failed' && (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                    ✗ Fail
                                  </span>
                                )}
                                {isRunning && (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                    ▶ Running
                                  </span>
                                )}
                                {!isRunning && status === 'pending' && (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                    ⋯ Pending
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Error Display */}
                            {error && (
                              <div className="mt-3 p-3 bg-red-100 border border-red-300 rounded text-sm text-red-900">
                                <p className="font-medium mb-1">Error:</p>
                                <p className="whitespace-pre-wrap text-xs">{error}</p>
                              </div>
                            )}

                            {/* Screenshots for this step */}
                            {stepScreenshots.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {stepScreenshots.map((shot, idx) => (
                                  <div key={`${shot.path}-${idx}`} className="flex items-center gap-3">
                                    <a
                                      href={shot.path}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block overflow-hidden rounded border border-gray-300"
                                    >
                                      <img
                                        src={shot.path}
                                        alt={shot.stepTitle || 'Screenshot'}
                                        className="h-20 w-32 object-cover"
                                        loading="lazy"
                                      />
                                    </a>
                                    <a
                                      href={shot.path}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs text-blue-600 hover:text-blue-800"
                                    >
                                      Open full size →
                                    </a>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-gray-500">No steps recorded for this test.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {!editedSteps || editedSteps.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-gray-600">
                      <p className="mb-2">No test steps defined.</p>
                      <p className="text-sm text-gray-500">Create steps using AI generation to get started.</p>
                    </div>
                  ) : (
                    <>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                        <p className="text-sm text-blue-800">
                          <strong>Edit Test Steps:</strong> Delete unwanted steps or insert new ones using AI.
                          After making changes, click "Save Changes" to regenerate the test code.
                        </p>
                      </div>

                      {stepsModified && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                          <p className="text-sm text-amber-800">
                            ⚠️ <strong>Unsaved changes</strong> - Don't forget to save your changes!
                          </p>
                        </div>
                      )}

                      <div className="space-y-3">
                        {editedSteps.map((step) => (
                          <div
                            key={step.number}
                            className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                                    {step.number}
                                  </span>
                                  <p className="font-medium text-gray-900">{step.qaSummary}</p>
                                </div>
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                                    Show Playwright code
                                  </summary>
                                  <pre className="mt-2 text-xs bg-gray-900 text-green-300 p-2 rounded overflow-x-auto">
                                    {step.playwrightCode}
                                  </pre>
                                </details>
                              </div>
                              <div className="flex flex-col gap-2">
                                <button
                                  onClick={() => handleOpenInsertModal(step.number)}
                                  className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100 border border-green-200"
                                  title="Insert step after this one"
                                >
                                  + Insert
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm(`Delete step ${step.number}: "${step.qaSummary}"?`)) {
                                      handleDeleteStep(step.number);
                                    }
                                  }}
                                  className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100 border border-red-200"
                                  title="Delete this step"
                                >
                                  ✕ Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={handleSaveSteps}
                            disabled={!stepsModified || savingSteps}
                            className="rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {savingSteps ? 'Saving…' : 'Save Changes'}
                          </button>
                          {stepsModified && (
                            <button
                              onClick={() => {
                                if (test?.metadata?.steps) {
                                  setEditedSteps([...test.metadata.steps]);
                                  setStepsModified(false);
                                }
                              }}
                              className="text-sm text-gray-600 hover:text-gray-800"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          Saving will regenerate the test code with your changes
                        </p>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg bg-white p-6 shadow">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Run History</h2>
                <button
                  onClick={() => void refreshRuns()}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Refresh
                </button>
              </div>
              {loadingRuns ? (
                <p className="mt-4 text-sm text-gray-500">Loading runs…</p>
              ) : runs.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No runs yet.</p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                    <span className="flex items-center gap-1 text-emerald-700">
                      ✓ {historyTotals.passed} pass
                    </span>
                    <span className="flex items-center gap-1 text-red-700">
                      ✗ {historyTotals.failed} fail
                    </span>
                    {historyTotals.stopped > 0 && (
                      <span className="flex items-center gap-1 text-amber-700">
                        ■ {historyTotals.stopped} stopped
                      </span>
                    )}
                    {(historyTotals.partial > 0 || historyTotals.skipped > 0) && (
                      <span className="flex items-center gap-1 text-gray-700">
                        ⋯ {historyTotals.partial + historyTotals.skipped} partial/skipped
                      </span>
                    )}
                    {topFailingSteps.length > 0 ? (
                      <span className="text-red-700">
                        Top failing steps: {topFailingSteps.map(([title, count]) => `${title} (${count})`).join(' · ')}
                      </span>
                    ) : (
                      <span className="text-gray-500">No failing steps recorded yet.</span>
                    )}
                  </div>
                  <div className="mt-4 space-y-3">
                    {runs.map((run) => {
                      const stepSummary = summarizeStepData(
                        run.steps,
                        run.stepCounts,
                        run.failedStepTitles
                      );
                      const isActive = activeRunId === run.id;

                      return (
                        <div
                          key={run.id}
                          className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 ${isActive ? 'border-blue-300 bg-blue-50' : 'border-gray-200'
                            }`}
                        >
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">{formatTimestamp(run.startedAt)}</p>
                            <p className="text-sm text-gray-500">
                              {formatRunResultStatus(run.status)} · {formatDuration(run.duration)}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              {stepSummary.counts ? (
                                <>
                                  <span className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-emerald-700">
                                    ✓ {stepSummary.counts.passed}
                                  </span>
                                  <span className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-red-700">
                                    ✗ {stepSummary.counts.failed}
                                  </span>
                                  <span className="flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-gray-700">
                                    Σ {stepSummary.counts.total}
                                  </span>
                                </>
                              ) : (
                                <span className="text-gray-500">No step data captured</span>
                              )}
                              {stepSummary.failedTitles && stepSummary.failedTitles.length > 0 && (
                                <span className="text-red-700">
                                  Failed at {stepSummary.failedTitles.slice(0, 2).join(', ')}
                                  {stepSummary.failedTitles.length > 2 ? '…' : ''}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <button
                              onClick={() => handleSelectRun(run.id)}
                              className={`rounded-lg border px-3 py-1 text-sm ${isActive
                                  ? 'border-blue-500 text-blue-700 bg-blue-100'
                                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                              {isActive ? 'Viewing' : 'View'}
                            </button>
                            {run.tracePath && (
                              <button
                                onClick={() => handleOpenTrace(run.id)}
                                className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                Trace
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {showRegenModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
            <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900">Create New AI Test</h2>
                  <p className="text-sm text-gray-500">Copies goal and success criteria into a fresh AI session.</p>
                </div>
                <button
                  onClick={() => setShowRegenModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <span aria-hidden="true">&times;</span>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">Starting URL</label>
                  <input
                    type="url"
                    value={regenUrl}
                    onChange={(e) => setRegenUrl(e.target.value)}
                    placeholder={defaultStartUrl || 'https://example.com/login'}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Max Steps</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={regenMaxSteps}
                    onChange={(e) => setRegenMaxSteps(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {regenMessage && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {regenMessage}
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  onClick={() => setShowRegenModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
                  disabled={startingGeneration}
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateFromGoal}
                  disabled={startingGeneration}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {startingGeneration ? 'Starting…' : 'Start AI Run'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CSV Import Modal */}
        <CSVImportModal
          isOpen={showCSVImport}
          onClose={() => setShowCSVImport(false)}
          variables={variables}
          onImport={handleImportCSV}
        />

        {/* Insert Step Modal */}
        {insertAfterStep !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
              <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-gray-900">
                    Insert Steps After Step {insertAfterStep}
                  </h2>
                  <button
                    onClick={handleCloseInsertModal}
                    className="text-gray-400 hover:text-gray-600"
                    disabled={initializingInsertion}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {initializingInsertion ? (
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                      <div>
                        <p className="text-sm font-medium text-blue-900">Preparing browser...</p>
                        <p className="text-xs text-blue-700">Replaying test up to step {insertAfterStep}. This may take a moment.</p>
                      </div>
                    </div>
                  </div>
                ) : insertionError ? (
                  <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm font-medium text-red-900">Failed to initialize</p>
                    <p className="text-xs text-red-700">{insertionError}</p>
                  </div>
                ) : insertionSessionId ? (
                  <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm font-medium text-green-900">✓ Browser ready</p>
                    <p className="text-xs text-green-700">Type instructions below. AI can see the current page state and will generate accurate steps.</p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">
                    Type what you want the test to do. AI will generate Playwright code for you.
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {insertedStepsPreview.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700">Generated Steps:</h3>
                    {insertedStepsPreview.map((step, index) => (
                      <div key={index} className="border border-green-200 rounded-lg p-3 bg-green-50">
                        <p className="font-medium text-gray-900">{step.qaSummary}</p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                            Show code
                          </summary>
                          <pre className="mt-2 text-xs bg-gray-900 text-green-300 p-2 rounded overflow-x-auto">
                            {step.playwrightCode}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                )}

                {insertionError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-800">{insertionError}</p>
                  </div>
                )}

                <form onSubmit={handleGenerateInsertStep} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      What should the test do?
                    </label>
                    <input
                      type="text"
                      value={insertPrompt}
                      onChange={(e) => setInsertPrompt(e.target.value)}
                      placeholder='e.g., "Click the submit button" or "Fill email field with test@example.com"'
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                      disabled={insertingSteps || !insertionSessionId || initializingInsertion}
                      autoFocus={!!insertionSessionId && !initializingInsertion}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!insertPrompt.trim() || insertingSteps || !insertionSessionId || initializingInsertion}
                    className="w-full rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {insertingSteps ? 'Generating...' : initializingInsertion ? 'Preparing browser...' : 'Generate Step'}
                  </button>
                </form>
              </div>

              <div className="p-6 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={handleCloseInsertModal}
                    className="px-4 py-2 text-gray-700 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmInsertSteps}
                    disabled={insertedStepsPreview.length === 0}
                    className="rounded-lg bg-green-600 px-6 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Insert {insertedStepsPreview.length} Step{insertedStepsPreview.length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
