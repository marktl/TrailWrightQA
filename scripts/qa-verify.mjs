
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";

// Cleanup old screenshots before running tests
function cleanupOldScreenshots() {
  const lastRunDir = "qa/last-run";
  if (!existsSync(lastRunDir)) return;

  const files = readdirSync(lastRunDir);
  const pngFiles = files.filter(f => f.endsWith(".png"));

  // Keep screenshots from last 24 hours, delete older ones
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  let deleted = 0;

  for (const file of pngFiles) {
    const filePath = `${lastRunDir}/${file}`;
    try {
      const stats = statSync(filePath);
      if (stats.mtimeMs < oneDayAgo) {
        unlinkSync(filePath);
        deleted++;
      }
    } catch (e) {
      // Ignore errors (file might be locked)
    }
  }

  if (deleted > 0) {
    console.log(`Cleaned up ${deleted} old screenshot(s)`);
  }
}

// Clean up before starting
cleanupOldScreenshots();

const PROMPT = `IMPORTANT: You must invoke the qa-run-playwright skill using the Skill tool NOW.

Execute the qa-run-playwright skill to run ALL scenarios with environment=local.

After the skill completes, return ONLY compact JSON with no other text:
{"passed":<n>,"failed":<m>,"resultsFile":"...","issuesFile":"..."}

Do NOT respond with greetings or questions. Invoke the skill immediately.`;

const args = [
  "--print",
  "--output-format", "json",
  "--max-turns", "150",
  "--permission-mode", "acceptEdits",
  "--dangerously-skip-permissions",
  "--allowedTools", "Skill(qa-run-playwright)",
  "--allowedTools", "Read",
  "--allowedTools", "Write",
  "--allowedTools", "WebFetch",
  "--allowedTools", "Bash(pwsh -File scripts/start-local-dev.ps1)",
  "--allowedTools", "mcp__playwright__*",
  "--",
  PROMPT
];

// Use claude.cmd explicitly on Windows and construct command as string for shell
const cmdStr = process.platform === "win32"
  ? `claude.cmd ${args.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`
  : `claude ${args.join(" ")}`;

// Debug: show constructed command (truncated)
console.log("Running:", cmdStr.substring(0, 150) + "...");

const r = spawnSync(cmdStr, { encoding: "utf8", shell: true });

// Debug: write full output to file
if (!existsSync("qa/last-run")) mkdirSync("qa/last-run", { recursive: true });
writeFileSync("qa/last-run/claude-output.txt", r.stdout || "(no stdout)", "utf8");
writeFileSync("qa/last-run/claude-stderr.txt", r.stderr || "(no stderr)", "utf8");
console.log("Debug: Claude output saved to qa/last-run/claude-output.txt");

if (r.error) {
  console.error(r.error);
  process.exit(2);
}

try {
  let out;

  // Try parsing Claude's JSON output first (it's more reliable than results.json)
  try {
    const claudeResult = JSON.parse((r.stdout || "").trim());
    // Extract JSON from the markdown result field (handle escaped newlines)
    const resultText = claudeResult.result || "";

    // The result field has escaped newlines like \n, so we need to look for that pattern
    // Match: ```json\n{...}\n```
    const jsonMatch = resultText.match(/```json\\n(\{[^`]*?\})\\n```/);
    if (jsonMatch) {
      // Unescape the JSON before parsing
      const jsonStr = jsonMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      out = JSON.parse(jsonStr);
    } else {
      // Try parsing the entire result field as JSON (unlikely but possible)
      out = JSON.parse(resultText);
    }
  } catch (claudeErr) {
    // Fall back to results.json file (handle potential encoding issues)
    try {
      const raw = readFileSync("qa/last-run/results.json", "utf8");
      // Strip BOM and any non-JSON prefix
      const cleaned = raw.replace(/^\uFEFF/, "").replace(/^[^\{]*/, "");
      out = JSON.parse(cleaned);
    } catch (fileErr) {
      console.error("Failed to parse results from Claude output or results.json");
      console.error("Claude parse error:", claudeErr.message);
      console.error("File parse error:", fileErr.message);
      console.error("Raw stdout (first 200 chars):", (r.stdout || "").slice(0, 200));
      process.exit(2);
    }
  }

  const passed = Number(out.passed || 0);
  const failed = Number(out.failed || 0);
  const total  = passed + failed;

  console.log(`QA: ${passed} passed, ${failed} failed`);
  if (out.resultsFile) console.log(`Artifacts: ${out.resultsFile}`);
  if (out.issuesFile)  console.log(`Issues:    ${out.issuesFile}`);

  // 🔴 Treat zero executed scenarios as an error
  if (total === 0) {
    console.error(
      "No scenarios executed.\n" +
      "- Check qa/e2e-cases.yaml exists and has 'scenarios:'\n" +
      "- See qa/last-run/runner.log and heartbeat.txt\n" +
      "- Ensure the QA skill resolved baseUrl and preflight correctly"
    );
    process.exit(2);
  }

  process.exit(failed > 0 ? 1 : 0);
} catch (e) {
  console.error("Unexpected error:", e.message);
  console.error("Raw stdout (first 500 chars):", (r.stdout || "").slice(0, 500));
  process.exit(2);
}
