@echo off
chcp 65001 >nul 2>&1
setlocal

if defined BUSINESS_OS_REPO_ROOT (
  set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
  for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=host"
if /I not "%MODE%"=="host" if /I not "%MODE%"=="docker" (
  echo Usage: run\cloudflare-origin.bat host^|docker [--dry-run]
  echo.
  echo   host   = Cloudflare Tunnel runs on Windows and routes to http://127.0.0.1:4000
  echo   docker = Cloudflare Tunnel runs inside Compose and routes to http://app:4000
  if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
  exit /b 2
)

shift
node "%ROOT%\ops\scripts\runtime\update-cloudflare-tunnel-origin.mjs" --mode "%MODE%" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Cloudflare origin update command finished. Next: restart Business OS.
) else (
  echo [ERROR] Cloudflare origin update failed. Check API token permissions and tunnel settings.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
