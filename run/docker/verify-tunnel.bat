@echo off
chcp 65001 >nul 2>&1
setlocal
REM ==========================================================================
REM  Runs only the Cloudflare Tunnel health check (a subset of what
REM  doctor.bat does): config presence, connector token file, active
REM  connector state via the Cloudflare API, ingress routes, the
REM  cloudflared container's own status/logs, and (if cloudflared supports
REM  it) its native network connectivity pre-check.
REM  Read-only -- makes no changes. Use this for a fast recheck after
REM  fixing something, instead of the full doctor.bat pass.
REM ==========================================================================
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
node "%ROOT%\ops\scripts\runtime\cloudflare\verify-cloudflare-tunnel.ts" --output "%ROOT%\ops\runtime\docker-release\cloudflare-tunnel-verify.json" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Cloudflare Tunnel is healthy: an active connector is registered and both hostnames are routed.
) else (
  echo [ERROR] Cloudflare Tunnel diagnostic failed. See the [FAIL] lines above for the specific cause and fix.
  echo         Common fixes: run\docker\rotate-cloudflare.bat to fetch a fresh tunnel token, or
  echo         run\docker\start.bat to restart the cloudflared container.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
