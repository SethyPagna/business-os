@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

if defined BUSINESS_OS_REPO_ROOT (
  set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
  for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if "%~1"=="" (
  echo Usage: scale-services.bat up^|down^|status^|logs
  echo.
  echo This is a legacy support command.
  echo Everyday users should run Start Business OS.bat.
  echo For diagnostics, run run\docker\doctor.bat.
  if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
  exit /b 2
)

echo [INFO] Legacy support command. Normal startup handles scale services automatically.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Scale -ScaleAction "%~1" -RequireServices
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Scale service support command finished.
) else (
  echo [ERROR] Scale service support command failed. Prefer run\docker\doctor.bat for full diagnostics.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
