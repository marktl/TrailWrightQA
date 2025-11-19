import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { ApiCredential } from '../api/client';
import { SCREEN_SIZE_PRESETS } from '../constants/screenSizes';

export default function GenerateStart() {
  const navigate = useNavigate();
  const [startUrl, setStartUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [maxSteps, setMaxSteps] = useState('20');
  const [isStarting, setIsStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [keepBrowserOpen, setKeepBrowserOpen] = useState(false);
  const [defaultStartUrl, setDefaultStartUrl] = useState('');
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState('');
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [credentialForm, setCredentialForm] = useState({
    name: '',
    username: '',
    password: '',
    notes: ''
  });
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [selectedScreenSize, setSelectedScreenSize] = useState('');
  const [mode, setMode] = useState<'auto' | 'manual' | ''>('');

  useEffect(() => {
    let cancelled = false;

    api
      .getConfig()
      .then((config) => {
        if (!cancelled) {
          const url = config?.defaultStartUrl || '';
          setStartUrl(url);
          setDefaultStartUrl(url);
        }
      })
      .catch(() => void 0);

    void loadCredentials();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadCredentials() {
    try {
      setLoadingCredentials(true);
      const { credentials: list } = await api.listCredentials();
      setCredentials(list);
      if (list.length && !selectedCredentialId) {
        setSelectedCredentialId(list[0]?.id ?? '');
      }
    } catch (err) {
      console.error('Failed to load credentials', err);
      setCredentialError('Unable to load credentials');
    } finally {
      setLoadingCredentials(false);
    }
  }

  async function handleCreateCredential() {
    if (!credentialForm.name.trim() || !credentialForm.username.trim() || !credentialForm.password.trim()) {
      setCredentialError('Provide a name, username, and password for the new credential.');
      return;
    }

    setSavingCredential(true);
    setCredentialError(null);
    try {
      const response = await api.createCredential({
        name: credentialForm.name.trim(),
        username: credentialForm.username.trim(),
        password: credentialForm.password.trim(),
        notes: credentialForm.notes.trim() || undefined
      });
      setCredentialForm({ name: '', username: '', password: '', notes: '' });
      setShowCredentialForm(false);
      await loadCredentials();
      setSelectedCredentialId(response.credential.id);
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to create credential';
      setCredentialError(text);
    } finally {
      setSavingCredential(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!mode) {
      setMessage('Select a mode to continue.');
      return;
    }

    const trimmedUrl = startUrl.trim();
    const trimmedGoal = goal.trim();

    if (!trimmedUrl) {
      setMessage('Provide a starting URL.');
      return;
    }

    if (mode === 'auto' && !trimmedGoal) {
      setMessage('Provide a goal for self-driving tests.');
      return;
    }

    const parsedSteps = mode === 'auto' ? Number.parseInt(maxSteps, 10) || 20 : undefined;

    setIsStarting(true);
    setMessage(null);

    try {
      const viewportSize = selectedScreenSize
        ? SCREEN_SIZE_PRESETS.find((p) => p.id === selectedScreenSize)?.viewport
        : undefined;

      const derivedGoal =
        mode === 'auto'
          ? trimmedGoal
          : trimmedGoal || 'Step-by-step test session';
      const derivedSuccess =
        mode === 'auto' ? successCriteria.trim() || undefined : undefined;

      const payload: Parameters<typeof api.startGeneration>[0] = {
        startUrl: trimmedUrl,
        goal: derivedGoal,
        successCriteria: derivedSuccess,
        keepBrowserOpen: mode === 'auto' ? keepBrowserOpen : true,
        credentialId: mode === 'auto' ? selectedCredentialId || undefined : undefined,
        viewportSize,
        mode
      };

      if (mode === 'auto') {
        payload.maxSteps = parsedSteps ?? 20;
      }

      const { sessionId } = await api.startGeneration(payload);
      navigate(`/generate/${sessionId}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to start AI generation';
      setMessage(error);
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Generate with AI</h1>
            <p className="text-sm text-gray-600">Describe the workflow once — TrailWright handles the rest.</p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg bg-white p-6 shadow space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
            <div className="grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('auto')}
                className={`rounded-lg border px-4 py-3 text-left transition ${
                  mode === 'auto'
                    ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-sm'
                    : 'border-gray-200 text-gray-700 hover:border-gray-300'
                }`}
              >
                <p className="text-sm font-semibold">Self-driving Test</p>
                <p className="text-xs mt-1 text-gray-600">
                  Let the agent plan and execute the full test to hit your goal.
                </p>
              </button>
              <button
                type="button"
                onClick={() => setMode('manual')}
                className={`rounded-lg border px-4 py-3 text-left transition ${
                  mode === 'manual'
                    ? 'border-blue-500 bg-blue-50 text-blue-900 shadow-sm'
                    : 'border-gray-200 text-gray-700 hover:border-gray-300'
                }`}
              >
                <p className="text-sm font-semibold">Step-by-step Test</p>
                <p className="text-xs mt-1 text-gray-600">
                  Browser opens and waits for each instruction (e.g., “click Register”).
                </p>
              </button>
            </div>
            {mode ? (
              mode === 'manual' ? (
                <p className="mt-2 text-xs text-gray-500">
                  Chromium launches at your URL and pauses after every action so you can steer the next step.
                </p>
              ) : (
                <p className="mt-2 text-xs text-gray-500">
                  Recommended for most flows — watch the AI drive end-to-end and edit if needed.
                </p>
              )
            ) : (
              <p className="mt-2 text-xs text-gray-500">Pick a mode to continue.</p>
            )}
          </div>

          {!mode ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
              Select a mode above to configure the test.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Starting URL *</label>
                <input
                  type="url"
                  value={startUrl}
                  onChange={(e) => setStartUrl(e.target.value)}
                  required
                  placeholder="https://example.com/login"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {mode === 'auto' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Goal / What to test *</label>
                    <textarea
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      required
                      rows={4}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Example: Register as Jennifer Test_Physician and confirm dashboard greets the doctor."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Success Criteria (optional)</label>
                    <textarea
                      value={successCriteria}
                      onChange={(e) => setSuccessCriteria(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder={'Example: Dashboard shows "Active MD License" card.'}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Max Steps</label>
                    <input
                      type="number"
                      value={maxSteps}
                      min={1}
                      max={200}
                      onChange={(e) => setMaxSteps(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Defaults to 20"
                    />
                  </div>
                </>
              )}

              {mode === 'auto' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Credential (optional)</label>
                  {loadingCredentials ? (
                    <p className="text-sm text-gray-500">Loading credentials…</p>
                  ) : credentials.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No credentials saved. Add one below or in Settings.
                    </p>
                  ) : (
                    <select
                      value={selectedCredentialId}
                      onChange={(e) => setSelectedCredentialId(e.target.value)}
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
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-blue-600">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCredentialForm((prev) => !prev);
                        setCredentialError(null);
                      }}
                      className="font-medium hover:underline"
                    >
                      {showCredentialForm ? 'Cancel new credential' : '+ Add new credential'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate('/settings')}
                      className="font-medium hover:underline"
                    >
                      Manage in Settings →
                    </button>
                  </div>
                  {showCredentialForm && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                      <div>
                        <label className="text-xs font-medium text-gray-600">Display Name</label>
                        <input
                          type="text"
                          value={credentialForm.name}
                          onChange={(e) =>
                            setCredentialForm((prev) => ({ ...prev, name: e.target.value }))
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600">Username / Email</label>
                        <input
                          type="text"
                          value={credentialForm.username}
                          onChange={(e) =>
                            setCredentialForm((prev) => ({ ...prev, username: e.target.value }))
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600">Password</label>
                        <input
                          type="password"
                          value={credentialForm.password}
                          onChange={(e) =>
                            setCredentialForm((prev) => ({ ...prev, password: e.target.value }))
                          }
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600">Notes (optional)</label>
                        <textarea
                          value={credentialForm.notes}
                          onChange={(e) =>
                            setCredentialForm((prev) => ({ ...prev, notes: e.target.value }))
                          }
                          rows={2}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      {credentialError && (
                        <p className="text-xs text-red-600">{credentialError}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleCreateCredential()}
                        disabled={savingCredential}
                        className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingCredential ? 'Saving…' : 'Save Credential'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Screen Size (optional)</label>
                <select
                  value={selectedScreenSize}
                  onChange={(e) => setSelectedScreenSize(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Default (Browser default)</option>
                  {SCREEN_SIZE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  Test against specific viewport sizes like mobile, tablet, or desktop.
                </p>
              </div>

              {mode === 'auto' && (
                <label className="flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={keepBrowserOpen}
                    onChange={(e) => setKeepBrowserOpen(e.target.checked)}
                    className="mt-1 rounded"
                  />
                  <span className="text-sm text-gray-700">
                    Leave the Chromium window open after generation completes
                    <span className="block text-xs text-gray-500">
                      Useful for inspecting the final state before saving.
                    </span>
                  </span>
                </label>
              )}
            </>
          )}

          {message && (
            <p className="text-sm text-red-600">{message}</p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setMode('');
                setStartUrl(defaultStartUrl || '');
                setGoal('');
                setSuccessCriteria('');
                setMaxSteps('20');
                setSelectedScreenSize('');
                setSelectedCredentialId('');
                setShowCredentialForm(false);
                setCredentialError(null);
                setKeepBrowserOpen(false);
                setMessage(null);
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
              disabled={isStarting}
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={isStarting}
              className="rounded-lg bg-blue-600 px-5 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isStarting ? 'Starting…' : 'Start AI Generation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
