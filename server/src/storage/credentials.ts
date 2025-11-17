import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { CredentialRecord } from '../types.js';

const DATA_FILE = 'credentials.enc';
const KEY_FILE = 'credentials.key';

async function ensureKey(dataDir: string): Promise<Buffer> {
  const keyPath = path.join(dataDir, KEY_FILE);
  try {
    const raw = await fs.readFile(keyPath);
    if (raw.length === 32) {
      return raw;
    }
    const decoded = Buffer.from(raw.toString().trim(), 'base64');
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Will create new key below
  }

  const key = crypto.randomBytes(32);
  await fs.writeFile(keyPath, key.toString('base64'), { mode: 0o600 });
  return key;
}

async function readRawRecords(dataDir: string): Promise<CredentialRecord[]> {
  const filePath = path.join(dataDir, DATA_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    if (!raw.trim()) {
      return [];
    }
    const buffer = Buffer.from(raw.trim(), 'base64');
    if (buffer.length < 28) {
      return [];
    }
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const encrypted = buffer.subarray(28);
    const key = await ensureKey(dataDir);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
    const parsed = JSON.parse(decrypted);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    console.warn('[credentials] Failed to read credentials store:', error);
    return [];
  }
}

async function writeRawRecords(dataDir: string, records: CredentialRecord[]): Promise<void> {
  const filePath = path.join(dataDir, DATA_FILE);
  const payload = Buffer.from(JSON.stringify(records, null, 2), 'utf-8');
  const key = await ensureKey(dataDir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, tag, encrypted]).toString('base64');
  await fs.writeFile(filePath, blob, { mode: 0o600 });
}

export async function listCredentials(dataDir: string): Promise<CredentialRecord[]> {
  const records = await readRawRecords(dataDir);
  return records.sort(
    (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
  );
}

export async function getCredentialById(
  dataDir: string,
  id: string
): Promise<CredentialRecord | undefined> {
  const records = await readRawRecords(dataDir);
  return records.find((record) => record.id === id);
}

export interface CredentialInput {
  id?: string;
  name: string;
  username: string;
  password: string;
  notes?: string;
}

export async function upsertCredential(dataDir: string, input: CredentialInput): Promise<CredentialRecord> {
  const now = new Date().toISOString();
  const records = await readRawRecords(dataDir);
  const existingIndex = input.id
    ? records.findIndex((record) => record.id === input.id)
    : -1;

  if (existingIndex >= 0) {
    const existing = records[existingIndex];
    const updated: CredentialRecord = {
      ...existing,
      name: input.name.trim() || existing.name,
      username: input.username.trim(),
      password: input.password,
      notes: input.notes?.trim() || undefined,
      updatedAt: now
    };
    records[existingIndex] = updated;
  } else {
    const newRecord: CredentialRecord = {
      id: input.id || `cred-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: input.name.trim(),
      username: input.username.trim(),
      password: input.password,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now
    };
    records.push(newRecord);
  }

  await writeRawRecords(dataDir, records);
  const id = input.id || records[records.length - 1].id;
  return (await getCredentialById(dataDir, id))!;
}

export async function deleteCredential(dataDir: string, id: string): Promise<void> {
  const records = await readRawRecords(dataDir);
  const filtered = records.filter((record) => record.id !== id);
  if (filtered.length === records.length) {
    throw new Error('Credential not found');
  }
  await writeRawRecords(dataDir, filtered);
}

export async function serializeCredentialsBlob(dataDir: string): Promise<string | null> {
  const records = await readRawRecords(dataDir);
  if (!records.length) {
    return null;
  }
  const sanitized = records.map((record) => ({
    id: record.id,
    name: record.name,
    username: record.username,
    password: record.password,
    notes: record.notes,
    lastUsedAt: record.lastUsedAt
  }));
  const payload = JSON.stringify(sanitized);
  return Buffer.from(payload, 'utf-8').toString('base64');
}
