@echo off
chcp 65001 >nul 2>&1
setlocal
REM ==========================================================================
REM  Creates a timestamped backup folder (Postgres dump + object storage
REM  manifest, and a MinIO archive if running in offline mode) under
REM  ops\runtime\docker-release\backups\. Restore it later with
REM  run\docker\restore.bat.
REM  Safe to run any time; does not stop or affect the running app.
REM ==========================================================================
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\docker-release.ps1" -Action Backup %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Backup command finished. Next: keep the backup folder safe or run run\docker\doctor.bat to verify runtime health.
) else (
  echo [ERROR] Backup failed. Check ops\runtime\logs and run run\docker\doctor.bat.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
