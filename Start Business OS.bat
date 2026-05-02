@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | One-File Launcher
REM
REM  Normal users should start here. This file delegates to the correct
REM  runtime launcher for source checkouts and portable release folders.
REM ========================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo ========================================================================
echo   Business OS
echo ========================================================================
echo.
echo   Starting the app, Docker services, workers, and Cloudflare access...
echo   You do not need to run Docker, Redis, Postgres, MinIO, or workers by hand.
echo.

if exist "%ROOT%\run\start-server.bat" (
    call "%ROOT%\run\start-server.bat"
    exit /b %ERRORLEVEL%
)

if exist "%ROOT%\start-server.bat" (
    call "%ROOT%\start-server.bat"
    exit /b %ERRORLEVEL%
)

echo [ERROR] Business OS launcher could not find a start script.
echo         Expected one of:
echo           %ROOT%\run\start-server.bat
echo           %ROOT%\start-server.bat
echo.
echo         Reinstall Business OS or restore the full portable folder.
echo.
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b 1
