import { useState, useRef, useEffect } from 'react';
import { useGenerationStream } from '../hooks/useGenerationStream';

interface Variable {
  name: string;
  sampleValue: string;
  type: 'string' | 'number';
}

export function GenerationViewer({ sessionId }: { sessionId: string }) {
  const { state, steps, isConnected, stopRecording } = useGenerationStream(sessionId);
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [editedSummary, setEditedSummary] = useState('');
  const [editedCode, setEditedCode] = useState('');
  const [variables, setVariables] = useState<Variable[]>([]);
  const [showAddVariable, setShowAddVariable] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const [activeField, setActiveField] = useState<'summary' | 'code' | null>(null);
  const [isDiscarding, setIsDiscarding] = useState(false);

  const summaryInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLTextAreaElement>(null);

  const handleEditStep = (step: any) => {
    setEditingStep(step.stepNumber);
    setEditedSummary(step.qaSummary);
    setEditedCode(step.playwrightCode);
  };

  const handleCancelEdit = () => {
    setEditingStep(null);
    setEditedSummary('');
    setEditedCode('');
  };

  const handleSaveEdit = async (stepNumber: number) => {
    try {
      const response = await fetch(`/api/generate/${sessionId}/steps/${stepNumber}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          qaSummary: editedSummary,
          playwrightCode: editedCode,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update step');
      }

      setEditingStep(null);
      setEditedSummary('');
      setEditedCode('');
    } catch (error) {
      console.error('Failed to update step:', error);
      alert('Failed to update step');
    }
  };

  const handleDeleteStep = async (stepNumber: number) => {
    if (!confirm('Delete this step?')) {
      return;
    }

    try {
      const response = await fetch(`/api/generate/${sessionId}/steps/${stepNumber}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete step');
      }
    } catch (error) {
      console.error('Failed to delete step:', error);
      alert('Failed to delete step');
    }
  };

  const handleResume = async () => {
    try {
      const response = await fetch(`/api/generate/${sessionId}/resume`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to resume recording');
      }
    } catch (error) {
      console.error('Failed to resume recording:', error);
      alert('Failed to resume recording');
    }
  };

  const handleSave = async () => {
    try {
      const response = await fetch(`/api/generate/${sessionId}/save`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to save test');
      }

      const data = await response.json();
      console.log('Save response:', data);

      // Redirect to test workspace instead of showing alert
      if (data.test?.id) {
        window.location.href = `/tests/${data.test.id}`;
      } else {
        window.location.href = '/';
      }
    } catch (error) {
      console.error('Failed to save:', error);
      alert('Failed to save test');
    }
  };

  const handleDiscard = async () => {
    if (isDiscarding) return;

    const confirmed = window.confirm(
      'Are you sure you want to exit without saving?\n\nAll recorded steps will be lost. This cannot be undone.'
    );
    if (!confirmed) return;

    setIsDiscarding(true);
    try {
      await fetch(`/api/generate/${sessionId}/record/discard`, {
        method: 'POST',
      });
      window.location.href = '/';
    } catch (error) {
      console.error('Failed to discard:', error);
      alert('Failed to discard recording');
      setIsDiscarding(false);
    }
  };

  // Load variables when editing a step
  useEffect(() => {
    if (editingStep !== null) {
      fetchVariables();
    }
  }, [editingStep]);

  const fetchVariables = async () => {
    try {
      const response = await fetch(`/api/generate/${sessionId}/variables`);
      if (response.ok) {
        const data = await response.json();
        setVariables(data.variables || []);
      }
    } catch (error) {
      console.error('Failed to fetch variables:', error);
    }
  };

  const handleInsertVariable = (varName: string) => {
    const variable = `{{${varName}}}`;

    if (activeField === 'summary' && summaryInputRef.current) {
      const input = summaryInputRef.current;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const newValue = editedSummary.slice(0, start) + variable + editedSummary.slice(end);
      setEditedSummary(newValue);

      // Set cursor position after inserted variable
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    } else if (activeField === 'code' && codeInputRef.current) {
      const textarea = codeInputRef.current;
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const newValue = editedCode.slice(0, start) + variable + editedCode.slice(end);
      setEditedCode(newValue);

      // Set cursor position after inserted variable
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + variable.length, start + variable.length);
      }, 0);
    }
  };

  const handleAddVariable = async () => {
    if (!newVarName.trim() || !newVarValue.trim()) {
      alert('Please enter both variable name and sample value');
      return;
    }

    try {
      const response = await fetch(`/api/generate/${sessionId}/variables`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newVarName.trim(),
          sampleValue: newVarValue.trim(),
          type: 'string'
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to add variable');
      }

      const data = await response.json();
      setVariables(data.variables || []);
      setNewVarName('');
      setNewVarValue('');
      setShowAddVariable(false);

      // Auto-insert the newly created variable
      handleInsertVariable(newVarName.trim());
    } catch (error) {
      console.error('Failed to add variable:', error);
      alert('Failed to add variable');
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
              className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700"
            >
              Pause Recording
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {(isRecordMode ? [...steps].reverse() : steps).map((step) => (
          <div
            key={step.stepNumber}
            className="bg-white border rounded-lg p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 font-bold">
                {step.stepNumber}
              </div>
              <div className="flex-1">
                {editingStep === step.stepNumber ? (
                  // Edit mode
                  <div className="space-y-3">
                    {/* Variable Chips Panel */}
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-medium text-blue-900">
                          Variables - Click to insert
                        </label>
                        <button
                          onClick={() => setShowAddVariable(!showAddVariable)}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          + Add Variable
                        </button>
                      </div>

                      {/* Add Variable Form */}
                      {showAddVariable && (
                        <div className="mb-2 p-2 bg-white border border-blue-300 rounded space-y-2">
                          <input
                            type="text"
                            value={newVarName}
                            onChange={(e) => setNewVarName(e.target.value)}
                            placeholder="Variable name (e.g., username)"
                            className="w-full px-2 py-1 border rounded text-xs"
                          />
                          <input
                            type="text"
                            value={newVarValue}
                            onChange={(e) => setNewVarValue(e.target.value)}
                            placeholder="Sample value (e.g., john@example.com)"
                            className="w-full px-2 py-1 border rounded text-xs"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={handleAddVariable}
                              className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                            >
                              Create & Insert
                            </button>
                            <button
                              onClick={() => {
                                setShowAddVariable(false);
                                setNewVarName('');
                                setNewVarValue('');
                              }}
                              className="px-2 py-1 text-xs bg-gray-400 text-white rounded hover:bg-gray-500"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Variable Chips */}
                      <div className="flex flex-wrap gap-2">
                        {variables.length === 0 ? (
                          <span className="text-xs text-gray-500 italic">
                            No variables yet. Click "+ Add Variable" to create one.
                          </span>
                        ) : (
                          variables.map((v) => (
                            <button
                              key={v.name}
                              onClick={() => handleInsertVariable(v.name)}
                              className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium hover:bg-purple-200 border border-purple-300"
                              title={`Click to insert {{${v.name}}} - Sample: ${v.sampleValue}`}
                            >
                              {v.name}
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        QA Summary
                      </label>
                      <input
                        ref={summaryInputRef}
                        type="text"
                        value={editedSummary}
                        onChange={(e) => setEditedSummary(e.target.value)}
                        onFocus={() => setActiveField('summary')}
                        className="w-full px-3 py-2 border rounded-md text-sm"
                        placeholder="e.g., Fill username into email field"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Playwright Code
                      </label>
                      <textarea
                        ref={codeInputRef}
                        value={editedCode}
                        onChange={(e) => setEditedCode(e.target.value)}
                        onFocus={() => setActiveField('code')}
                        className="w-full px-3 py-2 border rounded-md text-sm font-mono"
                        rows={3}
                        placeholder="e.g., await page.fill('#email', username);"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(step.stepNumber)}
                        className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="px-3 py-1 bg-gray-400 text-white rounded text-sm hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                    {step.screenshotData && (
                      <img
                        src={step.screenshotData}
                        alt={`Step ${step.stepNumber} screenshot`}
                        className="mt-2 border rounded max-w-full"
                      />
                    )}
                  </div>
                ) : (
                  // Display mode
                  <div>
                    <div className="flex items-start justify-between">
                      <p className="font-medium flex-1">{step.qaSummary}</p>
                      {isRecordMode && !state.recordingActive && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleEditStep(step)}
                            className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteStep(step.stepNumber)}
                            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
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
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {isRecordMode && !state.recordingActive && (
        <div className="border-t p-4 bg-white flex gap-3">
          <button
            onClick={handleResume}
            className="flex-1 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Resume Recording
          </button>
          {steps.length > 0 && (
            <button
              onClick={handleSave}
              className="flex-1 py-3 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Save Test
            </button>
          )}
          <button
            onClick={handleDiscard}
            disabled={isDiscarding}
            className="py-3 px-4 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50"
            title="Exit without saving"
          >
            {isDiscarding ? 'Exiting…' : 'Exit'}
          </button>
        </div>
      )}
    </div>
  );
}
