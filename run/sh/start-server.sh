#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUSINESS_OS_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
RUNTIME_DIR="$ROOT/ops/runtime"
LOG_DIR="$RUNTIME_DIR/logs"
DATA_DIR="$ROOT/business-os-data"
ENV_FILE="$BACKEND_DIR/.env"
ECOSYSTEM="$ROOT/ops/config/ecosystem.config.js"
PUBLIC_CHECK_SCRIPT="$ROOT/ops/scripts/runtime/check-public-url.mjs"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

echo ""
echo "=============================================================="
echo "  Business OS - Server Setup & Start"
echo "=============================================================="
echo ""

info "Ensuring data directories exist..."
mkdir -p "$DATA_DIR/organizations" "$LOG_DIR"
ok "Data dirs ready"

if ! command -v node &>/dev/null; then
  error "Node.js not found. Install from https://nodejs.org (v24+ required)"
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.version)")
ok "Node.js: $NODE_VER"

export BUSINESS_OS_REQUIRE_SCALE_SERVICES=1
export JOB_QUEUE_DRIVER="${JOB_QUEUE_DRIVER:-bullmq}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export RUNTIME_CACHE_ENABLED="${RUNTIME_CACHE_ENABLED:-1}"
export CACHE_REDIS_URL="${CACHE_REDIS_URL:-redis://127.0.0.1:6380}"
export DATABASE_DRIVER="${DATABASE_DRIVER:-sqlite}"
export OBJECT_STORAGE_DRIVER="${OBJECT_STORAGE_DRIVER:-local}"
export SQLITE_BUSY_TIMEOUT_MS="${SQLITE_BUSY_TIMEOUT_MS:-30000}"
export SQLITE_CACHE_SIZE_KB="${SQLITE_CACHE_SIZE_KB:-196608}"
export SQLITE_MMAP_SIZE_MB="${SQLITE_MMAP_SIZE_MB:-1024}"
export SQLITE_WAL_AUTOCHECKPOINT="${SQLITE_WAL_AUTOCHECKPOINT:-4000}"
export SQLITE_JOURNAL_SIZE_LIMIT_MB="${SQLITE_JOURNAL_SIZE_LIMIT_MB:-128}"
export SQLITE_SYNCHRONOUS="${SQLITE_SYNCHRONOUS:-NORMAL}"
export IMPORT_QUEUE_CONCURRENCY="${IMPORT_QUEUE_CONCURRENCY:-1}"
export MEDIA_QUEUE_CONCURRENCY="${MEDIA_QUEUE_CONCURRENCY:-4}"
export IMPORT_ROW_BATCH_SIZE="${IMPORT_ROW_BATCH_SIZE:-400}"
export IMPORT_BATCH_PAUSE_MS="${IMPORT_BATCH_PAUSE_MS:-20}"
export IMPORT_IMAGE_CONCURRENCY="${IMPORT_IMAGE_CONCURRENCY:-4}"
export UPLOAD_CHUNK_MB="${UPLOAD_CHUNK_MB:-12}"

info "Skipping shell scale-service bootstrap."
warn "Windows launchers now own Docker service startup automatically."

if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  info "Installing backend dependencies..."
  (cd "$BACKEND_DIR" && npm install --omit=dev)
  ok "Backend dependencies installed"
else
  ok "Backend node_modules present"
fi

if [ ! -f "$FRONTEND_DIR/dist/index.html" ]; then
  warn "Frontend dist not found - building now..."
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
  fi
  (cd "$FRONTEND_DIR" && npm run build)
  ok "Frontend built successfully"
else
  ok "Frontend dist present"
fi

if [ -f "$ENV_FILE" ]; then
  ok ".env: $ENV_FILE"
else
  warn ".env not found at $ENV_FILE - server will use default settings"
fi

if [[ "${1:-}" == "--check" ]]; then
  ok "Setup check complete - not starting server (--check flag)"
  exit 0
fi

if [[ "${1:-}" == "--node" ]]; then
  info "Starting with Node.js directly..."
  cd "$ROOT"
  exec node "$BACKEND_DIR/server.js"
fi

if ! command -v pm2 &>/dev/null; then
  warn "PM2 not found - running with Node.js directly"
  warn "start-server.sh does not install global packages automatically"
  cd "$ROOT"
  exec node "$BACKEND_DIR/server.js"
fi

if [ ! -f "$ECOSYSTEM" ]; then
  error "ecosystem config not found at $ECOSYSTEM"
  exit 1
fi

info "Starting with PM2..."
cd "$ROOT"
pm2 stop business-os 2>/dev/null || true
pm2 delete business-os 2>/dev/null || true
pm2 start "$ECOSYSTEM"
pm2 save

echo ""
echo "=============================================================="
echo -e "${GREEN}  Business OS is running${NC}"
echo "=============================================================="
echo ""
PORT=$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "4000")
TAILSCALE_URL=$(grep -E '^TAILSCALE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
CUSTOMER_PORTAL_PATH=$(node -e "fetch('http://127.0.0.1:' + process.argv[1] + '/api/portal/config').then(r => r.ok ? r.json() : null).then(cfg => { const path = String(cfg?.publicPath || '/customer-portal'); process.stdout.write(path.startsWith('/') ? path : '/' + path); }).catch(() => process.stdout.write('/customer-portal'))" "$PORT")
echo "  Local URL: http://localhost:${PORT}"
echo "  Local Portal: http://localhost:${PORT}${CUSTOMER_PORTAL_PATH}"
if command -v tailscale &>/dev/null; then
  info "Ensuring Tailscale Funnel targets the local backend..."
  tailscale funnel --bg --yes "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || warn "Tailscale Funnel command failed"
fi
if [ -n "${TAILSCALE_URL:-}" ] && [ -f "$PUBLIC_CHECK_SCRIPT" ]; then
  info "Verifying public URL with Node HTTPS..."
  if node "$PUBLIC_CHECK_SCRIPT" "$TAILSCALE_URL" "$CUSTOMER_PORTAL_PATH"; then
    ok "Public URL verification passed"
    echo "  Remote Admin: ${TAILSCALE_URL}"
    echo "  Customer URL: ${TAILSCALE_URL%/}${CUSTOMER_PORTAL_PATH}"
  else
    warn "Public URL verification failed"
    if command -v tailscale &>/dev/null; then
      info "Resetting stale Tailscale Serve/Funnel config and retrying..."
      tailscale serve reset >/dev/null 2>&1 || true
      tailscale funnel --bg --yes "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true
      if node "$PUBLIC_CHECK_SCRIPT" "$TAILSCALE_URL" "$CUSTOMER_PORTAL_PATH"; then
        ok "Public URL verification passed after Tailscale reset"
        echo "  Remote Admin: ${TAILSCALE_URL}"
        echo "  Customer URL: ${TAILSCALE_URL%/}${CUSTOMER_PORTAL_PATH}"
      else
        warn "Public URL verification still failed after Tailscale reset"
      fi
    fi
  fi
fi
echo ""
