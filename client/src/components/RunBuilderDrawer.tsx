/**
 * Run Builder Drawer
 *
 * A slide-out panel for configuring multi-test runs with:
 * - Test ordering (drag to reorder)
 * - Per-test step selection
 * - Run options (headed mode, speed, browser reuse, etc.)
 */

import { useState, useEffect, useCallback } from 'react';
import type { ApiTestMetadata } from '../api/client';
import { api } from '../api/client';
import type { QueuedTest, RunConfiguration, ExtractedStep } from '../../../shared/types';

interface RunBuilderDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTests: ApiTestMetadata[];
  onStartRun: (configId: string) => void;
}

interface TestWithSteps {
  test: ApiTestMetadata;
  steps: ExtractedStep[];
  loadingSteps: boolean;
}

export default function RunBuilderDrawer({
  isOpen,
  onClose,
  selectedTests,
  onStartRun
}: RunBuilderDrawerProps) {
  // Test queue state
  const [testsWithSteps, setTestsWithSteps] = useState<TestWithSteps[]>([]);
  const [enabledTests, setEnabledTests] = useState<Set<string>>(new Set());
  const [startFromStep, setStartFromStep] = useState<Record<string, number>>({});

  // Run options
  const [headed, setHeaded] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [reusesBrowser, setReusesBrowser] = useState(false);
  const [stopOnFailure, setStopOnFailure] = useState(false);

  // UI state
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize tests when drawer opens
  useEffect(() => {
    if (isOpen && selectedTests.length > 0) {
      const initial = selectedTests.map((test) => ({
        test,
        steps: [] as ExtractedStep[],
        loadingSteps: true
      }));
      setTestsWithSteps(initial);
      setEnabledTests(new Set(selectedTests.map((t) => t.id)));
      setStartFromStep({});
      setError(null);

      // Load steps for each test
      selectedTests.forEach((test) => {
        api.getTestSteps(test.id).then(({ steps }) => {
          setTestsWithSteps((prev) =>
            prev.map((item) =>
              item.test.id === test.id
                ? { ...item, steps, loadingSteps: false }
                : item
            )
          );
        }).catch(() => {
          setTestsWithSteps((prev) =>
            prev.map((item) =>
              item.test.id === test.id
                ? { ...item, steps: [], loadingSteps: false }
                : item
            )
          );
        });
      });
    }
  }, [isOpen, selectedTests]);

  // Move test up in order
  const moveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setTestsWithSteps((prev) => {
      const newList = [...prev];
      [newList[index - 1], newList[index]] = [newList[index], newList[index - 1]];
      return newList;
    });
  }, []);

  // Move test down in order
  const moveDown = useCallback((index: number) => {
    setTestsWithSteps((prev) => {
      if (index >= prev.length - 1) return prev;
      const newList = [...prev];
      [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];
      return newList;
    });
  }, []);

  // Toggle test enabled/disabled
  const toggleEnabled = useCallback((testId: string) => {
    setEnabledTests((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(testId)) {
        newSet.delete(testId);
      } else {
        newSet.add(testId);
      }
      return newSet;
    });
  }, []);

  // Update start from step for a test
  const updateStartStep = useCallback((testId: string, step: number) => {
    setStartFromStep((prev) => ({ ...prev, [testId]: step }));
  }, []);

  // Start the multi-run
  const handleStartRun = async () => {
    setStarting(true);
    setError(null);

    try {
      const config: RunConfiguration = {
        tests: testsWithSteps
          .map((item, index): QueuedTest => ({
            testId: item.test.id,
            testName: item.test.name,
            order: index,
            startFromStep: startFromStep[item.test.id] || 0,
            enabled: enabledTests.has(item.test.id)
          })),
        options: {
          headed,
          speed,
          reusesBrowser,
          stopOnFailure
        }
      };

      const { configId } = await api.startMultiRun(config);
      onStartRun(configId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      setStarting(false);
    }
  };

  const enabledCount = testsWithSteps.filter((t) => enabledTests.has(t.test.id)).length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative ml-auto w-full max-w-lg bg-white shadow-xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-900">Run Builder</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Run Options */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Run Options</h3>
            <div className="space-y-3 bg-gray-50 rounded-lg p-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={headed}
                  onChange={(e) => setHeaded(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-700">Headed mode (visible browser)</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={reusesBrowser}
                  onChange={(e) => setReusesBrowser(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-700">Reuse browser between tests</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={stopOnFailure}
                  onChange={(e) => setStopOnFailure(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-700">Stop on first failure</span>
              </label>

              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-700">Speed:</span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={speed}
                  onChange={(e) => setSpeed(parseFloat(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm text-gray-600 w-12">{speed.toFixed(1)}x</span>
              </div>
            </div>
          </div>

          {/* Test Queue */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Test Queue ({enabledCount} of {testsWithSteps.length} enabled)
            </h3>
            <div className="space-y-2">
              {testsWithSteps.map((item, index) => (
                <div
                  key={item.test.id}
                  className={`rounded-lg border p-3 ${
                    enabledTests.has(item.test.id)
                      ? 'border-gray-200 bg-white'
                      : 'border-gray-100 bg-gray-50 opacity-60'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        title="Move up"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => moveDown(index)}
                        disabled={index === testsWithSteps.length - 1}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                        title="Move down"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>

                    {/* Enable checkbox */}
                    <input
                      type="checkbox"
                      checked={enabledTests.has(item.test.id)}
                      onChange={() => toggleEnabled(item.test.id)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600"
                    />

                    {/* Test info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-500">{index + 1}.</span>
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {item.test.name}
                        </span>
                      </div>

                      {/* Step selector */}
                      <div className="mt-2">
                        <label className="text-xs text-gray-500">Start from:</label>
                        <select
                          value={startFromStep[item.test.id] || 0}
                          onChange={(e) => updateStartStep(item.test.id, parseInt(e.target.value))}
                          disabled={!enabledTests.has(item.test.id)}
                          className="ml-2 text-xs rounded border border-gray-200 px-2 py-1"
                        >
                          <option value={0}>Beginning</option>
                          {item.loadingSteps ? (
                            <option disabled>Loading steps...</option>
                          ) : (
                            item.steps.map((step) => (
                              <option key={step.number} value={step.number}>
                                Step {step.number}: {step.title.slice(0, 40)}
                                {step.title.length > 40 ? '...' : ''}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4">
          {error && (
            <p className="mb-3 text-sm text-red-600">{error}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleStartRun}
              disabled={starting || enabledCount === 0}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {starting ? 'Starting...' : `Start Run (${enabledCount} test${enabledCount === 1 ? '' : 's'})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
