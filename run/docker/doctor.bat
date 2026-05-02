@echo off
chcp 65001 >nul 2>&1
setlocal
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
