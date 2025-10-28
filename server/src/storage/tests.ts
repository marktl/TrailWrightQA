import fs from 'fs/promises';
import path from 'path';
import type { Test, TestMetadata } from '../../shared/types.js';

const METADATA_DELIMITER = '// === TRAILWRIGHT_METADATA ===';

function serializeTest(test: Test): string {
  const metadataComment = `/**\n * ${METADATA_DELIMITER}\n * ${JSON.stringify(test.metadata, null, 2)}\n */\n\n`;
  return metadataComment + test.code;
}

function parseTest(content: string, testId: string): Test {
  const metadataMatch = content.match(/\/\*\*\n \* \/\/ === TRAILWRIGHT_METADATA ===\n \* ([\s\S]*?)\n \*\//);

  if (metadataMatch) {
    const metadata = JSON.parse(metadataMatch[1]);
    const code = content.replace(metadataMatch[0], '').trim();
    return { metadata, code };
  }

  // Fallback for tests without metadata
  return {
    metadata: {
      id: testId,
      name: testId,
      createdAt: new Date().toISOString()
    },
    code: content
  };
}

export async function saveTest(dataDir: string, test: Test): Promise<void> {
  const testsDir = path.join(dataDir, 'tests');
  const filePath = path.join(testsDir, `${test.metadata.id}.spec.ts`);
  const content = serializeTest(test);
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function loadTest(dataDir: string, testId: string): Promise<Test> {
  const testsDir = path.join(dataDir, 'tests');
  const filePath = path.join(testsDir, `${testId}.spec.ts`);
  const content = await fs.readFile(filePath, 'utf-8');
  return parseTest(content, testId);
}

export async function listTests(dataDir: string): Promise<TestMetadata[]> {
  const testsDir = path.join(dataDir, 'tests');

  try {
    const files = await fs.readdir(testsDir);
    const testFiles = files.filter(f => f.endsWith('.spec.ts'));

    const tests = await Promise.all(
      testFiles.map(async (file) => {
        const testId = file.replace('.spec.ts', '');
        const test = await loadTest(dataDir, testId);
        return test.metadata;
      })
    );

    return tests.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (err) {
    return [];
  }
}

export async function deleteTest(dataDir: string, testId: string): Promise<void> {
  const testsDir = path.join(dataDir, 'tests');
  const filePath = path.join(testsDir, `${testId}.spec.ts`);
  await fs.unlink(filePath);
}
