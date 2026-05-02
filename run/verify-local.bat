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
echo [2/6] Ensuring frontend dependencies...
set "FRONTEND_INSTALL_MODE=install"
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$path='%ROOT%\frontend'; $stamp=Join-Path $path 'node_modules/.package-lock.json'; $lock=Join-Path $path 'package-lock.json'; $pkg=Join-Path $path 'package.json'; if ((Test-Path $stamp) -and (Test-Path $lock) -and (Test-Path $pkg)) { $latest = @((Get-Item $pkg).LastWriteTimeUtc, (Get-Item $lock).LastWriteTimeUtc) | Sort-Object -Descending | Select-Object -First 1; $installed = (Get-Item $stamp).LastWriteTimeUtc; if ($installed -ge $latest) { 'skip' } else { 'install' } } else { 'install' }"`) do set "FRONTEND_INSTALL_MODE=%%s"
if /i "!FRONTEND_INSTALL_MODE!"=="skip" (
  echo [OK] Frontend dependencies already up to date
) else (
  call npm.cmd install --prefer-offline --no-audit --loglevel=warn
  if errorlevel 1 exit /b 1
  echo [OK] Frontend dependencies installed
)
echo.
if "%SKIP_FRONTEND_BUILD%"=="0" (
  echo [2b/6] Building frontend...
  call npm.cmd run build
  if errorlevel 1 exit /b 1
  if not exist "%ROOT%\frontend\dist\index.html" (
    echo [ERROR] Frontend build did not produce frontend\dist\index.html.
    exit /b 1
  )
  echo [OK] Frontend build passed
  echo.
) else (
  echo [2b/6] Skipping frontend build ^(--skip-frontend-build^)
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
echo [5a/6] Ensuring backend dependencies...
set "BACKEND_INSTALL_MODE=install"
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$path='%ROOT%\backend'; $stamp=Join-Path $path 'node_modules/.package-lock.json'; $lock=Join-Path $path 'package-lock.json'; $pkg=Join-Path $path 'package.json'; if ((Test-Path $stamp) -and (Test-Path $lock) -and (Test-Path $pkg)) { $latest = @((Get-Item $pkg).LastWriteTimeUtc, (Get-Item $lock).LastWriteTimeUtc) | Sort-Object -Descending | Select-Object -First 1; $installed = (Get-Item $stamp).LastWriteTimeUtc; if ($installed -ge $latest) { 'skip' } else { 'install' } } else { 'install' }"`) do set "BACKEND_INSTALL_MODE=%%s"
if /i "!BACKEND_INSTALL_MODE!"=="skip" (
  echo [OK] Backend dependencies already up to date
) else (
  call npm.cmd install --prefer-offline --no-audit --loglevel=warn
  if errorlevel 1 exit /b 1
  echo [OK] Backend dependencies installed
)
echo.
echo [5b/6] Running backend utility/security/core tests...
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
