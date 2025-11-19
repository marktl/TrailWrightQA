import path from 'node:path';
import fs from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import type { VariableRow } from '../types.js';

type ImportMode = 'replace' | 'append';

export type ColumnMapping = Record<string, string | null | undefined>;

function normalizeMapping(mapping?: ColumnMapping | null): ColumnMapping {
  if (!mapping) {
    return {};
  }
  return Object.entries(mapping).reduce<ColumnMapping>((acc, [source, target]) => {
    const key = source?.trim();
    if (!key) {
      return acc;
    }
    const normalizedTarget = typeof target === 'string' ? target.trim() : target;
    if (normalizedTarget) {
      acc[key] = normalizedTarget;
    } else {
      acc[key] = null;
    }
    return acc;
  }, {});
}

export class VariableStorage {
  private dataDir: string;

  constructor(private baseDir: string) {
    this.dataDir = path.join(baseDir, 'test-data');
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  private getCsvPath(testId: string): string {
    return path.join(this.dataDir, `${testId}.csv`);
  }

  async readVariables(testId: string): Promise<VariableRow[]> {
    const csvPath = this.getCsvPath(testId);
    try {
      const content = await fs.readFile(csvPath, 'utf-8');
      if (!content.trim()) {
        return [];
      }
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      }) as VariableRow[];
      return records;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to read variables for ${testId}: ${error?.message || error}`);
    }
  }

  async writeVariables(testId: string, rows: VariableRow[]): Promise<VariableRow[]> {
    await this.ensureDir();
    const csvPath = this.getCsvPath(testId);

    if (!rows || rows.length === 0) {
      await fs.writeFile(csvPath, '');
      return [];
    }

    const columns = this.buildColumnOrder(rows);
    const csv = stringify(rows, {
      header: true,
      columns
    });
    await fs.writeFile(csvPath, csv, 'utf-8');
    return rows;
  }

  async deleteVariables(testId: string): Promise<void> {
    const csvPath = this.getCsvPath(testId);
    try {
      await fs.unlink(csvPath);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async importCSV(
    testId: string,
    csvContent: string,
    columnMapping?: ColumnMapping | null,
    mode: ImportMode = 'replace'
  ): Promise<VariableRow[]> {
    if (typeof csvContent !== 'string' || !csvContent.trim()) {
      throw new Error('csvContent must be a non-empty string');
    }

    const mapping = normalizeMapping(columnMapping);
    const rows = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as VariableRow[];

    if (!rows.length) {
      throw new Error('CSV file must include at least one data row');
    }

    const mappedRows = rows.map((row) => this.mapRow(row, mapping));
    const filteredRows = mappedRows.filter((row) => Object.keys(row).length > 0);

    if (!filteredRows.length) {
      throw new Error('Column mapping resulted in zero mapped columns');
    }

    if (mode === 'append') {
      const existing = await this.readVariables(testId);
      return this.writeVariables(testId, [...existing, ...filteredRows]);
    }

    return this.writeVariables(testId, filteredRows);
  }

  async exportCSV(testId: string): Promise<string> {
    const csvPath = this.getCsvPath(testId);
    try {
      const content = await fs.readFile(csvPath, 'utf-8');
      return content;
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  private buildColumnOrder(rows: VariableRow[]): string[] {
    const order: string[] = [];
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (key && !order.includes(key)) {
          order.push(key);
        }
      }
    }
    return order;
  }

  private mapRow(row: VariableRow, mapping: ColumnMapping): VariableRow {
    const mapped: VariableRow = {};
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        continue;
      }

      // Check if this column is in the mapping
      const hasMappingEntry = Object.hasOwn(mapping, normalizedKey);
      const target = hasMappingEntry ? mapping[normalizedKey] : normalizedKey;

      // Skip if explicitly mapped to null/undefined
      if (!target) {
        continue;
      }

      mapped[target] = value === undefined || value === null ? '' : String(value);
    }
    return mapped;
  }
}
