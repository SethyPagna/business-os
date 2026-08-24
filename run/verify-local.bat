@echo off
chcp 65001 >nul 2>&1
setlocal

REM ==========================================================================
REM  Local-only counterpart to full-automation.bat: remove stray files ->
REM  install frontend + Cloudflare Worker dependencies -> typecheck both ->
REM  run the pure-logic test suites -> build the frontend. Never calls
REM  wrangler, never touches D1, never pushes secrets, never deploys -- use
REM  this after pulling in a change to confirm it actually installs,
REM  typechecks, passes its tests, and builds, without cutting a release.
REM  See ops\scripts\powershell\verify-local.ps1 for the implementation.
REM  For an actual release, use run\full-automation.bat instead.
REM ==========================================================================

if defined BUSINESS_OS_REPO_ROOT (
  set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
  for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\verify-local.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Local verify finished - nothing was deployed.
) else (
  echo [ERROR] Local verify failed. Review the step above.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
