@echo off
chcp 65001 >nul 2>&1
setlocal

REM ==========================================================================
REM  Runs the full local verification suite, then builds and starts a new
REM  Docker release image in one step (verify -> docker-release.ps1 -Action
REM  Release -> docker-release.ps1 -Action Start). Intended for cutting a
REM  new versioned release and deploying it locally in one command.
REM  Takes longer than run\docker\update.bat -- use that instead for a
REM  routine "pull latest and restart".
REM ==========================================================================

if defined BUSINESS_OS_REPO_ROOT (
  set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
  for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\full-automation.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Full Business OS automation finished.
) else (
  echo [ERROR] Full Business OS automation failed. Review the step above.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
