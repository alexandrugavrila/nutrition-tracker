<#
.SYNOPSIS
    Build and publish immutable backend/frontend images for a release tag.

.DESCRIPTION
    Reads registry credentials and image repositories from environment variables,
    `.env.publish`, or `.env`, shows the latest 3 local git tags as release
    hints, optionally prompts for a new tag, then builds and pushes the backend
    and frontend images using the same Dockerfiles used by CI.

.PARAMETER Tag
    Release tag to publish. If omitted, the script shows the latest 3 local git
    tags and prompts interactively.

.PARAMETER CreateGitTag
    Deprecated compatibility switch. A matching annotated local git tag is now
    always required and created before image builds.

.PARAMETER PushGitTag
    Deprecated compatibility switch. The matching git tag is always pushed to
    origin after both images build and before either image is pushed.
#>
[CmdletBinding()]
param(
  [string]$Tag,
  [switch]$CreateGitTag,
  [switch]$PushGitTag
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/../lib/publish-utils.ps1"

$repoRoot = Get-PublishRepoRoot
Set-Location $repoRoot

$resolvedTag = Resolve-ReleaseTag -Tag $Tag
$null = $CreateGitTag # Retained for CLI compatibility; tags are now always created.
$null = $PushGitTag # Retained for CLI compatibility; remote tag publication is mandatory.
Assert-PublishReleaseSource -Tag $resolvedTag
Ensure-ReleaseGitTag -Tag $resolvedTag
$images = Get-PublishImageReferences -Tag $resolvedTag

Write-Host "Publishing release tag '$resolvedTag'"
Write-Host "  Backend:  $($images.BackendImage)"
Write-Host "  Frontend: $($images.FrontendImage)"

Invoke-RegistryLogin -Registry $images.Registry
Invoke-PublishBuild -Images $images
Ensure-ReleaseGitTag -Tag $resolvedTag -Push
Invoke-PublishPush -Images $images

Write-Host "Publish complete."
Write-Host "Next deploy command:"
Write-Host "  pwsh ./scripts/prod/deploy.ps1 -Tag $resolvedTag"
