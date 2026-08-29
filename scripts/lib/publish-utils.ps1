# Shared helpers for manually building and publishing immutable application images.

$script:PublishEnvCandidates = @('.env.publish', '.env')

function Get-PublishRepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
}

function Get-PublishEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Key,

    [switch]$Optional
  )

  $envItem = Get-Item -Path "Env:$Key" -ErrorAction SilentlyContinue
  if ($envItem -and -not [string]::IsNullOrWhiteSpace($envItem.Value)) {
    return $envItem.Value
  }

  foreach ($candidate in $script:PublishEnvCandidates) {
    $path = Join-Path (Get-PublishRepoRoot) $candidate
    if (-not (Test-Path $path)) { continue }

    $pattern = '^\s*' + [regex]::Escape($Key) + '=(.*)$'
    foreach ($line in Get-Content -Path $path) {
      if ($line -match $pattern) {
        return $Matches[1]
      }
    }
  }

  if ($Optional) {
    return $null
  }

  throw "Required setting '$Key' was not found in the environment, .env.publish, or .env."
}

function Get-RecentReleaseTags {
  param([int]$Count = 3)

  try {
    $tags = & git -C (Get-PublishRepoRoot) tag --sort=-creatordate 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $tags) {
      return @()
    }
    return @($tags | Select-Object -First $Count)
  }
  catch {
    return @()
  }
}

function Test-PublishInteractive {
  try {
    return (-not [Console]::IsInputRedirected) -and (-not [Console]::IsOutputRedirected)
  }
  catch {
    return $false
  }
}

function Resolve-ReleaseTag {
  param([string]$Tag)

  if ($Tag) {
    return $Tag.Trim()
  }

  $recent = Get-RecentReleaseTags
  if ($recent.Count -gt 0) {
    Write-Host "Latest 3 release tags:"
    foreach ($existing in $recent) {
      Write-Host "  $existing"
    }
  }
  else {
    Write-Host "No existing git tags were found in this repository."
  }

  if (-not (Test-PublishInteractive)) {
    throw "No tag was provided and the shell is non-interactive. Supply -Tag explicitly."
  }

  $inputTag = Read-Host 'Enter the new image tag to publish'
  if ([string]::IsNullOrWhiteSpace($inputTag)) {
    throw "A non-empty tag is required."
  }

  return $inputTag.Trim()
}

function Invoke-PublishGit {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $output = & git -C (Get-PublishRepoRoot) @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed:`n$output"
  }
  return ($output | Out-String).Trim()
}

function Assert-PublishReleaseSource {
  param([Parameter(Mandatory = $true)][string]$Tag)

  $repoRoot = Get-PublishRepoRoot
  Invoke-PublishGit -Arguments @('check-ref-format', "refs/tags/$Tag") | Out-Null
  $branch = Invoke-PublishGit -Arguments @('branch', '--show-current')
  if ($branch -ne 'main') {
    throw "Releases must be published from main. Current branch: '$branch'."
  }

  $status = Invoke-PublishGit -Arguments @('status', '--porcelain')
  if ($status) {
    throw "Release publishing requires a clean main worktree. Commit or stash local changes first."
  }

  Invoke-PublishGit -Arguments @(
    'fetch', '--no-tags', 'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/development:refs/remotes/origin/development'
  ) | Out-Null

  $head = Invoke-PublishGit -Arguments @('rev-parse', 'HEAD^{commit}')
  $originMain = Invoke-PublishGit -Arguments @('rev-parse', 'origin/main^{commit}')
  if ($head -ne $originMain) {
    throw "Local main must exactly match origin/main before publishing. HEAD=$head origin/main=$originMain"
  }

  $development = Invoke-PublishGit -Arguments @('rev-parse', 'origin/development^{commit}')
  $parents = (Invoke-PublishGit -Arguments @('rev-list', '--parents', '-n', '1', $head)) -split '\s+'
  if ($parents.Count -ne 3 -or $parents[2] -ne $development) {
    throw "HEAD must be the two-parent development -> main release merge, with origin/development as its second parent."
  }

  & git -C $repoRoot show-ref --verify --quiet "refs/tags/$Tag"
  if ($LASTEXITCODE -eq 0) {
    $tagCommit = Invoke-PublishGit -Arguments @('rev-parse', "$Tag^{commit}")
    if ($tagCommit -ne $head) {
      throw "Release tag '$Tag' already points to $tagCommit, not HEAD $head."
    }
  }
}

function Get-RegistryHost {
  param([Parameter(Mandatory = $true)][string]$ImageRepository)

  $configured = Get-PublishEnvValue -Key 'CONTAINER_REGISTRY' -Optional
  if ($configured) {
    return $configured
  }

  $firstSegment = ($ImageRepository -split '/', 2)[0]
  if ($firstSegment -match '[\.:]' -or $firstSegment -eq 'localhost') {
    return $firstSegment
  }

  return 'docker.io'
}

function Get-PublishImageReferences {
  param([Parameter(Mandatory = $true)][string]$Tag)

  $backendRepo = Get-PublishEnvValue -Key 'BACKEND_IMAGE_REPO'
  $frontendRepo = Get-PublishEnvValue -Key 'FRONTEND_IMAGE_REPO'

  return [pscustomobject]@{
    BackendRepository = $backendRepo
    FrontendRepository = $frontendRepo
    BackendImage = "$backendRepo`:$Tag"
    FrontendImage = "$frontendRepo`:$Tag"
    Registry = Get-RegistryHost -ImageRepository $backendRepo
  }
}

function Invoke-RegistryLogin {
  param([Parameter(Mandatory = $true)][string]$Registry)

  $username = Get-PublishEnvValue -Key 'CONTAINER_REGISTRY_USERNAME'
  $token = Get-PublishEnvValue -Key 'CONTAINER_REGISTRY_TOKEN'

  Write-Host "Logging into container registry '$Registry'..."
  $token | docker login $Registry --username $username --password-stdin
  if ($LASTEXITCODE -ne 0) {
    throw "docker login failed."
  }
}

function Invoke-PublishBuild {
  param([Parameter(Mandatory = $true)]$Images)

  $repoRoot = Get-PublishRepoRoot
  Push-Location $repoRoot
  try {
    Write-Host "Building backend image: $($Images.BackendImage)"
    & docker build -f Backend/Dockerfile --target prod -t $Images.BackendImage .
    if ($LASTEXITCODE -ne 0) { throw "Backend image build failed." }

    Write-Host "Building frontend image: $($Images.FrontendImage)"
    & docker build -f Frontend/Dockerfile -t $Images.FrontendImage .
    if ($LASTEXITCODE -ne 0) { throw "Frontend image build failed." }
  }
  finally {
    Pop-Location
  }
}

function Invoke-PublishPush {
  param([Parameter(Mandatory = $true)]$Images)

  Write-Host "Pushing backend image: $($Images.BackendImage)"
  & docker push $Images.BackendImage
  if ($LASTEXITCODE -ne 0) { throw "Backend image push failed." }

  Write-Host "Pushing frontend image: $($Images.FrontendImage)"
  & docker push $Images.FrontendImage
  if ($LASTEXITCODE -ne 0) { throw "Frontend image push failed." }
}

function Ensure-ReleaseGitTag {
  param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [switch]$Push
  )

  $repoRoot = Get-PublishRepoRoot
  $exists = (& git -C $repoRoot tag --list $Tag 2>$null | Out-String).Trim()
  if (-not $exists) {
    Write-Host "Creating annotated git tag '$Tag'..."
    & git -C $repoRoot tag -a -m "Release $Tag" -- $Tag
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create git tag '$Tag'."
    }
  }
  else {
    $tagCommit = (& git -C $repoRoot rev-parse "$Tag^{commit}" 2>$null | Out-String).Trim()
    $headCommit = (& git -C $repoRoot rev-parse 'HEAD^{commit}' 2>$null | Out-String).Trim()
    if ($tagCommit -ne $headCommit) {
      throw "Git tag '$Tag' points to $tagCommit, not HEAD $headCommit."
    }
    Write-Host "Git tag '$Tag' already exists locally and points to HEAD."
  }

  if ($Push) {
    Write-Host "Pushing git tag '$Tag' to origin..."
    & git -C $repoRoot push origin "refs/tags/$Tag"
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to push git tag '$Tag' to origin."
    }
  }
}
