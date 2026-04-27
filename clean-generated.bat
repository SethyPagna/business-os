@echo off
setlocal

REM ============================================================
REM  Business OS | Generated Artifact Cleanup
REM
REM  Removes only generated artifacts:
REM    - frontend/backend node_modules
REM    - frontend/dist
REM    - backend/frontend-dist
REM    - release/build temp output
REM
REM  Preserves:
REM    - source code
REM    - backend/.env
REM    - business-os-data
REM ============================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "MODE="
set "PREVIEW_ARG="
set "LOCK_ARG="
if /i "%~1"=="preview" (
    set "PREVIEW_ARG=-Preview"
) else if /i "%~1"=="deep" (
    set "LOCK_ARG=-IncludeLockfiles"
)
if /i "%~2"=="deep" set "LOCK_ARG=-IncludeLockfiles"
if /i "%~2"=="preview" set "PREVIEW_ARG=-Preview"

echo.
echo ========================================================================
echo   Business OS  ^|  Clean Generated Files
echo ========================================================================
echo.
echo   This removes generated/rebuildable files only.
echo   Source code, .env, and business-os-data are preserved.
if defined PREVIEW_ARG echo   Preview mode: only lists what would be removed.
if defined LOCK_ARG echo   Deep mode: package-lock files will also be removed.
echo.

powershell -ExecutionPolicy Bypass -File "%ROOT%\clean-generated.ps1" %PREVIEW_ARG% %LOCK_ARG%
if errorlevel 1 (
    echo.
    echo [ERROR] Cleanup failed.
    pause
    exit /b 1
)

echo.
echo [OK] Cleanup complete.
echo.
pause
