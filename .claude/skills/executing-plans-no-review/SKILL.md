---
name: executing-plans-no-review
description: Execute an implementation plan end-to-end with no review pauses; auto-continue between batches until complete.
allowed-tools: Bash(npm run test:*), Edit, Write, Read, WebFetch, mcp__playwright__*
---

# Executing Plans — No Review

## Overview
Load the plan once, then **execute through to completion without feedback pauses**. Verification happens continuously; only **blockers** stop.

**Announce at start:** "I'm using the executing-plans-no-review skill to implement this plan without review pauses."

---

## The Process

### Step 1: Load and Review Plan (one-time)
1. Read the plan file.
2. List risks/assumptions/ambiguities.
3. If **critical blockers**, stop and ask. Otherwise continue and create any scaffolding via `TodoWrite`.

### Step 2: Execute (no pauses)
Execute tasks in sensible sub-batches. For each task:
1. Mark `in_progress`.
2. Implement exactly as specified.
3. Run local verifications (types, unit tests, build).
4. If verifications fail, fix-forward within this flow (bounded retries, e.g., 2).
5. Mark `completed`.

### Step 2.5: Trigger E2E via QA runner (required)
- It reads `qa/qa-scratchpad.json` and `qa/e2e-cases.yaml`, then drives the browser via **Playwright MCP**.
- Capture summary JSON from the QA runner.
- Ensure `qa/qa-scratchpad.json` has `"run.environment": "local"` unless the plan explicitly sets another target.
- Call **`superpowers:qa-run-playwright`**.


### Step 2.6: Delegate failing E2E fixes to Codex (bounded)
- If the QA summary shows failures:
  - Log artifacts (`qa/last-run/results.json`, `qa/issues.md`) and proceed automatically.
  - Run: `npm run fix:auto`  # uses Codex CLI to read qa/issues.md → produce a unified diff → apply/commit → rerun QA
  - If still failing after MAX_FIX_ATTEMPTS (default 5), stop and report blockers.
- If QA is green, proceed to Step 4.


### Step 2.7: Artifacts
- Always write/update:
  - `qa/last-run/results.json` and any `qa/last-run/*.png`
  - `qa/issues.md` (empty if none)
  - A short `QA_SUMMARY.md` with pass/fail counts and links to artifacts

### Step 3: Continuous Reporting (non-blocking)
After each sub-batch or QA cycle, log:
- Implemented items
- Verification results (unit/integration + E2E)
- Commit SHAs
- Open TODOs (if any)
Then immediately continue.

### Step 4: Finish the Plan
Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **SUB-SKILL:** `superpowers:finishing-a-development-branch`
- If E2E is green, proceed to **create PR** and present link; if not green, stop and summarize blockers.

### Step 5: Final Summary
- List tasks completed
- Verification summary (unit/build/E2E)
- Branch/PR links
- Remaining TODOs / follow-ups

## When to Stop and Ask for Help
Only on critical blockers (ambiguous or unsafe changes, persistent red after 3 QA cycles, missing credentials).
