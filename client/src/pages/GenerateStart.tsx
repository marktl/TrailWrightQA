import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function GenerateStart() {
  const navigate = useNavigate();
  const [startUrl, setStartUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [successCriteria, setSuccessCriteria] = useState('');
  const [maxSteps, setMaxSteps] = useState('20');
  const [isStarting, setIsStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [keepBrowserOpen, setKeepBrowserOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .getConfig()
      .then((config) => {
        if (!cancelled) {
          setStartUrl(config?.defaultStartUrl || '');
        }
      })
      .catch(() => void 0);

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedUrl = startUrl.trim();
    const trimmedGoal = goal.trim();

    if (!trimmedUrl || !trimmedGoal) {
      setMessage('Provide both a starting URL and goal.');
      return;
    }

    const parsedSteps = Number.parseInt(maxSteps, 10) || 20;

    setIsStarting(true);
    setMessage(null);

    try {
      const { sessionId } = await api.startGeneration({
        startUrl: trimmedUrl,
        goal: trimmedGoal,
        successCriteria: successCriteria.trim() || undefined,
        maxSteps: parsedSteps,
        keepBrowserOpen
      });
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
              min="1"
              max="50"
              value={maxSteps}
              onChange={(e) => setMaxSteps(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">Default is 20. Increase for longer flows.</p>
          </div>

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

          {message && (
            <p className="text-sm text-red-600">{message}</p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setStartUrl(defaultStartUrl || '');
                setGoal('');
                setSuccessCriteria('');
                setMaxSteps('20');
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
