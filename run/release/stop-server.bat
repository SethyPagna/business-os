@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Packaged Release Stopper
REM ========================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "RUNTIME_DIR=%ROOT%\runtime"
set "LOG_DIR=%RUNTIME_DIR%\logs"
set "RUN_LOG=%LOG_DIR%\stop-server.log"
set "ENV_FILE=%ROOT%\.env"
set "PORT=4000"
set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%ROOT%\runtime\secrets\cloudflare-business-os-leangcosmetics.token"

if exist "%ENV_FILE%" (
  for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PORT="') do set "PORT=%%a"
  for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^CLOUDFLARE_TUNNEL_TOKEN_FILE="') do set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%%b"
)
if not exist "%CLOUDFLARE_TUNNEL_TOKEN_FILE%" if exist "%ROOT%\%CLOUDFLARE_TUNNEL_TOKEN_FILE%" set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%ROOT%\%CLOUDFLARE_TUNNEL_TOKEN_FILE%"
if "%PORT%"=="" set "PORT=4000"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
echo [%DATE% %TIME%] STOP requested port=%PORT%>>"%RUN_LOG%"

echo.
echo ========================================================================
echo   Business OS ^| Stop Server
echo ========================================================================
echo.

echo [INFO] Stopping packaged server and workers...
powershell -NoProfile -Command "Get-Process business-os-server -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match [regex]::Escape('%ROOT%') -and ($_.Name -match '^(node|business-os-server)\\.exe$') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo [INFO] Stopping Cloudflare Tunnel...
powershell -NoProfile -Command "$tokenPath='%CLOUDFLARE_TUNNEL_TOKEN_FILE%'; Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { ([string]$_.CommandLine) -match [regex]::Escape($tokenPath) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  echo [INFO] Stopping listener PID %%a...
  powershell -NoProfile -Command "Stop-Process -Id %%a -Force -ErrorAction SilentlyContinue" >nul 2>&1
)

if /I "%~1"=="--with-services" (
  echo [INFO] Stopping Docker scale services...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Scale -ScaleAction down
)

echo [DONE] Business OS stop command completed.
echo [%DATE% %TIME%] STOP completed>>"%RUN_LOG%"
exit /b 0
