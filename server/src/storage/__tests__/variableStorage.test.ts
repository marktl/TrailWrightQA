import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { VariableStorage } from '../variables.js';

describe('VariableStorage', () => {
  let dataRoot: string;
  let storage: VariableStorage;

  beforeEach(() => {
    dataRoot = path.join(os.tmpdir(), `trailwright-vars-${Date.now()}`);
    storage = new VariableStorage(dataRoot);
  });

  afterEach(async () => {
    await fs.rm(dataRoot, { recursive: true, force: true });
  });

  it('writes and reads variable rows', async () => {
    const rows = [
      { product: 'teddy bear', color: 'brown' },
      { product: 'action figure', color: 'red' }
    ];

    await storage.writeVariables('test-123', rows);
    const loaded = await storage.readVariables('test-123');

    expect(loaded).toEqual(rows);
  });

  it('appends during CSV import when requested', async () => {
    const initialRows = [{ product: 'bear', color: 'brown' }];
    await storage.writeVariables('test-append', initialRows);

    const csv = `product,color\nrobot,chrome`;
    const merged = await storage.importCSV('test-append', csv, undefined, 'append');
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ product: 'robot', color: 'chrome' });
  });

  it('maps CSV columns based on mapping object', async () => {
    const csv = `Item,Shade,Ignored\nBear,Brown,noop`;
    const rows = await storage.importCSV(
      'test-map',
      csv,
      { Item: 'product', Shade: 'color', Ignored: null },
      'replace'
    );

    expect(rows).toEqual([{ product: 'Bear', color: 'Brown' }]);
  });

  it('deletes CSV file when requested', async () => {
    await storage.writeVariables('test-delete', [{ product: 'sample' }]);
    await storage.deleteVariables('test-delete');

    const loaded = await storage.readVariables('test-delete');
    expect(loaded).toEqual([]);
  });
});
