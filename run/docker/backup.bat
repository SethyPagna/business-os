@echo off
chcp 65001 >nul 2>&1
setlocal
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
