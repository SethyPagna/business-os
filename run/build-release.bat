@echo off
chcp 65001 >nul 2>&1
setlocal

REM ========================================================================
REM  Business OS | Final Release Builder
REM
REM  The legacy Windows EXE/NSIS release has been retired. The final supported
REM  release is the local Docker release kit built by run\docker\release.bat.
REM ========================================================================

if defined BUSINESS_OS_REPO_ROOT (
  set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
  for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo.
echo ========================================================================
echo   Business OS  ^|  Build Final Docker Release
echo ========================================================================
echo.
echo   This builds the no-source Docker release kit.
echo   Output: release\business-os\
echo.

if not exist "%ROOT%\run\docker\release.bat" (
  echo [ERROR] Missing Docker release builder:
  echo         %ROOT%\run\docker\release.bat
  echo.
  if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
  exit /b 1
)

set "OLD_BUSINESS_OS_NO_PAUSE=%BUSINESS_OS_NO_PAUSE%"
set "BUSINESS_OS_NO_PAUSE=1"
call "%ROOT%\run\docker\release.bat" %*
set "EXIT_CODE=%ERRORLEVEL%"
set "BUSINESS_OS_NO_PAUSE=%OLD_BUSINESS_OS_NO_PAUSE%"

echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Final Docker release built.
  echo        Next: copy or sync release\business-os\ to the laptop.
  echo        On that laptop, double-click Start Business OS.bat.
) else (
  echo [ERROR] Final Docker release failed.
  echo         Check ops\runtime\logs and run run\docker\doctor.bat.
)
echo.
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
