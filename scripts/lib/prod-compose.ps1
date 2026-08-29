# Shared helpers for the production Docker Compose stack.

$script:ProdComposeFileName = 'docker-compose.prod.yml'
$script:ProdEnvFileName = '.env.production'

function Get-ProdRepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
}

function Get-ProdComposeFilePath {
  $path = Join-Path (Get-ProdRepoRoot) $script:ProdComposeFileName
  if (-not (Test-Path $path)) {
    throw "Production compose file not found: $path"
  }
  return $path
}

function Get-ProdEnvFilePath {
  $path = Join-Path (Get-ProdRepoRoot) $script:ProdEnvFileName
  if (-not (Test-Path $path)) {
    throw "Production env file not found: $path"
  }
  return $path
}

function Get-ProdComposeArguments {
  return @('--env-file', (Get-ProdEnvFilePath), '-f', (Get-ProdComposeFilePath))
}

function Invoke-ProdCompose {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [switch]$CaptureOutput
  )

  $repoRoot = Get-ProdRepoRoot
  $composeArgs = Get-ProdComposeArguments

  Push-Location $repoRoot
  try {
    if ($CaptureOutput) {
      $output = & docker compose @composeArgs @Arguments
      if ($LASTEXITCODE -ne 0) {
        throw "docker compose exited with code $LASTEXITCODE."
      }
      return $output
    }

    & docker compose @composeArgs @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose exited with code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}

function Get-ProdEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key
  )

  $pattern = '^\s*' + [regex]::Escape($Key) + '=(.*)$'
  foreach ($line in Get-Content -Path (Get-ProdEnvFilePath)) {
    if ($line -match $pattern) {
      return $Matches[1]
    }
  }

  throw "Required key '$Key' was not found in $(Get-ProdEnvFilePath)."
}

function Set-ProdEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key,

    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $path = Get-ProdEnvFilePath
  $lines = [System.Collections.Generic.List[string]]::new()
  $pattern = '^\s*' + [regex]::Escape($Key) + '='
  $updated = $false

  foreach ($line in Get-Content -Path $path) {
    if ($line -match $pattern) {
      $lines.Add("$Key=$Value")
      $updated = $true
    }
    else {
      $lines.Add($line)
    }
  }

  if (-not $updated) {
    $lines.Add("$Key=$Value")
  }

  Set-Content -Path $path -Value $lines
}

function Set-ProdImageTag {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Image,

    [Parameter(Mandatory = $true)]
    [string]$Tag
  )

  $withoutDigest = ($Image -split '@', 2)[0]
  $lastSlash = $withoutDigest.LastIndexOf('/')
  $lastColon = $withoutDigest.LastIndexOf(':')

  if ($lastColon -gt $lastSlash) {
    $base = $withoutDigest.Substring(0, $lastColon)
  }
  else {
    $base = $withoutDigest
  }

  return "${base}:$Tag"
}

function Get-ProdServiceContainerId {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Service
  )

  $output = Invoke-ProdCompose -Arguments @('ps', '-q', $Service) -CaptureOutput
  return ($output | Out-String).Trim()
}

function Wait-ProdService {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Service,

    [int]$TimeoutSeconds = 180
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastStatus = 'not-created'

  do {
    $containerId = Get-ProdServiceContainerId -Service $Service
    if ($containerId) {
      $status = (& docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $containerId | Out-String).Trim()
      if ($LASTEXITCODE -eq 0) {
        $lastStatus = $status
        if ($status -eq 'healthy' -or $status -eq 'running') {
          return
        }
      }
    }

    Start-Sleep -Seconds 2
  } until ((Get-Date) -ge $deadline)

  throw "Service '$Service' did not become healthy within $TimeoutSeconds seconds. Last status: $lastStatus."
}

function Wait-ProdHttp {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,

    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null

  do {
    try {
      Invoke-WebRequest -Uri $Url -TimeoutSec 5 | Out-Null
      return
    }
    catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 2
    }
  } until ((Get-Date) -ge $deadline)

  throw "HTTP check failed for $Url within $TimeoutSeconds seconds. Last error: $lastError"
}

function Get-ProdHttpPort {
  $value = Get-ProdEnvValue -Key 'PROD_HTTP_PORT'
  if ([string]::IsNullOrWhiteSpace($value)) {
    return 80
  }
  return [int]$value
}

function Get-ProdBackupDirectory {
  $path = Join-Path (Get-ProdRepoRoot) 'Database/backups/production'
  New-Item -ItemType Directory -Path $path -Force | Out-Null
  return $path
}

function Resolve-ProdDumpPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $candidate = $Path
  if ($candidate -like '*.meta.json') {
    $candidate = $candidate.Substring(0, $candidate.Length - '.meta.json'.Length)
  }

  if (-not [System.IO.Path]::IsPathRooted($candidate)) {
    $candidate = Join-Path (Get-ProdRepoRoot) $candidate
  }

  if (-not (Test-Path $candidate)) {
    throw "Snapshot dump not found: $candidate"
  }

  return (Resolve-Path $candidate).Path
}

function Get-ProdSnapshotMetadataPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DumpPath
  )

  return "$(Resolve-ProdDumpPath -Path $DumpPath).meta.json"
}

function Get-ProdSnapshotMetadata {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DumpPath
  )

  $metaPath = Get-ProdSnapshotMetadataPath -DumpPath $DumpPath
  if (-not (Test-Path $metaPath)) {
    return $null
  }

  try {
    return Get-Content -Raw -Path $metaPath | ConvertFrom-Json
  }
  catch {
    throw "Snapshot metadata is unreadable: $metaPath"
  }
}

function Get-ProdGitCommit {
  try {
    $commit = (& git -C (Get-ProdRepoRoot) rev-parse --short HEAD 2>$null | Out-String).Trim()
    if ($commit) {
      return $commit
    }
  }
  catch { }

  return 'unknown'
}

function Get-ProdAlembicVersion {
  $user = Get-ProdEnvValue -Key 'POSTGRES_USER'
  $password = Get-ProdEnvValue -Key 'POSTGRES_PASSWORD'
  $database = Get-ProdEnvValue -Key 'POSTGRES_DB'

  try {
    $output = Invoke-ProdCompose -Arguments @(
      'exec', '-T', '-e', "PGPASSWORD=$password", 'db',
      'psql', '-h', 'localhost', '-U', $user, '-d', $database, '-Atc',
      'SELECT version_num FROM alembic_version LIMIT 1;'
    ) -CaptureOutput
    $value = ($output | Out-String).Trim()
    if ($value) {
      return $value
    }
  }
  catch { }

  return 'unknown'
}

function Invoke-ProdMigration {
  Write-Host "Running Alembic migrations against the production database..."
  Invoke-ProdCompose -Arguments @(
    'run', '--rm', 'backend',
    'sh', '-lc', 'cd /app/Backend && python -m alembic -c alembic.ini upgrade head'
  )
}

function Invoke-ProdBackup {
  param(
    [string]$Label = 'manual'
  )

  $sanitizedLabel = [regex]::Replace($Label, '[^A-Za-z0-9._-]+', '-').Trim('-')
  if ([string]::IsNullOrWhiteSpace($sanitizedLabel)) {
    $sanitizedLabel = 'snapshot'
  }

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $baseName = "production-$sanitizedLabel-$timestamp"
  $backupDir = Get-ProdBackupDirectory
  $dumpPath = Join-Path $backupDir "$baseName.dump"
  $metaPath = "$dumpPath.meta.json"
  $tempDump = "/tmp/$baseName.dump"
  $user = Get-ProdEnvValue -Key 'POSTGRES_USER'
  $password = Get-ProdEnvValue -Key 'POSTGRES_PASSWORD'
  $database = Get-ProdEnvValue -Key 'POSTGRES_DB'

  Write-Host "Creating production database snapshot..."
  Invoke-ProdCompose -Arguments @('up', '-d', 'db')
  Wait-ProdService -Service 'db' -TimeoutSeconds 180

  try {
    Invoke-ProdCompose -Arguments @(
      'exec', '-T', '-e', "PGPASSWORD=$password", 'db',
      'pg_dump', '--format=custom', '--no-owner', '--no-privileges',
      '-h', 'localhost', '-U', $user, '-d', $database, '-f', $tempDump
    )

    $containerId = Get-ProdServiceContainerId -Service 'db'
    if (-not $containerId) {
      throw "Could not resolve the production db container id."
    }

    & docker cp "$containerId`:$tempDump" $dumpPath
    if ($LASTEXITCODE -ne 0) {
      throw "docker cp failed while copying the production snapshot."
    }
  }
  finally {
    try {
      Invoke-ProdCompose -Arguments @('exec', '-T', 'db', 'sh', '-lc', "rm -f $tempDump") | Out-Null
    }
    catch { }
  }

  $metadata = [ordered]@{
    timestamp        = $timestamp
    label            = $sanitizedLabel
    dump_path        = $dumpPath
    alembic_version  = Get-ProdAlembicVersion
    git_commit       = Get-ProdGitCommit
    backend_image    = Get-ProdEnvValue -Key 'BACKEND_IMAGE'
    frontend_image   = Get-ProdEnvValue -Key 'FRONTEND_IMAGE'
    postgres_image   = Get-ProdEnvValue -Key 'POSTGRES_IMAGE'
    edge_image       = Get-ProdEnvValue -Key 'EDGE_IMAGE'
  }
  $metadata | ConvertTo-Json | Out-File -FilePath $metaPath -Encoding utf8

  return [pscustomobject]@{
    DumpPath     = $dumpPath
    MetadataPath = $metaPath
  }
}

function Invoke-ProdRestore {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DumpPath,

    [switch]$ResetSchema
  )

  $resolvedDumpPath = Resolve-ProdDumpPath -Path $DumpPath
  $tempDump = "/tmp/$(Split-Path -Path $resolvedDumpPath -Leaf)"
  $user = Get-ProdEnvValue -Key 'POSTGRES_USER'
  $password = Get-ProdEnvValue -Key 'POSTGRES_PASSWORD'
  $database = Get-ProdEnvValue -Key 'POSTGRES_DB'

  Invoke-ProdCompose -Arguments @('up', '-d', 'db')
  Wait-ProdService -Service 'db' -TimeoutSeconds 180

  $containerId = Get-ProdServiceContainerId -Service 'db'
  if (-not $containerId) {
    throw "Could not resolve the production db container id."
  }

  & docker cp $resolvedDumpPath "$containerId`:$tempDump"
  if ($LASTEXITCODE -ne 0) {
    throw "docker cp failed while staging the production snapshot for restore."
  }

  try {
    if ($ResetSchema) {
      Write-Host "Resetting schema 'public' before restore..."
      Invoke-ProdCompose -Arguments @(
        'exec', '-T', '-e', "PGPASSWORD=$password", 'db',
        'psql', '-h', 'localhost', '-U', $user, '-d', $database,
        '-v', 'ON_ERROR_STOP=1', '-c',
        'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
      )
    }

    Write-Host "Restoring production database from snapshot..."
    Invoke-ProdCompose -Arguments @(
      'exec', '-T', '-e', "PGPASSWORD=$password", 'db',
      'pg_restore', '--clean', '--if-exists', '--no-owner', '--no-privileges',
      '-h', 'localhost', '-U', $user, '-d', $database, $tempDump
    )
  }
  finally {
    try {
      Invoke-ProdCompose -Arguments @('exec', '-T', 'db', 'sh', '-lc', "rm -f $tempDump") | Out-Null
    }
    catch { }
  }
}

function Wait-ProdStackReady {
  Wait-ProdService -Service 'db' -TimeoutSeconds 180
  Wait-ProdService -Service 'backend' -TimeoutSeconds 240
  Wait-ProdService -Service 'frontend' -TimeoutSeconds 180
  Wait-ProdService -Service 'edge' -TimeoutSeconds 180

  $httpPort = Get-ProdHttpPort
  Write-Host "Running post-deploy HTTP checks on port $httpPort..."
  Wait-ProdHttp -Url "http://127.0.0.1:$httpPort/healthz" -TimeoutSeconds 60
  Wait-ProdHttp -Url "http://127.0.0.1:$httpPort/api/ingredients/" -TimeoutSeconds 60
  Wait-ProdHttp -Url "http://127.0.0.1:$httpPort/api/foods/" -TimeoutSeconds 60
}
