Large features / refactors

Claude Code → /superpower brainstorm
Generates a detailed implementation plan.

Claude Code → /executing-plans-no-review

Implements plan

Preflights local services

Runs Playwright E2E via MCP (qa-run-playwright)

If E2E fails: delegates to Codex auto-fix (npm run fix:auto) until green or attempts exhausted

When green, opens a PR

Human
Manual smoke test → merge.

Examples

# Plan & build (Claude Code agent in VS Code or terminal)
/superpower brainstorm "Add appointment reminders with email + UI entry"
/executing-plans-no-review

# If the executor pauses on persistent red after max attempts:
git status
type qa\issues.md  # read failures

# Manually triggering the Codex fix loop (rarely needed: the skill calls it)
npm run fix:auto
# When green:
gh pr create -f

Smaller targeted fixes

Use Codex for surgical changes, verified by the same Claude QA runner.

Examples

git checkout -b fix/login-redirect

# Hands-free: run QA; if red, Codex produces a patch; apply+commit; repeat until green
npm run fix:auto

# Open PR when green
gh pr create -f


If you just want to run E2E without fixing:

npm run qa:verify   # runs Claude QA skill headlessly, exits 0/1

What we configured (portable)

qa/qa-scratchpad.json — env/accounts & knobs (preflight, batchSize, keepAlive)

qa/e2e-cases.yaml — human-readable scenarios (use data-testid selectors)

skills/qa-run-playwright.skill.md — drives Playwright MCP; writes:

qa/last-run/results.json, qa/last-run/*.png

qa/issues.jsonl, qa/issues.md

skills/executing-plans-no-review — now delegates fixes to Codex via npm run fix:auto

scripts/qa-verify.mjs — headless Claude Code CLI call to run the QA skill; clean exit codes

scripts/auto-fix.mjs — Codex loop: read qa/issues.md → make file changes directly → commit → re-run QA

package.json — scripts:

{ "scripts": {
    "qa:verify": "node scripts/qa-verify.mjs",
    "fix:auto":  "node scripts/auto-fix.mjs"
}}


~/.claude/settings.json — permissions.allow: ["mcp__playwright__*"] (no prompts for browser actions)

Docs provenance (for reuse):

Claude Code CLI & best practices.
Claude Docs
+2
Claude Docs
+2

MCP overview + Playwright MCP servers.
GitHub
+4
Model Context Protocol
+4
Claude Docs
+4

Codex CLI (local coding agent), npm package, and docs.
OpenAI Developers
+2
npmjs.com
+2

Creating the PR automatically (both paths)

From the big-feature flow: your executor ends by running its finishing step (or just gh pr create -f). Claude Code can also create PRs directly when connected to a repo—now available via its web/CLI tooling.
Windows Central

From the small-fix loop: append this to the end of scripts/auto-fix.mjs on success:

# PowerShell or bash wrapper after `npm run fix:auto`
gh pr create -f


(Requires gh auth login once.)

How to port to a new repo

Copy qa/, scripts/, and the two skill files.

Update qa/qa-scratchpad.json accounts and preflight.startScript.

Ensure data-testid in your UI.

Add the two npm scripts to package.json.

Confirm Claude Code + Codex CLIs on PATH:

claude --version
codex --version

Configure Codex for high-quality automated fixes:

pwsh scripts/setup-codex-config.ps1

This sets GPT-5 Codex with high reasoning effort in ~/.codex/config.toml


(Both tools support CLI operation; see their docs/refs.)
Claude Docs
+1

How to undo

Delete qa/ and scripts/

Remove the two npm scripts from package.json

Remove or disable the two skills

Optionally tighten ~/.claude/settings.json permissions so Playwright MCP prompts again

Notes on reliability & long runs

Granular MCP steps + heartbeats keep the session active (per-scenario progress + qa/last-run/heartbeat.txt). Using standardized MCP servers for Playwright is encouraged for agent/tool orchestration.
executeautomation.

Claude Code CLI supports flags/limits; see the CLI reference to tune long-running behavior.
Claude Docs

Codex CLI runs locally and makes file changes directly in non-interactive mode.

## How `npm run fix:auto` Works

The auto-fix script is **fully automatic** - you don't need to manually re-test. Here's the flow:

### Execution Flow

```
ATTEMPT 1:
├─ [timestamp] Starting QA verification...        (runs tests, ~4-8 min)
├─ [timestamp] QA: 0 passed, 3 failed
├─ [timestamp] Calling Codex CLI...               (Codex investigates & fixes, ~2-30 min)
├─ [timestamp] Codex completed. Checking for file changes...
├─ [timestamp] Codex made changes. Committing...
└─ [timestamp] Changes committed. Re-running QA…

ATTEMPT 2:
├─ [timestamp] Starting QA verification...        (AUTOMATIC re-test)
├─ [timestamp] QA: 1 passed, 2 failed             (progress!)
└─ ... (repeats)

FINAL:
└─ [timestamp] ✅ E2E is green. Done.             (exits when all pass)
```

### How to Monitor Progress

**Codex is working when you see:**
- Terminal shows: `[timestamp] Calling Codex CLI...`
- Check `patches/codex-raw-attempt-N.txt` to see live progress
- Codex writes JSONL events showing commands it's running

**Codex is done when you see:**
```
[timestamp] Codex CLI returned (exit code: 0)
[timestamp] Codex completed. Checking for file changes...
[timestamp] Patch saved to patches/attempt-N.patch (NNNN bytes)
```

### Configuration

- **Max attempts:** 5 (set `MAX_FIX_ATTEMPTS=N` env var)
- **Codex timeout:** 30 minutes per attempt
- **Skip first QA run:** If recent failures exist (within 10 min), skips straight to Codex

### Exit Conditions

- **Success (exit 0):** All tests pass
- **Failure (exit 1):** Max attempts exhausted, still failing
- **Error (exit 2):** Codex timeout, git errors, QA harness errors

### Troubleshooting

If Codex seems stuck:
1. Check `patches/codex-raw-attempt-N.txt` for live output
2. Look for command executions in the JSONL logs
3. If no file changes after 30 min, it times out automatically

The script runs with `--dangerously-bypass-approvals-and-sandbox` so Codex makes changes directly without prompts. This is safe because everything is in git and can be reverted.
