export interface TestMetadata {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  prompt?: string;
  successCriteria?: string;
  steps?: TestStepMetadata[];
  createdAt: string;
  updatedAt?: string;
  folder?: string | null;
  lastRunAt?: string;
  lastRunStatus?: RunResult['status'];
  lastRunId?: string;
  credentialId?: string;
  startUrl?: string;
  dataSource?: string;
  variables?: VariableDefinition[];
}

export interface TestStepMetadata {
  number: number;
  qaSummary: string;
  playwrightCode: string;
  screenshotPath?: string;
}

export interface VariableDefinition {
  name: string;
  type?: 'string' | 'number';
  sampleValue?: string;
  description?: string;
}

export type VariableRow = Record<string, string>;

export interface Test {
  metadata: TestMetadata;
  code: string;
}

export interface CredentialRecord {
  id: string;
  name: string;
  username: string;
  password: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface RunResult {
  id: string;
  testId: string;
  status: 'passed' | 'failed' | 'skipped' | 'stopped' | 'partial';
  duration: number;
  startedAt: string;
  endedAt: string;
  tracePath?: string;
  screenshotPaths?: string[];
  screenshots?: RunScreenshot[];
  videoPath?: string;
  error?: string;
  errorSummary?: string;
  steps?: StepSummary[];
  stepCounts?: StepCounts;
  failedStepTitles?: string[];
  rowResults?: RowResult[];
  logs?: RunLogEntry[];
}

export interface RowResult {
  rowIndex: number;
  rowData: Record<string, string>;
  status: 'passed' | 'failed';
  duration: number;
  tracePath?: string;
  error?: string;
}

export interface RunScreenshot {
  path: string;
  stepTitle?: string;
  testTitle?: string;
  description?: string;
  capturedAt?: string;
  attachmentName?: string;
}

export interface StepCounts {
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

export type RunStatus = 'queued' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';

export interface RunLogEntry {
  id: string;
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface StepSummary {
  id: string;
  title: string;
  status: 'pending' | 'passed' | 'failed';
  startedAt: string;
  endedAt?: string;
  depth: number;
  category?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  message: string;
  timestamp: string;
  isError?: boolean; // True when this message reports an error/failure requiring user help
}

// Common screen sizes for testing
export interface ViewportSize {
  width: number;
  height: number;
}

export interface RunOptionSettings {
  headed: boolean;
  speed: number;
  keepOpen?: boolean;
  viewportSize?: ViewportSize;
}

export interface LiveRunState {
  runId: string;
  testId: string;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  logs: RunLogEntry[];
  steps: StepSummary[];
  chat: ChatMessage[];
  result?: RunResult;
  options?: RunOptionSettings;
}

// Live AI Test Generation Types

export type AIActionType = 'goto' | 'click' | 'fill' | 'select' | 'press' | 'wait' | 'expectVisible' | 'expectText' | 'expectValue' | 'expectUrl' | 'expectTitle' | 'screenshot' | 'done';

export interface AIAction {
  action: AIActionType;
  selector?: string;
  value?: string;
  reasoning: string;
}

export interface RecordedStep {
  stepNumber: number;
  playwrightCode: string;
  qaSummary: string;
  timestamp: string;
  url?: string;
  screenshotPath?: string;
  screenshotData?: string;
  waitCode?: string;
  interactionType?: 'click' | 'fill' | 'select' | 'navigate' | 'assert';
  elementInfo?: {
    role?: string;
    name?: string;
    selector: string;
  };
  networkDelay?: number;
}

export type CaptureMode = 'accessibility' | 'screenshot' | 'hybrid';

export type GenerationMode = 'auto' | 'manual' | 'record';

export interface LiveGenerationOptions {
  startUrl: string;
  goal: string;
  successCriteria?: string;
  maxSteps?: number;
  captureMode?: CaptureMode;
  keepBrowserOpen?: boolean;
  credentialId?: string;
  viewportSize?: ViewportSize;
  mode?: GenerationMode;
}

export type GenerationStatus =
  | 'initializing'
  | 'running'
  | 'thinking'
  | 'awaiting_input'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped';

export interface LiveGenerationState {
  sessionId: string;
  status: GenerationStatus;
  startedAt: string;
  updatedAt: string;
  startUrl: string;
  goal: string;
  currentUrl: string;
  stepsTaken: number;
  maxSteps: number;
  successCriteria?: string;
  recordedSteps: RecordedStep[];
  logs: string[];
  chat: ChatMessage[];
  error?: string;
  savedTestId?: string;
  keepBrowserOpen?: boolean;
  credentialId?: string;
  credentialSummary?: {
    id: string;
    name: string;
    username: string;
    notes?: string;
  };
  mode: GenerationMode;
  pendingPlan?: StepPlan; // For manual mode: plan awaiting approval
  // Record mode-specific fields
  recordingActive?: boolean;
  assertionPickerActive?: boolean;
  steps?: RecordedStep[];
  testName?: string;
  createdAt?: string;
}

// Step planning types for manual mode
export interface PlannedStep {
  id: string;
  description: string;
  action: AIActionType;
  selector?: string;
  value?: string;
}

export interface StepPlan {
  id: string;
  originalInstruction: string;
  steps: PlannedStep[];
  canExecute: boolean; // true if AI can execute, false if needs clarification
  clarificationMessage?: string; // message if canExecute is false
  timestamp: string;
}

export type LiveGenerationEventType =
  | 'initial_state'
  | 'status'
  | 'log'
  | 'ai_thinking'
  | 'step_recorded'
  | 'step_deleted'
  | 'discarded'
  | 'page_changed'
  | 'chat'
  | 'plan_ready'
  | 'plan_approved'
  | 'plan_rejected'
  | 'completed'
  | 'auto_saved'
  | 'error';

export interface LiveGenerationEvent {
  type: LiveGenerationEventType;
  timestamp: string;
  payload: any;
}

// ============================================
// Multi-Run (Run Builder) Types
// ============================================

/** Configuration for a single test in a run queue */
export interface QueuedTest {
  testId: string;
  testName: string;
  order: number;
  startFromStep?: number;  // 0 = start from beginning (default)
  enabled: boolean;        // Can toggle tests on/off without removing
}

/** Configuration for a multi-test run */
export interface RunConfiguration {
  tests: QueuedTest[];
  options: {
    headed: boolean;
    speed: number;           // 0.5 - 2.0
    reusesBrowser: boolean;  // Chain tests in same browser
    stopOnFailure: boolean;
    viewportSize?: ViewportSize;
  };
}

/** Status of a test within a multi-run */
export type QueuedTestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

/** Queued test with runtime state */
export interface QueuedTestWithState extends QueuedTest {
  runId?: string;           // Assigned when test starts
  status: QueuedTestStatus;
  error?: string;
  duration?: number;
}

/** Active multi-test run session state */
export interface MultiRunState {
  configId: string;           // Unique ID for this run configuration
  status: 'queued' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  currentTestIndex: number;
  tests: QueuedTestWithState[];
  startedAt: string;
  endedAt?: string;
  browserEndpoint?: string;   // CDP endpoint for browser reuse
  totalDuration?: number;
}

/** Event types for multi-run SSE stream */
export type MultiRunEventType =
  | 'hydrate'          // Initial state dump
  | 'status'           // Overall status change
  | 'test_start'       // A test in queue started
  | 'test_complete'    // A test completed (with pass/fail)
  | 'progress'         // Current test index update
  | 'log'              // Log message
  | 'error';           // Error event

export interface MultiRunEvent {
  type: MultiRunEventType;
  timestamp: string;
  payload: any;
}

/** Extracted step info for step selection UI */
export interface ExtractedStep {
  number: number;
  title: string;       // QA summary from test.step('title', ...)
  lineNumber?: number; // For future "jump to code" feature
}
