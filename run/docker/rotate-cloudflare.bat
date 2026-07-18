@echo off
chcp 65001 >nul 2>&1
setlocal
REM ==========================================================================
REM  Fetches a fresh Cloudflare Tunnel connector token from the Cloudflare
REM  API (using CLOUDFLARE_API_TOKEN) and writes it to the tunnel token
REM  file cloudflared authenticates with. This is the fix for an empty or
REM  stale connector token -- the most common cause of Cloudflare Error
REM  1033/530 (see run\docker\README.md).
REM  Also how you get your FIRST tunnel token on a brand-new machine.
REM  Safe to re-run, but each run invalidates the previous token, so
REM  restart with run\docker\start.bat right after.
REM ==========================================================================
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
node "%ROOT%\ops\scripts\runtime\cloudflare\rotate-cloudflare-tunnel-token.ts" --mode docker %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Cloudflare tunnel token rotation finished. Next: run run\docker\start.bat or restart Business OS.
) else (
  echo [ERROR] Cloudflare rotation failed. Check the API token permissions and ops\runtime\secrets.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
