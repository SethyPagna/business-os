@echo off
chcp 65001 >nul 2>&1
setlocal
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
