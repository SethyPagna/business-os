#!/usr/bin/env bash
# ============================================================
#  Business OS | Stop Server (Step 3 of 3)
# ============================================================

ROOT="$(cd "$(dirname "$0")" && pwd)"
KILLED=0

echo ""
echo "========================================================================"
echo "  Business OS  |  Stop Server  (Step 3 of 3)"
echo "========================================================================"
echo ""

# ---- Step 1: Stop and remove PM2 app ---------------------------------------
if command -v pm2 &>/dev/null; then
    echo "[INFO] Stopping PM2 app..."
    pm2 stop   business-os 2>/dev/null || true
    pm2 delete business-os 2>/dev/null || true
    pm2 flush  business-os 2>/dev/null || true
    pm2 kill                2>/dev/null || true
    echo "[OK]  PM2 stopped and flushed"
else
    echo "[INFO] PM2 not found — skipping"
fi

# ---- Step 2: Kill anything on port 4000 ------------------------------------
echo ""
echo "[INFO] Releasing port 4000..."
PIDS=$(lsof -ti tcp:4000 2>/dev/null || true)
if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
    echo "[OK]  Killed processes on port 4000: $PIDS"
    KILLED=1
else
    echo "[INFO] Nothing on port 4000"
fi

# ---- Step 3: Kill all node server.js processes -----------------------------
echo ""
echo "[INFO] Stopping all node server.js processes..."
SERVER_PIDS=$(pgrep -f "node.*server\.js" 2>/dev/null || true)
if [ -n "$SERVER_PIDS" ]; then
    echo "$SERVER_PIDS" | xargs kill -9 2>/dev/null || true
    echo "[OK]  Killed node server.js PIDs: $SERVER_PIDS"
    KILLED=1
else
    echo "[INFO] No node server.js processes found"
fi

# ---- Step 4: Stop Tailscale Funnel -----------------------------------------
echo ""
echo "[INFO] Stopping Tailscale Funnel..."
if command -v tailscale &>/dev/null; then
    tailscale funnel --bg off 2>/dev/null || true
    echo "[OK]  Tailscale Funnel stopped"
else
    echo "[INFO] Tailscale not found — skipping"
fi

# ---- Done ------------------------------------------------------------------
echo ""
if [ "$KILLED" -eq 1 ]; then
    echo "[DONE] Business OS server stopped."
else
    echo "[DONE] No running server found."
fi
echo ""
