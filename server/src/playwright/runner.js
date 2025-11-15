import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { resolveNpxInvocation } from '../utils/npx.js';

const ARTIFACT_EXTENSIONS = ['.zip', '.webm', '.png'];

export async function createRunExecutionContext(dataDir, testId, preferences = {}) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${testId}`;
  const runDir = path.join(dataDir, 'runs', runId);
  const testFile = path.join(dataDir, 'tests', `${testId}.spec.ts`);

  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'runs', 'latest'), { recursive: true });

  const headed = typeof preferences.headed === 'boolean' ? preferences.headed : true;
  const rawSpeed = typeof preferences.speed === 'number' ? preferences.speed : 1;
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

export async function finalizeRunExecution(context, exitCode, stderr, options = {}) {
  const endTime = Date.now();
  const duration = endTime - context.startTime;

  const resultsPath = path.join(context.dataDir, 'runs', 'latest', 'results.json');
  let playwrightResults = null;

  try {
    const resultsContent = await fs.readFile(resultsPath, 'utf-8');
    playwrightResults = JSON.parse(resultsContent);
  } catch {
    // Ignore JSON parse failures – happens on early termination
  }

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

  let status = 'passed';
  let error;

  if (options.terminated) {
    status = 'stopped';
    error = options.terminationReason || 'Run terminated by user';
  } else if (playwrightResults?.suites) {
    const suites = playwrightResults.suites ?? [];
    const specs = suites.flatMap((suite) => suite.specs ?? []);
    const failingSpec = specs.find((spec) =>
      spec.tests?.some((test) => test.results?.some((result) => result.status === 'failed'))
    );

    if (failingSpec) {
      status = 'failed';
      const failingResult =
        failingSpec.tests?.[0]?.results?.find((result) => result.status === 'failed') ?? null;
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

  let tracePath;
  try {
    const runFiles = await fs.readdir(context.runDir);
    const traceFile = runFiles.find((file) => file.endsWith('.zip'));
    if (traceFile) {
      tracePath = path.join(context.runDir, traceFile);
    }
  } catch {
    // Ignore trace discovery errors
  }

  const result = {
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

export async function runTest(options) {
  const context = await createRunExecutionContext(options.dataDir, options.testId, {
    headed: options.headed,
    speed: options.speed
  });
  const npx = await resolveNpxInvocation();
  const baseEnv = npx.env ?? process.env;

  const relativeTestPath = path.relative(context.dataDir, context.testFile).replace(/\\/g, '/');

  return new Promise((resolve, reject) => {
    const args = [...npx.argsPrefix, 'playwright', 'test', relativeTestPath];
    if (context.options.headed) {
      args.push('--headed');
    }

    const proc = spawn(npx.command, args, {
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
      } catch (error) {
        reject(new Error(`Failed to process test results: ${error.message}`));
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

export async function getRunResult(dataDir, runId) {
  const resultPath = path.join(dataDir, 'runs', runId, 'result.json');
  const content = await fs.readFile(resultPath, 'utf-8');
  return JSON.parse(content);
}

export async function listRuns(dataDir, testId) {
  const runsDir = path.join(dataDir, 'runs');

  try {
    const runDirs = await fs.readdir(runsDir);

    const runs = await Promise.all(
      runDirs
        .filter((dir) => dir !== 'latest')
        .map(async (dir) => {
          try {
            const result = await getRunResult(dataDir, dir);
            if (testId && result.testId !== testId) {
              return null;
            }
            return result;
          } catch {
            return null;
          }
        })
    );

    return runs
      .filter((result) => !!result)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  } catch {
    return [];
  }
}
