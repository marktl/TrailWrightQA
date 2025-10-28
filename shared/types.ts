export interface TestMetadata {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  prompt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Test {
  metadata: TestMetadata;
  code: string;
}

export interface RunResult {
  id: string;
  testId: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  startedAt: string;
  endedAt: string;
  tracePath?: string;
  screenshotPaths?: string[];
  videoPath?: string;
  error?: string;
}
