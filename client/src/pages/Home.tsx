import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ApiTestMetadata } from '../api/client';

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function formatTimestamp(iso?: string) {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return dateFormatter.format(date);
}

export default function Home() {
  const navigate = useNavigate();
  const [tests, setTests] = useState<ApiTestMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [healthStatus, setHealthStatus] = useState<'ok' | 'error' | null>(null);

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [genUrl, setGenUrl] = useState('');
  const [genGoal, setGenGoal] = useState('');
  const [genMaxSteps, setGenMaxSteps] = useState('20');
  const [genSuccessCriteria, setGenSuccessCriteria] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [generateMessageType, setGenerateMessageType] = useState<'success' | 'error' | null>(null);
  const [defaultStartUrl, setDefaultStartUrl] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [testToDelete, setTestToDelete] = useState<ApiTestMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showRunOptions, setShowRunOptions] = useState(false);
  const [testToRun, setTestToRun] = useState<ApiTestMetadata | null>(null);
  const [runHeaded, setRunHeaded] = useState(true);
  const [runSpeed, setRunSpeed] = useState(1);
  const [runIsStarting, setRunIsStarting] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  useEffect(() => {
    loadTests();
    checkHealth();
    loadConfig();
  }, []);

  async function loadTests() {
    try {
      setLoading(true);
      const { tests: data } = await api.listTests();
      const sorted = [...data].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setTests(sorted);
    } catch (err) {
      console.error('Failed to load tests:', err);
    } finally {
      setLoading(false);
    }
  }

  async function checkHealth() {
    try {
      await api.healthCheck();
      setHealthStatus('ok');
    } catch (err) {
      console.error('Health check failed:', err);
      setHealthStatus('error');
    }
  }

  async function loadConfig() {
    try {
      const config = await api.getConfig();
      setDefaultStartUrl(config?.defaultStartUrl || '');
    } catch (err) {
      console.error('Failed to load config:', err);
      setDefaultStartUrl('');
    }
  }

  function openGenerateModal() {
    setGenUrl(defaultStartUrl || '');
    setGenGoal('');
    setGenMaxSteps('20');
    setGenSuccessCriteria('');
    setGenerateMessage(null);
    setGenerateMessageType(null);
    setShowGenerateModal(true);
  }

  function closeGenerateModal() {
    setShowGenerateModal(false);
    setGenUrl('');
    setGenGoal('');
    setGenMaxSteps('20');
    setGenSuccessCriteria('');
    setIsGenerating(false);
    setGenerateMessage(null);
    setGenerateMessageType(null);
  }

  function openRunOptions(test: ApiTestMetadata) {
    setTestToRun(test);
    setRunHeaded(true);
    setRunSpeed(1);
    setRunMessage(null);
    setRunIsStarting(false);
    setShowRunOptions(true);
  }

  function closeRunOptions() {
    setShowRunOptions(false);
    setTestToRun(null);
    setRunIsStarting(false);
    setRunMessage(null);
  }

  async function launchRunWithOptions() {
    const selectedTest = testToRun;
    if (!selectedTest) {
      return;
    }

    setRunIsStarting(true);
    setRunMessage(null);

    try {
      const { runId } = await api.runTest(selectedTest.id, {
        headed: runHeaded,
        speed: runSpeed
      });

      closeRunOptions();
      window.open(`/runs/${runId}?testId=${encodeURIComponent(selectedTest.id)}`, '_blank');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start run';
      setRunMessage(message);
    } finally {
      setRunIsStarting(false);
    }
  }

  async function handleEditTest(testId: string) {
    try {
      const response = await api.editTest(testId);
      alert(response.message || 'Playwright Inspector launched for editing.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to launch inspector';
      alert(`Unable to launch inspector: ${message}`);
    }
  }

  async function handleGenerateTest() {
    const trimmedUrl = genUrl.trim();
    const trimmedGoal = genGoal.trim();
    const trimmedCriteria = genSuccessCriteria.trim();
    const maxSteps = parseInt(genMaxSteps) || 20;

    if (!trimmedUrl || !trimmedGoal || isGenerating) {
      setGenerateMessageType('error');
      setGenerateMessage('Please provide both URL and goal');
      return;
    }

    setIsGenerating(true);
    setGenerateMessage(null);
    setGenerateMessageType(null);

    try {
      const { sessionId } = await api.startGeneration({
        startUrl: trimmedUrl,
        goal: trimmedGoal,
        maxSteps,
        successCriteria: trimmedCriteria || undefined
      });

      closeGenerateModal();
      // Open live generation viewer in new tab
      window.open(`/generate/${sessionId}`, '_blank');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start generation';
      setGenerateMessageType('error');
      setGenerateMessage(message);
    } finally {
      setIsGenerating(false);
    }
  }

  function openDeleteModal(test: ApiTestMetadata) {
    setTestToDelete(test);
    setShowDeleteModal(true);
  }

  function closeDeleteModal() {
    setShowDeleteModal(false);
    setTestToDelete(null);
    setIsDeleting(false);
  }

  async function confirmDelete() {
    if (!testToDelete) return;

    setIsDeleting(true);
    try {
      await api.deleteTest(testToDelete.id);
      await loadTests();
      closeDeleteModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete test';
      alert(`Unable to delete test: ${message}`);
      setIsDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
          <h1 className="text-4xl font-bold text-gray-900">TrailWright QA</h1>
          <button
            onClick={() => navigate('/settings')}
            className="px-4 py-2 text-gray-600 hover:text-gray-900"
          >
            Settings
          </button>
        </header>

        <section className="grid gap-6 md:grid-cols-1 mb-8">
          <div className="bg-white rounded-lg shadow p-6 flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Generate Test Set with AI
              </h2>
              <p className="mt-2 text-gray-600">
                Describe the workflow and TrailWright will draft a Playwright spec, launch the run,
                and stream live progress.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={openGenerateModal}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Generate with AI
              </button>
              <button
                onClick={() => navigate('/settings')}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Configure Provider
              </button>
            </div>
            {healthStatus === 'error' && (
              <p className="text-sm text-red-600">
                Unable to reach the backend API. Ensure the TrailWright server is running.
              </p>
            )}
          </div>

        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Recent Test Sets</h2>
            <span className="text-sm text-gray-500">{tests.length} total</span>
          </div>

          {loading ? (
            <p className="text-gray-500" data-testid="tests-loading">
              Loading test library…
            </p>
          ) : tests.length === 0 ? (
            <p className="text-gray-500" data-testid="tests-empty">
              No test sets yet. Generate one with AI to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {tests.map((test) => (
                <div
                  key={test.id}
                  className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-medium text-gray-900 truncate">{test.name}</h3>
                      <span className="text-xs text-gray-500">
                        Created {formatTimestamp(test.createdAt)}
                      </span>
                    </div>
                    {test.description && (
                      <p className="mt-2 text-sm text-gray-600 line-clamp-2">{test.description}</p>
                    )}
                    {test.tags && test.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {test.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => openRunOptions(test)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 whitespace-nowrap"
                    >
                      Run/Edit
                    </button>
                    <button
                      onClick={() => handleEditTest(test.id)}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
                      aria-label="Edit test"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => openDeleteModal(test)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 whitespace-nowrap"
                      aria-label="Delete test"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">AI Live Test Generation</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Watch AI build your test step-by-step in real-time
                </p>
              </div>
              <button
                onClick={closeGenerateModal}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close generate test modal"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Starting URL *
                </label>
                <input
                  type="url"
                  value={genUrl}
                  onChange={(e) => setGenUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com/login"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Goal / What to test *
                </label>
                <textarea
                  value={genGoal}
                  onChange={(e) => setGenGoal(e.target.value)}
                  className="w-full h-24 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Example: You are Jennifer Test_Physician. Register with the Oregon Medical Board for an MD Active License. Your SSN starts with 123 and you can make up any needed data."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Success Criteria (optional)
                </label>
                <textarea
                  value={genSuccessCriteria}
                  onChange={(e) => setGenSuccessCriteria(e.target.value)}
                  className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Example: Dashboard greets the logged-in doctor by name and shows active license card."
                />
                <p className="mt-1 text-xs text-gray-500">
                  Describe what success looks like so the AI knows when to stop.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Steps (default: 20)
                </label>
                <input
                  type="number"
                  value={genMaxSteps}
                  onChange={(e) => setGenMaxSteps(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="1"
                  max="50"
                />
              </div>
            </div>

            {generateMessage && (
              <p
                className={`mt-3 text-sm ${
                  generateMessageType === 'success'
                    ? 'text-green-600'
                    : generateMessageType === 'error'
                      ? 'text-red-600'
                      : 'text-gray-600'
                }`}
              >
                {generateMessage}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeGenerateModal}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateTest}
                disabled={!genUrl.trim() || !genGoal.trim() || isGenerating}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? 'Starting…' : 'Start AI Generation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRunOptions && testToRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Run Options</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Adjust playback preferences for <span className="font-medium">{testToRun.name}</span>.
                </p>
              </div>
              <button
                onClick={closeRunOptions}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close run options"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            <div className="space-y-5">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={runHeaded}
                  onChange={(e) => setRunHeaded(e.target.checked)}
                  className="rounded"
                />
                Show browser window during run (headed mode)
              </label>

              <div>
                <div className="flex items-center justify-between text-sm text-gray-700">
                  <span>Playback speed</span>
                  <span className="font-medium text-gray-900">
                    {Number.isInteger(runSpeed) ? `${runSpeed}x` : `${runSpeed.toFixed(1)}x`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.5"
                  value={runSpeed}
                  onChange={(e) => setRunSpeed(parseFloat(e.target.value))}
                  className="w-full mt-2"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Slower</span>
                  <span>Normal</span>
                  <span>Faster</span>
                </div>
              </div>

              {runMessage && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {runMessage}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeRunOptions}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                disabled={runIsStarting}
              >
                Cancel
              </button>
              <button
                onClick={launchRunWithOptions}
                disabled={runIsStarting}
                className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {runIsStarting ? 'Starting…' : 'Start Run'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && testToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Delete Test Set</h2>
              <p className="text-sm text-gray-600 mt-2">
                Are you sure you want to delete "{testToDelete.name}"? This action cannot be undone.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={closeDeleteModal}
                disabled={isDeleting}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
