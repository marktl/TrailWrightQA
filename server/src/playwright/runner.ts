import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import type { RunResult } from '../types.js';
import { resolveNpxInvocation } from '../utils/npx.js';

export interface RunTestOptions {
  dataDir: string;
  testId: string;
  headed?: boolean;
  speed?: number;
}

export interface RunExecutionContext {
  dataDir: string;
  testId: string;
  testFile: string;
  runId: string;
  runDir: string;
  startTime: number;
  options: {
    headed: boolean;
    speed: number;
    slowMo: number;
  };
}

export interface FinalizeRunOptions {
  terminated?: boolean;
  terminationReason?: string;
}

const ARTIFACT_EXTENSIONS = ['.zip', '.webm', '.png'];

export async function createRunExecutionContext(
  dataDir: string,
  testId: string,
  preferences?: { headed?: boolean; speed?: number }
): Promise<RunExecutionContext> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${testId}`;
  const runDir = path.join(dataDir, 'runs', runId);
  const testFile = path.join(dataDir, 'tests', `${testId}.spec.ts`);

  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'runs', 'latest'), { recursive: true });

  const headed = typeof preferences?.headed === 'boolean' ? preferences.headed : true;
  const rawSpeed = typeof preferences?.speed === 'number' ? preferences.speed : 1;
  const normalizedSpeed = Number.isFinite(rawSpeed) ? Math.min(2, Math.max(0.5, rawSpeed)) : 1;
  const slowMo = normalizedSpeed < 1 ? Math.round((1 - normalizedSpeed) * 1000) : 0;

  return {
    dataDir,
    testId,
    testFile,
    runId,
    runDir,
    startTime: Date.now(),
    options: {
      headed,
      speed: normalizedSpeed,
      slowMo
    }
  };
}

export async function finalizeRunExecution(
  context: RunExecutionContext,
  exitCode: number | null,
  stderr: string,
  options: FinalizeRunOptions = {}
): Promise<RunResult> {
  const endTime = Date.now();
  const duration = endTime - context.startTime;

  // Attempt to parse Playwright JSON output
  const resultsPath = path.join(context.dataDir, 'runs', 'latest', 'results.json');
  let playwrightResults: any = null;

  try {
    const resultsContent = await fs.readFile(resultsPath, 'utf-8');
    playwrightResults = JSON.parse(resultsContent);
  } catch {
    // Ignore JSON parse failures – happens on early termination
  }

  // Move generated artifacts into run directory
  const latestDir = path.join(context.dataDir, 'runs', 'latest');
  try {
    const files = await fs.readdir(latestDir);
    await Promise.all(
      files
        .filter((file) => ARTIFACT_EXTENSIONS.some((ext) => file.endsWith(ext)))
        .map((file) =>
          fs.rename(path.join(latestDir, file), path.join(context.runDir, file)).catch(() => void 0)
        )
    );
  } catch {
    // Ignore if there is no latest directory or artifacts
  }

  let status: RunResult['status'] = 'passed';
  let error: string | undefined;

  if (options.terminated) {
    status = 'stopped';
    error = options.terminationReason || 'Run terminated by user';
  } else if (playwrightResults?.suites) {
    const suites = playwrightResults.suites ?? [];
    const specs = suites.flatMap((suite: any) => suite.specs ?? []);

    const failingSpec = specs.find((spec: any) =>
      spec.tests?.some((test: any) =>
        test.results?.some((result: any) => result.status === 'failed')
      )
    );

    if (failingSpec) {
      status = 'failed';
      const failingResult =
        failingSpec.tests?.[0]?.results?.find((result: any) => result.status === 'failed') ?? null;
      error =
        failingResult?.error?.message ||
        failingResult?.error?.value ||
        'Test failed – see Playwright trace for details';
    } else {
      status = 'passed';
    }
  } else if (exitCode !== 0) {
    status = 'failed';
    error = stderr || 'Test execution failed';
  }

  // Locate trace artifact if present
  let tracePath: string | undefined;
  try {
    const runFiles = await fs.readdir(context.runDir);
    const traceFile = runFiles.find((file) => file.endsWith('.zip'));
    if (traceFile) {
      tracePath = path.join(context.runDir, traceFile);
    }
  } catch {
    // Ignore trace discovery errors
  }

  const result: RunResult = {
    id: context.runId,
    testId: context.testId,
    status,
    duration,
    startedAt: new Date(context.startTime).toISOString(),
    endedAt: new Date(endTime).toISOString(),
    tracePath,
    error
  };

  await fs.writeFile(path.join(context.runDir, 'result.json'), JSON.stringify(result, null, 2));

  return result;
}

export async function runTest(options: RunTestOptions): Promise<RunResult> {
  const context = await createRunExecutionContext(options.dataDir, options.testId, {
    headed: options.headed,
    speed: options.speed
  });
  const npx = await resolveNpxInvocation();
  const baseEnv = npx.env ?? process.env;

  // Use relative path from dataDir since that's our cwd
  // Normalize to forward slashes for cross-platform compatibility
  const relativeTestPath = path.relative(context.dataDir, context.testFile).replace(/\\/g, '/');

  return new Promise((resolve, reject) => {
    const args = [...npx.argsPrefix, 'playwright', 'test', relativeTestPath];
    if (context.options.headed) {
      args.push('--headed');
    }

    const proc: ChildProcessWithoutNullStreams = spawn(npx.command, args, {
      cwd: context.dataDir,
      env: {
        ...baseEnv,
        TRAILWRIGHT_HEADLESS: context.options.headed ? 'false' : 'true',
        TRAILWRIGHT_SLOWMO: String(context.options.slowMo)
      }
    });

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      try {
        const result = await finalizeRunExecution(context, code, stderr);
        resolve(result);
      } catch (error: any) {
        reject(new Error(`Failed to process test results: ${error.message}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
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
        .filter((dir) => dir !== 'latest')
        .map(async (dir): Promise<RunResult | null> => {
          try {
            const result = await getRunResult(dataDir, dir);
            return result;
          } catch {
            return null;
          }
        })
    );

    const validRuns = runs.filter((run): run is RunResult => run !== null);

    if (testId) {
      return validRuns
        .filter((run) => run.testId === testId)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    }

    return validRuns.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  } catch {
    return [];
  }
}
