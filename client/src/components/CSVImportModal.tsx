import { useState, useCallback, useRef } from 'react';

export interface VariableDefinition {
  name: string;
  type?: 'string' | 'number';
  sampleValue?: string;
}

export type VariableRow = Record<string, string>;
export type ColumnMapping = Record<string, string | null>;
export type ImportMode = 'replace' | 'append' | 'merge';

export interface CSVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  variables: VariableDefinition[];
  onImport: (csvContent: string, mapping: ColumnMapping, mode: ImportMode) => Promise<void>;
}

interface ParsedCSV {
  headers: string[];
  rows: string[][];
  rawContent: string;
}

/**
 * Modal for importing CSV data with column mapping and import mode selection
 */
export function CSVImportModal({ isOpen, onClose, variables, onImport }: CSVImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedCSV, setParsedCSV] = useState<ParsedCSV | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [importMode, setImportMode] = useState<ImportMode>('replace');
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Parse CSV content
  const parseCSV = useCallback((content: string): ParsedCSV => {
    const lines = content.trim().split('\n');
    if (lines.length === 0) {
      throw new Error('CSV file is empty');
    }

    // Simple CSV parsing (handles basic cases, not complex quoted values with commas)
    const parseRow = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseRow(lines[0]);
    const rows = lines.slice(1).map(parseRow);

    return { headers, rows, rawContent: content };
  }, []);

  // Handle file selection
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const parsed = parseCSV(content);
          setParsedCSV(parsed);

          // Auto-generate mapping for matching headers
          const autoMapping: ColumnMapping = {};
          parsed.headers.forEach((header) => {
            const normalizedHeader = header.toLowerCase().trim();
            const matchingVar = variables.find(
              (v) => v.name.toLowerCase() === normalizedHeader
            );
            if (matchingVar) {
              autoMapping[header] = matchingVar.name;
            } else {
              autoMapping[header] = null; // Unmapped
            }
          });
          setColumnMapping(autoMapping);
        } catch (err: any) {
          setError(err.message || 'Failed to parse CSV file');
          setParsedCSV(null);
        }
      };
      reader.onerror = () => {
        setError('Failed to read file');
      };
      reader.readAsText(file);
    },
    [parseCSV, variables]
  );

  // Update column mapping
  const handleMappingChange = useCallback((csvHeader: string, targetVariable: string | null) => {
    setColumnMapping((prev) => ({
      ...prev,
      [csvHeader]: targetVariable
    }));
  }, []);

  // Validate mapping
  const validateMapping = useCallback((): { valid: boolean; message?: string } => {
    if (!parsedCSV) {
      return { valid: false, message: 'No CSV file selected' };
    }

    const mappedVariables = new Set(Object.values(columnMapping).filter((v) => v !== null));

    // Check if at least one column is mapped
    if (mappedVariables.size === 0) {
      return { valid: false, message: 'At least one column must be mapped to a variable' };
    }

    // Check for duplicate mappings
    if (mappedVariables.size !== Object.values(columnMapping).filter((v) => v !== null).length) {
      return { valid: false, message: 'Multiple CSV columns cannot map to the same variable' };
    }

    return { valid: true };
  }, [parsedCSV, columnMapping]);

  // Handle import
  const handleImport = useCallback(async () => {
    if (!parsedCSV) return;

    const validation = validateMapping();
    if (!validation.valid) {
      setError(validation.message || 'Invalid mapping');
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      await onImport(parsedCSV.rawContent, columnMapping, importMode);
      onClose();
      // Reset state
      setParsedCSV(null);
      setColumnMapping({});
      setImportMode('replace');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err: any) {
      setError(err.message || 'Failed to import CSV');
    } finally {
      setIsImporting(false);
    }
  }, [parsedCSV, columnMapping, importMode, onImport, onClose, validateMapping]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setParsedCSV(null);
    setColumnMapping({});
    setImportMode('replace');
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Import CSV Data</h2>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* File Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select CSV File
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          {parsedCSV && (
            <>
              {/* Column Mapping */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Column Mapping</h3>
                <p className="text-xs text-gray-500 mb-3">
                  Map CSV columns to test variables. Unmapped columns will be ignored.
                </p>
                <div className="space-y-2">
                  {parsedCSV.headers.map((header) => (
                    <div key={header} className="flex items-center gap-3">
                      <div className="flex-1">
                        <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                          {header}
                        </span>
                      </div>
                      <div className="flex-shrink-0 text-gray-400">→</div>
                      <div className="flex-1">
                        <select
                          value={columnMapping[header] || ''}
                          onChange={(e) =>
                            handleMappingChange(header, e.target.value || null)
                          }
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">(Skip column)</option>
                          {variables.map((variable) => (
                            <option key={variable.name} value={variable.name}>
                              {variable.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Import Mode */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Import Mode</h3>
                <div className="space-y-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="importMode"
                      value="replace"
                      checked={importMode === 'replace'}
                      onChange={(e) => setImportMode(e.target.value as ImportMode)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">Replace All Data</div>
                      <div className="text-xs text-gray-500">
                        Delete existing data and replace with CSV content
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="importMode"
                      value="append"
                      checked={importMode === 'append'}
                      onChange={(e) => setImportMode(e.target.value as ImportMode)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">Append Rows</div>
                      <div className="text-xs text-gray-500">
                        Add CSV rows to the end of existing data
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={importMode === 'merge'}
                      onChange={(e) => setImportMode(e.target.value as ImportMode)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">Merge</div>
                      <div className="text-xs text-gray-500">
                        Update existing rows and append new ones (advanced)
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Preview */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Preview</h3>
                <div className="border border-gray-200 rounded overflow-auto max-h-48">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        {parsedCSV.headers.map((header) => (
                          <th
                            key={header}
                            className="px-3 py-2 text-left font-medium text-gray-700 border-b"
                          >
                            {header}
                            {columnMapping[header] && (
                              <div className="text-blue-600 font-normal">
                                → {columnMapping[header]}
                              </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedCSV.rows.slice(0, 5).map((row, idx) => (
                        <tr key={idx} className="border-b border-gray-100">
                          {row.map((cell, cellIdx) => (
                            <td key={cellIdx} className="px-3 py-2 text-gray-600">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Showing first {Math.min(5, parsedCSV.rows.length)} of {parsedCSV.rows.length}{' '}
                  rows
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={handleCancel}
            disabled={isImporting}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!parsedCSV || isImporting}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
