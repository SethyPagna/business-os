#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUSINESS_OS_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
RUNTIME_DIR="$ROOT/ops/runtime"
LOG_DIR="$RUNTIME_DIR/logs"
DATA_DIR="$HOME/business-os-data"
ENV_FILE="$BACKEND_DIR/.env"
ECOSYSTEM="$ROOT/ops/config/ecosystem.config.js"

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
mkdir -p "$DATA_DIR/db" "$DATA_DIR/uploads" "$LOG_DIR"
ok "Data dirs ready"

if ! command -v node &>/dev/null; then
  error "Node.js not found. Install from https://nodejs.org (v24+ required)"
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.version)")
ok "Node.js: $NODE_VER"

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
  warn "PM2 not found - installing globally..."
  npm install -g pm2
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
echo "  Local URL: http://localhost:${PORT}"
echo ""
