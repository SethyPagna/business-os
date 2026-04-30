#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export BUSINESS_OS_REPO_ROOT="${BUSINESS_OS_REPO_ROOT:-$SCRIPT_DIR}"
exec bash "$SCRIPT_DIR/ops/scripts/shell/setup.sh" "$@"
