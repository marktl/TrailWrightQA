import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type {
  LiveRunState,
  RunLogEntry,
  StepSummary,
  ChatMessage,
  RunStatus
} from '../../../shared/types';
import type { ApiTestMetadata } from '../api/client';
import type { RunStreamEvent, RunControlAction } from '../api/client';

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

export default function RunSession() {
  const navigate = useNavigate();
  const { runId } = useParams();
  const [searchParams] = useSearchParams();
  const seededTestId = searchParams.get('testId');

  const [run, setRun] = useState<LiveRunState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testMetadata, setTestMetadata] = useState<ApiTestMetadata | null>(null);
  const [pendingAction, setPendingAction] = useState<RunControlAction | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  const logsRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runId) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    api
      .getRun(runId)
      .then(({ run: state }) => {
        if (!cancelled) {
          setRun(state);
          setLoading(false);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Unable to load run details. Try refreshing.';
          setError(message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    const testId = run?.testId || seededTestId;
    if (!testId) {
      return;
    }

    let cancelled = false;

    api
      .getTest(testId)
      .then(({ test }) => {
        if (!cancelled) {
          setTestMetadata(test.metadata);
        }
      })
      .catch(() => {
        // Non-fatal: the test might have been deleted externally
      });

    return () => {
      cancelled = true;
    };
  }, [run?.testId, seededTestId]);

  const handleStreamEvent = useCallback((event: RunStreamEvent) => {
    setRun((current) => {
      if (event.type === 'hydrate') {
        setLoading(false);
        setError(null);
        return event.payload;
      }

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
          return {
            ...current,
            logs,
            updatedAt: event.payload.timestamp
          };
        }
        case 'step': {
          const steps = [...current.steps];
          const existingIndex = steps.findIndex((step) => step.id === event.payload.id);
          if (existingIndex >= 0) {
            steps[existingIndex] = { ...steps[existingIndex], ...event.payload };
          } else {
            steps.unshift(event.payload);
          }
          return {
            ...current,
            steps,
            updatedAt: event.payload.endedAt || event.payload.startedAt || current.updatedAt
          };
        }
        case 'chat': {
          const chat = [...current.chat, event.payload];
          if (chat.length > 200) {
            chat.splice(0, chat.length - 200);
          }
          return {
            ...current,
            chat,
            updatedAt: event.payload.timestamp
          };
        }
        case 'result':
          return {
            ...current,
            result: event.payload,
            updatedAt: event.payload.endedAt
          };
        case 'error':
          setError(event.payload.message);
          return {
            ...current,
            updatedAt: event.payload.timestamp
          };
        default:
          return current;
      }
    });
  }, []);

  useEffect(() => {
    if (!runId) {
      return;
    }

    const source = api.connectToRunStream(runId, handleStreamEvent);
    return () => {
      source.close();
    };
  }, [runId, handleStreamEvent]);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [run?.logs]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [run?.chat]);

  const currentStatus = run?.status ?? 'queued';
  const canControl = currentStatus === 'running' || currentStatus === 'paused';

  const stepGroups = useMemo(() => run?.steps ?? [], [run?.steps]);
  const logItems = useMemo(() => run?.logs ?? [], [run?.logs]);
  const chatItems = useMemo(() => run?.chat ?? [], [run?.chat]);

  const testTitle = testMetadata?.name || run?.testId || 'Test Run';

  const runSummary = useMemo(() => {
    if (!run) {
      return '';
    }
    if (run.result) {
      const duration = formatDuration(run.result.duration);
      const finished = formatTimestamp(run.result.endedAt);
      return `Finished ${run.result.status.toUpperCase()} · ${duration} · ${finished}`;
    }
    return `Started ${formatTimestamp(run.startedAt)}`;
  }, [run]);

  async function handleControl(action: RunControlAction) {
    if (!runId) return;
    setPendingAction(action);
    try {
      await api.controlRun(runId, action);
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
    if (!runId) return;
    const trimmed = chatInput.trim();
    if (!trimmed) return;

    try {
      setSendingChat(true);
      setError(null);
      await api.sendRunChat(runId, trimmed);
      setChatInput('');
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

  async function handleOpenTrace() {
    if (!runId) return;
    try {
      await api.openTrace(runId);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to open Playwright trace for this run.';
      setError(message);
    }
  }

  if (!runId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-lg text-center">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Run not specified</h1>
          <p className="text-gray-600">
            The requested run could not be identified. Return to the{' '}
            <button
              onClick={() => navigate('/')}
              className="text-blue-600 hover:underline"
            >
              dashboard
            </button>{' '}
            to start a new session.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{testTitle}</h1>
            {testMetadata?.description && (
              <p className="mt-1 text-gray-600">{testMetadata.description}</p>
            )}
            {runSummary && <p className="mt-1 text-sm text-gray-500">{runSummary}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${statusStyles[currentStatus]}`}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-current opacity-70" />
              {statusLabels[currentStatus]}
            </span>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-gray-600">
            Connecting to live run telemetry…
          </div>
        )}

        {!loading && !run && !error && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-gray-600">
            Unable to locate run details. The run may have expired or been removed.
          </div>
        )}

        {run && (
          <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <button
                    onClick={() => handleControl('resume')}
                    disabled={
                      currentStatus !== 'paused' || pendingAction !== null || !canControl
                    }
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Resume
                  </button>
                  <button
                    onClick={() => handleControl('pause')}
                    disabled={
                      currentStatus !== 'running' || pendingAction !== null || !canControl
                    }
                    className="px-4 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Pause
                  </button>
                  <button
                    onClick={() => handleControl('stop')}
                    disabled={currentStatus === 'stopped' || pendingAction !== null || !canControl}
                    className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Stop
                  </button>
                  {run.result?.tracePath && (
                    <button
                      onClick={handleOpenTrace}
                      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                    >
                      Open Playwright Trace
                    </button>
                  )}
                </div>

                <div className="rounded-md bg-gray-900 text-green-200 font-mono text-sm h-64 overflow-y-auto p-4">
                  <div ref={logsRef}>
                    {logItems.length === 0 ? (
                      <p className="text-gray-400">Awaiting log output…</p>
                    ) : (
                      logItems.map((log: RunLogEntry) => (
                        <div key={log.id} className="whitespace-pre-wrap">
                          <span className="text-gray-500">
                            [{formatTimestamp(log.timestamp)}]
                          </span>{' '}
                          {log.message}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Live Step Summary</h2>
                {stepGroups.length === 0 ? (
                  <p className="text-gray-500">Waiting for step activity…</p>
                ) : (
                  <div className="space-y-3">
                    {stepGroups.map((step: StepSummary) => (
                      <div
                        key={step.id}
                        className={`rounded-lg border-l-4 px-4 py-3 ${stepStatusStyles[step.status]}`}
                        style={{ marginLeft: `${step.depth * 12}px` }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-gray-900">{step.title}</p>
                          <span className="text-xs uppercase tracking-wide text-gray-600">
                            {step.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-3">
                          <span>Started {formatTimestamp(step.startedAt)}</span>
                          {step.endedAt && <span>Ended {formatTimestamp(step.endedAt)}</span>}
                          {step.category && <span>{step.category}</span>}
                        </div>
                        {step.error && (
                          <p className="mt-2 text-sm text-red-700">{step.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">AI Copilot</h2>
                <div
                  ref={chatRef}
                  className="h-64 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50"
                >
                  {chatItems.length === 0 ? (
                    <p className="text-gray-500 text-sm">
                      Ask the AI to adjust selectors, add assertions, or suggest alternate paths.
                    </p>
                  ) : (
                    chatItems.map((message: ChatMessage) => (
                      <div key={message.id} className="mb-4">
                        <div className="text-xs text-gray-500 mb-1">
                          {message.role === 'assistant'
                            ? 'AI Copilot'
                            : message.role === 'user'
                              ? 'You'
                              : 'System'}{' '}
                          · {formatTimestamp(message.timestamp)}
                        </div>
                        <div className="text-sm text-gray-800 whitespace-pre-wrap">
                          {message.message}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <form onSubmit={handleSendChat} className="mt-4 flex gap-2">
                  <input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={sendingChat || !run || run.status === 'completed' || run.status === 'failed' || run.status === 'stopped'}
                    placeholder="Ask the AI to adjust the run or suggest a new assertion…"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled={
                      sendingChat ||
                      !chatInput.trim() ||
                      !run ||
                      run.status === 'completed' ||
                      run.status === 'failed' ||
                      run.status === 'stopped'
                    }
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sendingChat ? 'Sending…' : 'Send'}
                  </button>
                </form>
              </div>

              {testMetadata?.tags && testMetadata.tags.length > 0 && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-3">Tags</h2>
                  <div className="flex flex-wrap gap-2">
                    {testMetadata.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
