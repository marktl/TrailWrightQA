import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

export interface VariableDefinition {
  name: string;
  type?: 'string' | 'number';
  sampleValue?: string;
}

export type VariableRow = Record<string, string>;

export interface VariableDataGridProps {
  testId: string;
  variables: VariableDefinition[];
  data: VariableRow[];
  onDataChange: (data: VariableRow[]) => Promise<void>;
  onExportCSV: () => void;
  disabled?: boolean;
}

/**
 * Spreadsheet component for editing test variable data using ag-grid
 * Supports inline editing, row add/delete, and auto-save
 */
export function VariableDataGrid({
  variables,
  data,
  onDataChange,
  onExportCSV,
  disabled = false
}: VariableDataGridProps) {
  const gridRef = useRef<AgGridReact>(null);
  const [rowData, setRowData] = useState<VariableRow[]>(data);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update local state when prop data changes
  useEffect(() => {
    setRowData(data);
  }, [data]);

  // Generate column definitions from variables
  const columnDefs = useMemo<ColDef[]>(() => {
    if (variables.length === 0) {
      return [
        {
          headerName: 'No Variables',
          field: 'placeholder',
          flex: 1,
          editable: false
        }
      ];
    }

    return variables.map((variable) => ({
      headerName: variable.name,
      field: variable.name,
      editable: !disabled,
      flex: 1,
      cellEditor: variable.type === 'number' ? 'agNumberCellEditor' : 'agTextCellEditor',
      cellEditorParams: variable.type === 'number' ? { precision: 0 } : undefined,
      valueSetter: (params) => {
        if (params.newValue !== params.oldValue) {
          params.data[variable.name] = params.newValue;
          return true;
        }
        return false;
      }
    }));
  }, [variables, disabled]);

  // Auto-save when data changes
  const handleCellValueChanged = useCallback(async () => {
    const api = gridRef.current?.api;
    if (!api) return;

    const allRows: VariableRow[] = [];
    api.forEachNode((node) => {
      if (node.data) {
        allRows.push(node.data);
      }
    });

    setRowData(allRows);

    try {
      setSaving(true);
      setError(null);
      await onDataChange(allRows);
    } catch (err: any) {
      setError(err.message || 'Failed to save data');
    } finally {
      setSaving(false);
    }
  }, [onDataChange]);

  // Add a new empty row
  const handleAddRow = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;

    const newRow: VariableRow = {};
    variables.forEach((variable) => {
      newRow[variable.name] = '';
    });

    const updatedData = [...rowData, newRow];
    setRowData(updatedData);
    api.setGridOption('rowData', updatedData);

    // Auto-save the new row
    void onDataChange(updatedData);
  }, [variables, rowData, onDataChange]);

  // Delete selected rows
  const handleDeleteRows = useCallback(async () => {
    const api = gridRef.current?.api;
    if (!api) return;

    const selectedNodes = api.getSelectedNodes();
    if (selectedNodes.length === 0) {
      setError('No rows selected');
      return;
    }

    const selectedData = selectedNodes.map((node) => node.data);
    const updatedData = rowData.filter((row) => !selectedData.includes(row));

    setRowData(updatedData);
    api.setGridOption('rowData', updatedData);

    try {
      setSaving(true);
      setError(null);
      await onDataChange(updatedData);
    } catch (err: any) {
      setError(err.message || 'Failed to delete rows');
    } finally {
      setSaving(false);
    }
  }, [rowData, onDataChange]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: false,
      resizable: true,
      minWidth: 100
    }),
    []
  );

  if (variables.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-sm text-gray-500">
          No variables defined for this test. Create variables during test generation to enable data-driven testing.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Test Data</h3>
          {saving && <span className="text-xs text-blue-600">Saving...</span>}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleAddRow}
            disabled={disabled}
            className="text-xs px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + Add Row
          </button>
          <button
            onClick={handleDeleteRows}
            disabled={disabled}
            className="text-xs px-3 py-1.5 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete Selected
          </button>
          <button
            onClick={onExportCSV}
            className="text-xs px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {error}
        </div>
      )}

      <div className="ag-theme-alpine" style={{ height: '400px', width: '100%' }}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowSelection="multiple"
          suppressRowClickSelection={true}
          onCellValueChanged={handleCellValueChanged}
          animateRows={true}
          enableCellChangeFlash={true}
        />
      </div>

      <div className="mt-3 text-xs text-gray-500">
        <p>
          {rowData.length} row{rowData.length !== 1 ? 's' : ''} • {variables.length} variable
          {variables.length !== 1 ? 's' : ''}
        </p>
        <p className="mt-1">
          Click a cell to edit • Select rows with checkbox and click "Delete Selected" to remove
        </p>
      </div>
    </div>
  );
}
