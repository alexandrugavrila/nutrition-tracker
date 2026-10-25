#!/usr/bin/env bash
# Same disposable validation entry point as the PowerShell wrapper.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
source "$REPO_ROOT/scripts/lib/venv.sh"
ensure_venv
npm --prefix Frontend run e2e:install
python -m testsupport.run_e2e "$@"
