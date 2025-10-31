import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

type Config = {
  apiProvider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  baseUrl?: string;
  defaultBrowser: 'chromium' | 'firefox' | 'webkit';
};

const defaultConfig: Config = {
  apiProvider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  defaultBrowser: 'chromium',
};

export default function Settings() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadConfig();

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
              Default Base URL
            </label>
            <input
              type="url"
              value={config.baseUrl || ''}
              onChange={(e) => updateConfig({ baseUrl: e.target.value })}
              placeholder="https://example.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
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
      </div>
    </div>
  );
}
