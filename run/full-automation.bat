@echo off
chcp 65001 >nul 2>&1
setlocal

REM ==========================================================================
REM  Runs the full Cloudflare release pipeline in one step: typecheck ->
REM  build frontend -> apply remote D1 migrations -> wrangler deploy -> live
REM  health check against the real Workers URL. Intended for cutting a new
REM  release and deploying it in one command. See
REM  ops\scripts\powershell\full-automation.ps1 for the implementation.
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
