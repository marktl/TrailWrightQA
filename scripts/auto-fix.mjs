import { spawnSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_ATTEMPTS = parseInt(process.env.MAX_FIX_ATTEMPTS ?? "5", 10);
const SKIP_FIRST_RUN_IF_RECENT_MINUTES = parseInt(process.env.SKIP_FIRST_RUN_IF_RECENT_MINUTES ?? "10", 10);
const PATCH_DIR = "patches";
const ISSUES_MD = "qa/issues.md";
const RESULTS_JSON = "qa/last-run/results.json";
const CODEX_TIMEOUT_MS = parseInt(process.env.CODEX_TIMEOUT_MS ?? `${30 * 60 * 1000}`, 10);
const CODEX_RETRY_LIMIT = parseInt(process.env.CODEX_RETRY_LIMIT ?? "0", 10); // 0 = unlimited
const CODEX_RESTART_DELAY_MS = parseInt(process.env.CODEX_RESTART_DELAY_MS ?? "60000", 10);

if (!existsSync(PATCH_DIR)) mkdirSync(PATCH_DIR, { recursive: true });

function run(cmd, args, opts = {}) {
  // On Windows, use shell: true for .cmd files
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,  // Required for .cmd files on Windows
    ...opts
  });
  return res;
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, -5);
}

function canSkipFirstRun() {
  // Check if we have recent test results showing failures
  if (!existsSync(RESULTS_JSON) || !existsSync(ISSUES_MD)) return false;

  try {
    const resultsAge = (Date.now() - statSync(RESULTS_JSON).mtimeMs) / 60000; // minutes
    const issuesAge = (Date.now() - statSync(ISSUES_MD).mtimeMs) / 60000;

    // If results are too old, don't skip
    if (resultsAge > SKIP_FIRST_RUN_IF_RECENT_MINUTES) return false;
    if (issuesAge > SKIP_FIRST_RUN_IF_RECENT_MINUTES) return false;

    // Check if results show failures (handle encoding issues)
    const raw = readFileSync(RESULTS_JSON, "utf8");
    const cleaned = raw.replace(/^\uFEFF/, "").replace(/^[^\{]*/, "");
    const results = JSON.parse(cleaned);
    const failed = Number(results.failed || 0);

    if (failed > 0) {
      console.log(`[${timestamp()}] Found recent test failures (${failed} failed, ${resultsAge.toFixed(1)}m ago)`);
      console.log(`[${timestamp()}] Skipping first QA run, going straight to Codex...`);
      return true;
    }
  } catch (e) {
    // If anything goes wrong, just run normally
    return false;
  }

  return false;
}

function runQA() {
  console.log(`[${timestamp()}] Starting QA verification...`);
  const res = run("node", ["scripts/qa-verify.mjs"]);
  const code = res.status ?? 2;
  let summary = { passed: 0, failed: 0 };
  try { summary = JSON.parse(readFileSync(RESULTS_JSON, "utf8")); } catch {}
  console.log(`[${timestamp()}] QA verification complete (exit code: ${code})`);
  if (res.stderr) console.log("QA stderr:", res.stderr);
  return { code, summary, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function commitAttempt(n) {
  let res = run("git", ["add", "-A"]);
  if ((res.status ?? 1) !== 0) {
    console.error(`[${timestamp()}] git add failed:`, res.stderr || res.stdout);
    return res.status ?? 1;
  }
  res = run("git", ["commit", "-m", `Auto-fix attempt ${n} - apply Codex patch from QA failures`]);
  if ((res.status ?? 1) !== 0) {
    console.error(`[${timestamp()}] git commit failed:`, res.stderr || res.stdout);
    console.error(`[${timestamp()}] This might be due to a git hook requiring approval.`);
    console.error(`[${timestamp()}] You can disable hooks with: git config core.hooksPath /dev/null`);
  }
  return res.status ?? 1;
}

function fail(msg) { console.error(msg); process.exit(2); }

async function askCodexForPatch(attempt) {
  const issues = existsSync(ISSUES_MD) ? readFileSync(ISSUES_MD, "utf8") : "(no issues.md found)";
  const prompt = [
    "You are running in NON-INTERACTIVE mode. Make all necessary file changes automatically.",
    "",
    "AVAILABLE TOOLS:",
    "- You have access to Playwright MCP tools (mcp__playwright__*)",
    "- You can run tests yourself: navigate pages, click elements, verify behavior",
    "- Use this to validate fixes before committing",
    "",
    "Task: Fix the failing Playwright E2E tests by making minimal code changes.",
    "",
    "Test failures:",
    "```",
    issues,
    "```",
    "",
    "Instructions:",
    "1. Investigate the codebase to understand the issue (use grep, read files)",
    "2. If unclear, use Playwright to reproduce the failure and understand root cause",
    "3. Make MINIMAL file edits to fix the test failures",
    "4. For test timing issues (timeouts, expectResponse), check test step order in qa/e2e-cases.yaml",
    "5. For missing routes: create Next.js pages at portal/src/app/[route]/page.tsx",
    "6. For missing API endpoints: create portal/src/app/api/[route]/route.ts",
    "7. Add data-testid attributes where tests expect them",
    "8. DO NOT ask for confirmation - make the changes directly",
    "9. Avoid getting stuck on encoding/formatting issues - focus on functional fixes",
    "",
    "After making changes, output a 1-line summary of what you fixed."
  ].join("\n");

  let iteration = 1;
  while (CODEX_RETRY_LIMIT === 0 || iteration <= CODEX_RETRY_LIMIT) {
    const patchPath = await runCodexIteration({ attempt, iteration, prompt, issues });
    if (patchPath) return patchPath;

    if (CODEX_RETRY_LIMIT !== 0 && iteration >= CODEX_RETRY_LIMIT) {
      console.error(`[${timestamp()}] Reached Codex retry limit (${CODEX_RETRY_LIMIT}).`);
      break;
    }

    iteration++;
    if (CODEX_RESTART_DELAY_MS > 0) {
      console.log(`[${timestamp()}] ⏳ No changes from Codex. Restarting in ${(CODEX_RESTART_DELAY_MS / 1000).toFixed(0)}s...`);
      await new Promise((resolve) => setTimeout(resolve, CODEX_RESTART_DELAY_MS));
    } else {
      console.log(`[${timestamp()}] ⏳ No changes from Codex. Restarting immediately...`);
    }
  }

  return null;
}

function runCodexIteration({ attempt, iteration, prompt, issues }) {
  console.log(`[${timestamp()}] Calling Codex CLI (iteration ${iteration}, this may take 2-30 minutes)...`);
  console.log(`[${timestamp()}] Codex is analyzing ${issues.length} chars of failure logs...`);
  console.log(`[${timestamp()}] Live progress will appear below. Check patches/codex-raw-attempt-${attempt}-iter-${iteration}.txt for full output.`);

  // Use spawn instead of spawnSync to prevent I/O buffer deadlock
  // Codex writes 64KB+ of JSONL which fills the stdout buffer and hangs spawnSync
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let lastProgressTime = Date.now();
    let exitCode = null;
    let resolved = false;
    const safeResolve = (value) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };

    const proc = spawn("codex", [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model", "gpt-5-codex",  // Use GPT-5 with extended thinking
      "-"                         // stdin sentinel stays last
    ], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    // Write prompt to stdin and close
    proc.stdin.write(prompt);
    proc.stdin.end();

    let lastMeaningfulProgressTime = Date.now();
    let lastReasoningText = "";
    let stuckWarningCount = 0;

    // Watchdog: Check every 5 minutes if Codex is stuck
    const watchdogInterval = setInterval(() => {
      const stuckMinutes = (Date.now() - lastMeaningfulProgressTime) / 60000;
      if (stuckMinutes >= 5) {
        stuckWarningCount++;
        console.warn(`[${timestamp()}] ⚠️  Codex appears stuck (${stuckMinutes.toFixed(1)}m with no meaningful progress)`);
        console.warn(`[${timestamp()}] Last activity: ${lastReasoningText.slice(0, 100)}`);

        if (stuckWarningCount >= 2) {
          console.error(`[${timestamp()}] Codex stuck for 10+ minutes. Killing process...`);
          clearInterval(watchdogInterval);
          proc.kill("SIGTERM");
          setTimeout(() => {
            console.error(`[${timestamp()}] Consider simplifying the task or fixing manually.`);
            safeResolve(null);
          }, 1000);
        } else {
          console.warn(`[${timestamp()}] Will kill if still stuck in another 5 minutes.`);
        }
      }
    }, 300000); // Check every 5 minutes

    // Stream stdout and show progress every 30 seconds
    proc.stdout.on("data", (chunk) => {
      const data = chunk.toString();
      stdout += data;

      // Show live progress every 30 seconds
      const now = Date.now();
      if (now - lastProgressTime > 30000) {
        // Parse last JSONL line to show what Codex is doing
        const lines = stdout.trim().split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const event = JSON.parse(lines[i]);
            if (event.type === "reasoning" || event.type === "item.completed") {
              const text = event.item?.text || event.text || "";
              if (text) {
                console.log(`[${timestamp()}] Codex: ${text.slice(0, 100)}...`);

                // Track meaningful progress (not just "Rechecking" or "Confirming status")
                if (!text.toLowerCase().includes("recheck") &&
                    !text.toLowerCase().includes("confirming") &&
                    !text.toLowerCase().includes("encoding")) {
                  lastMeaningfulProgressTime = now;
                  lastReasoningText = text;
                  stuckWarningCount = 0; // Reset counter on meaningful progress
                }

                lastProgressTime = now;
                break;
              }
            }
          } catch {}
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    // Timeout after 30 minutes
    const timeoutHandle = setTimeout(() => {
      clearInterval(watchdogInterval);
      proc.kill("SIGTERM");
      console.error(`[${timestamp()}] Codex CLI timed out after ${(CODEX_TIMEOUT_MS / 60000).toFixed(1)} minutes`);
      safeResolve(null);
    }, CODEX_TIMEOUT_MS);

    proc.on("close", (code) => {
      clearInterval(watchdogInterval); // Stop watchdog
      clearTimeout(timeoutHandle); // Stop timeout
      exitCode = code ?? 1;
      console.log(`[${timestamp()}] Codex CLI returned (exit code: ${exitCode})`);

      // Save output
      writeFileSync(join(PATCH_DIR, `codex-raw-attempt-${attempt}-iter-${iteration}.txt`), stdout, "utf8");
      if (stderr) writeFileSync(join(PATCH_DIR, `codex-stderr-attempt-${attempt}-iter-${iteration}.txt`), stderr, "utf8");

      // Check for non-zero exit but continue anyway (MCP warnings are common)
      if (exitCode !== 0) {
        console.warn(`[${timestamp()}] Codex returned exit code ${exitCode}, but checking for changes anyway...`);
        if (stderr) console.warn(`[${timestamp()}] Codex stderr:`, stderr.slice(0, 2000));
      } else {
        console.log(`[${timestamp()}] Codex completed successfully.`);
      }

      // Continue with rest of function (checking for file changes)
      if (resolved) return;
      handleCodexCompletion(attempt, iteration, safeResolve);
    });
  });
}

function handleCodexCompletion(attempt, iteration, resolve) {

  console.log(`[${timestamp()}] Checking for file changes...`);

  // Show what files changed
  const statusResult = run("git", ["status", "--short"]);
  const changedFiles = (statusResult.stdout || "").trim();
  if (changedFiles) {
    console.log(`[${timestamp()}] Changed files:\n${changedFiles}`);
  }

  // Stage all changes first (including untracked files)
  const stageResult = run("git", ["add", "-A"]);
  if ((stageResult.status ?? 1) !== 0) {
    console.error(`[${timestamp()}] Failed to stage changes`);
    resolve(null);
    return;
  }

  // Now generate patch from staged changes
  const diffResult = run("git", ["diff", "--cached"]);
  const patch = (diffResult.stdout || "").trim();

  if (!patch) {
    console.error(`[${timestamp()}] Codex completed but no changes to commit.`);
    console.error(`[${timestamp()}] Git status showed: ${changedFiles || "(no changes)"}`);
    console.error(`[${timestamp()}] Check patches/codex-raw-attempt-${attempt}-iter-${iteration}.txt for Codex output.`);
    resolve(null);
    return;
  }

  const patchPath = join(PATCH_DIR, `attempt-${attempt}-iter-${iteration}.patch`);
  writeFileSync(patchPath, patch, "utf8");
  console.log(`[${timestamp()}] Patch saved to ${patchPath} (${patch.length} bytes)`);

  resolve(patchPath);
}

(async function main() {
  console.log(`[${timestamp()}] Auto-fix starting (max attempts: ${MAX_ATTEMPTS})`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n[${timestamp()}] === ATTEMPT ${attempt}/${MAX_ATTEMPTS} ===`);

    let qa;
    // Skip first QA run if we have recent failures
    if (attempt === 1 && canSkipFirstRun()) {
      // Read existing results instead of running tests (handle encoding)
      const raw = readFileSync(RESULTS_JSON, "utf8");
      const cleaned = raw.replace(/^\uFEFF/, "").replace(/^[^\{]*/, "");
      const results = JSON.parse(cleaned);
      qa = {
        code: 1,
        summary: {
          passed: Number(results.passed || 0),
          failed: Number(results.failed || 0)
        }
      };
    } else {
      qa = runQA();
    }

    console.log(`[${timestamp()}] QA: ${qa.summary.passed} passed, ${qa.summary.failed} failed`);
    if (qa.code === 0) {
      console.log(`[${timestamp()}] ✅ E2E is green. Done.`);
      process.exit(0);
    }
    if (qa.code === 2) fail(`[${timestamp()}] QA harness error; see logs.`);

    console.log(`[${timestamp()}] ❌ Tests failing. Asking Codex to fix them...`);
    const patchPath = await askCodexForPatch(attempt);
    if (!patchPath) fail(`[${timestamp()}] Codex did not make any changes.`);

    // Auto-commit is enabled by default. Set SKIP_AUTO_COMMIT=1 to disable.
    if (process.env.SKIP_AUTO_COMMIT === "1") {
      console.log(`[${timestamp()}] Codex made changes. Review with: git diff`);
      console.log(`[${timestamp()}] Commit manually when ready: git commit -m "Auto-fix attempt ${attempt}"`);
      console.log(`[${timestamp()}] Then re-run: npm run fix:auto`);
      process.exit(0);
    }

    console.log(`[${timestamp()}] Codex made changes. Committing...`);
    const committed = commitAttempt(attempt);
    if (committed !== 0) {
      console.warn(`[${timestamp()}] Commit returned non-zero, but continuing anyway...`);
      console.log(`[${timestamp()}] Check git status to verify commit succeeded`);
    }

    console.log(`[${timestamp()}] Changes committed. Re-running QA…`);
  }
  console.error(`[${timestamp()}] 🛑 Still failing after ${MAX_ATTEMPTS} attempts.`);
  process.exit(1);
})();
