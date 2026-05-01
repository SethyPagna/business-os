@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

if defined BUSINESS_OS_REPO_ROOT (
  set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
  for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "SKIP_FRONTEND_BUILD=0"

:parse_args
if "%~1"=="" goto after_args
if /i "%~1"=="--skip-frontend-build" (
  set "SKIP_FRONTEND_BUILD=1"
  shift
  goto parse_args
)
shift
goto parse_args

:after_args
echo.
echo ========================================================================
echo   Business OS ^| Local Verification
echo ========================================================================
echo.

cd /d "%ROOT%"

echo [1/6] Verifying tracked runtime dependencies...
node ops\scripts\verify-runtime-deps.js
if errorlevel 1 exit /b 1
echo [OK] Runtime dependency manifest check passed
echo.

echo [1a/6] Verifying Docker-only release automation...
node ops\scripts\verify-docker-release.js
if errorlevel 1 exit /b 1
echo [OK] Docker-only release automation check passed
echo.

echo [1b/6] Verifying required Docker scale services...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Verify -RequireServices
if errorlevel 1 exit /b 1
echo [OK] Required scale services are ready
echo.

cd /d "%ROOT%\frontend"
if "%SKIP_FRONTEND_BUILD%"=="0" (
  echo [2/6] Building frontend...
  call npm.cmd run build
  if errorlevel 1 exit /b 1
  echo [OK] Frontend build passed
  echo.
) else (
  echo [2/6] Skipping frontend build ^(--skip-frontend-build^)
  echo.
)

echo [3/6] Running frontend utility tests...
call npm.cmd run test:utils
if errorlevel 1 exit /b 1
echo [OK] Frontend utility tests passed
echo.

echo [4/6] Verifying frontend i18n...
call npm.cmd run verify:i18n
if errorlevel 1 exit /b 1
echo [OK] Frontend i18n verification passed
echo.

echo [4b/6] Verifying frontend UI coverage...
call npm.cmd run verify:ui
if errorlevel 1 exit /b 1
echo [OK] Frontend UI coverage verification passed
echo.

echo [4c/6] Verifying frontend performance guardrails...
call npm.cmd run verify:performance
if errorlevel 1 exit /b 1
echo [OK] Frontend performance guardrails passed
echo.

cd /d "%ROOT%\backend"
echo [5/6] Running backend utility/security/core tests...
call npm.cmd run test:utils
if errorlevel 1 exit /b 1
echo [OK] Backend utility/security/core tests passed
echo.

echo [6/6] Verifying backend data integrity...
call npm.cmd run verify:integrity
if errorlevel 1 exit /b 1
echo [OK] Backend data integrity verification passed
echo.

echo ========================================================================
echo   VERIFICATION PASSED
echo ========================================================================
echo.
exit /b 0
