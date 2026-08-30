#!/usr/bin/env bash
# Build and publish immutable backend/frontend images for a release tag.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: ./scripts/prod/publish.sh [<tag>] [--create-git-tag] [--push-git-tag]

Requires a clean, synchronized main release merge, creates or verifies the
matching annotated git tag locally and on origin, reads registry settings from
the environment, .env.publish, or .env, then builds and pushes both application
images. The tag-related switches are retained only for compatibility.
USAGE
}

TAG=""
CREATE_GIT_TAG=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --create-git-tag)
      CREATE_GIT_TAG=true
      ;;
    --push-git-tag)
      # Retained for compatibility; remote tag publication is mandatory.
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      usage
      exit 1
      ;;
    *)
      if [[ -n "$TAG" ]]; then
        usage
        exit 1
      fi
      TAG="$1"
      ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck disable=SC1090
source "$REPO_ROOT/scripts/lib/publish-utils.sh"

cd "$REPO_ROOT"

resolved_tag="$(publish_resolve_tag "$TAG")"
if [[ "$CREATE_GIT_TAG" == true ]]; then
  echo "--create-git-tag is retained for compatibility; a local release tag is now always created."
fi
publish_assert_release_source "$resolved_tag"
publish_ensure_git_tag "$resolved_tag" false
backend_repo="$(publish_get_env_value BACKEND_IMAGE_REPO)"
frontend_repo="$(publish_get_env_value FRONTEND_IMAGE_REPO)"
backend_image="${backend_repo}:${resolved_tag}"
frontend_image="${frontend_repo}:${resolved_tag}"
registry="$(publish_registry_host "$backend_repo")"

echo "Publishing release tag '$resolved_tag'"
echo "  Backend:  $backend_image"
echo "  Frontend: $frontend_image"

publish_registry_login "$registry"
publish_build_images "$backend_image" "$frontend_image"
publish_ensure_git_tag "$resolved_tag" true
publish_push_images "$backend_image" "$frontend_image"

echo "Publish complete."
echo "Next deploy command:"
echo "  ./scripts/prod/deploy.sh $resolved_tag"
