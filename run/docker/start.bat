@echo off
chcp 65001 >nul 2>&1
setlocal
REM ==========================================================================
REM  Starts the Docker release runtime: Postgres, Redis, R2/offline object
REM  storage, the app, the import/media workers, and the Cloudflare Tunnel.
REM  Requires: run\docker\install.bat to have been run at least once (this
REM  runs it again anyway if the env file is missing).
REM  Safe to re-run any time -- uses "docker compose up -d", which is
REM  idempotent: containers already running are left alone.
REM ==========================================================================
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\docker-release.ps1" -Action Start %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Docker start command finished. Next: open https://admin.leangcosmetics.dpdns.org or https://leangcosmetics.dpdns.org/public.
) else (
  echo [ERROR] Docker start failed. Run run\docker\doctor.bat and check ops\runtime\logs.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
