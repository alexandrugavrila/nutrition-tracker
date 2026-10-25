# Pass Python CLI flags verbatim, e.g. --email, --password-stdin.
$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '../..')
try {
    & python -m Backend.commands.manage_account @args
    if ($LASTEXITCODE -ne 0) { throw "Account command failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }
