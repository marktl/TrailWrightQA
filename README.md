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

1. Configure your AI provider in Settings
2. Describe what you want to test (e.g., "Test user login with valid credentials")
3. AI will generate complete Playwright test code
4. Save and run the test

### View Results

- Test results show pass/fail status, duration, and any errors
- Click "Open Playwright Trace Viewer" to debug failures with time-travel debugging

### Manage Tests

- All tests are stored as `.spec.ts` files in `~/.trailwright/tests/`
- Test metadata is embedded in comments within each file
- Run tests individually from the UI

## Data Location

All data is stored in `~/.trailwright/`:
- `config.json` - Settings and API keys
- `tests/` - Your test files
- `runs/` - Test results, traces, screenshots
- `playwright.config.ts` - Playwright configuration

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

TrailWright MVP is a single-user, local-first application:

- **Server**: Express backend wraps Playwright and AI providers
- **Client**: Vite + React frontend for test management
- **Storage**: File-based (no database needed)
- **Security**: All data local, API keys stored on filesystem

## License

MIT
