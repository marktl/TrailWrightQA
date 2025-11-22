import React, { useState } from 'react';

interface RecordModeSetupProps {
  onStart: (config: {
    name: string;
    startUrl: string;
    description?: string;
  }) => void;
}

export function RecordModeSetup({ onStart }: RecordModeSetupProps) {
  const [name, setName] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !startUrl.trim()) {
      return;
    }

    onStart({
      name: name.trim(),
      startUrl: startUrl.trim(),
      description: description.trim(),
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">Record Mode - Create Test</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="test-name" className="block text-sm font-medium mb-1">
            Test Name *
          </label>
          <input
            id="test-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., User Login Test"
            className="w-full px-3 py-2 border rounded-md"
            required
          />
        </div>

        <div>
          <label htmlFor="start-url" className="block text-sm font-medium mb-1">
            Starting URL *
          </label>
          <input
            id="start-url"
            type="url"
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
            placeholder="https://example.com/login"
            className="w-full px-3 py-2 border rounded-md"
            required
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-1">
            Description (Optional)
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of what this test does..."
            className="w-full px-3 py-2 border rounded-md"
            rows={3}
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
            disabled={!name.trim() || !startUrl.trim()}
          >
            Start Recording
          </button>
        </div>
      </form>

      <div className="mt-6 p-4 bg-blue-50 rounded-md">
        <h3 className="font-medium mb-2">How Record Mode Works:</h3>
        <ul className="text-sm space-y-1 list-disc list-inside">
          <li>Browser will open to your starting URL</li>
          <li>Perform actions normally (click, type, select)</li>
          <li>TrailWright records each step automatically</li>
          <li>AI generates clean Playwright code in real-time</li>
          <li>Click "Stop Recording" when done</li>
        </ul>
      </div>
    </div>
  );
}
