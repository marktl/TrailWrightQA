# TrailWright QA

**AI-powered Playwright testing for non-technical users**

Empower BA and QA staff to create professional browser automation tests without writing code. Choose your approach: let AI drive autonomously or guide it step-by-step through chat.

## Features

- 🤖 **AI Self-Driving Mode** - Give AI a goal and watch it autonomously build complete tests
- 💬 **AI Step-by-Step Mode** - Interactive chat interface to guide test creation with granular control
- 🎥 **Record Mode** - Perform actions yourself while AI generates Playwright code automatically
- 📊 **Data-Driven Testing** - Run tests with multiple variable sets using spreadsheet UI or CSV import
- 👀 **Real-Time Viewer** - See each action as it happens with QA-friendly summaries
- 🎯 **One-Click Execution** - Run tests and view results instantly
- 🔍 **Playwright Trace Viewer** - Time-travel debugging with full trace support
- 💾 **File-Based Storage** - No database required, everything in `~/.trailwright/`
- 🔒 **Local-Only** - All data stays on your machine, API keys never leave your system
- 🚀 **Zero Config** - Works out of the box with sensible defaults
- 🎨 **Multiple AI Providers** - Supports Anthropic Claude, OpenAI GPT-4o, Google Gemini

## Quick Start

```bash
# Clone the repository
git clone <your-repo-url>
cd TrailWrightQA

# Install dependencies
npm install
npm run setup   # installs server/ and client/ packages too

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

### AI Self-Driving Mode (Recommended for Clear Goals)

**Give AI a goal and watch it autonomously build your test:**

1. Click "Generate with AI (Self-Driving)" on the home page
2. Fill in the form:
   - **Starting URL**: Where to begin (e.g., `https://example.com/login`)
   - **Goal**: What to accomplish (e.g., "Search for 'teddy bear', add to cart, and complete purchase")
   - **Max Steps**: Safety limit (default: 20)
3. Click "Start Generation"
4. **New tab opens** showing:
   - Browser automation happening live (headed mode)
   - Each step with QA summary and Playwright code
   - Real-time system logs
   - Current status and progress
5. When complete, click "Save Test" to add to your library

**How it works:**
- AI observes page using accessibility tree
- Autonomously decides next action (click, fill, select, etc.)
- Executes action in visible browser
- Records step with QA-friendly summary
- Repeats until goal achieved or max steps reached
- After 2 failed retries, shows screenshot and asks for help

### AI Step-by-Step Mode (Recommended for Granular Control)

**Guide AI through chat to build tests interactively:**

1. Click "Generate with AI (Step-by-Step)" on the home page
2. Optionally create variables (e.g., `{{product}}`, `{{color}}`)
3. Browser opens and chat interface appears
4. Give instructions via text:
   - "Go to example-shop.com"
   - "Search for {{product}} in {{color}}"
   - "Add first result to cart"
5. Watch AI execute each instruction in real-time
6. Each step generates Playwright code automatically
7. Click "Save Test" when complete

**With Variables:**
- Create variable chips before or during test creation
- Drag variables into chat prompts
- Add sample values for test execution
- AI generates parameterized Playwright tests
- Later manage data in spreadsheet view or import CSV

### Data-Driven Testing

**Run the same test with multiple data sets:**

1. Create test using step-by-step mode with variables
2. After saving, open test and go to "Data" tab
3. See spreadsheet view with your variables as columns
4. Add rows manually or click "Import CSV"
5. Map CSV columns to your variables
6. Run test - each row executes as separate test case
7. View results with individual pass/fail and traces per row

**CSV Format:**
```csv
product,color,size
teddy bear,brown,small
teddy bear,brown,large
action figure,red,medium
```

### Run Tests

1. Find your test in "Recent Test Sets"
2. Click "Run & Watch" to execute
3. View live progress with step-by-step updates
4. Click "Open Trace" for time-travel debugging

### Manage Tests

- All tests stored as `.spec.ts` files in `~/.trailwright/tests/`
- Edit tests directly or via UI "Edit" button
- Delete tests you no longer need
- Tests are standard Playwright - run them anywhere

## Example Test Scenarios

### Self-Driving Examples

**Simple Google Search:**
```
Mode: Self-Driving
URL: https://www.google.com
Goal: Search for "Playwright testing" and verify results appear
Max Steps: 5
```

**E-Commerce Purchase:**
```
Mode: Self-Driving
URL: https://example-shop.com
Goal: Search for 'teddy bear', add to cart, and complete purchase
Max Steps: 20
```

### Step-by-Step Examples

**Guided Shopping:**
```
Mode: Step-by-Step
Instructions:
1. "Go to example-shop.com"
2. "Click search bar, type 'stuffed teddy bear' and search"
3. "Add first result to cart"
4. "Proceed to checkout"
```

**With Variables:**
```
Mode: Step-by-Step
Variables: {{product}}, {{color}}, {{size}}
Sample: "teddy bear", "brown", "small"
Instructions:
1. "Search for {{product}} in {{color}}"
2. "Filter by size {{size}}"
3. "Add first result to cart"
```

## Data Location

All data is stored in `~/.trailwright/`:
- `config.json` - Settings, API keys, provider selection
- `tests/*.spec.ts` - Your test files with metadata
- `test-data/*.csv` - Variable data for parameterized tests
- `runs/` - Test results, traces, screenshots, videos
- `playwright.config.ts` - Auto-generated Playwright configuration

## Tech Stack

- **Backend**: Node.js, Express, TypeScript, Playwright
- **Frontend**: Vite, React, Tailwind CSS, React Router
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

## Architecture

TrailWright is a single-user, local-first application designed for non-technical users:

- **Server**: Express + TypeScript backend
  - Two AI modes: Self-driving (autonomous) and Step-by-step (interactive)
  - Iterative AI agent loop with accessibility tree capture
  - Variable resolution and parameterized test generation
  - Playwright test execution in headed mode
  - Server-Sent Events (SSE) for real-time updates
  - Multi-provider AI support (Anthropic, OpenAI, Gemini)
- **Client**: Vite + React + Tailwind CSS frontend
  - Test creation wizard with mode selection
  - Interactive chat interface for step-by-step mode
  - Variable management with spreadsheet UI
  - CSV import/export with column mapping
  - Live generation viewer with real-time streaming
  - Settings UI for API configuration
- **Storage**: File-based (no database needed)
  - Tests stored as standard Playwright `.spec.ts` files
  - Variables stored as CSV files (one per test)
- **Security**: All data local, API keys never sent to external services

## Key Technologies

- **Playwright** - Browser automation with accessibility tree API
- **TypeScript** - Type-safe development
- **Server-Sent Events** - Real-time streaming without WebSockets
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first styling

## License

MIT
