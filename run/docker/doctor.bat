@echo off
chcp 65001 >nul 2>&1
setlocal
REM ==========================================================================
REM  Full read-only-plus-self-healing diagnostic pass: Docker engine
REM  readiness, the external data volume, the env file, compose config
REM  validity, container status, Postgres schema readiness, and Cloudflare
REM  Tunnel connectivity (token file, active connector, ingress routes, and
REM  network-level reachability).
REM  Safe to run any time, as often as you like -- it only reads state and
REM  fixes clearly-safe gaps (e.g. creating a missing volume); it never
REM  touches your data.
REM ==========================================================================
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\docker-release.ps1" -Action Doctor %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Doctor command finished. Next: run Start Business OS.bat to launch.
) else (
  echo [ERROR] Doctor found a problem. Check the messages above and ops\runtime\logs.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
