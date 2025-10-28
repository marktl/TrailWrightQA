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
