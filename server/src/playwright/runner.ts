import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import type { Dirent } from 'fs';
import type { RunResult, RunScreenshot } from '../types.js';
import type { ViewportSize } from '../../../shared/types.js';
import { serializeCredentialsBlob } from '../storage/credentials.js';
import { resolveNpxInvocation } from '../utils/npx.js';
import { loadTest, saveTest } from '../storage/tests.js';
import { summarizeError } from '../ai/index.js';
import { loadConfig } from '../storage/config.js';

export interface RunTestOptions {
  dataDir: string;
  testId: string;
  headed?: boolean;
  speed?: number;
  keepOpen?: boolean;
  viewportSize?: ViewportSize;
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
    keepOpen: boolean;
    viewportSize?: ViewportSize;
  };
}

export interface FinalizeRunOptions {
  terminated?: boolean;
  terminationReason?: string;
}

type ArtifactRecord = {
  filename: string;
  sourceKey: string;
  ext: string;
};

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, '/');
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function moveLatestArtifacts(context: RunExecutionContext): Promise<ArtifactRecord[]> {
  const latestDir = path.join(context.dataDir, 'runs', 'latest');
  const moved: ArtifactRecord[] = [];

  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const sourceKey = normalizePath(entryPath);
      let targetName = entry.name;
      const baseName = path.basename(entry.name, ext);
      let attempt = 1;
      while (await fileExists(path.join(context.runDir, targetName))) {
        targetName = `${baseName}-${attempt}${ext}`;
        attempt += 1;
      }

      const destination = path.join(context.runDir, targetName);
      try {
        await fs.rename(entryPath, destination);
      } catch {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(entryPath, destination);
        await fs.unlink(entryPath).catch(() => void 0);
      }

      moved.push({ filename: targetName, sourceKey, ext });
    }
  }

  await walk(latestDir);

  try {
    await fs.rm(latestDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
  await fs.mkdir(latestDir, { recursive: true });

  return moved;
}

type ScreenshotAttachment = {
  sourceKey: string;
  attachmentName?: string;
  testTitle?: string;
  stepTitle?: string;
  capturedAt?: string;
};

function collectScreenshotAttachments(playwrightResults: any): ScreenshotAttachment[] {
  const attachments: ScreenshotAttachment[] = [];

  function walkSteps(steps: any[], testTitle: string, capturedAt?: string): void {
    for (const step of steps ?? []) {
      // Check attachments in this step
      for (const attachment of step.attachments ?? []) {
        if (!attachment?.path || typeof attachment.path !== 'string') {
          continue;
        }
        const contentType = String(attachment.contentType || '').toLowerCase();
        const attachmentName = String(attachment.name || '');
        if (
          contentType.includes('image/') ||
          attachmentName.toLowerCase().includes('screenshot')
        ) {
          attachments.push({
            sourceKey: normalizePath(attachment.path),
            attachmentName: attachment.name,
            testTitle,
            stepTitle: step.title, // Use step title from test.step()
            capturedAt: capturedAt ? new Date(capturedAt).toISOString() : undefined
          });
        }
      }

      // Recursively walk child steps
      if (Array.isArray(step.steps)) {
        walkSteps(step.steps, testTitle, capturedAt);
      }
    }
  }

  function walkSuite(suite: any): void {
    if (!suite) return;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        for (const test of spec.tests ?? []) {
          for (const result of test.results ?? []) {
            const capturedAt = result.startTime || result.startedAt || result.startWallTime;
            const testTitle = spec?.title || test?.title;

            // Walk steps to find screenshots
            if (Array.isArray(result.steps)) {
              walkSteps(result.steps, testTitle, capturedAt);
            }

            // Also check attachments at result level (for failure screenshots)
            for (const attachment of result.attachments ?? []) {
              if (!attachment?.path || typeof attachment.path !== 'string') {
                continue;
              }
              const contentType = String(attachment.contentType || '').toLowerCase();
              const attachmentName = String(attachment.name || '');
              if (
                contentType.includes('image/') ||
                attachmentName.toLowerCase().includes('screenshot')
              ) {
                attachments.push({
                  sourceKey: normalizePath(attachment.path),
                  attachmentName: attachment.name,
                  testTitle,
                  stepTitle: undefined, // Result-level screenshots don't have step title
                  capturedAt: capturedAt ? new Date(capturedAt).toISOString() : undefined
                });
              }
            }
          }
        }
      }
    }

    if (Array.isArray(suite.suites)) {
      suite.suites.forEach((child: any) => walkSuite(child));
    }
  }

  (playwrightResults?.suites ?? []).forEach((suite: any) => walkSuite(suite));
  return attachments;
}

export async function createRunExecutionContext(
  dataDir: string,
  testId: string,
  preferences?: { headed?: boolean; speed?: number; keepOpen?: boolean; viewportSize?: ViewportSize }
): Promise<RunExecutionContext> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${testId}`;
  const runDir = path.join(dataDir, 'runs', runId);
  const testFile = path.join(dataDir, 'tests', `${testId}.spec.ts`);

  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'runs', 'latest'), { recursive: true });

  const headed = typeof preferences?.headed === 'boolean' ? preferences.headed : true;
  const rawSpeed = typeof preferences?.speed === 'number' ? preferences.speed : 1;
  const normalizedSpeed = Number.isFinite(rawSpeed) ? Math.min(1, Math.max(0.5, rawSpeed)) : 1;
  const slowMo = normalizedSpeed < 1 ? Math.round((1 - normalizedSpeed) * 1000) : 0;
  const keepOpen = Boolean(preferences?.keepOpen);
  const viewportSize = preferences?.viewportSize;

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
      slowMo,
      keepOpen,
      viewportSize
    }
  };
}

function buildArtifactUrl(runId: string, file: string): string {
  const encoded = encodeURIComponent(file);
  return `/api/runs/${runId}/artifacts/${encoded}`;
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
  const artifactRecords = await moveLatestArtifacts(context);

  let status: RunResult['status'] = 'passed';
  let error: string | undefined;

  if (options.terminated) {
    status = 'stopped';
    error = options.terminationReason || 'Run terminated by user';
  } else if (
    stderr.includes('No tests found') ||
    stderr.includes('ENOENT') ||
    stderr.includes('TypeError:') ||
    stderr.includes('SyntaxError:') ||
    stderr.includes('ReferenceError:') ||
    stderr.includes('is not a function') ||
    stderr.includes('is not defined')
  ) {
    // Handle test loading/compilation errors that don't produce non-zero exit codes
    status = 'failed';
    error = stderr || 'Test failed to load or compile';
  } else if (exitCode !== 0) {
    status = 'failed';
    error = stderr || 'Test execution failed';
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
  }

  const traceRecord =
    artifactRecords.find((record) => record.ext === '.zip' && record.filename.includes('trace')) ||
    artifactRecords.find((record) => record.ext === '.zip');
  const videoRecord = artifactRecords.find((record) => record.ext === '.webm');

  const screenshotAttachments = collectScreenshotAttachments(playwrightResults);
  const matchedScreenshots = new Set<string>();
  const screenshotDetails: RunScreenshot[] = [];

  for (const attachment of screenshotAttachments) {
    const record = artifactRecords.find(
      (artifact) => artifact.ext === '.png' && artifact.sourceKey === attachment.sourceKey
    );
    if (!record) {
      continue;
    }
    matchedScreenshots.add(record.filename);
    screenshotDetails.push({
      path: record.filename, // Store just the filename, not the full URL
      stepTitle: attachment.stepTitle || undefined, // Use step title from test.step()
      testTitle: attachment.testTitle,
      capturedAt: attachment.capturedAt,
      attachmentName: attachment.attachmentName
    });
  }

  const remainingScreenshots = artifactRecords.filter(
    (record) => record.ext === '.png' && !matchedScreenshots.has(record.filename)
  );
  remainingScreenshots.forEach((record, index) => {
    screenshotDetails.push({
      path: record.filename, // Store just the filename
      stepTitle: `Screenshot ${screenshotDetails.length + index + 1}`
    });
  });

  const screenshotPaths = screenshotDetails.map((detail) => detail.path);
  const tracePath = traceRecord ? path.join(context.runDir, traceRecord.filename) : undefined;
  const videoPath = videoRecord
    ? buildArtifactUrl(context.runId, videoRecord.filename)
    : undefined;

  // Summarize error with AI if available and test failed
  let errorSummary: string | undefined;
  if (error && status === 'failed') {
    try {
      const config = await loadConfig(context.dataDir);
      if (config.ai?.provider && config.ai?.apiKey) {
        errorSummary = await summarizeError({
          provider: config.ai.provider,
          apiKey: config.ai.apiKey,
          error,
          stepContext: undefined // Could pass failing step context here
        });
      }
    } catch {
      // Ignore summarization errors
    }
  }

  const result: RunResult = {
    id: context.runId,
    testId: context.testId,
    status,
    duration,
    startedAt: new Date(context.startTime).toISOString(),
    endedAt: new Date(endTime).toISOString(),
    tracePath,
    videoPath,
    screenshotPaths: screenshotPaths.length ? screenshotPaths : undefined,
    screenshots: screenshotDetails.length ? screenshotDetails : undefined,
    error,
    errorSummary
  };

  await fs.writeFile(path.join(context.runDir, 'result.json'), JSON.stringify(result, null, 2));
  await updateTestRunMetadata(context, result).catch(() => void 0);

  return result;
}

async function updateTestRunMetadata(
  context: RunExecutionContext,
  result: RunResult
): Promise<void> {
  try {
    const test = await loadTest(context.dataDir, context.testId);
    test.metadata = {
      ...test.metadata,
      lastRunAt: result.endedAt,
      lastRunStatus: result.status,
      lastRunId: result.id,
      updatedAt: new Date().toISOString()
    };
    await saveTest(context.dataDir, test);
  } catch (error) {
    console.warn(
      `[runner] Unable to update run metadata for ${context.testId}:`,
      (error as Error)?.message || error
    );
  }
}

export async function runTest(options: RunTestOptions): Promise<RunResult> {
  const context = await createRunExecutionContext(options.dataDir, options.testId, {
    headed: options.headed,
    speed: options.speed,
    keepOpen: options.keepOpen,
    viewportSize: options.viewportSize
  });
  const npx = await resolveNpxInvocation();
  const baseEnv = npx.env ?? process.env;
  const credentialsBlob = await serializeCredentialsBlob(options.dataDir);

  // Use relative path from dataDir since that's our cwd
  // Normalize to forward slashes for cross-platform compatibility
  const relativeTestPath = path.relative(context.dataDir, context.testFile).replace(/\\/g, '/');

  return new Promise((resolve, reject) => {
    const args = [...npx.argsPrefix, 'playwright', 'test', relativeTestPath];
    if (context.options.headed) {
      args.push('--headed');
    }
    if (context.options.keepOpen && context.options.headed) {
      args.push('--debug');
    }

    const env = {
      ...baseEnv,
      TRAILWRIGHT_HEADLESS: context.options.headed ? 'false' : 'true',
      TRAILWRIGHT_SLOWMO: String(context.options.slowMo),
      TRAILWRIGHT_KEEP_BROWSER_OPEN: context.options.keepOpen ? 'true' : 'false',
      ...(credentialsBlob ? { TRAILWRIGHT_CREDENTIALS_BLOB: credentialsBlob } : {}),
      ...(context.options.viewportSize ? {
        TRAILWRIGHT_VIEWPORT_WIDTH: String(context.options.viewportSize.width),
        TRAILWRIGHT_VIEWPORT_HEIGHT: String(context.options.viewportSize.height)
      } : {})
    };

    const proc: ChildProcessWithoutNullStreams = spawn(npx.command, args, {
      cwd: context.dataDir,
      env
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
