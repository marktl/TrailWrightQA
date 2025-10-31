import path from 'path';
import fs from 'fs/promises';

const REPORTER_FILE = 'trailwright-reporter.js';
const CONFIG_SENTINEL = 'trailwright-reporter.js';
const REPORTER_SENTINEL = 'TW_EVENT:';

export function generatePlaywrightConfig(): string {
  return `// @ts-check
/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './tests',
  timeout: 45000,
  retries: 1,
  use: {
    headless: false,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [
    ['list', { printSteps: true }],
    ['html', { outputFolder: 'runs/latest/html-report', open: 'never' }],
    ['json', { outputFile: 'runs/latest/results.json' }],
    ['./${REPORTER_FILE}']
  ],
};

module.exports = config;
`;
}

export function generateTrailwrightReporterSource(): string {
  return `'const EVENT_PREFIX = "TW_EVENT:";
const timestamp = () => new Date().toISOString();

function emit(event) {
  try {
    process.stdout.write(EVENT_PREFIX + JSON.stringify(event) + "\\n");
  } catch {
    // Ignore write errors
  }
}

class TrailwrightReporter {
  constructor() {
    this._stepIds = new WeakMap();
    this._stepCounter = 0;
  }

  printsToStdio() {
    return false;
  }

  onBegin(config, suite) {
    emit({ type: "run:start", totalTests: suite.allTests().length, timestamp: timestamp() });
  }

  onTestBegin(test) {
    emit({ type: "test:start", testId: this._testId(test), title: test.title, timestamp: timestamp() });
  }

  onStepBegin(test, result, step) {
    const id = this._ensureStepId(step);
    emit({
      type: "step:start",
      stepId: id,
      testId: this._testId(test),
      title: step.title,
      category: step.category,
      depth: this._depth(step),
      timestamp: timestamp()
    });
  }

  onStepEnd(test, result, step) {
    const id = this._ensureStepId(step);
    emit({
      type: "step:end",
      stepId: id,
      testId: this._testId(test),
      status: step.error ? "failed" : "passed",
      duration: step.duration,
      error: step.error ? this._error(step.error) : undefined,
      timestamp: timestamp()
    });
  }

  onStdOut(chunk, test) {
    emit({ type: "stdout", testId: test ? this._testId(test) : null, text: chunk.toString(), timestamp: timestamp() });
  }

  onStdErr(chunk, test) {
    emit({ type: "stderr", testId: test ? this._testId(test) : null, text: chunk.toString(), timestamp: timestamp() });
  }

  onTestEnd(test, result) {
    emit({
      type: "test:end",
      testId: this._testId(test),
      status: result.status,
      duration: result.duration,
      error: result.error ? this._error(result.error) : undefined,
      timestamp: timestamp()
    });
  }

  onError(error) {
    emit({ type: "run:error", error: this._error(error), timestamp: timestamp() });
  }

  onEnd(result) {
    emit({ type: "run:end", status: result.status, timestamp: timestamp() });
  }

  _ensureStepId(step) {
    let existing = this._stepIds.get(step);
    if (!existing) {
      existing = "step-" + ++this._stepCounter;
      this._stepIds.set(step, existing);
    }
    return existing;
  }

  _depth(step) {
    let depth = 0;
    let current = step.parent;
    while (current) {
      depth++;
      current = current.parent;
    }
    return depth;
  }

  _testId(test) {
    try {
      if (typeof test.titlePath === "function") {
        return test.titlePath().join(" › ");
      }
    } catch {
      // Ignore titlePath errors
    }
    return test.title || "untitled";
  }

  _error(error) {
    if (!error) return undefined;
    return {
      message: error.message || String(error),
      value: error.value,
      stack: error.stack
    };
  }
}

module.exports = TrailwrightReporter;
`;
}

async function ensureFileWithSentinel(filePath: string, sentinel: string, contents: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    if (existing.includes(sentinel)) {
      return;
    }
  } catch {
    // Missing file, will write below
  }

  await fs.writeFile(filePath, contents, 'utf-8');
}

export async function ensurePlaywrightConfig(dataDir: string): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(path.join(dataDir, 'runs', 'latest'), { recursive: true });

  const configPath = path.join(dataDir, 'playwright.config.js');
  const reporterPath = path.join(dataDir, REPORTER_FILE);

  await ensureFileWithSentinel(configPath, CONFIG_SENTINEL, generatePlaywrightConfig());
  await ensureFileWithSentinel(reporterPath, REPORTER_SENTINEL, generateTrailwrightReporterSource());
}
