import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type {
  ApiTest,
  ApiTestMetadata,
  RunStreamEvent,
  RunControlAction,
  ApiCredential
} from '../api/client';
import type {
  LiveRunState,
  RunLogEntry,
  StepSummary,
  RunStatus,
  ChatMessage,
  RunResult,
  RunScreenshot
} from '../../../shared/types';
import { SCREEN_SIZE_PRESETS } from '../constants/screenSizes';

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
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenUrl, setRegenUrl] = useState('');
  const [regenMaxSteps, setRegenMaxSteps] = useState('20');
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [startingGeneration, setStartingGeneration] = useState(false);
  const [defaultStartUrl, setDefaultStartUrl] = useState('');

  const refreshRuns = useCallback(async () => {
    if (!testId) return;
    try {
      const { runs } = await api.listRuns(testId);
      setRuns(runs);
    } catch (err) {
      console.error('Failed to refresh runs', err);
    }
  }, [testId]);

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

      const { runId } = await api.runTest(testId, { headed, speed, keepBrowserOpen, viewportSize });
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
    try {
      const { run } = await api.getRun(runId);
      setRunState(run);
    } catch (err) {
      console.warn('Unable to load run details', err);
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

  async function handleOpenTrace() {
    if (!activeRunId) return;
    try {
      await api.openTrace(activeRunId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to open Playwright trace';
      setError(message);
    }
  }

  const logItems = useMemo(() => runState?.logs ?? [], [runState?.logs]);
  const chatItems = useMemo(() => runState?.chat ?? [], [runState?.chat]);
  const orderedSteps = useMemo(() => {
    if (!runState?.steps) {
      return [] as StepSummary[];
    }
    return [...runState.steps].sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return aTime - bTime;
    });
  }, [runState?.steps]);
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

  const currentStatus: RunStatus = runState?.status ?? 'queued';
  const testTitle = name || test?.metadata.name || 'Test Workspace';

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
            <div className="rounded-lg bg-white p-6 shadow">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">{testTitle}</h1>
                  <p className="text-sm text-gray-500">Prompt, run, and review in one window.</p>
                </div>
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${statusStyles[currentStatus]}`}
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
                  {statusLabels[currentStatus]}
                </span>
              </div>

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

              <div className="mt-4 space-y-2">
                <label className="text-sm font-medium text-gray-700">Success Criteria</label>
                <textarea
                  value={successCriteria}
                  readOnly
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600"
                />
              </div>

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
            </div>

            <div className="rounded-lg bg-white p-6 shadow">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Live Run</h2>
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
                      onClick={handleOpenTrace}
                      disabled={!runState?.result?.tracePath}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 disabled:opacity-40"
                    >
                      Open Trace
                    </button>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-gray-500">Timeline</h3>
                      <div className="mt-2 space-y-2">
                        {orderedSteps.length === 0 && (
                          <p className="text-sm text-gray-500">No steps recorded yet.</p>
                        )}
                        {orderedSteps.map((step) => (
                          <div
                            key={step.id}
                            className={`rounded-lg border px-3 py-2 text-sm ${stepStatusStyles[step.status] || ''}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-900">{step.title}</span>
                              <span className="text-xs text-gray-600">{formatTimestamp(step.startedAt)}</span>
                            </div>
                            {step.error && (
                              <p className="mt-2 text-xs text-red-600">{step.error}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-gray-500">Logs</h3>
                      <div
                        ref={logsRef}
                        className="mt-2 h-48 overflow-y-auto rounded-lg border bg-gray-50 p-3 text-xs font-mono text-gray-700"
                      >
                        {logItems.length === 0 && <p className="text-gray-500">No output yet…</p>}
                        {logItems.map((log) => (
                          <div key={log.id} className="mb-1">
                            <span className="text-gray-400">[{formatTimestamp(log.timestamp)}]</span>{' '}
                            <span className="uppercase text-gray-500">{log.stream}</span>: {log.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold uppercase text-gray-500">Screenshot Timeline</h3>
                    {screenshotDetails.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-500">
                        No screenshots captured for this run.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {screenshotDetails.map((shot, index) => (
                          <div
                            key={`${shot.path}-${index}`}
                            className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-900">
                                {shot.stepTitle || `Screenshot ${index + 1}`}
                              </p>
                              {shot.testTitle && (
                                <p className="text-xs text-gray-500">{shot.testTitle}</p>
                              )}
                              {shot.capturedAt && (
                                <p className="text-xs text-gray-400">
                                  {formatTimestamp(shot.capturedAt)}
                                </p>
                              )}
                              <a
                                href={shot.path}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-blue-600 hover:text-blue-800"
                              >
                                Open full size →
                              </a>
                            </div>
                            <a
                              href={shot.path}
                              target="_blank"
                              rel="noreferrer"
                              className="block overflow-hidden rounded-lg border border-gray-200"
                            >
                              <img
                                src={shot.path}
                                alt={shot.stepTitle || `Run screenshot ${index + 1}`}
                                className="h-28 w-40 object-cover"
                                loading="lazy"
                              />
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold uppercase text-gray-500">Ask the assistant</h3>
                    <form className="mt-2 flex gap-2" onSubmit={handleSendChat}>
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Ask why a step failed, how to harden the test, etc."
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        type="submit"
                        disabled={sendingChat || !activeRunId}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-40"
                      >
                        {sendingChat ? 'Sending…' : 'Send'}
                      </button>
                    </form>
                    <div
                      ref={chatRef}
                      className="mt-3 max-h-40 overflow-y-auto rounded-lg border bg-gray-50 p-3 text-sm text-gray-800"
                    >
                      {chatItems.length === 0 && (
                        <p className="text-gray-500">AI responses will appear here.</p>
                      )}
                      {chatItems.map((msg) => (
                        <div key={msg.id} className="mb-2">
                          <p className="text-xs uppercase text-gray-500">{msg.role}</p>
                          <p>{msg.message}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-gray-600">
                  Start a run to see live steps, logs, and AI assistance.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
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
            </div>

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
                <div className="mt-4 space-y-3">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                    >
                      <div>
                        <p className="font-medium text-gray-900">{formatTimestamp(run.startedAt)}</p>
                        <p className="text-sm text-gray-500">
                          {statusLabels[run.status as RunStatus] || run.status} · {formatDuration(run.duration)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleSelectRun(run.id)}
                        className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        View
                      </button>
                    </div>
                  ))}
                </div>
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
      </div>
    </div>
  );
}
