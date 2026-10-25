# Run migrations, explicit account tests, API E2E and browser E2E in disposable infrastructure.
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PytestArgs)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path "$PSScriptRoot/../..")
. "$PSScriptRoot/../lib/venv.ps1"
Ensure-Venv
& npm --prefix Frontend run e2e:install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& python -m testsupport.run_e2e @PytestArgs
exit $LASTEXITCODE
