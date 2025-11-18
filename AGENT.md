# TrailWright QA - Project Context

## Purpose

TrailWright is a **local-first AI-powered Playwright test platform** designed to empower non-technical BA and QA staff to create automated browser tests without writing code. Users can:

- **AI Self-Driving Mode**: Give AI a goal and watch it autonomously create complete tests
- **AI Step-by-Step Mode**: Collaborate with AI through chat to build tests interactively
- **Data-Driven Testing**: Run tests with multiple variable sets from spreadsheet-like interface or CSV import
- **Full Test Management**: Edit, organize, and execute test suites
- **Standard Playwright**: All tests are standard `.spec.ts` files that run anywhere

**Key Philosophy**: Enable non-technical users to create professional-grade automated tests through AI assistance and intuitive UI, while maintaining full compatibility with standard Playwright.

## Architecture

### Tech Stack
- **Backend**: Node.js + Express + TypeScript
- **Test Runner**: Playwright (headed mode with traces)
- **Frontend**: Vite + React + Tailwind CSS
- **AI Providers**: Anthropic Claude, OpenAI, Google Gemini
- **Storage**: Local file-based (`~/.trailwright/`)

### Components

**Server** (`server/src/`)
- `ai/` - AI integration for test generation and chat
  - `agentPrompts.ts` - Structured prompts for iterative AI decision-making
  - `index.ts` - AI provider integration (Anthropic, OpenAI, Gemini)
- `playwright/` - Test execution, config generation, live run management
  - `pageStateCapture.ts` - Accessibility tree capture with hash optimization
  - `actionExecutor.ts` - Execute AI actions and generate QA summaries
  - `liveTestGenerator.ts` - Iterative agent loop orchestrator
  - `runner.ts` - Standard test execution
  - `liveRunManager.ts` - Live test run sessions with SSE
- `routes/` - REST API (tests, runs, config, AI chat, live generation)
  - `generate.ts` - Live AI generation endpoints with SSE streaming
- `storage/` - File-based persistence layer

**Client** (`client/src/`)
- Test library and editor
- Settings and configuration UI
- Test run viewer with trace integration
- **Live AI Generation Viewer** - Real-time step-by-step test creation
- AI copilot chat interface

**Data Directory** (`~/.trailwright/`)
```
├── config.json              # Settings, API keys, provider selection
├── playwright.config.ts     # Auto-generated Playwright config
├── tests/*.spec.ts          # Test files with metadata headers
├── test-data/*.csv          # Variable data for parameterized tests
├── runs/                    # Execution results with traces
└── trailwright-reporter.js  # Custom event reporter
```

**API Endpoints:**
- `POST /api/generate/start` - Start AI generation session (self-driving or step-by-step)
- `GET /api/generate/:sessionId/state` - Get current generation state
- `GET /api/generate/:sessionId/events` - SSE stream for real-time updates
- `POST /api/generate/:sessionId/chat` - Send step-by-step instruction to AI
- `POST /api/generate/:sessionId/stop` - Stop running generation
- `POST /api/generate/:sessionId/save` - Save completed test to library
- `GET /api/tests/:testId/variables` - Get variable definitions and data
- `PUT /api/tests/:testId/variables` - Update variable data
- `POST /api/tests/:testId/variables/import` - Import CSV data for variables

### Test Creation Modes

**1. AI Self-Driving Mode (Autonomous)**
- **Who it's for**: Users who have a clear end goal and want AI to figure out the steps
- User provides starting URL, goal/success criteria, and max steps
- AI autonomously observes page → decides action → executes → records
- Real-time viewer shows progress with QA-friendly summaries
- Loop continues until goal achieved or max steps reached
- Generates standard Playwright test with metadata
- **Key Features:**
  - Accessibility tree-based page state capture
  - Hash-based change detection for token optimization
  - Template-based QA summaries for non-technical users
  - Server-Sent Events (SSE) for real-time UI updates
  - Supports Anthropic Claude, OpenAI GPT-4o, Google Gemini
  - Error handling: 2 retries, then screenshot + ask user for help
- **Example Goal**: "Search for 'teddy bear', add to cart, and complete purchase"

**2. AI Step-by-Step Mode (Interactive)**
- **Who it's for**: Users who want granular control over each test step
- Text-based chat interface with browser running in headed mode (visible)
- User gives instruction → AI interprets and executes → shows result → repeat
- Each step generates both Playwright code and QA summary in real-time
- User can see browser actions happening live
- Error handling: 2 retries, then screenshot + ask user for help
- **Example Instructions:**
  - "Click into search bar, type 'stuffed teddy bear' and click search"
  - "Add the first teddy bear to cart"
  - "Fill in shipping address with test data"
- **Variable Support**: User can create variable chips (e.g., `{{product}}`) and drag them into chat prompts
- AI resolves variables from current sample values during execution
- Generates parameterized Playwright tests when variables are used

**Future Enhancement:**
- Ability to switch from self-driving to step-by-step mode mid-test (not yet implemented)

### Variables and Data-Driven Testing

**Purpose**: Enable non-technical users to run the same test with different data sets (e.g., test multiple products, user types, or configurations).

**Variable Creation Workflow:**
1. **Define Variables** (before or during test creation):
   - User opens variable panel/sidebar
   - Creates variable set with named fields: `product`, `color`, `size`
   - Adds at least one sample row for test execution
   - Variables displayed as draggable chips: `{{product}}`, `{{color}}`, `{{size}}`

2. **Use in Step-by-Step Mode**:
   - Drag variable chip into chat input
   - Submit prompt: "Search for {{product}} in {{color}}"
   - AI sees template syntax and sample values
   - Executes with sample data (e.g., "teddy bear" in "brown")
   - Generates parameterized Playwright code

3. **Manage Data** (after test creation):
   - "Data" tab shows spreadsheet view with variables as columns
   - Sample row pre-populated from test creation
   - Add rows manually via inline editing
   - Import CSV with column mapping UI
   - Export data back to CSV

4. **Test Execution** (parameterized tests):
   - Run all rows sequentially in one browser session
   - Each row gets own test result entry with trace
   - Results table shows pass/fail per data row
   - Click trace to debug specific data combination

**File Storage:**
- Each test gets own CSV: `~/.trailwright/test-data/{testId}.csv`
- Test metadata references data source
- CSV has header row with variable names
- Tests without variables generate normal (non-parameterized) Playwright code

**Test File Pattern** (with variables):
```typescript
/**
 * // === TRAILWRIGHT_METADATA ===
 * {
 *   "id": "abc123",
 *   "name": "Product Search Test",
 *   "dataSource": "abc123.csv"
 * }
 */
import { test } from '@playwright/test';
import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { join } from 'path';

const dataPath = join(process.env.HOME || process.env.USERPROFILE, '.trailwright/test-data/abc123.csv');
const testData = parse(readFileSync(dataPath), {
  columns: true,
  skip_empty_lines: true
});

test.describe.each(testData)('Product Search', (row) => {
  test(`Search for ${row.product} in ${row.color}`, async ({ page }) => {
    await page.goto('https://example.com');
    await page.getByRole('searchbox').fill(row.product);
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('Color').selectOption(row.color);
    // ... rest of test
  });
});
```

**CSV Import Features:**
- Column mapping UI when headers don't match variable names
- Options: Replace all data / Append rows / Merge (user choice)
- Auto-create new variables if CSV has extra columns
- Validation: Warn if CSV missing required columns

**Design Principles:**
- 1:1 relationship: Each test has its own CSV (simpler mental model)
- Variables are optional: Tests work with or without parameterization
- Inline workflow: Variable creation integrated into test creation flow
- Spreadsheet familiarity: UI matches Excel/Google Sheets patterns

### Playwright Configuration

Tests run in **headed mode** by default with optimized trace capture:

```typescript
{
  headless: false,              // Visible browser
  trace: 'retain-on-failure',   // Traces only for failures
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
  reporter: [
    ['list', { printSteps: true }],
    ['html', { ... }],
    ['json', { ... }],
    ['./trailwright-reporter.js']  // Real-time events
  ]
}
```

## Setup & Development

### Initial Setup
```bash
# Install dependencies
npm install

# Install Playwright browsers
cd server
npx playwright install chromium

# Configure AI provider (optional)
# Edit ~/.trailwright/config.json or use Settings UI
```

### Running the Application
```bash
# Start both frontend and backend
npm run dev

# Or individually:
npm run dev:server  # Backend on :3210
npm run dev:client  # Frontend on :3000

# Or via PowerShell:
.\scripts\start-local-dev.ps1
```

### Building for Production
```bash
npm run build        # Build both
npm run build:server # Server only
npm run build:client # Client only
```

### Testing
```bash
cd server
npm test  # Run Vitest unit tests
```

## Common Operations

### Regenerate Playwright Config
If config changes aren't applied:
```bash
rm ~/.trailwright/playwright.config.ts
# Restart server - config will regenerate
```

### View Trace Files
```bash
npx playwright show-trace ~/.trailwright/runs/{runId}/trace.zip
```

### Reset All Data
```bash
rm -rf ~/.trailwright
# Server will recreate structure on next start
```

## Key Implementation Notes

### AI Test Creation Pattern
AI-driven test creation uses an iterative agent loop:

**Setup Phase:**
1. User fills form: Starting URL, Goal, Max Steps (default 20)
2. Backend creates `LiveTestGenerator` session
3. Launches Playwright browser in headed mode (visible)
4. Opens real-time viewer in new browser tab
5. Connects SSE stream for live updates

**Iterative Loop:**
1. **Capture Page State** - Extract accessibility tree (interactive elements only)
2. **Hash Comparison** - Only send to AI if page changed (saves tokens ~70%)
3. **AI Decision** - Claude/GPT/Gemini returns JSON with next action
   ```json
   {
     "action": "click|fill|select|press|goto|done",
     "selector": "getByRole('button', { name: 'Submit' })",
     "value": "...",
     "reasoning": "Click the submit button to complete form"
   }
   ```
4. **Execute Action** - Run in Playwright with error handling
5. **Record Step** - Generate both:
   - Playwright code: `await page.getByRole('button', { name: 'Submit' }).click();`
   - QA summary: `Click "Submit" button`
6. **Emit Event** - Send to viewer via SSE for real-time display
7. **Check Completion** - AI responds with `action: "done"` or max steps reached
8. **Loop** or save complete test file

**Key Optimizations:**
- Accessibility tree is ~1-5KB vs full DOM at 50-500KB
- Hash-based change detection prevents redundant AI calls
- Template-based QA summaries avoid extra AI requests
- Estimated cost: $0.20-$0.60 per test depending on complexity

### Headed Mode Requirement
Always use `--headed` flag when spawning Playwright to ensure browser visibility:
```typescript
spawn(npx, ['playwright', 'test', testFile, '--headed'], { ... })
```

### Custom Reporter
`trailwright-reporter.js` emits structured events for real-time UI updates:
- Test start/end
- Step execution with timing
- Console logs and errors
- Network activity (via traces)

### Test File Format
Tests include metadata header for TrailWright UI:
```typescript
/**
 * // === TRAILWRIGHT_METADATA ===
 * { "id": "...", "name": "...", "tags": [...] }
 */
import { test, expect } from '@playwright/test';
// ... test code
```

## Example Test Scenarios

### Self-Driving Mode Examples

**Quick Test (Google Search):**
```
Mode: Self-Driving
URL: https://www.google.com
Goal: Search for "Playwright testing" and verify results appear
Max Steps: 5
```

**E-Commerce Flow:**
```
Mode: Self-Driving
URL: https://example-shop.com
Goal: Search for 'teddy bear', add to cart, and complete purchase with test credit card
Max Steps: 20
```

**Complex Form (Oregon Medical Board):**
```
Mode: Self-Driving
URL: https://omb.oregon.gov/login
Goal: Register as Jennifer Test_Physician for MD Active License. SSN starts with 123. Complete entire registration form.
Max Steps: 25
```

### Step-by-Step Mode Examples

**Guided Shopping Test:**
```
Mode: Step-by-Step
User: "Go to example-shop.com"
AI: [navigates and confirms]
User: "Click into search bar, type 'stuffed teddy bear' and search"
AI: [executes search]
User: "Add the first teddy bear to cart"
AI: [adds to cart]
User: "Go to checkout"
AI: [navigates to checkout]
```

**With Variables:**
```
Mode: Step-by-Step
Variables: {{product}}, {{color}}, {{size}}
Sample Data: "teddy bear", "brown", "small"

User: "Search for {{product}} in {{color}}"
AI: [searches for "teddy bear" in "brown"]
User: "Filter by size {{size}}"
AI: [applies size filter "small"]
User: "Add first result to cart"
AI: [adds to cart]
```

### Data-Driven Test Example

**Multi-Product Test:**
```
Test: Product Search and Add to Cart
Variables: product, color, size

CSV Data:
product,color,size
teddy bear,brown,small
teddy bear,brown,large
teddy bear,white,small
action figure,red,medium
stuffed dog,black,large

Execution: Runs 5 tests sequentially, one per row
Results: Individual pass/fail + trace for each combination
```

### What You'll See During Generation

**Self-Driving Mode:**
- Browser window opens in headed mode (visible automation)
- Viewer page shows real-time step-by-step progress
- Each step displays QA summary + Playwright code
- System logs stream in console panel
- Status updates: initializing → running → thinking → completed
- Save button appears when done

**Step-by-Step Mode:**
- Browser window visible showing current page
- Chat interface for sending instructions
- Each instruction shows AI's interpretation
- Live code generation as steps execute
- Error screenshots when AI needs help
- "Save Test" button when complete

## Documentation

- **MVP Plan**: `docs/plans/2025-10-27-trailwright-mvp.md`
- **Playwright Reference**: `docs/PLAYWRIGHT_CAPABILITIES.md`
- **API**: Server routes are self-documenting via TypeScript types

---

*TrailWright: AI-powered testing for non-technical users*
