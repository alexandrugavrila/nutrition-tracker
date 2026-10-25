#!/usr/bin/env bash
# Shared staged implementation; see docs/release-cutover.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec "${PYTHON:-python3}" "$ROOT/scripts/prod/cutover.py" "$@"
