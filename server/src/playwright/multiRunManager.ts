/**
 * Multi-Run Manager
 *
 * Orchestrates running multiple tests sequentially with optional browser reuse.
 * Provides real-time progress updates via EventEmitter.
 */

import { EventEmitter } from 'events';
import type {
  RunConfiguration,
  MultiRunState,
  MultiRunEvent,
  MultiRunEventType,
  QueuedTestWithState,
  RunResult
} from '../../../shared/types.js';
import { browserPool } from './browserPool.js';
import { startLiveRun, getLiveRunSession, LiveRunSession } from './liveRunManager.js';
import { loadTest } from '../storage/tests.js';

export type MultiRunControlAction = 'pause' | 'resume' | 'stop' | 'skip';

const multiRunSessions = new Map<string, MultiRunSession>();

/**
 * Manages a multi-test run with optional browser reuse
 */
export class MultiRunSession {
  private readonly configId: string;
  private readonly config: RunConfiguration;
  private readonly dataDir: string;
  private readonly emitter = new EventEmitter();

  private status: MultiRunState['status'] = 'queued';
  private currentTestIndex = -1;
  private tests: QueuedTestWithState[] = [];
  private currentRun: LiveRunSession | null = null;
  private wsEndpoint: string | null = null;
  private startedAt: string;
  private endedAt?: string;
  private totalDuration = 0;

  private paused = false;
  private stopped = false;
  private runningPromise: Promise<void> | null = null;

  constructor(dataDir: string, config: RunConfiguration) {
    this.dataDir = dataDir;
    this.config = config;
    this.configId = `multi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.startedAt = new Date().toISOString();
    this.emitter.setMaxListeners(100);

    // Initialize test states
    this.tests = config.tests
      .filter(t => t.enabled)
      .sort((a, b) => a.order - b.order)
      .map(t => ({
        ...t,
        status: 'pending' as const
      }));
  }

  get id(): string {
    return this.configId;
  }

  /**
   * Get current state snapshot
   */
  getState(): MultiRunState {
    return {
      configId: this.configId,
      status: this.status,
      currentTestIndex: this.currentTestIndex,
      tests: [...this.tests],
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      browserEndpoint: this.wsEndpoint || undefined,
      totalDuration: this.totalDuration
    };
  }

  /**
   * Subscribe to multi-run events
   */
  subscribe(listener: (event: MultiRunEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }

  /**
   * Start the multi-run execution
   */
  async start(): Promise<void> {
    if (this.runningPromise) {
      throw new Error('Multi-run already started');
    }

    this.runningPromise = this.executeAll();
    return this.runningPromise;
  }

  /**
   * Pause the multi-run (pauses current test)
   */
  pause(): void {
    if (this.status !== 'running') {
      throw new Error('Multi-run is not running');
    }
    this.paused = true;
    this.updateStatus('paused');
    this.log('Multi-run paused');

    // Pause current test if running
    if (this.currentRun) {
      try {
        this.currentRun.pause();
      } catch {
        // Current test may not be pauseable
      }
    }
  }

  /**
   * Resume the multi-run
   */
  resume(): void {
    if (this.status !== 'paused') {
      throw new Error('Multi-run is not paused');
    }
    this.paused = false;
    this.updateStatus('running');
    this.log('Multi-run resumed');

    // Resume current test if paused
    if (this.currentRun) {
      try {
        this.currentRun.resume();
      } catch {
        // Current test may not be resumeable
      }
    }
  }

  /**
   * Stop the entire multi-run
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.log('Stopping multi-run...');

    // Stop current test if running
    if (this.currentRun) {
      try {
        await this.currentRun.stop();
      } catch {
        // Ignore stop errors
      }
    }

    // Mark remaining tests as skipped
    for (let i = this.currentTestIndex + 1; i < this.tests.length; i++) {
      this.tests[i].status = 'skipped';
    }

    await this.cleanup();
    this.updateStatus('stopped');
  }

  /**
   * Skip current test and move to next
   */
  async skip(): Promise<void> {
    if (this.currentTestIndex < 0 || this.currentTestIndex >= this.tests.length) {
      return;
    }

    this.log(`Skipping test: ${this.tests[this.currentTestIndex].testName}`);

    // Stop current test
    if (this.currentRun) {
      try {
        await this.currentRun.stop();
      } catch {
        // Ignore stop errors
      }
    }

    // Mark as skipped
    this.tests[this.currentTestIndex].status = 'skipped';
    this.emitTestComplete(this.currentTestIndex);
  }

  /**
   * Execute all tests in sequence
   */
  private async executeAll(): Promise<void> {
    this.updateStatus('running');
    this.log(`Starting multi-run with ${this.tests.length} tests`);

    // Acquire browser if reusing
    if (this.config.options.reusesBrowser) {
      try {
        this.wsEndpoint = await browserPool.acquire(this.configId, {
          headed: this.config.options.headed,
          slowMo: this.config.options.speed < 1 ? Math.round((1 - this.config.options.speed) * 1000) : 0,
          viewportSize: this.config.options.viewportSize
        });
        this.log(`Browser acquired for reuse: ${this.wsEndpoint}`);
      } catch (error: any) {
        this.log(`Failed to acquire browser: ${error.message}`);
        this.updateStatus('failed');
        return;
      }
    }

    const startTime = Date.now();

    try {
      for (let i = 0; i < this.tests.length; i++) {
        if (this.stopped) {
          break;
        }

        // Wait while paused
        while (this.paused && !this.stopped) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (this.stopped) {
          break;
        }

        this.currentTestIndex = i;
        this.emitProgress();

        const result = await this.runSingleTest(i);

        // Check stop on failure
        if (this.config.options.stopOnFailure && result?.status === 'failed') {
          this.log(`Test failed and stopOnFailure is enabled. Stopping multi-run.`);
          this.stopped = true;

          // Mark remaining as skipped
          for (let j = i + 1; j < this.tests.length; j++) {
            this.tests[j].status = 'skipped';
          }
          break;
        }
      }

      this.totalDuration = Date.now() - startTime;

      if (!this.stopped) {
        this.updateStatus('completed');
        this.log(`Multi-run completed. Total duration: ${Math.round(this.totalDuration / 1000)}s`);
      }
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Run a single test in the queue
   */
  private async runSingleTest(index: number): Promise<RunResult | null> {
    const test = this.tests[index];
    test.status = 'running';
    this.emitTestStart(index);
    this.log(`Running test ${index + 1}/${this.tests.length}: ${test.testName}`);

    const testStartTime = Date.now();

    try {
      // Load test to verify it exists
      await loadTest(this.dataDir, test.testId);

      // Start the test run
      // Pass browser endpoint if reusing
      const session = await this.startTestWithOptions(test.testId);
      this.currentRun = session;
      test.runId = session.id;

      // Wait for completion
      const result = await this.waitForCompletion(session);

      test.duration = Date.now() - testStartTime;

      if (result) {
        test.status = result.status === 'passed' ? 'passed' : 'failed';
        test.error = result.error;
      } else {
        test.status = 'failed';
        test.error = 'Test did not produce a result';
      }

      this.currentRun = null;
      this.emitTestComplete(index);

      return result;
    } catch (error: any) {
      test.duration = Date.now() - testStartTime;
      test.status = 'failed';
      test.error = error.message || 'Unknown error';
      this.currentRun = null;
      this.emitTestComplete(index);
      this.log(`Test failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Start a test run with multi-run options
   */
  private async startTestWithOptions(testId: string): Promise<LiveRunSession> {
    // For now, we'll use the standard startLiveRun
    // TODO: Pass wsEndpoint via environment variable for browser reuse
    const session = await startLiveRun(this.dataDir, testId, {
      headed: this.config.options.headed,
      speed: this.config.options.speed,
      stopOnFailure: false, // We handle this at multi-run level
      viewportSize: this.config.options.viewportSize
    });

    return session;
  }

  /**
   * Wait for a LiveRunSession to complete
   */
  private waitForCompletion(session: LiveRunSession): Promise<RunResult | null> {
    return new Promise((resolve) => {
      let resolved = false;

      const unsubscribe = session.subscribe((event) => {
        if (event.type === 'result') {
          resolved = true;
          unsubscribe();
          resolve(event.payload as RunResult);
        }
      });

      // Also poll state in case we miss the event
      const checkInterval = setInterval(() => {
        const state = session.getState();
        if (state.result && !resolved) {
          resolved = true;
          clearInterval(checkInterval);
          unsubscribe();
          resolve(state.result);
        }
        if (state.status === 'completed' || state.status === 'failed' || state.status === 'stopped') {
          if (!resolved) {
            resolved = true;
            clearInterval(checkInterval);
            unsubscribe();
            resolve(state.result || null);
          }
        }
      }, 500);

      // Timeout after 10 minutes per test
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearInterval(checkInterval);
          unsubscribe();
          resolve(null);
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    this.endedAt = new Date().toISOString();

    if (this.wsEndpoint && this.config.options.reusesBrowser) {
      try {
        await browserPool.release(this.configId);
        this.log('Browser released');
      } catch {
        // Ignore cleanup errors
      }
      this.wsEndpoint = null;
    }
  }

  /**
   * Emit an event
   */
  private emit(type: MultiRunEventType, payload: any): void {
    const event: MultiRunEvent = {
      type,
      timestamp: new Date().toISOString(),
      payload
    };
    this.emitter.emit('event', event);
  }

  private updateStatus(status: MultiRunState['status']): void {
    this.status = status;
    this.emit('status', { status });
  }

  private emitProgress(): void {
    this.emit('progress', {
      currentTestIndex: this.currentTestIndex,
      totalTests: this.tests.length
    });
  }

  private emitTestStart(index: number): void {
    const test = this.tests[index];
    this.emit('test_start', {
      index,
      testId: test.testId,
      testName: test.testName
    });
  }

  private emitTestComplete(index: number): void {
    const test = this.tests[index];
    this.emit('test_complete', {
      index,
      testId: test.testId,
      testName: test.testName,
      status: test.status,
      duration: test.duration,
      error: test.error,
      runId: test.runId
    });
  }

  private log(message: string): void {
    this.emit('log', { message });
    console.log(`[MultiRun:${this.configId.slice(-8)}] ${message}`);
  }
}

/**
 * Start a new multi-run
 */
export async function startMultiRun(
  dataDir: string,
  config: RunConfiguration
): Promise<MultiRunSession> {
  const session = new MultiRunSession(dataDir, config);
  multiRunSessions.set(session.id, session);

  // Start execution asynchronously
  session.start().catch(error => {
    console.error(`[MultiRun] Execution failed:`, error);
  });

  return session;
}

/**
 * Get a multi-run session by ID
 */
export function getMultiRunSession(configId: string): MultiRunSession | undefined {
  return multiRunSessions.get(configId);
}

/**
 * Get multi-run state by ID
 */
export function getMultiRunState(configId: string): MultiRunState | null {
  const session = multiRunSessions.get(configId);
  return session ? session.getState() : null;
}

/**
 * Subscribe to multi-run events
 */
export function subscribeToMultiRun(
  configId: string,
  listener: (event: MultiRunEvent) => void
): () => void {
  const session = multiRunSessions.get(configId);
  if (!session) {
    throw new Error('Multi-run not found');
  }
  return session.subscribe(listener);
}

/**
 * Control a multi-run
 */
export async function controlMultiRun(
  configId: string,
  action: MultiRunControlAction
): Promise<void> {
  const session = multiRunSessions.get(configId);
  if (!session) {
    throw new Error('Multi-run not found');
  }

  switch (action) {
    case 'pause':
      session.pause();
      break;
    case 'resume':
      session.resume();
      break;
    case 'stop':
      await session.stop();
      break;
    case 'skip':
      await session.skip();
      break;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
