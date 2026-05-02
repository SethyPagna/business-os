@echo off
chcp 65001 >nul 2>&1
setlocal
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\docker-release.ps1" -Action Update %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Update command finished. Next: open Business OS and confirm the version.
) else (
  echo [ERROR] Update failed. Check rollback output and ops\runtime\logs, then run run\docker\doctor.bat.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
