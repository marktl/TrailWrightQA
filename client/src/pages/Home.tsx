import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
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

  const [defaultStartUrl, setDefaultStartUrl] = useState('');
  const [providerStatus, setProviderStatus] = useState<{ provider: string; configured: boolean } | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [testToDelete, setTestToDelete] = useState<ApiTestMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setProviderStatus({
        provider: config?.apiProvider || 'anthropic',
        configured: Boolean(config?.apiKey && String(config.apiKey).startsWith('***'))
      });
    } catch (err) {
      console.error('Failed to load config:', err);
      setDefaultStartUrl('');
      setProviderStatus(null);
    }
  }

  async function handleExportTest(testId: string) {
    try {
      const blob = await api.exportTest(testId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${testId}-trailwright-export.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export test';
      alert(message);
    }
  }

  function handleImportClick() {
    setImportMessage(null);
    fileInputRef.current?.click();
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setImporting(true);
    setImportMessage(null);

    try {
      const response = await api.importTestArchive(file);
      setImportMessage(`Imported ${response?.test?.name || 'test'} successfully`);
      await loadTests();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import test archive';
      setImportMessage(message);
    } finally {
      setImporting(false);
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
              {providerStatus && (
                <p className="mt-2 text-sm text-gray-500">
                  Using <span className="font-semibold capitalize">{providerStatus.provider}</span>{' '}
                  {providerStatus.configured ? '✓ Configured' : '⚠️ API key required'}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/generate')}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Generate with AI
              </button>
              <button
                onClick={handleImportClick}
                disabled={importing}
                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                {importing ? 'Importing…' : 'Import Tests'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/zip"
                onChange={handleImportFileChange}
                className="hidden"
              />
            </div>
            {healthStatus === 'error' && (
              <p className="text-sm text-red-600">
                Unable to reach the backend API. Ensure the TrailWright server is running.
              </p>
            )}
            {importMessage && (
              <p className="text-sm text-gray-600">{importMessage}</p>
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
                      onClick={() => navigate(`/tests/${test.id}`)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 whitespace-nowrap"
                    >
                      Open Workspace
                    </button>
                    <button
                      onClick={() => handleExportTest(test.id)}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 whitespace-nowrap"
                    >
                      Export
                    </button>
                    <button
                      onClick={() => openDeleteModal(test)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 whitespace-nowrap"
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
