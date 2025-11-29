/**
 * Multi-Run Progress Component
 *
 * Shows real-time progress of a multi-test run with:
 * - Overall progress bar
 * - Status of each test (pending/running/passed/failed/skipped)
 * - Controls (pause/resume/stop/skip)
 */

import { useState, useEffect, useCallback } from 'react';
import { api, type MultiRunStreamEvent } from '../api/client';
import type { MultiRunState, QueuedTestWithState } from '../../../shared/types';

interface MultiRunProgressProps {
  configId: string;
  onClose: () => void;
  onViewRun?: (runId: string) => void;
}

const statusIcons: Record<string, string> = {
  pending: '⏳',
  running: '🔄',
  passed: '✅',
  failed: '❌',
  skipped: '⏭️'
};

const statusColors: Record<string, string> = {
  pending: 'text-gray-400',
  running: 'text-blue-600',
  passed: 'text-emerald-600',
  failed: 'text-red-600',
  skipped: 'text-orange-500'
};

export default function MultiRunProgress({
  configId,
  onClose,
  onViewRun
}: MultiRunProgressProps) {
  const [state, setState] = useState<MultiRunState | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);

  // Connect to SSE stream
  useEffect(() => {
    const eventSource = api.connectToMultiRunStream(configId, (event: MultiRunStreamEvent) => {
      if (event.type === 'hydrate') {
        setState(event.payload);
        setConnected(true);
      } else if (event.type === 'status') {
        setState((prev) => prev ? { ...prev, status: event.payload.status } : null);
      } else if (event.type === 'test_start' || event.type === 'test_complete') {
        // Refresh full state on test events
        api.getMultiRunState(configId)
          .then(({ multiRun }) => setState(multiRun))
          .catch(() => {});
      } else if (event.type === 'progress') {
        setState((prev) => prev ? { ...prev, currentTestIndex: event.payload.currentTestIndex } : null);
      }
    });

    return () => {
      eventSource.close();
    };
  }, [configId]);

  // Control actions
  const handleControl = useCallback(async (action: 'pause' | 'resume' | 'stop' | 'skip') => {
    setControlling(true);
    try {
      await api.controlMultiRun(configId, action);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Control action failed');
    } finally {
      setControlling(false);
    }
  }, [configId]);

  if (!connected || !state) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
        <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
          <p className="text-gray-600">Connecting to multi-run...</p>
        </div>
      </div>
    );
  }

  const completedCount = state.tests.filter(
    (t) => t.status === 'passed' || t.status === 'failed' || t.status === 'skipped'
  ).length;
  const totalCount = state.tests.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isRunning = state.status === 'running';
  const isPaused = state.status === 'paused';
  const isFinished = state.status === 'completed' || state.status === 'stopped';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-900">Multi-Test Run</h2>
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${
                state.status === 'running'
                  ? 'bg-blue-100 text-blue-700'
                  : state.status === 'paused'
                  ? 'bg-yellow-100 text-yellow-700'
                  : state.status === 'completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : state.status === 'stopped'
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {state.status.toUpperCase()}
            </span>
            {isFinished && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">
              Progress: {completedCount} of {totalCount} tests
            </span>
            <span className="text-sm font-medium text-gray-900">{progressPercent}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Test List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-2">
            {state.tests.map((test, index) => (
              <TestRow
                key={test.testId}
                test={test}
                index={index}
                isCurrent={index === state.currentTestIndex && isRunning}
                onViewRun={onViewRun}
              />
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="border-t px-6 py-4">
          {error && (
            <p className="mb-3 text-sm text-red-600">{error}</p>
          )}
          <div className="flex gap-3">
            {!isFinished && (
              <>
                {isPaused ? (
                  <button
                    onClick={() => handleControl('resume')}
                    disabled={controlling}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    onClick={() => handleControl('pause')}
                    disabled={controlling}
                    className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
                  >
                    Pause
                  </button>
                )}
                <button
                  onClick={() => handleControl('skip')}
                  disabled={controlling || !isRunning}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  title="Skip current test"
                >
                  Skip
                </button>
                <button
                  onClick={() => handleControl('stop')}
                  disabled={controlling}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  Stop
                </button>
              </>
            )}
            {isFinished && (
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface TestRowProps {
  test: QueuedTestWithState;
  index: number;
  isCurrent: boolean;
  onViewRun?: (runId: string) => void;
}

function TestRow({ test, index, isCurrent, onViewRun }: TestRowProps) {
  const durationStr = test.duration
    ? `${Math.round(test.duration / 1000)}s`
    : '--:--';

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg ${
        isCurrent ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
      }`}
    >
      <span className={`text-lg ${statusColors[test.status]}`}>
        {statusIcons[test.status]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-500">{index + 1}.</span>
          <span className="text-sm font-medium text-gray-900 truncate">
            {test.testName}
          </span>
        </div>
        {test.error && (
          <p className="mt-1 text-xs text-red-600 truncate">{test.error}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{durationStr}</span>
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded ${
            test.status === 'passed'
              ? 'bg-emerald-100 text-emerald-700'
              : test.status === 'failed'
              ? 'bg-red-100 text-red-700'
              : test.status === 'running'
              ? 'bg-blue-100 text-blue-700'
              : test.status === 'skipped'
              ? 'bg-orange-100 text-orange-700'
              : 'bg-gray-100 text-gray-600'
          }`}
        >
          {test.status.toUpperCase()}
        </span>
        {test.runId && onViewRun && (
          <button
            onClick={() => onViewRun(test.runId!)}
            className="text-xs text-blue-600 hover:underline"
          >
            View
          </button>
        )}
      </div>
    </div>
  );
}
