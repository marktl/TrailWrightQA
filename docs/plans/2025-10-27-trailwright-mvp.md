# TrailWright MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-first AI-powered Playwright test generation and execution platform with minimal Portal UI, file-based storage, and zero cloud dependencies.

**Architecture:** Node.js Express backend wraps Playwright test execution and AI test generation (Anthropic/OpenAI/Gemini). Vite+React frontend provides prompt input, test library, and results viewer. All data stored on filesystem (~/.trailwright/). Single-user, local-only for MVP.

**Tech Stack:** Node.js, Express, TypeScript, Playwright, Vite, React, Tailwind CSS, Anthropic SDK

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `README.md`

**Step 1: Initialize project root**

Run:
```bash
cd d:/NewProjects/TrailWrightQA
npm init -y
```

Expected: `package.json` created

**Step 2: Install root dependencies**

Run:
```bash
npm install -D typescript @types/node tsx concurrently
```

Expected: Dependencies installed, `node_modules/` created

**Step 3: Create TypeScript config**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["server/**/*", "shared/**/*"],
  "exclude": ["node_modules", "client", "dist"]
}
```

**Step 4: Create .gitignore**

Create `.gitignore`:
```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
client/dist/
client/node_modules/
server/node_modules/
```

**Step 5: Update package.json scripts**

Modify `package.json`:
```json
{
  "name": "trailwright",
  "version": "0.1.0",
  "description": "Local-first AI-powered Playwright test generation platform",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "cd server && npm run dev",
    "dev:client": "cd client && npm run dev",
    "build": "npm run build:server && npm run build:client",
    "build:server": "cd server && npm run build",
    "build:client": "cd client && npm run build"
  },
  "keywords": ["playwright", "testing", "ai", "qa"],
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "typescript": "^5.6.3",
    "@types/node": "^22.8.6",
    "tsx": "^4.19.2",
    "concurrently": "^9.0.1"
  }
}
```

**Step 6: Create README**

Create `README.md`:
```markdown
# TrailWright QA

Local-first AI-powered Playwright test generation and execution platform.

## Quick Start

```bash
npm install
npm run dev
```

Visit http://localhost:3210

## Features

- AI test generation (Anthropic/OpenAI/Gemini)
- One-click test execution
- Playwright trace viewer integration
- File-based storage (no database)
- Single-user, local-only

## Project Structure

- `server/` - Express backend + Playwright runner
- `client/` - Vite + React frontend
- `shared/` - Shared TypeScript types
```

**Step 7: Commit**

Run:
```bash
git init
git add .
git commit -m "chore: initialize project scaffolding"
```

---

## Task 2: Server Setup (Express + TypeScript)

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`
- Create: `server/src/config.ts`

**Step 1: Initialize server package**

Run:
```bash
mkdir -p server/src
cd server
npm init -y
```

**Step 2: Install server dependencies**

Run:
```bash
npm install express cors dotenv
npm install -D @types/express @types/cors @types/node typescript tsx nodemon
```

**Step 3: Create server TypeScript config**

Create `server/tsconfig.json`:
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create server config module**

Create `server/src/config.ts`:
```typescript
import os from 'os';
import path from 'path';

export const CONFIG = {
  PORT: process.env.PORT || 3210,
  DATA_DIR: process.env.TRAILWRIGHT_DATA_DIR || path.join(os.homedir(), '.trailwright'),
  NODE_ENV: process.env.NODE_ENV || 'development'
} as const;

export const PATHS = {
  TESTS: path.join(CONFIG.DATA_DIR, 'tests'),
  RUNS: path.join(CONFIG.DATA_DIR, 'runs'),
  CONFIG: path.join(CONFIG.DATA_DIR, 'config.json'),
  PLAYWRIGHT_CONFIG: path.join(CONFIG.DATA_DIR, 'playwright.config.ts')
} as const;
```

**Step 5: Create basic Express server**

Create `server/src/index.ts`:
```typescript
import express from 'express';
import cors from 'cors';
import { CONFIG } from './config.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 TrailWright server running on http://localhost:${CONFIG.PORT}`);
});
```

**Step 6: Add server scripts to package.json**

Modify `server/package.json`:
```json
{
  "name": "trailwright-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "express": "^4.21.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/cors": "^2.8.17",
    "@types/node": "^22.8.6",
    "typescript": "^5.6.3",
    "tsx": "^4.19.2",
    "nodemon": "^3.1.7"
  }
}
```

**Step 7: Test server runs**

Run:
```bash
npm run dev
```

Expected: Server starts on port 3210, logs "🚀 TrailWright server running..."

**Step 8: Test health endpoint**

Run (in another terminal):
```bash
curl http://localhost:3210/api/health
```

Expected: `{"status":"ok","timestamp":"..."}`

**Step 9: Commit**

Run:
```bash
git add .
git commit -m "feat: add Express server with health endpoint"
```

---

## Task 3: Client Setup (Vite + React + Tailwind)

**Files:**
- Create: `client/package.json`
- Create: `client/index.html`
- Create: `client/src/main.tsx`
- Create: `client/src/App.tsx`
- Create: `client/tailwind.config.js`
- Create: `client/postcss.config.js`
- Create: `client/src/index.css`

**Step 1: Initialize Vite project**

Run:
```bash
cd ..
npm create vite@latest client -- --template react-ts
cd client
```

**Step 2: Install client dependencies**

Run:
```bash
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**Step 3: Configure Tailwind**

Modify `client/tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

**Step 4: Add Tailwind directives**

Create `client/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 5: Create basic App component**

Create `client/src/App.tsx`:
```typescript
import { useState, useEffect } from 'react';

function App() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    fetch('http://localhost:3210/api/health')
      .then(res => res.json())
      .then(data => setHealth(data))
      .catch(err => console.error('Health check failed:', err));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          TrailWright QA
        </h1>
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-600">
            Server status: {health ? '✅ Connected' : '⏳ Connecting...'}
          </p>
          {health && (
            <pre className="mt-4 text-sm text-gray-500">
              {JSON.stringify(health, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
```

**Step 6: Update main.tsx**

Modify `client/src/main.tsx`:
```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

**Step 7: Update Vite config for proxy**

Modify `client/vite.config.ts`:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3210',
        changeOrigin: true,
      }
    }
  }
});
```

**Step 8: Update App to use proxy**

Modify `client/src/App.tsx` (change fetch URL):
```typescript
fetch('/api/health')  // Remove http://localhost:3210
```

**Step 9: Test client runs**

Run:
```bash
npm run dev
```

Expected: Client starts on port 3000, shows "Server status: ✅ Connected"

**Step 10: Commit**

Run:
```bash
cd ..
git add .
git commit -m "feat: add Vite+React client with Tailwind"
```

---

## Task 4: File-Based Storage System

**Files:**
- Create: `server/src/storage/index.ts`
- Create: `server/src/storage/config.ts`
- Create: `server/src/storage/tests.ts`
- Create: `server/src/storage/runs.ts`
- Test: `server/src/storage/__tests__/storage.test.ts`

**Step 1: Write test for storage initialization**

Create `server/src/storage/__tests__/storage.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initStorage } from '../index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Storage', () => {
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = path.join(os.tmpdir(), 'trailwright-test-' + Date.now());
  });

  afterEach(async () => {
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  it('should create data directories on init', async () => {
    await initStorage(testDataDir);

    const testsDir = await fs.stat(path.join(testDataDir, 'tests'));
    const runsDir = await fs.stat(path.join(testDataDir, 'runs'));
    const configFile = await fs.stat(path.join(testDataDir, 'config.json'));

    expect(testsDir.isDirectory()).toBe(true);
    expect(runsDir.isDirectory()).toBe(true);
    expect(configFile.isFile()).toBe(true);
  });
});
```

**Step 2: Install vitest**

Run:
```bash
cd server
npm install -D vitest
```

Add to `server/package.json`:
```json
"scripts": {
  "test": "vitest",
  "test:ui": "vitest --ui"
}
```

**Step 3: Run test to verify it fails**

Run:
```bash
npm test
```

Expected: FAIL - "Cannot find module '../index.js'"

**Step 4: Implement storage initialization**

Create `server/src/storage/index.ts`:
```typescript
import fs from 'fs/promises';
import path from 'path';

export async function initStorage(dataDir: string): Promise<void> {
  const testsDir = path.join(dataDir, 'tests');
  const runsDir = path.join(dataDir, 'runs');
  const configPath = path.join(dataDir, 'config.json');

  // Create directories
  await fs.mkdir(testsDir, { recursive: true });
  await fs.mkdir(runsDir, { recursive: true });

  // Create default config if doesn't exist
  try {
    await fs.access(configPath);
  } catch {
    const defaultConfig = {
      apiProvider: 'anthropic',
      apiKey: '',
      defaultBrowser: 'chromium',
      createdAt: new Date().toISOString()
    };
    await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2));
  }
}
```

**Step 5: Run test to verify it passes**

Run:
```bash
npm test
```

Expected: PASS - 1 test passed

**Step 6: Write test for saving/loading config**

Add to `server/src/storage/__tests__/storage.test.ts`:
```typescript
import { loadConfig, saveConfig } from '../config.js';

it('should save and load config', async () => {
  await initStorage(testDataDir);

  const config = { apiProvider: 'openai', apiKey: 'sk-test' };
  await saveConfig(testDataDir, config);

  const loaded = await loadConfig(testDataDir);
  expect(loaded.apiProvider).toBe('openai');
  expect(loaded.apiKey).toBe('sk-test');
});
```

**Step 7: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - "Cannot find module '../config.js'"

**Step 8: Implement config module**

Create `server/src/storage/config.ts`:
```typescript
import fs from 'fs/promises';
import path from 'path';

export interface Config {
  apiProvider: 'anthropic' | 'openai' | 'gemini';
  apiKey: string;
  defaultBrowser?: 'chromium' | 'firefox' | 'webkit';
  baseUrl?: string;
}

export async function loadConfig(dataDir: string): Promise<Config> {
  const configPath = path.join(dataDir, 'config.json');
  const content = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(content);
}

export async function saveConfig(dataDir: string, config: Partial<Config>): Promise<void> {
  const configPath = path.join(dataDir, 'config.json');
  const existing = await loadConfig(dataDir);
  const updated = { ...existing, ...config };
  await fs.writeFile(configPath, JSON.stringify(updated, null, 2));
}
```

**Step 9: Run test to verify it passes**

Run: `npm test`
Expected: PASS - 2 tests passed

**Step 10: Export storage functions**

Modify `server/src/storage/index.ts`:
```typescript
export * from './config.js';
export * from './tests.js';
export * from './runs.js';

// ... rest of initStorage code
```

**Step 11: Commit**

Run:
```bash
git add .
git commit -m "feat: add file-based storage with config management"
```

---

## Task 5: Test File Management

**Files:**
- Create: `server/src/storage/tests.ts`
- Create: `shared/types.ts`
- Test: Update `server/src/storage/__tests__/storage.test.ts`

**Step 1: Create shared types**

Create `shared/types.ts`:
```typescript
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
```

**Step 2: Write test for saving test file**

Add to `server/src/storage/__tests__/storage.test.ts`:
```typescript
import { saveTest, loadTest, listTests } from '../tests.js';

it('should save and load test file', async () => {
  await initStorage(testDataDir);

  const test = {
    metadata: {
      id: 'login-test',
      name: 'Login Test',
      description: 'Test user login',
      createdAt: new Date().toISOString()
    },
    code: `import { test } from '@playwright/test';\ntest('login', async ({ page }) => {});`
  };

  await saveTest(testDataDir, test);
  const loaded = await loadTest(testDataDir, 'login-test');

  expect(loaded.metadata.name).toBe('Login Test');
  expect(loaded.code).toContain('test(\'login\'');
});
```

**Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - "Cannot find module '../tests.js'"

**Step 4: Implement test management**

Create `server/src/storage/tests.ts`:
```typescript
import fs from 'fs/promises';
import path from 'path';
import type { Test, TestMetadata } from '../../shared/types.js';

const METADATA_DELIMITER = '// === TRAILWRIGHT_METADATA ===';

function serializeTest(test: Test): string {
  const metadataComment = `/**\n * ${METADATA_DELIMITER}\n * ${JSON.stringify(test.metadata, null, 2)}\n */\n\n`;
  return metadataComment + test.code;
}

function parseTest(content: string, testId: string): Test {
  const metadataMatch = content.match(/\/\*\*\n \* \/\/ === TRAILWRIGHT_METADATA ===\n \* ([\s\S]*?)\n \*\//);

  if (metadataMatch) {
    const metadata = JSON.parse(metadataMatch[1]);
    const code = content.replace(metadataMatch[0], '').trim();
    return { metadata, code };
  }

  // Fallback for tests without metadata
  return {
    metadata: {
      id: testId,
      name: testId,
      createdAt: new Date().toISOString()
    },
    code: content
  };
}

export async function saveTest(dataDir: string, test: Test): Promise<void> {
  const testsDir = path.join(dataDir, 'tests');
  const filePath = path.join(testsDir, `${test.metadata.id}.spec.ts`);
  const content = serializeTest(test);
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function loadTest(dataDir: string, testId: string): Promise<Test> {
  const testsDir = path.join(dataDir, 'tests');
  const filePath = path.join(testsDir, `${testId}.spec.ts`);
  const content = await fs.readFile(filePath, 'utf-8');
  return parseTest(content, testId);
}

export async function listTests(dataDir: string): Promise<TestMetadata[]> {
  const testsDir = path.join(dataDir, 'tests');

  try {
    const files = await fs.readdir(testsDir);
    const testFiles = files.filter(f => f.endsWith('.spec.ts'));

    const tests = await Promise.all(
      testFiles.map(async (file) => {
        const testId = file.replace('.spec.ts', '');
        const test = await loadTest(dataDir, testId);
        return test.metadata;
      })
    );

    return tests.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch (err) {
    return [];
  }
}

export async function deleteTest(dataDir: string, testId: string): Promise<void> {
  const testsDir = path.join(dataDir, 'tests');
  const filePath = path.join(testsDir, `${testId}.spec.ts`);
  await fs.unlink(filePath);
}
```

**Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS - all tests passed

**Step 6: Write test for listing tests**

Add to `server/src/storage/__tests__/storage.test.ts`:
```typescript
it('should list all tests', async () => {
  await initStorage(testDataDir);

  await saveTest(testDataDir, {
    metadata: { id: 'test1', name: 'Test 1', createdAt: new Date().toISOString() },
    code: 'test code 1'
  });

  await saveTest(testDataDir, {
    metadata: { id: 'test2', name: 'Test 2', createdAt: new Date().toISOString() },
    code: 'test code 2'
  });

  const tests = await listTests(testDataDir);
  expect(tests).toHaveLength(2);
  expect(tests.map(t => t.id)).toContain('test1');
  expect(tests.map(t => t.id)).toContain('test2');
});
```

**Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS - all tests passed

**Step 8: Commit**

Run:
```bash
git add .
git commit -m "feat: add test file management with metadata"
```

---

## Task 6: AI Test Generation

**Files:**
- Create: `server/src/ai/index.ts`
- Create: `server/src/ai/prompts.ts`
- Create: `server/.env.example`

**Step 1: Install AI SDKs**

Run:
```bash
cd server
npm install @anthropic-ai/sdk openai @google/generative-ai
```

**Step 2: Create environment example**

Create `server/.env.example`:
```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
```

**Step 3: Create AI prompts module**

Create `server/src/ai/prompts.ts`:
```typescript
export const SYSTEM_PROMPT = `You are an expert Playwright test generator.

Given a user's description of what to test, generate a complete, working Playwright test.

REQUIREMENTS:
1. Use TypeScript
2. Import from '@playwright/test'
3. Use resilient selectors in this priority:
   - getByRole (preferred)
   - getByLabel
   - getByPlaceholder
   - getByTestId
   - getByText
   - CSS selectors (last resort)
4. Include meaningful assertions
5. Add comments explaining each step
6. Handle common wait conditions (page loads, network idle)
7. Return ONLY the test code, no markdown formatting, no explanations

Example output:
import { test, expect } from '@playwright/test';

test('user login flow', async ({ page }) => {
  // Navigate to login page
  await page.goto('https://example.com/login');

  // Fill in credentials
  await page.getByLabel('Email').fill('user@example.com');
  await page.getByLabel('Password').fill('password123');

  // Submit form
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Verify successful login
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});`;

export function buildTestGenerationPrompt(userPrompt: string, baseUrl?: string): string {
  let prompt = `Generate a Playwright test for the following scenario:\n\n${userPrompt}`;

  if (baseUrl) {
    prompt += `\n\nBase URL: ${baseUrl}`;
  }

  return prompt;
}
```

**Step 4: Create AI service**

Create `server/src/ai/index.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { SYSTEM_PROMPT, buildTestGenerationPrompt } from './prompts.js';

export type AIProvider = 'anthropic' | 'openai' | 'gemini';

export interface GenerateTestOptions {
  provider: AIProvider;
  apiKey: string;
  prompt: string;
  baseUrl?: string;
}

export async function generateTest(options: GenerateTestOptions): Promise<string> {
  const { provider, apiKey, prompt, baseUrl } = options;

  switch (provider) {
    case 'anthropic':
      return generateWithAnthropic(apiKey, prompt, baseUrl);
    case 'openai':
      return generateWithOpenAI(apiKey, prompt, baseUrl);
    case 'gemini':
      return generateWithGemini(apiKey, prompt, baseUrl);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
}

async function generateWithAnthropic(
  apiKey: string,
  userPrompt: string,
  baseUrl?: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: buildTestGenerationPrompt(userPrompt, baseUrl)
    }]
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  return cleanGeneratedCode(content.text);
}

async function generateWithOpenAI(
  apiKey: string,
  userPrompt: string,
  baseUrl?: string
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildTestGenerationPrompt(userPrompt, baseUrl) }
    ],
    max_tokens: 4000
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  return cleanGeneratedCode(content);
}

async function generateWithGemini(
  apiKey: string,
  userPrompt: string,
  baseUrl?: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

  const result = await model.generateContent([
    SYSTEM_PROMPT,
    buildTestGenerationPrompt(userPrompt, baseUrl)
  ]);

  const response = result.response;
  const text = response.text();

  return cleanGeneratedCode(text);
}

function cleanGeneratedCode(code: string): string {
  // Remove markdown code fences if present
  let cleaned = code.replace(/```typescript\n?/g, '').replace(/```\n?/g, '');

  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();

  // Ensure it starts with import
  if (!cleaned.startsWith('import')) {
    throw new Error('Generated code does not start with import statement');
  }

  return cleaned;
}
```

**Step 5: Create API endpoint for test generation**

Create `server/src/routes/tests.ts`:
```typescript
import express from 'express';
import { generateTest } from '../ai/index.js';
import { saveTest, loadTest, listTests, deleteTest } from '../storage/tests.js';
import { loadConfig } from '../storage/config.js';
import { CONFIG } from '../config.js';
import type { Test } from '../../shared/types.js';

const router = express.Router();

// Generate test from AI prompt
router.post('/generate', async (req, res) => {
  try {
    const { prompt, baseUrl } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const config = await loadConfig(CONFIG.DATA_DIR);

    if (!config.apiKey) {
      return res.status(400).json({ error: 'API key not configured' });
    }

    const code = await generateTest({
      provider: config.apiProvider,
      apiKey: config.apiKey,
      prompt,
      baseUrl: baseUrl || config.baseUrl
    });

    res.json({ code });
  } catch (err: any) {
    console.error('Test generation error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate test' });
  }
});

// List all tests
router.get('/', async (req, res) => {
  try {
    const tests = await listTests(CONFIG.DATA_DIR);
    res.json({ tests });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single test
router.get('/:id', async (req, res) => {
  try {
    const test = await loadTest(CONFIG.DATA_DIR, req.params.id);
    res.json({ test });
  } catch (err: any) {
    res.status(404).json({ error: 'Test not found' });
  }
});

// Save test
router.post('/', async (req, res) => {
  try {
    const test: Test = req.body;

    if (!test.metadata.id || !test.code) {
      return res.status(400).json({ error: 'Invalid test data' });
    }

    if (!test.metadata.createdAt) {
      test.metadata.createdAt = new Date().toISOString();
    }
    test.metadata.updatedAt = new Date().toISOString();

    await saveTest(CONFIG.DATA_DIR, test);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete test
router.delete('/:id', async (req, res) => {
  try {
    await deleteTest(CONFIG.DATA_DIR, req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

**Step 6: Register routes in main server**

Modify `server/src/index.ts`:
```typescript
import express from 'express';
import cors from 'cors';
import { CONFIG } from './config.js';
import { initStorage } from './storage/index.js';
import testsRouter from './routes/tests.js';

const app = express();

app.use(cors());
app.use(express.json());

// Initialize storage on startup
await initStorage(CONFIG.DATA_DIR);
console.log(`📁 Data directory: ${CONFIG.DATA_DIR}`);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/tests', testsRouter);

app.listen(CONFIG.PORT, () => {
  console.log(`🚀 TrailWright server running on http://localhost:${CONFIG.PORT}`);
});
```

**Step 7: Test AI generation manually**

Run server:
```bash
npm run dev
```

Test with curl (replace with your API key):
```bash
curl -X POST http://localhost:3210/api/tests/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Test login with valid credentials"}'
```

Expected: Error "API key not configured" (we'll set it in settings UI)

**Step 8: Commit**

Run:
```bash
git add .
git commit -m "feat: add AI test generation with Anthropic/OpenAI/Gemini"
```

---

## Task 7: Playwright Test Runner

**Files:**
- Create: `server/src/playwright/runner.ts`
- Create: `server/src/playwright/config.ts`
- Create: `server/src/routes/runs.ts`

**Step 1: Install Playwright**

Run:
```bash
cd server
npm install @playwright/test
npx playwright install chromium
```

**Step 2: Create Playwright config template**

Create `server/src/playwright/config.ts`:
```typescript
import path from 'path';

export function generatePlaywrightConfig(dataDir: string): string {
  return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [
    ['html', { outputFolder: 'runs/latest/html-report', open: 'never' }],
    ['json', { outputFile: 'runs/latest/results.json' }]
  ],
});
`;
}

export async function ensurePlaywrightConfig(dataDir: string): Promise<void> {
  const fs = await import('fs/promises');
  const configPath = path.join(dataDir, 'playwright.config.ts');

  try {
    await fs.access(configPath);
  } catch {
    const config = generatePlaywrightConfig(dataDir);
    await fs.writeFile(configPath, config);
  }
}
```

**Step 3: Create test runner**

Create `server/src/playwright/runner.ts`:
```typescript
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import type { RunResult } from '../../shared/types.js';

export interface RunTestOptions {
  dataDir: string;
  testId: string;
}

export async function runTest(options: RunTestOptions): Promise<RunResult> {
  const { dataDir, testId } = options;
  const testFile = path.join(dataDir, 'tests', `${testId}.spec.ts`);

  // Create run ID
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}_${testId}`;
  const runDir = path.join(dataDir, 'runs', runId);
  await fs.mkdir(runDir, { recursive: true });

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn('npx', [
      'playwright', 'test',
      testFile,
      '--reporter=json'
    ], {
      cwd: dataDir,
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      try {
        // Parse Playwright JSON output
        const resultsPath = path.join(dataDir, 'runs', 'latest', 'results.json');
        let playwrightResults: any;

        try {
          const resultsContent = await fs.readFile(resultsPath, 'utf-8');
          playwrightResults = JSON.parse(resultsContent);
        } catch (err) {
          playwrightResults = null;
        }

        // Move artifacts to run directory
        const latestDir = path.join(dataDir, 'runs', 'latest');
        try {
          const files = await fs.readdir(latestDir);
          for (const file of files) {
            if (file.endsWith('.zip') || file.endsWith('.webm') || file.endsWith('.png')) {
              await fs.rename(
                path.join(latestDir, file),
                path.join(runDir, file)
              );
            }
          }
        } catch (err) {
          // Ignore if no artifacts
        }

        // Determine status
        let status: 'passed' | 'failed' | 'skipped' = 'passed';
        let error: string | undefined;

        if (playwrightResults?.suites) {
          const tests = playwrightResults.suites.flatMap((s: any) => s.specs || []);
          const failed = tests.some((t: any) =>
            t.tests?.some((test: any) =>
              test.results?.some((r: any) => r.status === 'failed')
            )
          );

          if (failed) {
            status = 'failed';
            const failedTest = tests.find((t: any) =>
              t.tests?.some((test: any) =>
                test.results?.some((r: any) => r.status === 'failed')
              )
            );
            error = failedTest?.tests?.[0]?.results?.[0]?.error?.message || 'Test failed';
          }
        } else if (code !== 0) {
          status = 'failed';
          error = stderr || 'Test execution failed';
        }

        // Find trace file
        let tracePath: string | undefined;
        try {
          const runFiles = await fs.readdir(runDir);
          const traceFile = runFiles.find(f => f.endsWith('.zip'));
          if (traceFile) {
            tracePath = path.join(runDir, traceFile);
          }
        } catch (err) {
          // No trace
        }

        const result: RunResult = {
          id: runId,
          testId,
          status,
          duration,
          startedAt: new Date(startTime).toISOString(),
          endedAt: new Date(endTime).toISOString(),
          tracePath,
          error
        };

        // Save result.json
        await fs.writeFile(
          path.join(runDir, 'result.json'),
          JSON.stringify(result, null, 2)
        );

        resolve(result);
      } catch (err: any) {
        reject(new Error(`Failed to process test results: ${err.message}`));
      }
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
        .filter(dir => dir !== 'latest')
        .map(async (dir) => {
          try {
            const result = await getRunResult(dataDir, dir);
            return result;
          } catch {
            return null;
          }
        })
    );

    const validRuns = runs.filter((r): r is RunResult => r !== null);

    if (testId) {
      return validRuns
        .filter(r => r.testId === testId)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    }

    return validRuns.sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  } catch (err) {
    return [];
  }
}
```

**Step 4: Create runs API routes**

Create `server/src/routes/runs.ts`:
```typescript
import express from 'express';
import { runTest, getRunResult, listRuns } from '../playwright/runner.js';
import { CONFIG } from '../config.js';
import { spawn } from 'child_process';
import path from 'path';

const router = express.Router();

// Run a test
router.post('/', async (req, res) => {
  try {
    const { testId } = req.body;

    if (!testId) {
      return res.status(400).json({ error: 'testId is required' });
    }

    const result = await runTest({
      dataDir: CONFIG.DATA_DIR,
      testId
    });

    res.json({ result });
  } catch (err: any) {
    console.error('Test run error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all runs or runs for specific test
router.get('/', async (req, res) => {
  try {
    const { testId } = req.query;
    const runs = await listRuns(CONFIG.DATA_DIR, testId as string);
    res.json({ runs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single run result
router.get('/:runId', async (req, res) => {
  try {
    const result = await getRunResult(CONFIG.DATA_DIR, req.params.runId);
    res.json({ result });
  } catch (err: any) {
    res.status(404).json({ error: 'Run not found' });
  }
});

// Open trace viewer for a run
router.post('/:runId/trace', async (req, res) => {
  try {
    const result = await getRunResult(CONFIG.DATA_DIR, req.params.runId);

    if (!result.tracePath) {
      return res.status(404).json({ error: 'No trace available for this run' });
    }

    // Spawn trace viewer in background
    spawn('npx', ['playwright', 'show-trace', result.tracePath], {
      detached: true,
      stdio: 'ignore'
    }).unref();

    res.json({ success: true, message: 'Trace viewer opened' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

**Step 5: Register runs routes**

Modify `server/src/index.ts`:
```typescript
import runsRouter from './routes/runs.js';

// ... existing code ...

app.use('/api/runs', runsRouter);
```

**Step 6: Initialize Playwright config on startup**

Modify `server/src/index.ts`:
```typescript
import { ensurePlaywrightConfig } from './playwright/config.js';

// ... after initStorage ...

await ensurePlaywrightConfig(CONFIG.DATA_DIR);
console.log(`🎭 Playwright configured`);
```

**Step 7: Test runner manually**

First, save a simple test via API, then run it:
```bash
curl -X POST http://localhost:3210/api/runs \
  -H "Content-Type: application/json" \
  -d '{"testId": "your-test-id"}'
```

Expected: Test executes, returns result with status

**Step 8: Commit**

Run:
```bash
git add .
git commit -m "feat: add Playwright test runner with trace support"
```

---

## Task 8: Settings UI & Config Management

**Files:**
- Create: `client/src/pages/Settings.tsx`
- Create: `client/src/api/client.ts`
- Create: `server/src/routes/config.ts`

**Step 1: Create config API routes**

Create `server/src/routes/config.ts`:
```typescript
import express from 'express';
import { loadConfig, saveConfig } from '../storage/config.js';
import { CONFIG } from '../config.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const config = await loadConfig(CONFIG.DATA_DIR);
    // Don't send full API key to client, just indicate if set
    res.json({
      ...config,
      apiKey: config.apiKey ? '***' + config.apiKey.slice(-4) : ''
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    await saveConfig(CONFIG.DATA_DIR, req.body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
```

**Step 2: Register config routes**

Modify `server/src/index.ts`:
```typescript
import configRouter from './routes/config.js';

app.use('/api/config', configRouter);
```

**Step 3: Create API client**

Create `client/src/api/client.ts`:
```typescript
const API_BASE = '/api';

export async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Config
  getConfig: () => fetchApi<any>('/config'),
  saveConfig: (config: any) => fetchApi('/config', {
    method: 'POST',
    body: JSON.stringify(config),
  }),

  // Tests
  listTests: () => fetchApi<{ tests: any[] }>('/tests'),
  getTest: (id: string) => fetchApi<{ test: any }>(`/tests/${id}`),
  saveTest: (test: any) => fetchApi('/tests', {
    method: 'POST',
    body: JSON.stringify(test),
  }),
  generateTest: (prompt: string, baseUrl?: string) => fetchApi<{ code: string }>('/tests/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt, baseUrl }),
  }),
  deleteTest: (id: string) => fetchApi(`/tests/${id}`, { method: 'DELETE' }),

  // Runs
  runTest: (testId: string) => fetchApi<{ result: any }>('/runs', {
    method: 'POST',
    body: JSON.stringify({ testId }),
  }),
  listRuns: (testId?: string) => fetchApi<{ runs: any[] }>(`/runs${testId ? `?testId=${testId}` : ''}`),
  getRun: (runId: string) => fetchApi<{ result: any }>(`/runs/${runId}`),
  openTrace: (runId: string) => fetchApi('/runs/' + runId + '/trace', { method: 'POST' }),
};
```

**Step 4: Create Settings page**

Create `client/src/pages/Settings.tsx`:
```typescript
import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function Settings() {
  const [config, setConfig] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const data = await api.getConfig();
      setConfig(data);
    } catch (err: any) {
      console.error('Failed to load config:', err);
    }
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');

    try {
      await api.saveConfig(config);
      setMessage('Settings saved successfully');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!config) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>

        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          {/* AI Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              AI Provider
            </label>
            <div className="space-y-2">
              {['anthropic', 'openai', 'gemini'].map((provider) => (
                <label key={provider} className="flex items-center">
                  <input
                    type="radio"
                    name="provider"
                    value={provider}
                    checked={config.apiProvider === provider}
                    onChange={(e) => setConfig({ ...config, apiProvider: e.target.value })}
                    className="mr-2"
                  />
                  <span className="capitalize">{provider}</span>
                </label>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              API Key
            </label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-sm text-gray-500">
              Your API key is stored locally only and never sent to any server except the AI provider.
            </p>
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Base URL (optional)
            </label>
            <input
              type="url"
              value={config.baseUrl || ''}
              onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
              placeholder="https://example.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Default Browser */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Default Browser
            </label>
            <div className="space-x-4">
              {['chromium', 'firefox', 'webkit'].map((browser) => (
                <label key={browser} className="inline-flex items-center">
                  <input
                    type="radio"
                    name="browser"
                    value={browser}
                    checked={config.defaultBrowser === browser}
                    onChange={(e) => setConfig({ ...config, defaultBrowser: e.target.value })}
                    className="mr-2"
                  />
                  <span className="capitalize">{browser}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <div className="pt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            {message && (
              <p className={`mt-2 text-sm ${message.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
                {message}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 5: Commit**

Run:
```bash
git add .
git commit -m "feat: add settings UI and config management"
```

---

## Task 9: Test Generation UI

**Files:**
- Create: `client/src/pages/Home.tsx`
- Create: `client/src/components/GenerateTestModal.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Install React Router**

Run:
```bash
cd client
npm install react-router-dom
```

**Step 2: Create Generate Test Modal**

Create `client/src/components/GenerateTestModal.tsx`:
```typescript
import { useState } from 'react';
import { api } from '../api/client';

interface Props {
  onClose: () => void;
  onTestGenerated: (code: string) => void;
}

export default function GenerateTestModal({ onClose, onTestGenerated }: Props) {
  const [prompt, setPrompt] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    if (!prompt.trim()) return;

    setGenerating(true);
    setError('');

    try {
      const { code } = await api.generateTest(prompt, baseUrl || undefined);
      onTestGenerated(code);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full p-6">
        <h2 className="text-2xl font-bold mb-4">Generate Test with AI</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Describe what to test
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Example: Test user login with valid credentials and verify dashboard loads"
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Base URL (optional)
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
              className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? 'Generating...' : 'Generate Test'}
            </button>
            <button
              onClick={onClose}
              disabled={generating}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Create Home page with test library**

Create `client/src/pages/Home.tsx`:
```typescript
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import GenerateTestModal from '../components/GenerateTestModal';

export default function Home() {
  const navigate = useNavigate();
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  useEffect(() => {
    loadTests();
  }, []);

  async function loadTests() {
    try {
      const { tests: data } = await api.listTests();
      setTests(data);
    } catch (err) {
      console.error('Failed to load tests:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleTestGenerated(code: string) {
    navigate('/test/new', { state: { code } });
  }

  async function handleRunTest(testId: string) {
    try {
      await api.runTest(testId);
      alert('Test started! Check results below.');
      loadTests(); // Refresh to show latest run
    } catch (err: any) {
      alert('Failed to run test: ' + err.message);
    }
  }

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900">TrailWright QA</h1>
          <button
            onClick={() => navigate('/settings')}
            className="px-4 py-2 text-gray-600 hover:text-gray-900"
          >
            ⚙️ Settings
          </button>
        </div>

        {/* Generate Test Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Generate Test with AI</h2>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            ✨ Generate New Test
          </button>
        </div>

        {/* Test Library */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Your Tests</h2>

          {tests.length === 0 ? (
            <p className="text-gray-500">No tests yet. Generate one to get started!</p>
          ) : (
            <div className="space-y-3">
              {tests.map((test) => (
                <div
                  key={test.id}
                  className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{test.name}</h3>
                    {test.description && (
                      <p className="text-sm text-gray-500 mt-1">{test.description}</p>
                    )}
                    {test.tags && test.tags.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {test.tags.map((tag: string) => (
                          <span
                            key={tag}
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/test/${test.id}`)}
                      className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleRunTest(test.id)}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      Run
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showGenerateModal && (
        <GenerateTestModal
          onClose={() => setShowGenerateModal(false)}
          onTestGenerated={handleTestGenerated}
        />
      )}
    </div>
  );
}
```

**Step 4: Update App.tsx with routing**

Modify `client/src/App.tsx`:
```typescript
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Settings from './pages/Settings';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

**Step 5: Test the UI**

Run both server and client:
```bash
npm run dev
```

Visit http://localhost:3000, click "Generate New Test", enter a prompt

Expected: Modal opens, can generate test (after configuring API key in Settings)

**Step 6: Commit**

Run:
```bash
git add .
git commit -m "feat: add test generation UI and test library"
```

---

## Task 10: Test Editor & Results Viewer

**Files:**
- Create: `client/src/pages/TestEditor.tsx`
- Create: `client/src/pages/TestResults.tsx`

**Step 1: Install syntax highlighter**

Run:
```bash
cd client
npm install @uiw/react-textarea-code-editor
```

**Step 2: Create Test Editor page**

Create `client/src/pages/TestEditor.tsx`:
```typescript
import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import CodeEditor from '@uiw/react-textarea-code-editor';
import { api } from '../api/client';

export default function TestEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [test, setTest] = useState<any>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id && id !== 'new') {
      loadTest();
    } else if (location.state?.code) {
      setCode(location.state.code);
      setName('New Test');
    }
  }, [id]);

  async function loadTest() {
    try {
      const { test: data } = await api.getTest(id!);
      setTest(data);
      setCode(data.code);
      setName(data.metadata.name);
      setDescription(data.metadata.description || '');
    } catch (err) {
      console.error('Failed to load test:', err);
    }
  }

  async function handleSave() {
    setSaving(true);

    try {
      const testId = id === 'new'
        ? name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        : id!;

      await api.saveTest({
        metadata: {
          id: testId,
          name,
          description,
          createdAt: test?.metadata.createdAt || new Date().toISOString(),
        },
        code
      });

      navigate(`/test/${testId}/results`);
    } catch (err: any) {
      alert('Failed to save test: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAndRun() {
    await handleSave();

    const testId = id === 'new'
      ? name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      : id!;

    try {
      await api.runTest(testId);
      navigate(`/test/${testId}/results`);
    } catch (err: any) {
      alert('Failed to run test: ' + err.message);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to Tests
          </button>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Test Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description (optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Test Code
            </label>
            <CodeEditor
              value={code}
              language="typescript"
              placeholder="Test code will appear here..."
              onChange={(e) => setCode(e.target.value)}
              padding={15}
              style={{
                fontSize: 14,
                fontFamily: 'ui-monospace, SFMono-Regular, Monaco, Consolas, monospace',
                backgroundColor: '#f8f9fa',
                borderRadius: '0.5rem',
                minHeight: '400px',
              }}
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleSaveAndRun}
              disabled={saving || !name.trim() || !code.trim()}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save & Run'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !code.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Create Test Results page**

Create `client/src/pages/TestResults.tsx`:
```typescript
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';

export default function TestResults() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [test, setTest] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [id]);

  async function loadData() {
    try {
      const [{ test: testData }, { runs: runsData }] = await Promise.all([
        api.getTest(id!),
        api.listRuns(id)
      ]);
      setTest(testData);
      setRuns(runsData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenTrace(runId: string) {
    try {
      await api.openTrace(runId);
    } catch (err: any) {
      alert('Failed to open trace: ' + err.message);
    }
  }

  async function handleRunTest() {
    try {
      await api.runTest(id!);
      // Reload runs after a delay
      setTimeout(() => loadData(), 2000);
    } catch (err: any) {
      alert('Failed to run test: ' + err.message);
    }
  }

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  const latestRun = runs[0];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 hover:text-blue-800"
          >
            ← Back to Tests
          </button>
          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/test/${id}`)}
              className="px-4 py-2 text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              Edit Test
            </button>
            <button
              onClick={handleRunTest}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Run Again
            </button>
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-6">{test.metadata.name}</h1>

        {/* Latest Run */}
        {latestRun && (
          <div className="bg-white rounded-lg shadow p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4">Latest Run</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <span className="text-gray-600">Status:</span>
                <span className={`ml-2 font-semibold ${
                  latestRun.status === 'passed' ? 'text-green-600' :
                  latestRun.status === 'failed' ? 'text-red-600' :
                  'text-gray-600'
                }`}>
                  {latestRun.status === 'passed' ? '✅ Passed' :
                   latestRun.status === 'failed' ? '❌ Failed' :
                   '⏭️ Skipped'}
                </span>
              </div>
              <div>
                <span className="text-gray-600">Duration:</span>
                <span className="ml-2">{(latestRun.duration / 1000).toFixed(2)}s</span>
              </div>
              <div>
                <span className="text-gray-600">Started:</span>
                <span className="ml-2">{new Date(latestRun.startedAt).toLocaleString()}</span>
              </div>
            </div>

            {latestRun.error && (
              <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm mb-4">
                <strong>Error:</strong> {latestRun.error}
              </div>
            )}

            {latestRun.tracePath && (
              <button
                onClick={() => handleOpenTrace(latestRun.id)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                🔍 Open Playwright Trace Viewer
              </button>
            )}
          </div>
        )}

        {/* Run History */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Run History</h2>

          {runs.length === 0 ? (
            <p className="text-gray-500">No runs yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                >
                  <div className="flex-1">
                    <span className={`font-medium ${
                      run.status === 'passed' ? 'text-green-600' :
                      run.status === 'failed' ? 'text-red-600' :
                      'text-gray-600'
                    }`}>
                      {run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : '⏭️'}
                    </span>
                    <span className="ml-2 text-gray-700">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                    <span className="ml-4 text-gray-500 text-sm">
                      ({(run.duration / 1000).toFixed(2)}s)
                    </span>
                  </div>
                  {run.tracePath && (
                    <button
                      onClick={() => handleOpenTrace(run.id)}
                      className="px-3 py-1 text-sm text-purple-600 hover:bg-purple-50 rounded"
                    >
                      View Trace
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Add routes to App.tsx**

Modify `client/src/App.tsx`:
```typescript
import TestEditor from './pages/TestEditor';
import TestResults from './pages/TestResults';

// Add to Routes:
<Route path="/test/:id" element={<TestEditor />} />
<Route path="/test/:id/results" element={<TestResults />} />
```

**Step 5: Test the full flow**

1. Start both server and client
2. Go to Settings, add API key
3. Generate a test with AI
4. Edit and save
5. Run the test
6. View results and open trace

Expected: Full flow works end-to-end

**Step 6: Commit**

Run:
```bash
git add .
git commit -m "feat: add test editor and results viewer with trace integration"
```

---

## Task 11: Polish & Documentation

**Files:**
- Update: `README.md`
- Create: `docs/user-guide.md`
- Create: `package.json` (root level for global install)

**Step 1: Update main README**

Update `README.md`:
```markdown
# TrailWright QA

Local-first AI-powered Playwright test generation and execution platform.

## Features

- 🤖 **AI Test Generation** - Generate Playwright tests from natural language prompts (Anthropic/OpenAI/Gemini)
- 🎯 **One-Click Execution** - Run tests and view results instantly
- 🔍 **Playwright Trace Viewer** - Time-travel debugging with full trace support
- 💾 **File-Based Storage** - No database required, everything in `~/.trailwright/`
- 🔒 **Local-Only** - All data stays on your machine, API keys never leave your system
- 🚀 **Zero Config** - Works out of the box with sensible defaults

## Quick Start

```bash
# Clone the repository
git clone <your-repo-url>
cd TrailWrightQA

# Install dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Start the application
npm run dev
```

Visit http://localhost:3000

## First-Time Setup

1. Click "Settings" in the top right
2. Choose your AI provider (Anthropic, OpenAI, or Gemini)
3. Enter your API key
4. Optionally set a default base URL for your tests

## Usage

### Generate a Test

1. Click "Generate New Test"
2. Describe what you want to test (e.g., "Test user login with valid credentials")
3. Click "Generate Test"
4. Review the generated code
5. Click "Save & Run"

### View Results

- Test results show pass/fail status, duration, and any errors
- Click "Open Playwright Trace Viewer" to debug failures with time-travel debugging

### Edit Tests

- Click "Edit" on any test to modify the code
- Tests are stored as `.spec.ts` files in `~/.trailwright/tests/`

## Data Location

All data is stored in `~/.trailwright/`:
- `config.json` - Settings and API keys
- `tests/` - Your test files
- `runs/` - Test results, traces, screenshots
- `playwright.config.ts` - Playwright configuration

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Playwright
- **Frontend**: Vite, React, Tailwind CSS
- **AI**: Anthropic SDK, OpenAI SDK, Google Generative AI

## Development

```bash
# Run tests
cd server && npm test

# Build for production
npm run build

# Start production server
cd server && npm start
cd client && npm run preview
```

## License

MIT
```

**Step 2: Create user guide**

Create `docs/user-guide.md`:
```markdown
# TrailWright User Guide

## Getting Started

### Installation

TrailWright requires Node.js 20+ installed on your system.

1. Clone the repository
2. Run `npm install` in the root directory
3. Run `npm install` in both `server/` and `client/` directories
4. Start the app with `npm run dev`

### Initial Configuration

Before generating tests, configure your AI provider:

1. Navigate to Settings (⚙️ icon in top right)
2. Select your AI provider:
   - **Anthropic (Claude)**: Best for complex test scenarios
   - **OpenAI (GPT-4)**: Great all-around performance
   - **Google (Gemini)**: Cost-effective option
3. Enter your API key for the chosen provider
4. Optionally set a default base URL

**Getting API Keys:**
- Anthropic: https://console.anthropic.com/
- OpenAI: https://platform.openai.com/api-keys
- Google: https://makersuite.google.com/app/apikey

## Generating Tests

### Using AI Prompts

TrailWright can generate complete Playwright tests from natural language descriptions.

**Examples of good prompts:**
- "Test user login with valid email and password, then verify dashboard appears"
- "Add an item to cart, proceed to checkout, and verify order summary"
- "Test form validation by submitting empty required fields"

**Tips for better results:**
- Be specific about the expected outcome
- Mention key UI elements (buttons, forms, etc.)
- Include validation steps

### Editing Generated Tests

After generation:
1. Review the code in the editor
2. Modify selectors or test logic as needed
3. Add or remove steps
4. Click "Save & Run" to execute immediately

## Running Tests

### Manual Execution

Click "Run" next to any test in the library to execute it immediately.

### Understanding Results

**Status Indicators:**
- ✅ **Passed**: All assertions succeeded
- ❌ **Failed**: One or more assertions failed
- ⏭️ **Skipped**: Test was skipped

**Trace Viewer:**
Click "Open Playwright Trace Viewer" on any run to see:
- Step-by-step execution
- Network requests
- Console logs
- Screenshots at each step
- DOM snapshots

## Best Practices

### Selector Strategy

TrailWright (via Playwright) prefers resilient selectors:

1. **getByRole** (most resilient)
   ```typescript
   await page.getByRole('button', { name: 'Submit' }).click();
   ```

2. **getByLabel** (forms)
   ```typescript
   await page.getByLabel('Email').fill('user@example.com');
   ```

3. **getByTestId** (custom test IDs)
   ```typescript
   await page.getByTestId('login-button').click();
   ```

4. **CSS selectors** (last resort)
   ```typescript
   await page.locator('.submit-btn').click();
   ```

### Test Organization

- Use descriptive test names
- Add tags for categorization (auth, checkout, admin, etc.)
- Keep tests focused on a single scenario

### Handling Failures

When a test fails:
1. Open the trace viewer
2. Find the failing step
3. Inspect the DOM and network at that moment
4. Update selectors or add wait conditions as needed

## Troubleshooting

### "API key not configured"
Go to Settings and enter your API key for the selected provider.

### "Test not found"
The test file may have been deleted from `~/.trailwright/tests/`. Check the directory.

### "Selector not found"
The page structure may have changed. Update the selector in the test editor.

### Trace viewer doesn't open
Ensure you have Playwright installed: `npx playwright install chromium`

## File Structure

```
~/.trailwright/
  config.json              # Your settings
  tests/
    login.spec.ts          # Test files
  runs/
    2025-10-27.../         # Each run has its own folder
      result.json          # Run metadata
      trace.zip            # Playwright trace
      screenshots/         # Failure screenshots
  playwright.config.ts     # Playwright settings
```

## Advanced Usage

### Custom Playwright Configuration

Edit `~/.trailwright/playwright.config.ts` to customize:
- Timeout values
- Browser options
- Screenshot/video settings
- Reporters

### Using Playwright Codegen

You can also generate tests using Playwright's built-in recorder:

```bash
cd ~/.trailwright
npx playwright codegen https://your-site.com
```

Then copy the generated code into a new test via the TrailWright UI.

## Support

For issues or feature requests, visit: https://github.com/yourusername/TrailWrightQA/issues
```

**Step 3: Commit**

Run:
```bash
git add .
git commit -m "docs: add comprehensive README and user guide"
```

---

## Execution Complete

**Plan saved to:** `docs/plans/2025-10-27-trailwright-mvp.md`

**What we built:**
1. ✅ Project scaffolding with TypeScript
2. ✅ Express backend with health checks
3. ✅ Vite + React frontend with Tailwind
4. ✅ File-based storage (config, tests, runs)
5. ✅ AI test generation (Anthropic/OpenAI/Gemini)
6. ✅ Playwright test runner with traces
7. ✅ Settings UI for configuration
8. ✅ Test generation modal
9. ✅ Test library and editor
10. ✅ Results viewer with trace integration
11. ✅ Documentation

**Ready to use:**
```bash
npm run dev
# Visit http://localhost:3000
# Go to Settings → add API key → generate tests
```

---

## Execution Options

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
