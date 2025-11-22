import fs from 'fs/promises';
import path from 'path';

type CleanupSummary = {
  removedTestFolders: string[];
  removedRunFolders: string[];
  removedDataFiles: string[];
};

async function collectSavedTestIds(dataDir: string): Promise<Set<string>> {
  const testsDir = path.join(dataDir, 'tests');
  const saved = new Set<string>();

  try {
    const entries = await fs.readdir(testsDir);
    entries
      .filter((name) => name.endsWith('.spec.ts'))
      .forEach((name) => saved.add(name.replace(/\.spec\.ts$/, '')));
  } catch (error) {
    console.error('[cleanup] Unable to read tests directory for saved ids', error);
  }

  return saved;
}

async function cleanupTestFolders(dataDir: string, savedTestIds: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  const testsDir = path.join(dataDir, 'tests');

  try {
    const entries = await fs.readdir(testsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (savedTestIds.has(entry.name)) {
        continue;
      }

      const target = path.join(testsDir, entry.name);
      await fs.rm(target, { recursive: true, force: true });
      removed.push(entry.name);
    }
  } catch (error) {
    console.error('[cleanup] Failed to prune orphaned test folders', error);
  }

  return removed;
}

async function cleanupRunFolders(dataDir: string, savedTestIds: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  const runsDir = path.join(dataDir, 'runs');

  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'latest') {
        continue;
      }

      const runDir = path.join(runsDir, entry.name);
      const runIdParts = entry.name.split('_');
      const inferredTestId = runIdParts.length > 1 ? runIdParts.slice(1).join('_') : null;

      let testId = inferredTestId;
      try {
        const resultPath = path.join(runDir, 'result.json');
        const resultContent = await fs.readFile(resultPath, 'utf-8');
        const parsed = JSON.parse(resultContent);
        if (parsed?.testId && typeof parsed.testId === 'string') {
          testId = parsed.testId;
        }
      } catch {
        // Missing or unreadable result.json – fall back to inferred id
      }

      if (testId && savedTestIds.has(testId)) {
        continue;
      }

      await fs.rm(runDir, { recursive: true, force: true });
      removed.push(entry.name);
    }
  } catch (error) {
    console.error('[cleanup] Failed to prune orphaned run folders', error);
  }

  return removed;
}

async function cleanupTestDataFiles(dataDir: string, savedTestIds: Set<string>): Promise<string[]> {
  const removed: string[] = [];
  const testDataDir = path.join(dataDir, 'test-data');

  try {
    const entries = await fs.readdir(testDataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.csv')) {
        continue;
      }
      const testId = entry.name.replace(/\.csv$/, '');
      if (savedTestIds.has(testId)) {
        continue;
      }

      const target = path.join(testDataDir, entry.name);
      await fs.rm(target, { force: true });
      removed.push(entry.name);
    }
  } catch (error) {
    console.error('[cleanup] Failed to prune orphaned test data files', error);
  }

  return removed;
}

export async function cleanupOrphanedTestArtifacts(dataDir: string): Promise<CleanupSummary> {
  const savedTestIds = await collectSavedTestIds(dataDir);

  const [removedTestFolders, removedRunFolders, removedDataFiles] = await Promise.all([
    cleanupTestFolders(dataDir, savedTestIds),
    cleanupRunFolders(dataDir, savedTestIds),
    cleanupTestDataFiles(dataDir, savedTestIds)
  ]);

  return {
    removedTestFolders,
    removedRunFolders,
    removedDataFiles
  };
}
