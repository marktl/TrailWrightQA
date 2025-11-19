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
  rowResults?: RowResult[];
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

export type AIActionType = 'goto' | 'click' | 'fill' | 'select' | 'press' | 'wait' | 'done';

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
}

export type CaptureMode = 'accessibility' | 'screenshot' | 'hybrid';

export type GenerationMode = 'auto' | 'manual';

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
