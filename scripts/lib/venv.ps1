# Shared: ensure the project's virtual environment is active
function Ensure-Venv {
  param(
    [string]$ActivatorPath = (Join-Path (Resolve-Path "$PSScriptRoot/..") 'env/activate-venv.ps1')
  )
  $activationLog = [System.IO.Path]::GetTempFileName()
  try {
    if (-not $env:VIRTUAL_ENV) {
      Out-Step "Activating virtual environment..."
      $global:LASTEXITCODE = 0
      . $ActivatorPath *> $activationLog 2>&1
      if ($LASTEXITCODE -ne 0) {
        if (Test-Path $activationLog) { Get-Content $activationLog | Write-Host }
        throw "Failed to activate virtual environment"
      }
    }
  }
  finally {
    Remove-Item $activationLog -ErrorAction SilentlyContinue
  }
}

