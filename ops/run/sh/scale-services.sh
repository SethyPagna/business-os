#!/usr/bin/env sh
set -eu

ROOT="${BUSINESS_OS_REPO_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)}"
cd "$ROOT"

if [ "${1:-}" = "" ]; then
  echo "Usage: scale-services.sh up|down|status|logs"
  exit 2
fi

node ops/scripts/verify-scale-services.js --require --print-compose-command

export DOCKER_CONFIG="$ROOT/ops/runtime/docker-config"
mkdir -p "$DOCKER_CONFIG" "$ROOT/ops/runtime/secrets"
if [ -f "$ROOT/minio.license" ]; then
  cp "$ROOT/minio.license" "$ROOT/ops/runtime/secrets/minio.license"
elif [ ! -f "$ROOT/ops/runtime/secrets/minio.license" ]; then
  : > "$ROOT/ops/runtime/secrets/minio.license"
fi
export MINIO_LICENSE_HOST_FILE="$ROOT/ops/runtime/secrets/minio.license"

DOCKER_EXE="${DOCKER_EXE:-docker}"
COMPOSE="$ROOT/ops/docker/compose.scale.yml"

case "$1" in
  up)
    "$DOCKER_EXE" compose -f "$COMPOSE" up -d
    ;;
  down)
    "$DOCKER_EXE" compose -f "$COMPOSE" down
    ;;
  status)
    "$DOCKER_EXE" compose -f "$COMPOSE" ps
    ;;
  logs)
    "$DOCKER_EXE" compose -f "$COMPOSE" logs --tail=200
    ;;
  *)
    echo "Unknown command: $1"
    exit 2
    ;;
esac
