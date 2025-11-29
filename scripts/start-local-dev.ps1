# Starts the local API server and web client required for Playwright QA runs.

param()

$ErrorActionPreference = "Stop"

$serverProcess = $null
$clientProcess = $null

function Stop-ProcessIfRunning($process) {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
}

function Abort($message) {
  Write-Host $message -ForegroundColor Red
  try { Stop-ProcessIfRunning $serverProcess } catch { }
  try { Stop-ProcessIfRunning $clientProcess } catch { }
  exit 1
}

Write-Host "Starting TrailWright QA dev environment..." -ForegroundColor Cyan

$rootDir = Join-Path $PSScriptRoot ".."
$serverDir = Join-Path $rootDir "server"
$clientDir = Join-Path $rootDir "client"

if (-not (Test-Path $serverDir)) {
  Abort "Could not locate server directory at $serverDir"
}

if (-not (Test-Path $clientDir)) {
  Abort "Could not locate client directory at $clientDir"
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  $npm = Get-Command npm -ErrorAction SilentlyContinue
}

if (-not $npm) {
  Abort "npm is not available on PATH. Install Node.js before running QA."
}

Write-Host "Launching API server (npm run dev) from $serverDir" -ForegroundColor Cyan
try {
  $serverProcess = Start-Process -FilePath $npm.Source `
    -ArgumentList "run", "dev" `
    -WorkingDirectory $serverDir `
    -PassThru `
    -WindowStyle Hidden
} catch {
  Abort "Failed to start API server: $($_.Exception.Message)"
}

Start-Sleep -Seconds 1
if ($serverProcess.HasExited) {
  Abort "API server process exited immediately with code $($serverProcess.ExitCode)"
}

Write-Host "Launching web client (npm run dev) from $clientDir" -ForegroundColor Cyan
try {
  $clientProcess = Start-Process -FilePath $npm.Source `
    -ArgumentList "run", "dev" `
    -WorkingDirectory $clientDir `
    -PassThru `
    -WindowStyle Hidden
} catch {
  Abort "Failed to start web client: $($_.Exception.Message)"
}

Start-Sleep -Seconds 1
if ($clientProcess.HasExited) {
  Abort "Web client process exited immediately with code $($clientProcess.ExitCode)"
}

$portalUrl = "http://localhost:3000/"
$apiUrl = "http://localhost:3210/api/health"
$attempts = 45

for ($i = 1; $i -le $attempts; $i++) {
  $portalReady = $false
  $apiReady = $false

  try {
    $portalResponse = Invoke-WebRequest -Uri $portalUrl -UseBasicParsing -TimeoutSec 2
    if ($portalResponse.StatusCode -eq 200) {
      $portalReady = $true
    }
  } catch {
    if ($clientProcess.HasExited) {
      Abort "Web client process exited unexpectedly with code $($clientProcess.ExitCode)"
    }
  }

  try {
    $apiResponse = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 2
    if ($apiResponse.StatusCode -eq 200) {
      $apiReady = $true
    }
  } catch {
    if ($serverProcess.HasExited) {
      Abort "API server process exited unexpectedly with code $($serverProcess.ExitCode)"
    }
  }

  if ($portalReady -and $apiReady) {
    Write-Host "Servers are ready: portal $portalUrl (PID $($clientProcess.Id)), API $apiUrl (PID $($serverProcess.Id))" -ForegroundColor Green
    exit 0
  }

  Start-Sleep -Seconds 1
}

Abort "Servers did not become ready at $portalUrl and $apiUrl after $attempts attempts."
