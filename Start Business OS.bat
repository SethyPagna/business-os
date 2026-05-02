@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | One-File Docker Launcher
REM
REM  Normal users should start here. This is the final supported runtime path:
REM  Docker services, workers, app container, and Cloudflare access.
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

if exist "%ROOT%\run\docker\start.bat" (
    call "%ROOT%\run\docker\start.bat"
    exit /b %ERRORLEVEL%
)

echo [ERROR] Business OS launcher could not find a start script.
echo         Expected:
echo           %ROOT%\run\docker\start.bat
echo.
echo         This folder is not the final Docker release layout.
echo         Reinstall Business OS or restore the full Docker portable folder.
echo.
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b 1
