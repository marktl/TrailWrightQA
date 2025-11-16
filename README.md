# TrailWright QA

**Local-first collaborative Playwright test platform** combining AI automation with manual control.

Watch AI build tests step-by-step in real-time, or record them manually. Your choice.

## Features

- 🤖 **Live AI Test Generation** - Watch AI create tests step-by-step in real-time with visible browser automation
- 👀 **Real-Time Viewer** - See each action as it happens with QA-friendly summaries
- 📝 **Manual Recording** - Use Playwright Inspector to record tests interactively
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

### AI Live Generation (Recommended)

**Watch AI build your test step-by-step in real-time:**

1. Click "Generate with AI" on the home page
2. Fill in the form:
   - **Starting URL**: Where to begin (e.g., `https://example.com/login`)
   - **Goal**: What to accomplish (e.g., "Register as Jennifer Test_Physician with SSN starting with 123")
   - **Max Steps**: Safety limit (default: 20)
3. Click "Start AI Generation"
4. **New tab opens** showing:
   - Browser automation happening live (headed mode)
   - Each step with QA summary and Playwright code
   - Real-time system logs
   - Current status and progress
5. When complete, click "Save Test" to add to your library

**How it works:**
- AI observes page using accessibility tree
- Decides next action (click, fill, select, etc.)
- Executes action in visible browser
- Records step with QA-friendly summary
- Repeats until goal achieved or max steps reached

### Manual Recording

**Record tests using Playwright Inspector:**

1. Click "Record Test Steps" on the home page
2. Playwright Inspector opens with a browser
3. Interact with your site - actions are recorded automatically
4. Close the inspector when done
5. Name your test and save

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

**Simple Google Search:**
```
URL: https://www.google.com
Goal: Search for "Playwright testing" and verify results appear
Max Steps: 5
```

**Complex Form Workflow:**
```
URL: https://omb.oregon.gov/login
Goal: Register as Jennifer Test_Physician for an MD Active License. SSN starts with 123.
Max Steps: 20
```

## Data Location

All data is stored in `~/.trailwright/`:
- `config.json` - Settings, API keys, provider selection
- `tests/*.spec.ts` - Your test files with metadata
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

TrailWright is a single-user, local-first application:

- **Server**: Express + TypeScript backend
  - Iterative AI agent loop with accessibility tree capture
  - Playwright test execution in headed mode
  - Server-Sent Events (SSE) for real-time updates
  - Multi-provider AI support (Anthropic, OpenAI, Gemini)
- **Client**: Vite + React + Tailwind CSS frontend
  - Test library and management
  - Live generation viewer with real-time streaming
  - Settings UI for API configuration
- **Storage**: File-based (no database needed)
- **Security**: All data local, API keys never sent to external services

## Key Technologies

- **Playwright** - Browser automation with accessibility tree API
- **TypeScript** - Type-safe development
- **Server-Sent Events** - Real-time streaming without WebSockets
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first styling

## License

MIT
