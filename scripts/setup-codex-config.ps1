# Setup Codex configuration for high-quality automated fixes
$configDir = "$env:USERPROFILE\.codex"
$configFile = "$configDir\config.toml"

# Create .codex directory if it doesn't exist
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    Write-Host "Created $configDir"
}

# Create/update config.toml
$config = @"
# Codex CLI Configuration
# See: https://codex.openai.com/docs

# Use GPT-5 Codex with extended reasoning for better automated fixes
model = "gpt-5-codex"
model_reasoning_effort = "high"

# Optional: Set default behavior
# auto_approve_edits = false
# auto_approve_bash = false
"@

Set-Content -Path $configFile -Value $config -Encoding UTF8
Write-Host "Created/updated $configFile"
Write-Host ""
Write-Host "Codex configuration:"
Write-Host "  Model: gpt-5-codex"
Write-Host "  Reasoning: high"
Write-Host ""
Write-Host "To verify, run: codex --version"
