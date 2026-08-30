#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Jump to an existing worktree for a branch or create a new one.
.DESCRIPTION
    Lists current worktrees, lets you pick a branch, and either changes directory to
    the matching worktree or creates a fresh worktree for that branch. New branches
    always start from the latest origin/development integration branch.
.PARAMETER Branch
    Optional branch name or numeric selection. If omitted the script prompts.
.PARAMETER SkipVSCode
    Suppress launching VS Code after switching.
.PARAMETER NewVSCodeWindow
    Open the worktree in a new VS Code window instead of reusing the current one.
.PARAMETER CopyEnv
    Copy the current worktree .env file into the target worktree if it does not exist there.
.PARAMETER StartWorkspaceStack
    Start the Docker Compose stack once the worktree is opened. The project's
    virtual environment is always activated.
.PARAMETER Data
    Required when -StartWorkspaceStack is supplied. Chooses which data set to load
    when starting Docker Compose (test or prod).
#>
[CmdletBinding()]
param(
    [string]$Branch,
    [switch]$SkipVSCode,
    [switch]$NewVSCodeWindow,
    [switch]$CopyEnv,
    [switch]$StartWorkspaceStack,
    [ValidateSet('test','prod')]
    [string]$Data
)

$ErrorActionPreference = 'Stop'

$branchEnvLib = Join-Path $PSScriptRoot 'lib' 'branch-env.ps1'
if (Test-Path $branchEnvLib) {
    . $branchEnvLib
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Args
    )

    $output = & git @Args 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $exitCode`n$output"
    }

    return $output
}

function Normalize-Path {
    param(
        [Parameter(Mandatory = $true)][string]$PathValue
    )

    return ([System.IO.Path]::GetFullPath($PathValue)).TrimEnd([char]92,'/')
}

function Test-LocalBranch {
    param(
        [Parameter(Mandatory = $true)][string]$Name
    )

    & git show-ref --verify --quiet ("refs/heads/$Name") > $null 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Test-RemoteBranch {
    param(
        [Parameter(Mandatory = $true)][string]$RemoteName,
        [Parameter(Mandatory = $true)][string]$Name
    )

    & git ls-remote --exit-code --heads $RemoteName $Name > $null 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Sync-RemoteBranchesToLocal {
    param(
        [Parameter(Mandatory = $true)][string]$RemoteName
    )

    $remoteRefs = Invoke-Git @('for-each-ref','--format=%(refname:short)',"refs/remotes/$RemoteName")
    foreach ($ref in $remoteRefs) {
        if (-not $ref) { continue }
        if ($ref -eq "$RemoteName/HEAD") { continue }
        if (-not $ref.StartsWith("$RemoteName/")) { continue }

        $branchName = $ref.Substring($RemoteName.Length + 1)
        if (-not $branchName) { continue }
        if (Test-LocalBranch -Name $branchName) { continue }

        Write-Host "Creating local branch '$branchName' tracking '$ref'..."
        Invoke-Git @('branch','--track',$branchName,$ref) | Out-Null
    }
}

function Parse-Worktrees {
    param([string[]]$Lines)

    $entries = @()
    $current = @{}

    foreach ($line in $Lines) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            if ($current.ContainsKey('Path')) {
                $entries += [pscustomobject]@{
                    Path   = Normalize-Path $current.Path
                    Branch = if ($current.ContainsKey('Branch')) { $current.Branch } else { $null }
                }
            }
            $current = @{}
            continue
        }

        $parts = $line.Split(' ', 2)
        if ($parts.Count -lt 2) { continue }

        switch ($parts[0]) {
            'worktree' { $current.Path = $parts[1] }
            'branch' {
                $branchValue = $parts[1]
                if ($branchValue -eq 'detached') {
                    $current.Branch = $null
                }
                else {
                    if ($branchValue.StartsWith('refs/heads/')) {
                        $branchValue = $branchValue.Substring(11)
                    }
                    $current.Branch = $branchValue
                }
            }
            default { }
        }
    }

    if ($current.ContainsKey('Path')) {
        $entries += [pscustomobject]@{
            Path   = Normalize-Path $current.Path
            Branch = if ($current.ContainsKey('Branch')) { $current.Branch } else { $null }
        }
    }

    return $entries
}

function Get-LastLine {
    param([Parameter(Mandatory = $true)]$Lines)

    return [string]($Lines | Select-Object -Last 1)
}

function Open-VSCode {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$NewWindow
    )

    $codeCommand = Get-Command -Name 'code' -ErrorAction SilentlyContinue
    if (-not $codeCommand) {
        Write-Warning "VS Code command 'code' not found in PATH. Skipping VS Code launch."
        return
    }

    $args = @()
    if ($NewWindow) {
        $args += '-n'
    }
    else {
        $args += '-r'
    }
    $args += $Path

    try {
        Start-Process -FilePath $codeCommand.Source -ArgumentList $args | Out-Null
    }
    catch {
        Write-Warning "Failed to launch VS Code: $($_.Exception.Message)"
    }
}

function Activate-VirtualEnvironment {
    Write-Host ''
    Write-Host 'Activating virtual environment...'
    & "$PSScriptRoot/env/activate-venv.ps1"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to activate virtual environment (exit code $LASTEXITCODE)."
    }
}

function Copy-EnvFileIfRequested {
    param(
        [Parameter(Mandatory = $true)][string]$SourceRoot,
        [Parameter(Mandatory = $true)][string]$TargetRoot,
        [switch]$Requested
    )

    if (-not $Requested) { return }

    $sourceEnv = Join-Path $SourceRoot '.env'
    if (-not (Test-Path -LiteralPath $sourceEnv)) {
        Write-Host "No .env found at '$sourceEnv'. Skipping env copy."
        return
    }

    $targetEnv = Join-Path $TargetRoot '.env'
    if (Test-Path -LiteralPath $targetEnv) {
        Write-Host "Target already has .env at '$targetEnv'. Skipping env copy."
        return
    }

    Copy-Item -LiteralPath $sourceEnv -Destination $targetEnv
    Write-Host "Copied .env to '$targetEnv'."
}

function Start-WorkspaceStack {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('test','prod')][string]$DataMode
    )

    $mode = $DataMode.ToLowerInvariant()
    Write-Host ''
    Write-Host "Starting Docker Compose stack using '$mode' data..."
    & "$PSScriptRoot/docker/compose.ps1" @('up','data',"-$mode")
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed to start (exit code $LASTEXITCODE)."
    }
}

if ($StartWorkspaceStack -and -not $Data) {
    Write-Error '-Data test|prod must be provided when using -StartWorkspaceStack.'
    exit 1
}

if ($Data -and -not $StartWorkspaceStack) {
    Write-Error '-Data can only be used together with -StartWorkspaceStack.'
    exit 1
}

$initialLocation = Get-Location

$repoRootRaw = Get-LastLine (Invoke-Git @('rev-parse','--show-toplevel'))
if (-not $repoRootRaw) {
    throw 'Unable to determine repository root. Is this a git worktree?'
}
Set-Location $repoRootRaw
$repoRoot = Normalize-Path $repoRootRaw
$branchEnvLib = Join-Path $repoRoot 'scripts' 'lib' 'branch-env.ps1'
if (Test-Path -LiteralPath $branchEnvLib) {
    . $branchEnvLib
}

$remoteName = 'origin'
Write-Host "Fetching latest refs from '$remoteName'..."
Invoke-Git @('fetch',$remoteName,'--prune') | Out-Null
Sync-RemoteBranchesToLocal -RemoteName $remoteName

$worktreeLines = Invoke-Git @('worktree','list','--porcelain')
$worktrees = Parse-Worktrees $worktreeLines
$localBranches = Invoke-Git @('for-each-ref','--format=%(refname:short)','refs/heads')

$branchMap = @{}
foreach ($wt in $worktrees) {
    if (-not $wt.Branch) { continue }
    if ($branchMap.ContainsKey($wt.Branch)) {
        $branchMap[$wt.Branch] += $wt
    }
    else {
        $branchMap[$wt.Branch] = @($wt)
    }
}

Write-Host ''
Write-Host 'Existing worktrees:'
$branchOptions = @()
$optionIndex = 1
foreach ($wt in $worktrees | Sort-Object Branch, Path) {
    $marker = if ($wt.Path -eq $repoRoot) { '>' } else { ' ' }
    $branchLabel = if ($wt.Branch) { $wt.Branch } else { '<detached>' }
    $indexLabel = ''
    if ($wt.Branch) {
        $indexLabel = "[$optionIndex] "
    }
    Write-Host (" $marker $indexLabel$branchLabel -> $($wt.Path)")
    if ($wt.Branch) {
        $branchOptions += [pscustomobject]@{
            Index  = $optionIndex
            Branch = $wt.Branch
            Path   = $wt.Path
        }
        $optionIndex++
    }
}

$localBranchesWithoutWorktrees = $localBranches | Where-Object { -not $branchMap.ContainsKey($_) } | Sort-Object
if ($localBranchesWithoutWorktrees.Count -gt 0) {
    Write-Host ''
    Write-Host 'Local branches (no worktree yet):'
    foreach ($localBranch in $localBranchesWithoutWorktrees) {
        Write-Host ("  [$optionIndex] $localBranch")
        $branchOptions += [pscustomobject]@{
            Index  = $optionIndex
            Branch = $localBranch
            Path   = $null
        }
        $optionIndex++
    }
}

$defaultBase = "$remoteName/development"

if (-not $Branch) {
    if ($branchOptions.Count -gt 0) {
        $Branch = Read-Host 'Select branch by name or number (or enter a new branch)'
    }
    else {
        $Branch = Read-Host 'Enter a branch to create a new worktree for'
    }
}
$Branch = ($Branch ?? '').Trim()
if (-not $Branch) {
    Write-Error 'No branch supplied.'
    Set-Location $initialLocation
    exit 1
}
if ($Branch.StartsWith("$remoteName/")) {
    $Branch = $Branch.Substring($remoteName.Length + 1)
}

$selectedOption = $null
if ($Branch -match '^[0-9]+$') {
    $selectedOption = $branchOptions | Where-Object { $_.Index -eq [int]$Branch }
    if (-not $selectedOption) {
        Write-Error 'Invalid numeric selection.'
        Set-Location $initialLocation
        exit 1
    }
    $Branch = $selectedOption.Branch
}

$targetPath = $null
if ($selectedOption) {
    $targetPath = $selectedOption.Path
}
elseif ($branchMap.ContainsKey($Branch)) {
    $entries = $branchMap[$Branch]
    if ($entries.Count -gt 1) {
        Write-Host "Branch '$Branch' is checked out in multiple worktrees:"
        for ($i = 0; $i -lt $entries.Count; $i++) {
            Write-Host "  [$(($i + 1))] $($entries[$i].Path)"
        }
        $choice = Read-Host 'Choose a worktree number'
        if ($choice -match '^[0-9]+$' -and [int]$choice -ge 1 -and [int]$choice -le $entries.Count) {
            $targetPath = $entries[[int]$choice - 1].Path
        }
        else {
            Write-Error 'Invalid selection.'
            Set-Location $initialLocation
            exit 1
        }
    }
    else {
        $targetPath = $entries[0].Path
    }
}

if ($targetPath) {
    Write-Host ''
    Write-Host "Switching to branch '$Branch' at:"
    Write-Host "  $targetPath"
    Copy-EnvFileIfRequested -SourceRoot $repoRoot -TargetRoot $targetPath -Requested:$CopyEnv
    Set-Location $targetPath
    Write-Host ''
    Write-Host 'Status:'
    $summary = Invoke-Git @('status','-sb')
    foreach ($line in $summary) {
        Write-Host "  $line"
    }

    if (-not $SkipVSCode) {
        Open-VSCode -Path $targetPath -NewWindow:$NewVSCodeWindow
    }
    Activate-VirtualEnvironment
    if ($StartWorkspaceStack) {
        Start-WorkspaceStack -DataMode $Data
    }
    return
}

$sanitizedName = Get-SanitizedBranch $Branch
if (-not $sanitizedName) { $sanitizedName = 'worktree' }
$worktreeName = "nutrition-$sanitizedName"
$parentDir = Get-WorktreeParentDir -RepoRoot $repoRoot
if (-not $parentDir) { $parentDir = $repoRoot }
$defaultPath = Normalize-Path (Join-Path $parentDir $worktreeName)
if ($defaultPath -eq $repoRoot) {
    $defaultPath = Normalize-Path (Join-Path $parentDir ($worktreeName + '-worktree'))
}
$counter = 1
while (Test-Path $defaultPath) {
    $defaultPath = Normalize-Path (Join-Path $parentDir ("$worktreeName-$counter"))
    $counter++
}

while (-not $targetPath) {
    $pathInput = Read-Host "Branch '$Branch' has no worktree. Enter path for new worktree (default: $defaultPath)"
    if ([string]::IsNullOrWhiteSpace($pathInput)) {
        $targetPath = $defaultPath
    }
    else {
        if ([System.IO.Path]::IsPathRooted($pathInput)) {
            $candidate = Normalize-Path $pathInput
        }
        else {
            $candidate = Normalize-Path (Join-Path $parentDir $pathInput)
        }
        if (Test-Path $candidate) {
            Write-Host "Path '$candidate' already exists. Choose another location."
        }
        else {
            $targetPath = $candidate
        }
    }
}

$branchExists = Test-LocalBranch -Name $Branch
$shouldPushNewBranch = $false
if ($branchExists) {
    Write-Host "Creating new worktree for existing branch '$Branch'..."
    Invoke-Git @('worktree','add',$targetPath,$Branch) | Out-Null
}
else {
    $remoteBranchExists = Test-RemoteBranch -RemoteName $remoteName -Name $Branch
    $baseRef = $defaultBase
    $useTracking = $false
    $shouldPushNewBranch = -not $remoteBranchExists

    if ($remoteBranchExists) {
        $baseRef = "$remoteName/$Branch"
        $useTracking = $true
    }
    elseif (-not (Test-RemoteBranch -RemoteName $remoteName -Name 'development')) {
        throw "Cannot create '$Branch': required integration branch '$remoteName/development' was not found."
    }
    elseif (-not $baseRef) {
        Write-Host 'Aborting.'
        Set-Location $initialLocation
        exit 1
    }

    if ($useTracking) {
        Write-Host "Creating branch '$Branch' tracking '$baseRef' in new worktree..."
        Invoke-Git @('worktree','add','--track','-b',$Branch,$targetPath,$baseRef) | Out-Null
    }
    else {
        Write-Host "Creating branch '$Branch' from '$baseRef' in new worktree..."
        Invoke-Git @('worktree','add','-b',$Branch,$targetPath,$baseRef) | Out-Null
    }
}

if ($shouldPushNewBranch) {
    Write-Host "Pushing new branch '$Branch' to '$remoteName' and setting upstream..."
    Invoke-Git @('-C',$targetPath,'push','--set-upstream',$remoteName,$Branch) | Out-Null
}

Write-Host ''
Write-Host "Switched to new worktree for '$Branch':"
Write-Host "  $targetPath"
Copy-EnvFileIfRequested -SourceRoot $repoRoot -TargetRoot $targetPath -Requested:$CopyEnv
Set-Location $targetPath
Write-Host ''
Write-Host 'Status:'
$finalSummary = Invoke-Git @('status','-sb')
foreach ($line in $finalSummary) {
    Write-Host "  $line"
}

if (-not $SkipVSCode) {
    Open-VSCode -Path $targetPath -NewWindow:$NewVSCodeWindow
}
Activate-VirtualEnvironment
if ($StartWorkspaceStack) {
    Start-WorkspaceStack -DataMode $Data
}
