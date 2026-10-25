# Shared staged implementation; see docs/release-cutover.md.
$ErrorActionPreference = 'Stop'
$interpreter = if ($env:PYTHON) { $env:PYTHON } else { 'python' }
& $interpreter "$PSScriptRoot/cutover.py" @args
if ($LASTEXITCODE -ne 0) { throw "Production cutover checkpoint failed ($LASTEXITCODE)." }
