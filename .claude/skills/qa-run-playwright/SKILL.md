---
name: qa-run-playwright
description: Run E2E scenarios defined in qa/e2e-cases.yaml using Playwright MCP; emit issues when failures occur.
allowed-tools: Read, Write, WebFetch, Bash(pwsh -File scripts/start-local-dev.ps1), mcp__playwright__*
---

# QA — Run Playwright (MCP)

## Overview
Read `qa/qa-scratchpad.json` and `qa/e2e-cases.yaml`, expand variables, then drive the browser via **Playwright MCP tools**.
On any failure: capture screenshot, console logs, and response bodies when possible, then append a structured record to `qa/issues.jsonl` and a human-readable item to `qa/issues.md`. Return a JSON summary.

**Key MCP tools used (by step type):**
- `navigate` → `mcp__playwright__Playwright_navigate`
- `click` → `mcp__playwright__Playwright_click`
- `fill` → `mcp__playwright__Playwright_fill`
- `select` → `mcp__playwright__Playwright_select`
- `expectText` → fetch with `mcp__playwright__playwright_get_visible_text` and assert contains
- `expectResponse` → `mcp__playwright__Playwright_expect_response` then `mcp__playwright__Playwright_assert_response`
- `screenshot` (implicit on failure) → `mcp__playwright__Playwright_screenshot`

> See Playwright MCP tool names & params in the server docs. :contentReference[oaicite:0]{index=0}

## Process

### Logging
- Before starting, create `qa/last-run/` if missing.
- Append a session header to `qa/last-run/runner.log` with timestamp, CWD, and resolved paths:
  - CWD
  - Path to `qa/qa-scratchpad.json`
  - Path to `qa/e2e-cases.yaml`
- For each step (navigate/click/fill/expect...), write a one-line entry:
  - `[SCENARIO:<name>] <action> <selector/url> -> OK/FAIL <ms>`
- On any failure, also write the error message and where the screenshot was saved.
- After finishing, write counts and duration.
- Keep `qa/last-run/heartbeat.txt` updated per scenario.

### MCP Call Recording
- For each MCP tool call, append to `qa/last-run/mcp-calls.jsonl`:
  - `{"timestamp": "<ISO>", "tool": "<name>", "args": {...}, "duration_ms": <n>, "success": true/false, "error": "<msg if failed>"}`
- This provides detailed diagnostics for "why didn't anything run?" scenarios.

### Preflight (Local Dev)
- Read `qa/qa-scratchpad.json` → `preflight`.
- If `startServices` is true:
  - Run `Bash(pwsh -File scripts/start-local-dev.ps1)` (non-blocking; let it boot servers).
- Poll health endpoints every 2s up to `retryUpToSeconds`:
  - `WebFetch` GET `${health.portal}` expecting 200.
  - `WebFetch` GET `${health.api}` expecting 200 (fallback to GET `http://localhost:8000/` if 404).
- If ports/health do not become healthy in time, write a blocker entry to `qa/issues.md` and abort.

1. **Read** `qa/qa-scratchpad.json` and `qa/e2e-cases.yaml`.
2. Resolve `baseUrl` from `env[run.environment]` if `baseUrl` contains `{{...}}`.

### Sanity check: scenarios present
- Parse `qa/e2e-cases.yaml` → `scenarios`.
- If `scenarios.length === 0`:
  - Write `qa/last-run/runner.log`: "No scenarios found."
  - Append to `qa/issues.md`: "- No scenarios found in qa/e2e-cases.yaml"
  - Write `qa/last-run/results.json`: `{"passed":0,"failed":1,"reason":"no_scenarios"}`
  - **Return a failure JSON** and stop.

3. For each `scenario`:
   - Start a fresh browser via `Playwright_navigate` to first `navigate` step (apply `project`, `viewport`, `headless`).
   - Execute steps in order, mapping step types to tools above.
   - On failure:
     - take `Playwright_screenshot` → `qa/last-run/<scenario>.png`
     - read logs via `Playwright_console_logs`
     - if `expectResponse` in progress, call `Playwright_assert_response`
     - write append-only entries to `qa/issues.jsonl` and add a bullet to `qa/issues.md`
   - Close browser with `Playwright_close`.
4. Write `qa/last-run/results.json` with `{ passed, failed, failures:[...] }`.
5. **Return** a JSON object `{ "passed": N, "failed": M, "issuesFile": "qa/issues.md", "resultsFile":"qa/last-run/results.json" }`.

### Keep-Alive & Progress
- After each scenario:
  - Append ISO timestamp + status to `qa/last-run/heartbeat.txt`
  - Print a one-line progress update to the chat (e.g., `progress: 2/7 passed, 1 failed`)
- Purpose: frequent short returns keep the session active and give you real-time visibility.

- After each scenario:
  - Append ISO timestamp + scenario name + PASS/FAIL to `qa/last-run/heartbeat.txt`
  - Print: `progress: <passed>/<total> passed, <failed> failed`
