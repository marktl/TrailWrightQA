import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { ApiCredential } from '../api/client';

type Config = {
  apiProvider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  defaultBrowser: 'chromium' | 'firefox' | 'webkit';
  defaultStartUrl?: string;
};

const defaultConfig: Config = {
  apiProvider: 'anthropic',
  apiKey: '',
  defaultBrowser: 'chromium',
  defaultStartUrl: ''
};

export default function Settings() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [credentials, setCredentials] = useState<ApiCredential[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [credentialMessage, setCredentialMessage] = useState<string | null>(null);
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [editingCredential, setEditingCredential] = useState<ApiCredential | null>(null);
  const [credentialForm, setCredentialForm] = useState({
    name: '',
    username: '',
    password: '',
    notes: ''
  });
  const [savingCredential, setSavingCredential] = useState(false);
  const [revealedCredentialId, setRevealedCredentialId] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
    loadCredentials();

    const refreshTimer = setTimeout(() => {
      loadConfig();
    }, 800);

    return () => clearTimeout(refreshTimer);
  }, []);

  async function loadConfig() {
    try {
      const data = await api.getConfig();
      setConfig({
        ...defaultConfig,
        ...data,
        defaultBrowser: data.defaultBrowser || defaultConfig.defaultBrowser,
      });
    } catch (err) {
      console.error('Failed to load config:', err);
      setConfig(defaultConfig);
    } finally {
      setLoading(false);
    }
  }

  async function loadCredentials() {
    try {
      setLoadingCredentials(true);
      setCredentialMessage(null);
      const { credentials: list } = await api.listCredentials();
      setCredentials(list);
    } catch (err) {
      console.error('Failed to load credentials:', err);
      setCredentialMessage('Unable to load credentials');
    } finally {
      setLoadingCredentials(false);
    }
  }

  function updateConfig(partial: Partial<Config>) {
    setConfig((prev) => ({ ...prev, ...partial }));
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');

    try {
      await api.saveConfig(config);
      setMessage('Settings saved successfully');
    } catch (err: any) {
      setMessage('Error: ' + (err?.message || 'Unable to save settings'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCredential() {
    if (!credentialForm.name.trim() || !credentialForm.username.trim()) {
      setCredentialMessage('Name and username are required');
      return;
    }
    if (!editingCredential && !credentialForm.password.trim()) {
      setCredentialMessage('Password is required');
      return;
    }

    setSavingCredential(true);
    try {
      if (editingCredential) {
        await api.updateCredential(editingCredential.id, {
          name: credentialForm.name.trim(),
          username: credentialForm.username.trim(),
          password: credentialForm.password.trim() || undefined,
          notes: credentialForm.notes.trim() || undefined
        });
        setCredentialMessage('Credential updated');
      } else {
        await api.createCredential({
          name: credentialForm.name.trim(),
          username: credentialForm.username.trim(),
          password: credentialForm.password.trim(),
          notes: credentialForm.notes.trim() || undefined
        });
        setCredentialMessage('Credential added');
      }
      setCredentialForm({ name: '', username: '', password: '', notes: '' });
      setEditingCredential(null);
      setShowCredentialForm(false);
      await loadCredentials();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save credential';
      setCredentialMessage(message);
    } finally {
      setSavingCredential(false);
    }
  }

  async function handleDeleteCredential(id: string) {
    const confirmed = window.confirm(
      'Delete this credential? Tests referencing it will need updates.'
    );
    if (!confirmed) return;
    try {
      await api.deleteCredential(id);
      setCredentialMessage('Credential removed');
      if (revealedCredentialId === id) {
        setRevealedCredentialId(null);
      }
      await loadCredentials();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete credential';
      setCredentialMessage(message);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
          >
            <span aria-hidden="true" className="text-base leading-none">&larr;</span>
            Back to Home
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Settings</h1>
        {loading && (
          <p className="mb-6 text-sm text-gray-500" data-testid="settings-loading">
            Loading configuration...
          </p>
        )}

        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <section>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AI Provider
            </label>
            <div className="space-y-2">
              {(['anthropic', 'openai', 'gemini'] as Config['apiProvider'][]).map((provider) => (
                <label key={provider} className="flex items-center">
                  <input
                    type="radio"
                    name="provider"
                    value={provider}
                    checked={config.apiProvider === provider}
                    onChange={(e) => updateConfig({ apiProvider: e.target.value as Config['apiProvider'] })}
                    className="mr-2"
                  />
                  <span className="capitalize">{provider}</span>
                </label>
              ))}
            </div>
          </section>

          <section>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => updateConfig({ apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </section>

          <section>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Starting URL
            </label>
            <input
              type="url"
              value={config.defaultStartUrl || ''}
              onChange={(e) => updateConfig({ defaultStartUrl: e.target.value })}
              placeholder="https://app.example.com/login"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              Pre-fills the AI generation form so you can start faster.
            </p>
          </section>

          <section>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Browser
            </label>
            <div className="space-y-2">
              {(['chromium', 'firefox', 'webkit'] as Config['defaultBrowser'][]).map((browser) => (
                <label key={browser} className="flex items-center">
                  <input
                    type="radio"
                    name="defaultBrowser"
                    value={browser}
                    checked={config.defaultBrowser === browser}
                    onChange={(e) =>
                      updateConfig({ defaultBrowser: e.target.value as Config['defaultBrowser'] })
                    }
                    className="mr-2"
                  />
                  <span className="capitalize">{browser === 'webkit' ? 'WebKit' : browser}</span>
                </label>
              ))}
            </div>
          </section>

          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            {message && (
              <p className={`mt-2 text-sm ${message.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                {message}
              </p>
            )}
          </div>
        </div>

        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Test Credential Vault</h2>
              <p className="text-sm text-gray-500">Store reusable logins once and share them with AI runs.</p>
            </div>
            <button
              onClick={() => {
                setEditingCredential(null);
                setCredentialForm({ name: '', username: '', password: '', notes: '' });
                setShowCredentialForm(true);
                setCredentialMessage(null);
              }}
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Add Credential
            </button>
          </div>

          {credentialMessage && (
            <p className="mb-4 text-sm text-red-600">{credentialMessage}</p>
          )}

          {showCredentialForm && (
            <form
              className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveCredential();
              }}
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-gray-700">Display Name</label>
                  <input
                    type="text"
                    value={credentialForm.name}
                    onChange={(e) => setCredentialForm((prev) => ({ ...prev, name: e.target.value }))}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">Username / Email</label>
                  <input
                    type="text"
                    value={credentialForm.username}
                    onChange={(e) =>
                      setCredentialForm((prev) => ({ ...prev, username: e.target.value }))
                    }
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">
                  Password {editingCredential ? <span className="text-xs text-gray-500">(leave blank to keep existing)</span> : null}
                </label>
                <input
                  type="password"
                  value={credentialForm.password}
                  onChange={(e) =>
                    setCredentialForm((prev) => ({ ...prev, password: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  required={!editingCredential}
                  placeholder="••••••"
                />
              </div>
              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">Notes (optional)</label>
                <textarea
                  value={credentialForm.notes}
                  onChange={(e) =>
                    setCredentialForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="mt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCredentialForm(false);
                    setEditingCredential(null);
                    setCredentialForm({ name: '', username: '', password: '', notes: '' });
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  disabled={savingCredential}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCredential}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingCredential ? 'Saving…' : editingCredential ? 'Update Credential' : 'Save Credential'}
                </button>
              </div>
            </form>
          )}

          {loadingCredentials ? (
            <p className="text-sm text-gray-500">Loading stored credentials…</p>
          ) : credentials.length === 0 ? (
            <p className="text-sm text-gray-500">No credentials saved yet.</p>
          ) : (
            <div className="space-y-4">
              {credentials.map((credential) => {
                const revealed = revealedCredentialId === credential.id;
                return (
                  <div
                    key={credential.id}
                    className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-base font-semibold text-gray-900">{credential.name}</p>
                      <p className="text-sm text-gray-600">Username: {credential.username}</p>
                      <p className="text-sm text-gray-600">
                        Password:{' '}
                        <span className="font-mono">
                          {revealed ? credential.password : '••••••••'}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setRevealedCredentialId((prev) =>
                              prev === credential.id ? null : credential.id
                            )
                          }
                          className="ml-2 text-xs font-medium text-blue-600 hover:text-blue-800"
                        >
                          {revealed ? 'Hide' : 'Reveal'}
                        </button>
                      </p>
                      {credential.notes && (
                        <p className="text-sm text-gray-500">Notes: {credential.notes}</p>
                      )}
                      {credential.lastUsedAt && (
                        <p className="text-xs text-gray-400">
                          Last used {new Date(credential.lastUsedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingCredential(credential);
                          setCredentialForm({
                            name: credential.name,
                            username: credential.username,
                            password: '',
                            notes: credential.notes || ''
                          });
                          setShowCredentialForm(true);
                          setCredentialMessage(null);
                        }}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDeleteCredential(credential.id)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

}
