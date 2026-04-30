#!/usr/bin/env bash
set -euo pipefail

ROOT="${BUSINESS_OS_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
DATA_DIR="$HOME/business-os-data"
ENV_FILE="$ROOT/backend/.env"

echo ""
echo "========================================================================"
echo "  Business OS  |  Setup  (Step 1 of 3)"
echo "========================================================================"
echo ""
echo "  Run this once to install dependencies and build the app."
echo "  After setup completes, use ./start-server.sh to launch."
echo ""

if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found."
  echo "        Install from: https://nodejs.org (LTS version)"
  exit 1
fi
NODE_VER=$(node --version)
echo "[OK] Node.js $NODE_VER"

echo ""
echo "[INFO] Creating data directories..."
mkdir -p "$DATA_DIR/db" "$DATA_DIR/uploads"
echo "       DB:      $DATA_DIR/db/business.db"
echo "       Uploads: $DATA_DIR/uploads"

echo ""
echo "[INFO] Writing backend configuration..."

EXISTING_TOKEN=""
if [ -f "$ENV_FILE" ]; then
  EXISTING_TOKEN=$(grep -i "^SYNC_TOKEN" "$ENV_FILE" | cut -d= -f2- || true)
fi

cat > "$ENV_FILE" <<ENVEOF
# Business OS - Backend Configuration
# Written by ops/run/sh/setup.sh

PORT=4000

# Your Tailscale Funnel URL (filled by start-server.sh if Tailscale is installed)
TAILSCALE_URL=

# Leave blank - Tailscale handles security.
SYNC_TOKEN=$EXISTING_TOKEN

DB_PATH=$DATA_DIR/db/business.db
UPLOADS_PATH=$DATA_DIR/uploads
ENVEOF
echo "[OK] Written: $ENV_FILE"

echo ""
echo "[INFO] Installing backend dependencies..."
cd "$ROOT/backend"
npm install --loglevel=warn
echo "[OK] Backend ready"

echo ""
echo "[INFO] Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install --loglevel=warn
echo ""
echo "[INFO] Building frontend..."
npm run build
echo "[OK] Frontend built"

echo ""
echo "[INFO] Checking PM2..."
if ! command -v pm2 &>/dev/null; then
  echo "[INFO] PM2 is not installed. This is optional."
  echo "[INFO] start-server.sh will run with Node.js directly unless you install PM2 manually."
else
  echo "[OK] PM2 already installed"
fi

echo ""
echo "========================================================================"
echo "  SETUP COMPLETE"
echo "========================================================================"
echo ""
echo "  Next steps:"
echo "    1. Run ./start-server.sh to launch the server"
echo "    2. Open http://localhost:4000 in your browser"
echo "    3. Login with: admin / admin"
echo ""
echo "  Data stored at: $DATA_DIR"
echo ""
