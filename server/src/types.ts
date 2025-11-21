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

export interface Test {
  metadata: TestMetadata;
  code: string;
}

export interface VariableDefinition {
  name: string;
  type?: 'string' | 'number';
  sampleValue?: string;
  description?: string;
}

export interface TestStepMetadata {
  number: number;
  qaSummary: string;
  playwrightCode: string;
}

export type VariableRow = Record<string, string>;

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
}

export interface RunScreenshot {
  path: string;
  stepTitle?: string;
  testTitle?: string;
  description?: string;
  capturedAt?: string;
  attachmentName?: string;
}

export interface RowResult {
  rowIndex: number;
  rowData: Record<string, string>;
  status: 'passed' | 'failed';
  duration: number;
  tracePath?: string;
  error?: string;
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

export interface StepCounts {
  total: number;
  passed: number;
  failed: number;
  pending: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  message: string;
  timestamp: string;
}

export interface RunOptionSettings {
  headed: boolean;
  speed: number;
  keepOpen?: boolean;
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
