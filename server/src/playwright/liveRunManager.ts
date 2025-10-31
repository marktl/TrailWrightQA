import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import type {
  LiveRunState,
  RunLogEntry,
  RunStatus,
  StepSummary,
  ChatMessage,
  RunResult
} from '../types.js';
import {
  createRunExecutionContext,
  finalizeRunExecution,
  FinalizeRunOptions,
  RunExecutionContext
} from './runner.js';
import { resolveNpxInvocation } from '../utils/npx.js';

const EVENT_PREFIX = 'TW_EVENT:';

export type RunControlAction = 'pause' | 'resume' | 'stop';

export type LiveRunEvent =
  | { type: 'status'; payload: { status: RunStatus; timestamp: string } }
  | { type: 'log'; payload: RunLogEntry }
  | { type: 'step'; payload: StepSummary }
  | { type: 'chat'; payload: ChatMessage }
  | { type: 'result'; payload: RunResult }
  | { type: 'error'; payload: { message: string; timestamp: string } };

const sessions = new Map<string, LiveRunSession>();

export class LiveRunSession {
  private context: RunExecutionContext;
  private process: ChildProcessWithoutNullStreams | null;
  private status: RunStatus = 'queued';
  private readonly emitter = new EventEmitter();
  private readonly logs: RunLogEntry[] = [];
  private readonly steps: StepSummary[] = [];
  private readonly stepMap = new Map<string, StepSummary>();
  private readonly chat: ChatMessage[] = [];
  private stdoutRemainder = '';
  private stderrRemainder = '';
  private stderrAggregate = '';
  private finalizing = false;
  private terminated = false;
  private terminationReason?: string;
  private result?: RunResult;
  private logCounter = 0;
  private readonly startedAt: string;
  private updatedAt: string;

  constructor(context: RunExecutionContext, proc: ChildProcessWithoutNullStreams) {
    this.context = context;
    this.process = proc;
    this.startedAt = new Date(context.startTime).toISOString();
    this.updatedAt = this.startedAt;
    this.emitter.setMaxListeners(100);

    this.attachProcessListeners();
    this.updateStatus('running');
    this.appendLog('system', 'Playwright run started');
  }

  get id(): string {
    return this.context.runId;
  }

  get testId(): string {
    return this.context.testId;
  }

  getState(): LiveRunState {
    return {
      runId: this.id,
      testId: this.testId,
      status: this.status,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      logs: [...this.logs],
      steps: [...this.steps],
      chat: [...this.chat],
      result: this.result
    };
  }

  subscribe(listener: (event: LiveRunEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }

  addChatMessage(role: ChatMessage['role'], message: string): ChatMessage {
    const chatMessage: ChatMessage = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      message,
      timestamp: new Date().toISOString()
    };
    this.chat.push(chatMessage);
    this.emit({ type: 'chat', payload: chatMessage });
    this.touch();
    return chatMessage;
  }

  pause(): void {
    if (!this.process) {
      throw new Error('Run has already completed');
    }
    if (process.platform === 'win32') {
      throw new Error('Pause is not supported on Windows');
    }
    if (this.status !== 'running') {
      throw new Error('Run is not currently running');
    }

    const paused = this.process.kill('SIGSTOP');
    if (!paused) {
      throw new Error('Unable to pause Playwright process');
    }

    this.updateStatus('paused');
    this.appendLog('system', 'Run paused');
  }

  resume(): void {
    if (!this.process) {
      throw new Error('Run has already completed');
    }
    if (process.platform === 'win32') {
      throw new Error('Pause is not supported on Windows');
    }
    if (this.status !== 'paused') {
      throw new Error('Run is not paused');
    }

    const resumed = this.process.kill('SIGCONT');
    if (!resumed) {
      throw new Error('Unable to resume Playwright process');
    }

    this.updateStatus('running');
    this.appendLog('system', 'Run resumed');
  }

  async stop(): Promise<void> {
    if (!this.process) {
      throw new Error('Run has already completed');
    }
    if (this.status === 'stopped') {
      return;
    }

    this.terminated = true;
    this.terminationReason = 'Run stopped by user';
    this.appendLog('system', 'Stopping run...');

    const killed = this.process.kill('SIGTERM') || this.process.kill('SIGINT');
    if (!killed) {
      this.process.kill('SIGKILL');
    }

    this.updateStatus('stopped');
  }

  private attachProcessListeners(): void {
    if (!this.process) {
      return;
    }

    this.process.stdout.on('data', (chunk) => this.handleStreamChunk('stdout', chunk));
    this.process.stderr.on('data', (chunk) => this.handleStreamChunk('stderr', chunk));

    this.process.on('close', (code) => {
      void this.handleProcessClose(code);
    });

    this.process.on('error', (error) => {
      this.appendLog('system', `Playwright process error: ${error.message ?? String(error)}`);
      void this.handleProcessClose(1);
    });
  }

  private async handleProcessClose(code: number | null): Promise<void> {
    if (this.finalizing) {
      return;
    }
    this.finalizing = true;

    const options: FinalizeRunOptions = this.terminated
      ? { terminated: true, terminationReason: this.terminationReason }
      : {};

    try {
      const result = await finalizeRunExecution(
        this.context,
        code,
        this.stderrAggregate,
        options
      );
      this.result = result;
      this.process = null;

      if (result.status === 'passed') {
        this.updateStatus('completed');
      } else if (result.status === 'stopped') {
        this.updateStatus('stopped');
      } else {
        this.updateStatus('failed');
      }

      this.emit({ type: 'result', payload: result });
      this.appendLog('system', `Run finished with status: ${result.status.toUpperCase()}`);
    } catch (error: any) {
      this.appendLog(
        'system',
        `Failed to finalize run: ${error?.message ?? String(error)}`
      );
      this.updateStatus('failed');
    }
  }

  private handleStreamChunk(stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const text = chunk.toString();

    if (stream === 'stderr') {
      this.stderrAggregate += text;
    }

    const combined =
      (stream === 'stdout' ? this.stdoutRemainder : this.stderrRemainder) + text;
    const lines = combined.split(/\r?\n/);
    const remainder = lines.pop() ?? '';

    if (stream === 'stdout') {
      this.stdoutRemainder = remainder;
    } else {
      this.stderrRemainder = remainder;
    }

    for (const rawLine of lines) {
      if (!rawLine.trim()) {
        continue;
      }

      if (stream === 'stdout' && rawLine.startsWith(EVENT_PREFIX)) {
        const payload = rawLine.slice(EVENT_PREFIX.length);
        this.handleReporterPayload(payload);
      } else {
        this.appendLog(stream, rawLine);
      }
    }
  }

  private handleReporterPayload(payload: string): void {
    try {
      const event = JSON.parse(payload);
      switch (event.type) {
        case 'run:start':
          this.updateStatus('running');
          break;
        case 'stdout':
          if (event.text) {
            this.appendLog('stdout', event.text);
          }
          break;
        case 'stderr':
          if (event.text) {
            this.appendLog('stderr', event.text);
          }
          break;
        case 'step:start':
          this.upsertStep({
            id: event.stepId ?? `step-${Date.now()}`,
            title: event.title ?? 'Unnamed step',
            status: 'pending',
            startedAt: event.timestamp ?? new Date().toISOString(),
            depth: Number.isFinite(event.depth) ? event.depth : 0,
            category: event.category
          });
          break;
        case 'step:end':
          this.upsertStep({
            id: event.stepId ?? `step-${Date.now()}`,
            title:
              event.title ??
              this.stepMap.get(event.stepId)?.title ??
              'Unnamed step',
            status: event.status === 'failed' ? 'failed' : 'passed',
            startedAt:
              this.stepMap.get(event.stepId)?.startedAt ??
              event.timestamp ??
              new Date().toISOString(),
            endedAt: event.timestamp ?? new Date().toISOString(),
            depth: Number.isFinite(event.depth)
              ? event.depth
              : this.stepMap.get(event.stepId)?.depth ?? 0,
            category: event.category ?? this.stepMap.get(event.stepId)?.category,
            error:
              event.error?.message ||
              event.error?.value ||
              (event.status === 'failed' ? 'Step failed' : undefined)
          });
          break;
        case 'test:start':
          if (event.title) {
            this.appendLog('system', `Running test: ${event.title}`);
          }
          break;
        case 'test:end':
          if (event.status === 'failed' && event.error?.message) {
            this.appendLog('system', event.error.message);
          }
          break;
        case 'run:error':
          if (event.error?.message) {
            this.appendLog('system', event.error.message);
          }
          break;
        default:
          break;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Unknown error: ${String(error)}`;
      this.emit({
        type: 'error',
        payload: { message: `Failed to parse reporter event: ${message}`, timestamp: new Date().toISOString() }
      });
    }
  }

  private upsertStep(step: StepSummary): void {
    const existing = this.stepMap.get(step.id);

    if (existing) {
      existing.status = step.status;
      existing.endedAt = step.endedAt ?? existing.endedAt;
      existing.error = step.error ?? existing.error;
      existing.category = step.category ?? existing.category;
      this.emit({ type: 'step', payload: { ...existing } });
    } else {
      this.stepMap.set(step.id, step);
      this.steps.unshift(step);
      this.emit({ type: 'step', payload: step });
    }

    this.touch();
  }

  private appendLog(stream: RunLogEntry['stream'], message: string): void {
    const entry: RunLogEntry = {
      id: `log-${++this.logCounter}`,
      timestamp: new Date().toISOString(),
      stream,
      message
    };
    this.logs.push(entry);
    this.emit({ type: 'log', payload: entry });
    this.touch();
  }

  private updateStatus(status: RunStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.emit({ type: 'status', payload: { status, timestamp: new Date().toISOString() } });
    this.touch();
  }

  private emit(event: LiveRunEvent): void {
    this.emitter.emit('event', event);
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}

export async function startLiveRun(
  dataDir: string,
  testId: string
): Promise<LiveRunSession> {
  const context = await createRunExecutionContext(dataDir, testId);
  const npx = await resolveNpxInvocation();
  const baseEnv = npx.env ?? process.env;

  // Use relative path from dataDir since that's our cwd
  // Normalize to forward slashes for cross-platform compatibility
  const relativeTestPath = path.relative(context.dataDir, context.testFile).replace(/\\/g, '/');

  console.log(`[liveRun] Executing: playwright test ${relativeTestPath} from ${context.dataDir}`);

  const proc = spawn(
    npx.command,
    [...npx.argsPrefix, 'playwright', 'test', relativeTestPath, '--workers=1', '--headed'],
    {
      cwd: context.dataDir,
      env: {
        ...baseEnv,
        TRAILWRIGHT_RUN_ID: context.runId,
        PLAYWRIGHT_JUNIT_OUTPUT_NAME: `trailwright-${context.runId}.xml`
      }
    }
  );

  const session = new LiveRunSession(context, proc);
  sessions.set(session.id, session);
  return session;
}

export function getLiveRunSession(runId: string): LiveRunSession | undefined {
  return sessions.get(runId);
}

export function getLiveRunState(runId: string): LiveRunState | null {
  const session = sessions.get(runId);
  return session ? session.getState() : null;
}

export function subscribeToLiveRun(
  runId: string,
  listener: (event: LiveRunEvent) => void
): () => void {
  const session = sessions.get(runId);
  if (!session) {
    throw new Error('Run not found');
  }
  return session.subscribe(listener);
}

export async function controlLiveRun(
  runId: string,
  action: RunControlAction
): Promise<void> {
  const session = sessions.get(runId);
  if (!session) {
    throw new Error('Run not found');
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
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

export function addChatToLiveRun(
  runId: string,
  role: ChatMessage['role'],
  message: string
): ChatMessage {
  const session = sessions.get(runId);
  if (!session) {
    throw new Error('Run not found');
  }
  return session.addChatMessage(role, message);
}
