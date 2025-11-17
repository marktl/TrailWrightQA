import express from 'express';
import { CONFIG } from '../config.js';
import {
  deleteCredential,
  getCredentialById,
  listCredentials,
  upsertCredential
} from '../storage/credentials.js';

const router = express.Router();

function sanitizeCredential(record: Awaited<ReturnType<typeof upsertCredential>>) {
  return {
    id: record.id,
    name: record.name,
    username: record.username,
    password: record.password,
    notes: record.notes,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt
  };
}

router.get('/', async (_req, res) => {
  try {
    const credentials = await listCredentials(CONFIG.DATA_DIR);
    res.json({
      credentials: credentials.map((record) => sanitizeCredential(record))
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Unable to load credentials' });
  }
});

router.post('/', async (req, res) => {
  const { name, username, password, notes } = req.body ?? {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Name, username, and password are required' });
  }

  try {
    const record = await upsertCredential(CONFIG.DATA_DIR, {
      name: String(name),
      username: String(username),
      password: String(password),
      notes: typeof notes === 'string' ? notes : undefined
    });
    res.status(201).json({ credential: sanitizeCredential(record) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Unable to save credential' });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, username, password, notes } = req.body ?? {};
  if (!name || !username) {
    return res.status(400).json({ error: 'Name and username are required' });
  }

  try {
    const existing = await getCredentialById(CONFIG.DATA_DIR, id);
    if (!existing) {
      return res.status(404).json({ error: 'Credential not found' });
    }

    const record = await upsertCredential(CONFIG.DATA_DIR, {
      id,
      name: String(name),
      username: String(username),
      password: typeof password === 'string' && password.trim() ? String(password) : existing.password,
      notes: typeof notes === 'string' ? notes : undefined
    });
    res.json({ credential: sanitizeCredential(record) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Unable to update credential' });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await deleteCredential(CONFIG.DATA_DIR, id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(404).json({ error: error?.message || 'Credential not found' });
  }
});

export default router;
