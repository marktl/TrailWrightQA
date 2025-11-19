import { useState } from 'react';
import { VariableChip } from './VariableChip';

export interface Variable {
  name: string;
  type: string;
  sampleValue?: string;
}

export interface VariablePanelProps {
  variables: Variable[];
  onAddVariable: (name: string, sampleValue: string, type: 'string' | 'number') => Promise<void>;
  onDeleteVariable: (name: string) => Promise<void>;
  disabled?: boolean;
}

/**
 * Variable management panel for step-by-step mode
 * Allows creating variables with sample values and displays them as draggable chips
 */
export function VariablePanel({
  variables,
  onAddVariable,
  onDeleteVariable,
  disabled = false
}: VariablePanelProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const [newVarType, setNewVarType] = useState<'string' | 'number'>('string');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = newVarName.trim();
    const trimmedValue = newVarValue.trim();

    if (!trimmedName) {
      setError('Variable name is required');
      return;
    }

    if (!/^\w+$/.test(trimmedName)) {
      setError('Variable name must contain only letters, numbers, and underscores');
      return;
    }

    if (!trimmedValue) {
      setError('Sample value is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await onAddVariable(trimmedName, trimmedValue, newVarType);
      // Clear form on success
      setNewVarName('');
      setNewVarValue('');
      setNewVarType('string');
      setIsAdding(false);
    } catch (err: any) {
      setError(err.message || 'Failed to add variable');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await onDeleteVariable(name);
    } catch (err: any) {
      setError(err.message || 'Failed to delete variable');
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Variables</h3>
        <button
          onClick={() => setIsAdding(!isAdding)}
          disabled={disabled}
          className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAdding ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      {isAdding && (
        <form onSubmit={handleSubmit} className="mb-3 p-3 bg-gray-50 rounded border border-gray-200">
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Variable Name
              </label>
              <input
                type="text"
                value={newVarName}
                onChange={(e) => setNewVarName(e.target.value)}
                placeholder="e.g., product"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                disabled={isSubmitting}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Sample Value
              </label>
              <input
                type={newVarType === 'number' ? 'number' : 'text'}
                value={newVarValue}
                onChange={(e) => setNewVarValue(e.target.value)}
                placeholder="e.g., teddy bear"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
              <select
                value={newVarType}
                onChange={(e) => setNewVarType(e.target.value as 'string' | 'number')}
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                disabled={isSubmitting}
              >
                <option value="string">String</option>
                <option value="number">Number</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full text-xs px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add Variable'}
            </button>
          </div>
        </form>
      )}

      {variables.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 mb-2">Drag into chat to use:</p>
          <div className="flex flex-wrap gap-2">
            {variables.map((variable) => (
              <VariableChip
                key={variable.name}
                name={variable.name}
                sampleValue={variable.sampleValue}
                onDelete={disabled ? undefined : () => handleDelete(variable.name)}
                draggable={!disabled}
              />
            ))}
          </div>
        </div>
      ) : (
        !isAdding && (
          <p className="text-xs text-gray-400 text-center py-4">
            No variables yet. Click "+ Add" to create one.
          </p>
        )
      )}
    </div>
  );
}
