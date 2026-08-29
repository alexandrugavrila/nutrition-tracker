#!/usr/bin/env bash
# Shared helpers for manually building and publishing immutable application images.

set -euo pipefail

publish_repo_root() {
  (
    cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
  )
}

publish_get_env_value() {
  local key=$1 optional=${2:-false}
  local value

  value="${!key:-}"
  if [[ -n "$value" ]]; then
    printf '%s\n' "$value"
    return 0
  fi

  local candidate line
  for candidate in ".env.publish" ".env"; do
    local path
    path="$(publish_repo_root)/$candidate"
    [[ -f "$path" ]] || continue

    while IFS= read -r line || [[ -n "$line" ]]; do
      case "$line" in
        "$key"=*)
          printf '%s\n' "${line#*=}"
          return 0
          ;;
      esac
    done <"$path"
  done

  if [[ "$optional" == true ]]; then
    return 0
  fi

  echo "Required setting '$key' was not found in the environment, .env.publish, or .env." >&2
  return 1
}

publish_recent_tags() {
  git -C "$(publish_repo_root)" tag --sort=-creatordate 2>/dev/null | head -n 3
}

publish_is_interactive() {
  [[ -t 0 && -t 1 ]]
}

publish_resolve_tag() {
  local provided=${1:-}
  if [[ -n "$provided" ]]; then
    printf '%s\n' "$provided"
    return 0
  fi

  local recent
  recent="$(publish_recent_tags)"
  if [[ -n "${recent//[[:space:]]/}" ]]; then
    echo "Latest 3 release tags:"
    while IFS= read -r tag || [[ -n "$tag" ]]; do
      [[ -z "$tag" ]] && continue
      echo "  $tag"
    done <<<"$recent"
  else
    echo "No existing git tags were found in this repository."
  fi

  if ! publish_is_interactive; then
    echo "No tag was provided and the shell is non-interactive. Supply a tag explicitly." >&2
    return 1
  fi

  local input_tag=""
  read -r -p "Enter the new image tag to publish: " input_tag
  if [[ -z "$input_tag" ]]; then
    echo "A non-empty tag is required." >&2
    return 1
  fi

  printf '%s\n' "$input_tag"
}

publish_assert_release_source() {
  local tag=$1 repo_root branch status head origin_main development parent_line
  local -a parents
  repo_root="$(publish_repo_root)"
  git -C "$repo_root" check-ref-format "refs/tags/$tag"
  branch="$(git -C "$repo_root" branch --show-current)"
  if [[ "$branch" != "main" ]]; then
    echo "Releases must be published from main. Current branch: '$branch'." >&2
    return 1
  fi

  status="$(git -C "$repo_root" status --porcelain)"
  if [[ -n "$status" ]]; then
    echo "Release publishing requires a clean main worktree. Commit or stash local changes first." >&2
    return 1
  fi

  git -C "$repo_root" fetch --no-tags origin \
    '+refs/heads/main:refs/remotes/origin/main' \
    '+refs/heads/development:refs/remotes/origin/development'
  head="$(git -C "$repo_root" rev-parse 'HEAD^{commit}')"
  origin_main="$(git -C "$repo_root" rev-parse 'origin/main^{commit}')"
  if [[ "$head" != "$origin_main" ]]; then
    echo "Local main must exactly match origin/main before publishing. HEAD=$head origin/main=$origin_main" >&2
    return 1
  fi

  development="$(git -C "$repo_root" rev-parse 'origin/development^{commit}')"
  parent_line="$(git -C "$repo_root" rev-list --parents -n 1 "$head")"
  read -r -a parents <<<"$parent_line"
  if [[ ${#parents[@]} -ne 3 || "${parents[2]}" != "$development" ]]; then
    echo "HEAD must be the two-parent development -> main release merge, with origin/development as its second parent." >&2
    return 1
  fi

  if git -C "$repo_root" show-ref --verify --quiet "refs/tags/$tag"; then
    local tag_commit
    tag_commit="$(git -C "$repo_root" rev-parse "$tag^{commit}")"
    if [[ "$tag_commit" != "$head" ]]; then
      echo "Release tag '$tag' already points to $tag_commit, not HEAD $head." >&2
      return 1
    fi
  fi
}

publish_registry_host() {
  local image_repository=$1 configured first_segment
  configured="$(publish_get_env_value CONTAINER_REGISTRY true || true)"
  if [[ -n "$configured" ]]; then
    printf '%s\n' "$configured"
    return 0
  fi

  first_segment="${image_repository%%/*}"
  if [[ "$first_segment" == *.* || "$first_segment" == *:* || "$first_segment" == "localhost" ]]; then
    printf '%s\n' "$first_segment"
  else
    printf 'docker.io\n'
  fi
}

publish_registry_login() {
  local registry=$1 username token
  username="$(publish_get_env_value CONTAINER_REGISTRY_USERNAME)"
  token="$(publish_get_env_value CONTAINER_REGISTRY_TOKEN)"

  echo "Logging into container registry '$registry'..."
  printf '%s' "$token" | docker login "$registry" --username "$username" --password-stdin
}

publish_build_images() {
  local backend_image=$1 frontend_image=$2 repo_root
  repo_root="$(publish_repo_root)"

  (
    cd "$repo_root"
    echo "Building backend image: $backend_image"
    docker build -f Backend/Dockerfile --target prod -t "$backend_image" .
    echo "Building frontend image: $frontend_image"
    docker build -f Frontend/Dockerfile -t "$frontend_image" .
  )
}

publish_push_images() {
  local backend_image=$1 frontend_image=$2

  echo "Pushing backend image: $backend_image"
  docker push "$backend_image"
  echo "Pushing frontend image: $frontend_image"
  docker push "$frontend_image"
}

publish_ensure_git_tag() {
  local tag=$1 push_tag=${2:-false} repo_root existing
  repo_root="$(publish_repo_root)"
  existing="$(git -C "$repo_root" tag --list "$tag" 2>/dev/null || true)"

  if [[ -z "$existing" ]]; then
    echo "Creating annotated git tag '$tag'..."
    git -C "$repo_root" tag -a -m "Release $tag" -- "$tag"
  else
    local tag_commit head_commit
    tag_commit="$(git -C "$repo_root" rev-parse "$tag^{commit}")"
    head_commit="$(git -C "$repo_root" rev-parse 'HEAD^{commit}')"
    if [[ "$tag_commit" != "$head_commit" ]]; then
      echo "Git tag '$tag' points to $tag_commit, not HEAD $head_commit." >&2
      return 1
    fi
    echo "Git tag '$tag' already exists locally and points to HEAD."
  fi

  if [[ "$push_tag" == true ]]; then
    echo "Pushing git tag '$tag' to origin..."
    git -C "$repo_root" push origin "refs/tags/$tag"
  fi
}
