import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ApiTestMetadata, ApiTest } from '../api/client';

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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function buildManualTestPayload(
  name: string,
  description: string,
  tags: string[],
  code: string
): ApiTest {
  const now = new Date().toISOString();
  const slug = slugify(name) || `manual-${Date.now()}`;
  const id = `manual-${slug}-${Date.now()}`;

  return {
    metadata: {
      id,
      name,
      description: description || undefined,
      tags: tags.length ? tags : undefined,
      createdAt: now,
      updatedAt: now
    },
    code
  };
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [generateMessageType, setGenerateMessageType] = useState<'success' | 'error' | null>(null);

  const [showManualModal, setShowManualModal] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualTags, setManualTags] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [manualMessage, setManualMessage] = useState<string | null>(null);
  const [manualMessageType, setManualMessageType] = useState<'success' | 'error' | null>(null);
  const [manualIsSaving, setManualIsSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [testToDelete, setTestToDelete] = useState<ApiTestMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadTests();
    checkHealth();
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

  function openGenerateModal() {
    setGenUrl('');
    setGenGoal('');
    setGenMaxSteps('20');
    setGenerateMessage(null);
    setGenerateMessageType(null);
    setShowGenerateModal(true);
  }

  function closeGenerateModal() {
    setShowGenerateModal(false);
    setGenUrl('');
    setGenGoal('');
    setGenMaxSteps('20');
    setIsGenerating(false);
    setGenerateMessage(null);
    setGenerateMessageType(null);
  }

  function openManualModal() {
    setManualName('');
    setManualDescription('');
    setManualTags('');
    setManualCode('');
    setManualMessage(null);
    setManualMessageType(null);
    setManualIsSaving(false);
    setShowManualModal(true);
  }

  function closeManualModal() {
    setShowManualModal(false);
    setManualMessage(null);
    setManualMessageType(null);
    setManualIsSaving(false);
  }

  async function handleRunTest(testId: string) {
    try {
      const { runId } = await api.runTest(testId);
      window.open(`/runs/${runId}?testId=${encodeURIComponent(testId)}`, '_blank');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start run';
      alert(`Unable to start run: ${message}`);
    }
  }

  async function handleRecordTest() {
    try {
      const response = await api.recordTest();
      const testId = response.testId;

      // Show instructions
      const shouldFinalize = confirm(
        `${response.message}\n\n` +
          `Instructions:\n` +
          `1. Record your test steps in the Playwright Inspector that just opened\n` +
          `2. When done, close the Inspector window\n` +
          `3. Click OK here to finalize and save your test\n\n` +
          `Click OK when you're done recording, or Cancel to finalize later.`
      );

      if (shouldFinalize && testId) {
        // Give them a moment to close the inspector
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const name = window.prompt('Give your test a name:', 'Recorded Test') || 'Recorded Test';
        const description =
          window.prompt('Add a description (optional):', 'Test recorded with Playwright Inspector') ||
          'Test recorded with Playwright Inspector';

        try {
          await api.finalizeTest(testId, {
            name,
            description,
            tags: ['recorded']
          });
          alert('Test saved successfully! Reloading...');
          await loadTests();
        } catch (finalizeErr) {
          const msg = finalizeErr instanceof Error ? finalizeErr.message : 'Failed to save test';
          alert(`Error saving test: ${msg}\nThe test file exists at: ${testId}.spec.ts`);
        }
      } else if (testId) {
        alert(
          `Recording session started.\nTest ID: ${testId}\n\nWhen done, you can finalize it manually or just refresh the page.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to launch recorder';
      alert(`Unable to launch recorder: ${message}`);
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
        maxSteps
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

  async function handleManualSubmit(runAfterSave: boolean) {
    const trimmedName = manualName.trim();
    const trimmedCode = manualCode.trim();
    const tags = manualTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    if (!trimmedName) {
      setManualMessageType('error');
      setManualMessage('Name is required.');
      return;
    }
    if (!trimmedCode) {
      setManualMessageType('error');
      setManualMessage('Please provide Playwright test code.');
      return;
    }

    const payload = buildManualTestPayload(
      trimmedName,
      manualDescription.trim(),
      tags,
      trimmedCode
    );

    try {
      setManualIsSaving(true);
      setManualMessage(null);
      setManualMessageType(null);

      await api.saveTest(payload);
      await loadTests();

      if (runAfterSave) {
        try {
          const { runId } = await api.runTest(payload.metadata.id);
          closeManualModal();
          window.open(`/runs/${runId}?testId=${encodeURIComponent(payload.metadata.id)}`, '_blank');
          return;
        } catch (runErr) {
          const message =
            runErr instanceof Error ? runErr.message : 'Saved test but failed to start run';
          setManualMessageType('error');
          setManualMessage(message);
          setManualIsSaving(false);
          return;
        }
      }

      setManualMessageType('success');
      setManualMessage(`Saved "${payload.metadata.name}"`);
      setManualIsSaving(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save test';
      setManualMessageType('error');
      setManualMessage(message);
      setManualIsSaving(false);
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

        <section className="grid gap-6 md:grid-cols-2 mb-8">
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

          <div className="bg-white rounded-lg shadow p-6 flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Generate Test Set Manually
              </h2>
              <p className="mt-2 text-gray-600">
                Record test steps with Playwright's visual inspector, or bring your own code.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleRecordTest}
                className="px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Record Test Steps
              </button>
              <button
                onClick={openManualModal}
                className="px-6 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800"
              >
                Paste Code
              </button>
            </div>
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
              No test sets yet. Generate one with AI or create a manual spec to get started.
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
                      onClick={() => handleRunTest(test.id)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 whitespace-nowrap"
                    >
                      Run &amp; Watch
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

      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-3xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Create Manual Test Set</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Paste your Playwright spec, optionally add tags, and decide whether to launch a
                  run immediately.
                </p>
              </div>
              <button
                onClick={closeManualModal}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close manual modal"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Checkout flow – guest path"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tags (comma separated)
                </label>
                <input
                  value={manualTags}
                  onChange={(e) => setManualTags(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="checkout, regression, smoke"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (optional)
                </label>
                <textarea
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  className="w-full h-20 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Short summary so teammates know where and when to use it."
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Playwright Test Code
                </label>
                <textarea
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  className="w-full h-64 px-3 py-2 font-mono text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={`import { test, expect } from '@playwright/test';

test('guest checkout', async ({ page }) => {
  await page.goto('https://acme.shop');
  // ...
});`}
                />
              </div>
            </div>

            {manualMessage && (
              <p
                className={`mt-3 text-sm ${
                  manualMessageType === 'success'
                    ? 'text-green-600'
                    : manualMessageType === 'error'
                      ? 'text-red-600'
                      : 'text-gray-600'
                }`}
              >
                {manualMessage}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={closeManualModal}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleManualSubmit(false)}
                disabled={manualIsSaving}
                className="px-5 py-2 bg-slate-200 text-gray-800 rounded-lg hover:bg-slate-300 disabled:opacity-50"
              >
                {manualIsSaving ? 'Saving…' : 'Save Test Set'}
              </button>
              <button
                onClick={() => handleManualSubmit(true)}
                disabled={manualIsSaving}
                className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {manualIsSaving ? 'Saving…' : 'Save & Run'}
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
