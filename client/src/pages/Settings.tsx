import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function Settings() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const data = await api.getConfig();
      setConfig(data);
    } catch (err: any) {
      console.error('Failed to load config:', err);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');

    try {
      await api.saveConfig(config);
      setMessage('Settings saved successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AI Provider
            </label>
            <div className="space-y-2">
              {['anthropic', 'openai', 'gemini'].map((provider) => (
                <label key={provider} className="flex items-center">
                  <input
                    type="radio"
                    name="provider"
                    value={provider}
                    checked={config.apiProvider === provider}
                    onChange={(e) => setConfig({ ...config, apiProvider: e.target.value })}
                    className="mr-2"
                  />
                  <span className="capitalize">{provider}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Base URL (optional)
            </label>
            <input
              type="url"
              value={config.baseUrl || ''}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://example.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="pt-4">
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
