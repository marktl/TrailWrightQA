import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function Home() {
  const navigate = useNavigate();
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTests();
  }, []);

  async function loadTests() {
    try {
      const { tests: data } = await api.listTests();
      setTests(data);
    } catch (err) {
      console.error('Failed to load tests:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRunTest(testId: string) {
    try {
      await api.runTest(testId);
      alert('Test started!');
      loadTests();
    } catch (err: any) {
      alert('Failed to run test: ' + err.message);
    }
  }

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900">TrailWright QA</h1>
          <button
            onClick={() => navigate('/settings')}
            className="px-4 py-2 text-gray-600 hover:text-gray-900"
          >
            Settings
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Generate Test with AI</h2>
          <p className="text-gray-600 mb-4">Configure your AI provider in Settings, then generate tests from natural language prompts.</p>
          <button
            onClick={() => navigate('/settings')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go to Settings
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Your Tests</h2>

          {tests.length === 0 ? (
            <p className="text-gray-500">No tests yet. Configure AI and generate tests to get started!</p>
          ) : (
            <div className="space-y-3">
              {tests.map((test) => (
                <div
                  key={test.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{test.name}</h3>
                    {test.description && (
                      <p className="text-sm text-gray-500 mt-1">{test.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleRunTest(test.id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Run
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
