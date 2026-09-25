@echo off
chcp 65001 >nul 2>&1
setlocal

REM ==========================================================================
REM  Business OS release menu: the owner runs a whole release alone.
REM  Network check -> choose version (clean release folder) -> tests ->
REM  login check -> safety snapshot -> database updates -> publish ->
REM  live checks, plus Undo, the product-name export and the R2 steps.
REM  Every production step asks first. Every run writes a full log to
REM  <BusinessOS>\Records\Deploys\<date>-<commit>\ for Claude to read.
REM
REM  IMPORTANT: open Windows Terminal or PowerShell from the Start menu and
REM  run this there. Not from inside Claude, and not from Chrome: those go
REM  through the VPN, and Cloudflare blocks the VPN.
REM
REM    run\release.bat                      the menu
REM    run\release.bat release              the whole release in order
REM    run\release.bat -DryRun              walk the menu, print every command
REM    run\release.bat deploy -Plan free    one step, with options
REM  Implementation: ops\scripts\deploy-kit\release.cjs (see DEPLOY.md,
REM  "Release without Claude").
REM ==========================================================================

for %%I in ("%~dp0..") do set "ROOT=%%~fI"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install Node 24 LTS from https://nodejs.org and try again.
  if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
  exit /b 1
)

node "%ROOT%\ops\scripts\deploy-kit\release.cjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
