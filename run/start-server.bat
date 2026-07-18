@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Source Runtime Launcher (compatibility shim)
REM
REM  Business OS runs on Docker now (Postgres + Redis + R2/MinIO + Cloudflare
REM  Tunnel). This file exists so older shortcuts/scripts that call
REM  run\start-server.bat keep working. It forwards straight to
REM  run\docker\start.bat, which is the real, supported entry point.
REM
REM  Use "Start Business OS.bat" or run\docker\start.bat directly instead.
REM ========================================================================

if defined BUSINESS_OS_REPO_ROOT (
    set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
    for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo [INFO] Business OS is Docker/Postgres/R2 object storage by default; MinIO is offline emergency mode.
echo        This support launcher is forwarding to run\docker\start.bat.
echo.
if exist "%ROOT%\run\docker\start.bat" (
    call "%ROOT%\run\docker\start.bat" %*
    exit /b %ERRORLEVEL%
)
echo [ERROR] Missing Docker start script: %ROOT%\run\docker\start.bat
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b 1
