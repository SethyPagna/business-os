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
if /i "%~1"=="preview" set "MODE=-Preview"

echo.
echo ========================================================================
echo   Business OS  ^|  Clean Generated Files
echo ========================================================================
echo.
echo   This removes generated/rebuildable files only.
echo   Source code, .env, and business-os-data are preserved.
if defined MODE echo   Preview mode: only lists what would be removed.
echo.

powershell -ExecutionPolicy Bypass -File "%ROOT%\clean-generated.ps1" %MODE%
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
