import fs from 'fs/promises';
import path from 'path';

const PACKAGE_JSON = {
  name: '@trailwright/credentials',
  version: '1.0.0',
  main: 'index.js',
  types: 'index.d.ts',
  description: 'TrailWright helper for accessing encrypted credentials at runtime'
};

const INDEX_SOURCE = `const CACHE_KEY = Symbol.for('trailwright.credentials.cache');

function decodeBlob() {
  const raw = process.env.TRAILWRIGHT_CREDENTIALS_BLOB;
  if (!raw) {
    return [];
  }
  try {
    const json = Buffer.from(raw, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        id: item.id,
        name: item.name,
        username: item.username,
        password: item.password,
        notes: item.notes,
        lastUsedAt: item.lastUsedAt
      }));
    }
  } catch {
    // Ignore malformed data
  }
  return [];
}

function getStore() {
  const globalScope = globalThis;
  if (!globalScope[CACHE_KEY]) {
    globalScope[CACHE_KEY] = decodeBlob();
  }
  return globalScope[CACHE_KEY];
}

function listCredentials() {
  return [...getStore()];
}

function getCredential(identifier) {
  const store = getStore();
  const match = store.find((record) => record.id === identifier || record.name === identifier);
  if (!match) {
    throw new Error('Credential not found: ' + identifier);
  }
  return match;
}

module.exports = {
  listCredentials,
  getCredential
};
`;

const INDEX_TYPES = `export type TrailwrightCredential = {
  id: string;
  name: string;
  username: string;
  password: string;
  notes?: string;
  lastUsedAt?: string;
};

export declare function listCredentials(): TrailwrightCredential[];
export declare function getCredential(identifier: string): TrailwrightCredential;
`;

export async function ensureCredentialHelper(dataDir: string): Promise<void> {
  const nodeModules = path.join(dataDir, 'node_modules', '@trailwright', 'credentials');
  await fs.mkdir(nodeModules, { recursive: true });

  const files: Array<[string, string]> = [
    ['package.json', JSON.stringify(PACKAGE_JSON, null, 2)],
    ['index.js', INDEX_SOURCE],
    ['index.d.ts', INDEX_TYPES]
  ];

  for (const [file, contents] of files) {
    const target = path.join(nodeModules, file);
    await fs.writeFile(target, contents, 'utf-8');
  }
}
