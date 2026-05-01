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
  echo This is a support command. Everyday users should run run\start-server.bat.
  exit /b 2
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Scale -ScaleAction "%~1" -RequireServices
exit /b %ERRORLEVEL%
