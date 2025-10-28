import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import type { RunResult } from '../../shared/types.js';

export interface RunTestOptions {
  dataDir: string;
  testId: string;
}

export async function runTest(options: RunTestOptions): Promise<RunResult> {
  const { dataDir, testId } = options;
  const testFile = path.join(dataDir, 'tests', `${testId}.spec.ts`);

  // Create run ID
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${testId}`;
  const runDir = path.join(dataDir, 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn('npx', [
      'playwright', 'test',
      testFile,
      '--reporter=json'
    ], {
      cwd: dataDir,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      try {
        // Parse Playwright JSON output
        const resultsPath = path.join(dataDir, 'runs', 'latest', 'results.json');
        let playwrightResults: any;

        try {
          const resultsContent = await fs.readFile(resultsPath, 'utf-8');
          playwrightResults = JSON.parse(resultsContent);
        } catch (err) {
          playwrightResults = null;
        }

        // Move artifacts to run directory
        const latestDir = path.join(dataDir, 'runs', 'latest');
        try {
          const files = await fs.readdir(latestDir);
          for (const file of files) {
            if (file.endsWith('.zip') || file.endsWith('.webm') || file.endsWith('.png')) {
              await fs.rename(
                path.join(latestDir, file),
                path.join(runDir, file)
              );
            }
          }
        } catch (err) {
          // Ignore if no artifacts
        }

        // Determine status
        let status: 'passed' | 'failed' | 'skipped' = 'passed';
        let error: string | undefined;

        if (playwrightResults?.suites) {
          const tests = playwrightResults.suites.flatMap((s: any) => s.specs || []);
          const failed = tests.some((t: any) =>
            t.tests?.some((test: any) =>
              test.results?.some((r: any) => r.status === 'failed')
            )
          );

          if (failed) {
            status = 'failed';
            const failedTest = tests.find((t: any) =>
              t.tests?.some((test: any) =>
                test.results?.some((r: any) => r.status === 'failed')
              )
            );
            error = failedTest?.tests?.[0]?.results?.[0]?.error?.message || 'Test failed';
          }
        } else if (code !== 0) {
          status = 'failed';
          error = stderr || 'Test execution failed';
        }

        // Find trace file
        let tracePath: string | undefined;
        try {
          const runFiles = await fs.readdir(runDir);
          const traceFile = runFiles.find(f => f.endsWith('.zip'));
          if (traceFile) {
            tracePath = path.join(runDir, traceFile);
          }
        } catch (err) {
          // No trace
        }

        const result: RunResult = {
          id: runId,
          testId,
          status,
          duration,
          startedAt: new Date(startTime).toISOString(),
          endedAt: new Date(endTime).toISOString(),
          tracePath,
          error
        };

        // Save result.json
        await fs.writeFile(
          path.join(runDir, 'result.json'),
          JSON.stringify(result, null, 2)
        );

        resolve(result);
      } catch (err: any) {
        reject(new Error(`Failed to process test results: ${err.message}`));
      }
    });
  });
}

export async function getRunResult(dataDir: string, runId: string): Promise<RunResult> {
  const resultPath = path.join(dataDir, 'runs', runId, 'result.json');
  const content = await fs.readFile(resultPath, 'utf-8');
  return JSON.parse(content);
}

export async function listRuns(dataDir: string, testId?: string): Promise<RunResult[]> {
  const runsDir = path.join(dataDir, 'runs');

  try {
    const runDirs = await fs.readdir(runsDir);

    const runs = await Promise.all(
      runDirs
        .filter(dir => dir !== 'latest')
        .map(async (dir) => {
          try {
            const result = await getRunResult(dataDir, dir);
            return result;
          } catch {
            return null;
          }
        })
    );

    const validRuns = runs.filter((r): r is RunResult => r !== null);

    if (testId) {
      return validRuns
        .filter(r => r.testId === testId)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    }

    return validRuns.sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  } catch (err) {
    return [];
  }
}
