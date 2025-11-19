import { useEffect, useMemo, useRef, useState } from 'react';
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

  const [, setDefaultStartUrl] = useState('');
  const [providerStatus, setProviderStatus] = useState<{ provider: string; configured: boolean } | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [testToDelete, setTestToDelete] = useState<ApiTestMetadata | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'uncategorized' | string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'created' | 'status'>('recent');
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState('');
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkCategoryInput, setBulkCategoryInput] = useState('');
  const [bulkFeedback, setBulkFeedback] = useState<string | null>(null);
  const [performingBulk, setPerformingBulk] = useState(false);
  const runStatusPills: Record<string, string> = {
    passed: 'bg-emerald-50 text-emerald-700',
    failed: 'bg-red-50 text-red-600',
    stopped: 'bg-orange-50 text-orange-700',
    skipped: 'bg-gray-100 text-gray-600',
    completed: 'bg-emerald-50 text-emerald-700'
  };

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

  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    tests.forEach((test) => {
      (test.tags ?? []).forEach((tag) => tags.add(tag));
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [tests]);

  const categoryOptions = useMemo(() => {
    const folders = new Set<string>();
    tests.forEach((test) => {
      if (test.folder) {
        folders.add(test.folder);
      }
    });
    return Array.from(folders).sort((a, b) => a.localeCompare(b));
  }, [tests]);

  const filteredTests = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tests.filter((test) => {
      if (query) {
        const haystack = [
          test.name,
          test.description,
          test.prompt,
          test.successCriteria,
          test.startUrl,
          ...(test.tags ?? [])
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      if (activeTag && !(test.tags ?? []).includes(activeTag)) {
        return false;
      }
      if (selectedCategory === 'uncategorized') {
        if (test.folder) {
          return false;
        }
      } else if (selectedCategory !== 'all' && test.folder !== selectedCategory) {
        return false;
      }
      return true;
    });
  }, [tests, searchQuery, activeTag, selectedCategory]);

  const sortedTests = useMemo(() => {
    const statusRank: Record<string, number> = {
      failed: 0,
      stopped: 1,
      passed: 2,
      skipped: 3,
      completed: 4
    };
    const data = [...filteredTests];
    data.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'status': {
          const rankA = statusRank[a.lastRunStatus ?? ''] ?? 5;
          const rankB = statusRank[b.lastRunStatus ?? ''] ?? 5;
          if (rankA === rankB) {
            return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
          }
          return rankA - rankB;
        }
        case 'recent':
        default:
          return (
            new Date(b.updatedAt || b.createdAt).getTime() -
            new Date(a.updatedAt || a.createdAt).getTime()
          );
      }
    });
    return data;
  }, [filteredTests, sortBy]);

  function toggleSelect(testId: string) {
    setSelectedTests((prev) =>
      prev.includes(testId) ? prev.filter((id) => id !== testId) : [...prev, testId]
    );
  }

  function selectAllFiltered() {
    setSelectedTests(filteredTests.map((test) => test.id));
  }

  function clearSelection() {
    setSelectedTests([]);
    setBulkAction('');
    setBulkTagInput('');
    setBulkCategoryInput('');
    setBulkFeedback(null);
  }

  async function handleBulkApply() {
    if (!bulkAction || selectedTests.length === 0) {
      return;
    }
    setPerformingBulk(true);
    setBulkFeedback(null);

    try {
      switch (bulkAction) {
        case 'run': {
          for (const id of selectedTests) {
            await api.runTest(id);
          }
          setBulkFeedback(`Started ${selectedTests.length} run(s).`);
          break;
        }
        case 'delete': {
          const confirmed = window.confirm(
            `Delete ${selectedTests.length} test(s)? This cannot be undone.`
          );
          if (!confirmed) {
            setPerformingBulk(false);
            return;
          }
          for (const id of selectedTests) {
            await api.deleteTest(id);
          }
          setBulkFeedback(`Deleted ${selectedTests.length} test(s).`);
          break;
        }
        case 'tag': {
          const tags = bulkTagInput
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean);
          if (tags.length === 0) {
            setBulkFeedback('Provide at least one tag to add.');
            setPerformingBulk(false);
            return;
          }
          for (const id of selectedTests) {
            const test = tests.find((t) => t.id === id);
            if (!test) continue;
            const merged = Array.from(new Set([...(test.tags ?? []), ...tags]));
            await api.updateTestMetadata(id, { tags: merged });
          }
          setBulkFeedback(`Added tags to ${selectedTests.length} test(s).`);
          break;
        }
        case 'category': {
          const targetCategory = bulkCategoryInput.trim();
          for (const id of selectedTests) {
            await api.updateTestMetadata(id, { folder: targetCategory || null });
          }
          setBulkFeedback(
            targetCategory
              ? `Moved ${selectedTests.length} test(s) to "${targetCategory}".`
              : `Cleared category on ${selectedTests.length} test(s).`
          );
          break;
        }
        default:
          break;
      }
      await loadTests();
      clearSelection();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bulk action failed';
      setBulkFeedback(message);
    } finally {
      setPerformingBulk(false);
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
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Test Library</h2>
              <p className="text-sm text-gray-500">
                Showing {sortedTests.length} of {tests.length} total
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, URL, or tag"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-2.5 text-gray-400">⌕</span>
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="recent">Sort: Last updated</option>
                <option value="name">Sort: Name (A–Z)</option>
                <option value="created">Sort: Oldest first</option>
                <option value="status">Sort: Status (failed first)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-gray-500">Category</span>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as typeof selectedCategory)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="all">All categories</option>
                <option value="uncategorized">Uncategorized</option>
                {categoryOptions.map((folderName) => (
                  <option key={folderName} value={folderName}>
                    {folderName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              {tagOptions.length === 0 ? (
                <span className="text-xs text-gray-400">No tags yet.</span>
              ) : (
                tagOptions.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      activeTag === tag
                        ? 'border-blue-500 bg-blue-50 text-blue-600'
                        : 'border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}
                  >
                    #{tag}
                  </button>
                ))
              )}
            </div>
            <button
              onClick={selectAllFiltered}
              className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-700"
              type="button"
            >
              Select filtered
            </button>
            {(searchQuery || activeTag || selectedCategory !== 'all') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setActiveTag(null);
                  setSelectedCategory('all');
                }}
                className="text-xs text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {selectedTests.length > 0 && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="text-sm text-blue-900">
                  {selectedTests.length} test{selectedTests.length === 1 ? '' : 's'} selected
                </div>
                <div className="flex flex-wrap gap-3">
                  <select
                    value={bulkAction}
                    onChange={(e) => setBulkAction(e.target.value)}
                    className="rounded-md border border-blue-300 px-3 py-2 text-sm"
                  >
                    <option value="">Bulk action…</option>
                    <option value="run">Run selected</option>
                    <option value="tag">Add tags</option>
                    <option value="category">Move to category</option>
                    <option value="delete">Delete</option>
                  </select>
                  {bulkAction === 'tag' && (
                    <input
                      type="text"
                      value={bulkTagInput}
                      onChange={(e) => setBulkTagInput(e.target.value)}
                      placeholder="comma-separated tags"
                      className="rounded-md border border-blue-300 px-3 py-2 text-sm"
                    />
                  )}
                  {bulkAction === 'category' && (
                    <input
                      type="text"
                      value={bulkCategoryInput}
                      onChange={(e) => setBulkCategoryInput(e.target.value)}
                      placeholder="Category name"
                      className="rounded-md border border-blue-300 px-3 py-2 text-sm"
                    />
                  )}
                  <button
                    onClick={() => void handleBulkApply()}
                    disabled={!bulkAction || performingBulk}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {performingBulk ? 'Applying…' : 'Apply'}
                  </button>
                  <button
                    onClick={clearSelection}
                    className="rounded-md border border-blue-200 px-3 py-2 text-sm text-blue-700 hover:bg-blue-100"
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {bulkFeedback && <p className="mt-2 text-xs text-blue-900">{bulkFeedback}</p>}
            </div>
          )}

          {loading ? (
            <p className="mt-4 text-gray-500" data-testid="tests-loading">
              Loading test library…
            </p>
          ) : tests.length === 0 ? (
            <p className="mt-4 text-gray-500" data-testid="tests-empty">
              No test sets yet. Generate one with AI to get started.
            </p>
          ) : sortedTests.length === 0 ? (
            <p className="mt-4 text-gray-500">No tests match the current filters.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {sortedTests.map((test) => (
                <div
                  key={test.id}
                  className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 hover:bg-gray-50 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex flex-1 gap-3">
                    <input
                      type="checkbox"
                      checked={selectedTests.includes(test.id)}
                      onChange={() => toggleSelect(test.id)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">{test.name}</h3>
                        {test.folder ? (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                            {test.folder}
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-400">
                            Uncategorized
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600 line-clamp-2">
                        {test.description || test.prompt || 'No description provided.'}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span>Created {formatTimestamp(test.createdAt)}</span>
                        {test.lastRunStatus && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${runStatusPills[test.lastRunStatus] ?? 'bg-gray-100 text-gray-600'}`}
                          >
                            {test.lastRunStatus}
                            {test.lastRunAt ? ` · ${formatTimestamp(test.lastRunAt)}` : ''}
                          </span>
                        )}
                      </div>
                      {test.tags && test.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {test.tags.map((tag) => (
                            <button
                              key={`${test.id}-${tag}`}
                              onClick={() => setActiveTag(tag)}
                              className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:border-blue-300 hover:text-blue-700"
                            >
                              #{tag}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => navigate(`/tests/${test.id}`)}
                      className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                    >
                      Open Workspace
                    </button>
                    <button
                      onClick={() => handleExportTest(test.id)}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Export
                    </button>
                    <button
                      onClick={() => openDeleteModal(test)}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
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
