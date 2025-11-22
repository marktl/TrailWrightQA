import React from 'react';
import { useGenerationStream } from '../hooks/useGenerationStream';

export function GenerationViewer({ sessionId }: { sessionId: string }) {
  const { state, steps, isConnected, stopRecording } = useGenerationStream(sessionId);

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/generate/${sessionId}/save`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to save test');
      }

      await response.json();
      alert('Test saved successfully!');
      window.location.href = '/tests';
    } catch (error) {
      console.error('Failed to save:', error);
      alert('Failed to save test');
    }
  };

  if (!state) {
    return <div>Loading...</div>;
  }

  const isRecordMode = state.mode === 'record';

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-gradient-to-r from-purple-600 to-purple-800 text-white p-4">
        <h1 className="text-xl font-bold">
          {isRecordMode ? '🔴 Recording Mode' : 'Test Generation'}
        </h1>
        <p className="text-sm opacity-90">{state.testName}</p>
      </div>

      {isRecordMode && state.recordingActive && (
        <div className="bg-yellow-50 border-b border-yellow-200 p-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></span>
              <strong>Recording</strong>
            </span>
            <span className="text-sm text-gray-600">
              {steps.length} step{steps.length !== 1 ? 's' : ''} captured
            </span>
            <span className="text-xs text-gray-500">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={stopRecording}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Stop Recording
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {steps.map((step) => (
          <div
            key={step.stepNumber}
            className="bg-white border rounded-lg p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 font-bold">
                {step.stepNumber}
              </div>
              <div className="flex-1">
                <p className="font-medium">{step.qaSummary}</p>
                <pre className="mt-2 p-2 bg-gray-50 rounded text-sm overflow-x-auto">
                  {step.playwrightCode}
                </pre>
                {step.screenshotData && (
                  <img
                    src={step.screenshotData}
                    alt={`Step ${step.stepNumber} screenshot`}
                    className="mt-2 border rounded max-w-full"
                  />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {isRecordMode && !state.recordingActive && steps.length > 0 && (
        <div className="border-t p-4 bg-white">
          <button
            onClick={handleSave}
            className="w-full py-3 bg-green-600 text-white rounded-md hover:bg-green-700"
          >
            Save Test
          </button>
        </div>
      )}
    </div>
  );
}
