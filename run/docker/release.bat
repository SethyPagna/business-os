@echo off
chcp 65001 >nul 2>&1
setlocal
REM ==========================================================================
REM  Builds a new versioned Docker image (tagged with the current backend
REM  version + timestamp) and assembles a portable release\business-os\
REM  folder you can copy or zip to another machine as a self-contained
REM  install (see README.md "Blank Windows Laptop To Running App").
REM  Does not affect any already-running containers on this machine.
REM ==========================================================================
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\docker-release.ps1" -Action Release %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Release command finished. Next: copy or sync release\business-os\ and run Start Business OS.bat.
) else (
  echo [ERROR] Release failed. Check ops\runtime\logs and fix verification failures.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
