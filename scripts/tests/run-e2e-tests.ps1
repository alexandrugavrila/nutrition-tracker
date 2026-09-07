# Runs branch-isolated end-to-end suites. Spins up the dedicated -test stack,
# waits for backend and frontend health, then executes API and browser e2e suites.
[CmdletBinding()]
param(
  # Additional arguments passed to pytest
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$PytestArgs
)

$ErrorActionPreference = 'Stop'

function Show-Usage {
  Write-Host ""
  Write-Host "Usage:" -ForegroundColor Yellow
  Write-Host "  pwsh ./scripts/tests/run-e2e-tests.ps1  [pytest-args...]"
  Write-Host ""
  Write-Host "Behavior:" -ForegroundColor Yellow
  Write-Host "  - Starts a dedicated test stack via"
  Write-Host "    ./scripts/docker/compose.ps1 up type -test data -test"
  Write-Host "    and reads port information from the generated env file"
  Write-Host "  - Waits for both backend and frontend to become healthy"
  Write-Host "  - Runs the backend API pytest e2e suite and the browser-driven Playwright suite"
  Write-Host "  - Additional arguments are passed through to pytest"
  Write-Host ""
  Write-Host "Examples:" -ForegroundColor Yellow
  Write-Host "  pwsh ./scripts/tests/run-e2e-tests.ps1 -q"
  Write-Host "  pwsh ./scripts/tests/run-e2e-tests.ps1 -k ingredient"
  Write-Host ""
}

if ($PSBoundParameters.ContainsKey('help') -or $args -contains '-h' -or $args -contains '--help') {
  Show-Usage
  exit 0
}

$repoRoot = Resolve-Path "$PSScriptRoot/../.."
Set-Location $repoRoot

# Ensure virtual environment is active
. "$PSScriptRoot/../lib/log.ps1"
. "$PSScriptRoot/../lib/venv.ps1"
Ensure-Venv

function Test-BackendHealthy([int]$Port) {
  try {
    # Use a lightweight endpoint; follow redirects if needed by calling ingredients without trailing slash
    $uri = "http://localhost:$Port/api/ingredients"
    $resp = Invoke-WebRequest -Uri $uri -Method GET -TimeoutSec 2 -MaximumRedirection 2 -ErrorAction Stop
    return $true
  }
  catch {
    return $false
  }
}

function Test-FrontendHealthy([int]$Port) {
  try {
    $uri = "http://localhost:$Port/"
    $resp = Invoke-WebRequest -Uri $uri -Method GET -TimeoutSec 2 -MaximumRedirection 2 -ErrorAction Stop
    return $true
  }
  catch {
    return $false
  }
}

# Determine a dedicated TEST compose project for this branch
. "$PSScriptRoot/../lib/compose-utils.ps1"
$testProject = Get-TestProject

function Get-BackendPort($proj) {
  try {
    $res = docker compose -p $proj port backend 8000 2>$null
    if ($LASTEXITCODE -eq 0 -and $res) { return ($res -split ':')[-1] }
  } catch { }
  return $null
}

function Get-FrontendPort($proj) {
  try {
    $res = docker compose -p $proj port frontend 3000 2>$null
    if ($LASTEXITCODE -eq 0 -and $res) { return ($res -split ':')[-1] }
  } catch { }
  return $null
}

$exit = 1
try {
  # Always stand up a dedicated TEST stack on TEST ports and project name
  $envFile = [System.IO.Path]::GetTempFileName()
  try {
    $env:COMPOSE_ENV_FILE = $envFile
    & "$PSScriptRoot/../docker/compose.ps1" up type -test data -test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Get-Content $envFile | ForEach-Object {
      if ($_ -match '^([^=]+)=(.+)$') { Set-Item -Path "env:$($matches[1])" -Value $matches[2] }
    }
  } finally {
    Remove-Item $envFile -ErrorAction SilentlyContinue
    Remove-Item env:COMPOSE_ENV_FILE -ErrorAction SilentlyContinue
  }

  # Ask docker for the published backend port for this test project
  $backendPort = Get-BackendPort $testProject
  if (-not $backendPort) { $backendPort = $env:TEST_BACKEND_PORT }
  $frontendPort = Get-FrontendPort $testProject
  if (-not $frontendPort) { $frontendPort = $env:TEST_FRONTEND_PORT }
  $env:DEV_BACKEND_PORT = $backendPort
  $env:DEV_FRONTEND_PORT = $frontendPort

  Write-Host "Checking backend health on port $backendPort..."
  $deadline = (Get-Date).AddSeconds(120)
  while (-not (Test-BackendHealthy -Port $backendPort)) {
    if ((Get-Date) -ge $deadline) {
      Write-Error "Backend did not become healthy on port $backendPort within timeout."
      exit 1
    }
    Start-Sleep -Seconds 1
  }

  Write-Host "Checking frontend health on port $frontendPort..."
  $deadline = (Get-Date).AddSeconds(180)
  while (-not (Test-FrontendHealthy -Port $frontendPort)) {
    if ((Get-Date) -ge $deadline) {
      Write-Error "Frontend did not become healthy on port $frontendPort within timeout."
      exit 1
    }
    Start-Sleep -Seconds 1
  }

  Write-Host "Installing Playwright browser runtime..."
  & npm --prefix Frontend run e2e:install | Out-Null
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Write-Host "Running API e2e tests against http://localhost:$backendPort/api"
  & pytest -vv -rP -s -m e2e Backend/tests/test_e2e_api.py @PytestArgs
  $apiExit = $LASTEXITCODE

  Write-Host "Running browser e2e tests against http://localhost:$frontendPort"
  $env:PLAYWRIGHT_BASE_URL = "http://localhost:$frontendPort"
  & npm --prefix Frontend run e2e
  $uiExit = $LASTEXITCODE

  if ($apiExit -ne 0) {
    $exit = $apiExit
  } else {
    $exit = $uiExit
  }
} finally {
  # Tear down the dedicated TEST stack regardless of test outcome
  & "$PSScriptRoot/../docker/compose.ps1" down type -test
  Remove-Item env:PLAYWRIGHT_BASE_URL -ErrorAction SilentlyContinue
}
exit $exit
