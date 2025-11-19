import express from 'express';
import { CONFIG } from '../config.js';
import { VariableStorage } from '../storage/variables.js';
import { loadTest, updateTestMetadata } from '../storage/tests.js';
import type { VariableDefinition, VariableRow } from '../types.js';

const router = express.Router();
const storage = new VariableStorage(CONFIG.DATA_DIR);

async function ensureTestExists(testId: string) {
  try {
    await loadTest(CONFIG.DATA_DIR, testId);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      const notFound = new Error('NOT_FOUND');
      (notFound as any).code = 'NOT_FOUND';
      throw notFound;
    }
    throw error;
  }
}

function normalizeRows(payload: unknown): VariableRow[] {
  if (!Array.isArray(payload)) {
    throw new Error('rows must be an array of objects');
  }

  return payload.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Row at index ${index} must be an object`);
    }

    const normalized: VariableRow = {};
    for (const [key, value] of Object.entries(entry)) {
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        continue;
      }
      normalized[trimmedKey] =
        value === undefined || value === null ? '' : String(value);
    }
    return normalized;
  });
}

function parseVariableDefinitions(payload: unknown): VariableDefinition[] | undefined {
  if (!payload) {
    return undefined;
  }
  if (!Array.isArray(payload)) {
    throw new Error('variables must be an array when provided');
  }
  return payload.map((def) => {
    if (!def || typeof def !== 'object') {
      throw new Error('variable definitions must be objects');
    }
    const name = typeof (def as any).name === 'string' ? (def as any).name.trim() : '';
    if (!name) {
      throw new Error('variable name is required');
    }
    const type = (def as any).type === 'number' ? 'number' : 'string';
    const sampleValue =
      typeof (def as any).sampleValue === 'string'
        ? (def as any).sampleValue
        : typeof (def as any).sampleValue === 'number'
          ? String((def as any).sampleValue)
          : undefined;
    return {
      name,
      type,
      sampleValue
    };
  });
}

async function updateMetadataForRows(
  testId: string,
  rows: VariableRow[],
  variables?: VariableDefinition[]
): Promise<void> {
  const hasRows = rows.length > 0;
  const updates: Partial<{
    dataSource: string | undefined;
    variables?: VariableDefinition[];
  }> = {
    dataSource: hasRows ? `${testId}.csv` : undefined
  };

  if (variables) {
    updates.variables = variables;
  }

  await updateTestMetadata(CONFIG.DATA_DIR, testId, updates);
}

router.get('/:testId/variables', async (req, res) => {
  const { testId } = req.params;
  try {
    const test = await loadTest(CONFIG.DATA_DIR, testId);
    const data = await storage.readVariables(testId);
    const variables = test.metadata.variables || [];
    return res.json({ variables, data });
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Test not found' });
    }
    console.error('[variables] Failed to read variables:', error);
    return res.status(500).json({ error: 'Unable to load variable data' });
  }
});

router.put('/:testId/variables', async (req, res) => {
  const { testId } = req.params;
  try {
    await ensureTestExists(testId);
    const rows = normalizeRows(req.body?.rows ?? req.body?.data ?? req.body);
    const definitions = parseVariableDefinitions(req.body?.variables);

    if (!rows.length) {
      await storage.deleteVariables(testId);
      await updateMetadataForRows(testId, [], definitions);
      return res.json({ rows: [] });
    }

    const written = await storage.writeVariables(testId, rows);
    await updateMetadataForRows(testId, written, definitions);
    return res.json({ rows: written });
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Test not found' });
    }
    console.error('[variables] Failed to write variables:', error);
    return res.status(400).json({ error: error?.message || 'Unable to save data' });
  }
});

router.post('/:testId/variables/import', async (req, res) => {
  const { testId } = req.params;
  const { csvContent, columnMapping, mode, variables } = req.body ?? {};
  try {
    await ensureTestExists(testId);

    if (typeof csvContent !== 'string') {
      return res.status(400).json({ error: 'csvContent is required' });
    }

    const importMode: ImportMode =
      mode === 'append' || mode === 'replace' ? mode : 'replace';

    const rows = await storage.importCSV(testId, csvContent, columnMapping, importMode);
    const defs = parseVariableDefinitions(variables);
    await updateMetadataForRows(testId, rows, defs);

    return res.json({ rows, rowCount: rows.length });
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Test not found' });
    }
    console.error('[variables] Failed to import CSV:', error);
    return res.status(400).json({ error: error?.message || 'Unable to import CSV data' });
  }
});

router.get('/:testId/variables/export', async (req, res) => {
  const { testId } = req.params;
  try {
    await ensureTestExists(testId);
    const csv = await storage.exportCSV(testId);

    if (!csv) {
      return res.status(404).json({ error: 'No variable data found' });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(testId)}.csv"`
    );
    return res.send(csv);
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND') {
      return res.status(404).json({ error: 'Test not found' });
    }
    console.error('[variables] Failed to export CSV:', error);
    return res.status(500).json({ error: 'Unable to export CSV data' });
  }
});

export default router;

type ImportMode = 'replace' | 'append';
