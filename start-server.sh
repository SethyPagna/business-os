#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-server.sh — Start Business OS backend with PM2 (recommended) or Node.
#
# Usage:
#   ./start-server.sh          # start with PM2 (auto-installs if missing)
#   ./start-server.sh --node   # start directly with node (no PM2)
#   ./start-server.sh --check  # verify setup without starting
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
DATA_DIR="$SCRIPT_DIR/data"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Business OS — Server Setup & Start"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── 1. Ensure data directories exist ─────────────────────────────────────────
info "Ensuring data directories exist..."
mkdir -p "$DATA_DIR/db" "$DATA_DIR/uploads"
ok "Data dirs: $DATA_DIR/db  &  $DATA_DIR/uploads"

# ── 2. Check Node.js ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install from https://nodejs.org (v24+ required)"
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.version)")
ok "Node.js: $NODE_VER"

# ── 3. Install backend dependencies ──────────────────────────────────────────
if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  info "Installing backend dependencies..."
  (cd "$BACKEND_DIR" && npm install --omit=dev)
  ok "Backend dependencies installed"
else
  ok "Backend node_modules: present"
fi

# ── 4. Check frontend build ───────────────────────────────────────────────────
if [ ! -f "$FRONTEND_DIR/dist/index.html" ]; then
  warn "Frontend dist not found — building now (this takes ~30 s)..."
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "Installing frontend dependencies..."
    (cd "$FRONTEND_DIR" && npm install)
  fi
  (cd "$FRONTEND_DIR" && npm run build)
  ok "Frontend built successfully"
else
  ok "Frontend dist: $FRONTEND_DIR/dist/index.html"
fi

# ── 5. Verify .env ────────────────────────────────────────────────────────────
ENV_FILE="$BACKEND_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env: $ENV_FILE"
  TAILSCALE=$(grep -E '^TAILSCALE_URL=' "$ENV_FILE" | cut -d= -f2-)
  if [ -n "$TAILSCALE" ]; then
    ok "Tailscale URL: $TAILSCALE"
  else
    warn "TAILSCALE_URL not set — run: tailscale funnel --bg 4000  then add to .env"
  fi
else
  warn ".env not found at $ENV_FILE — server will use default settings"
fi

# ── 6. Check or create logs directory ────────────────────────────────────────
mkdir -p "$SCRIPT_DIR/ops/runtime/logs"

# ── 7. Start the server ───────────────────────────────────────────────────────
if [[ "${1:-}" == "--check" ]]; then
  ok "Setup check complete — not starting server (--check flag)"
  exit 0
fi

if [[ "${1:-}" == "--node" ]]; then
  info "Starting with Node.js directly..."
  cd "$SCRIPT_DIR"
  exec node "$BACKEND_DIR/server.js"
fi

# Default: use PM2
if ! command -v pm2 &>/dev/null; then
  warn "PM2 not found — installing globally..."
  npm install -g pm2
fi

ECOSYSTEM="$SCRIPT_DIR/ops/config/ecosystem.config.js"
if [ ! -f "$ECOSYSTEM" ]; then
  error "ecosystem.config.js not found at $ECOSYSTEM"
  exit 1
fi

info "Starting with PM2..."
cd "$SCRIPT_DIR"

# Stop previous instance if running (ignore error if not running)
pm2 stop business-os 2>/dev/null || true
pm2 delete business-os 2>/dev/null || true

pm2 start "$ECOSYSTEM"
pm2 save

echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "${GREEN}  ✅ Business OS is running!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
PORT=$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || echo "4000")
echo "  Local URL:  http://localhost:${PORT:-4000}"
TAILSCALE=$(grep -E '^TAILSCALE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
if [ -n "$TAILSCALE" ]; then
  echo "  Remote URL: $TAILSCALE"
fi
echo ""
echo "  Default login: admin / admin"
echo "  View logs:     pm2 logs business-os"
echo "  Stop server:   pm2 stop business-os"
echo ""
