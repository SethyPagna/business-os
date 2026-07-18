@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Source Runtime Stopper (compatibility shim)
REM
REM  This used to stop a native PM2/host-cloudflared/Tailscale runtime and a
REM  retired Docker Compose stack (ops\docker\compose.scale.yml) that is no
REM  longer what "Start Business OS.bat" starts. That meant it silently did
REM  not stop the actual running app. It now forwards to
REM  run\docker\stop.bat, which stops the real, currently supported stack
REM  (ops\docker\compose.release.yml).
REM ========================================================================

if defined BUSINESS_OS_REPO_ROOT (
    set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
    for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo [INFO] Forwarding to run\docker\stop.bat.
echo.
if exist "%ROOT%\run\docker\stop.bat" (
    call "%ROOT%\run\docker\stop.bat" %*
    exit /b %ERRORLEVEL%
)
echo [ERROR] Missing Docker stop script: %ROOT%\run\docker\stop.bat
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b 1
