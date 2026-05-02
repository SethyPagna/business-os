@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Source Runtime Stopper
REM
REM  Shutdown flow:
REM    1. stop PM2-managed app if present
REM    2. kill listeners on the configured port
REM    3. kill stray node server.js processes
REM    4. stop Cloudflare Tunnel and optional legacy tunnels
REM    5. retry with elevation if the port is still busy
REM ========================================================================

if defined BUSINESS_OS_REPO_ROOT (
    set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
    for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "LOG_DIR=%ROOT%\ops\runtime\logs"
set "RUN_LOG=%LOG_DIR%\stop-server.log"
set "ENV_FILE=%ROOT%\backend\.env"
set "PORT=4000"
set "TAILSCALE_CMD="
set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%ROOT%\ops\runtime\secrets\cloudflare-business-os-leangcosmetics.token"
set "COMPOSE_FILE=%ROOT%\ops\docker\compose.scale.yml"
set "DOCKER_ENV=%ROOT%\ops\runtime\docker-scale.env"
set "DOCKER_CONFIG=%ROOT%\ops\runtime\docker-config"
if not defined BUSINESS_OS_REMOTE_PROVIDER set "BUSINESS_OS_REMOTE_PROVIDER=cloudflare"

if exist "%ENV_FILE%" (
    for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PORT="') do set "PORT=%%a"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^CLOUDFLARE_TUNNEL_TOKEN_FILE="') do set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^BUSINESS_OS_REMOTE_PROVIDER="') do set "BUSINESS_OS_REMOTE_PROVIDER=%%b"
)
if "%PORT%"=="" set "PORT=4000"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
echo [%DATE% %TIME%] STOP requested port=%PORT%>>"%RUN_LOG%"

if /I "%BUSINESS_OS_REMOTE_PROVIDER%"=="tailscale" (
    for %%g in (tailscale.exe tailscale.cmd tailscale.bat tailscale) do (
        if not defined TAILSCALE_CMD (
            for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined TAILSCALE_CMD set "TAILSCALE_CMD=%%p"
        )
    )
    if not defined TAILSCALE_CMD (
        for %%p in ("%ProgramFiles%\Tailscale\tailscale.exe" "%ProgramFiles(x86)%\Tailscale\tailscale.exe") do (
            if exist "%%~p" if not defined TAILSCALE_CMD set "TAILSCALE_CMD=%%~p"
        )
    )
)

echo.
echo ============================================================
echo   Business OS  ^|  Stopping Server
echo ============================================================
echo.

echo [INFO] Stopping Docker app/runtime containers if they are running...
set "DOCKER_CMD="
for %%g in (docker.exe docker.cmd docker.bat docker) do (
    if not defined DOCKER_CMD (
        for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined DOCKER_CMD set "DOCKER_CMD=%%p"
    )
)
if not defined DOCKER_CMD if exist "%ProgramFiles%\Docker\Docker\resources\bin\docker.exe" set "DOCKER_CMD=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"
if defined DOCKER_CMD if exist "%COMPOSE_FILE%" if exist "%DOCKER_ENV%" (
    "%DOCKER_CMD%" compose --env-file "%DOCKER_ENV%" -f "%COMPOSE_FILE%" --profile runtime --profile cloudflare-runtime stop app import-worker media-worker cloudflared >nul 2>&1
)

if /I "%BUSINESS_OS_REMOTE_PROVIDER%"=="tailscale" if defined TAILSCALE_CMD (
    echo [INFO] Stopping Tailscale health monitor...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\tailscale-health-monitor.ps1" -Mode Stop -Root "%ROOT%" -TailscalePath "!TAILSCALE_CMD!" >nul 2>&1
)

where pm2 >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Stopping PM2 app ^(project and user homes^)...
    for %%H in ("%ROOT%\ops\runtime\pm2" "%USERPROFILE%\.pm2") do (
        set "PM2_HOME=%%~H"
        call pm2 stop business-os >nul 2>&1
        call pm2 stop business-os-import-worker >nul 2>&1
        call pm2 stop business-os-media-worker >nul 2>&1
        call pm2 delete business-os >nul 2>&1
        call pm2 delete business-os-import-worker >nul 2>&1
        call pm2 delete business-os-media-worker >nul 2>&1
        call pm2 kill >nul 2>&1
    )
    echo [INFO] Stopping PM2 daemon processes...
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'pm2' -or $_.CommandLine -match 'Daemon\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
    echo [OK] PM2 stop commands executed.
) else (
    echo [INFO] PM2 not found.
)

echo.
echo [INFO] Killing listeners on port %PORT%...
set /a LOOP=0
:kill_loop
set /a LOOP+=1
set "FOUND_ANY="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%.*LISTENING" 2^>nul') do (
    set "PID=%%a"
    if not "!PID!"=="" (
        set "FOUND_ANY=1"
        echo [INFO] Killing PID !PID! ...
        powershell -NoProfile -Command "try { Stop-Process -Id !PID! -Force -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
        if errorlevel 1 (
            taskkill /PID !PID! /F >nul 2>&1
        )
    )
)
if defined FOUND_ANY (
    if !LOOP! LSS 6 (
        powershell -NoProfile -Command "Start-Sleep -Seconds 1" >nul 2>&1
        goto :kill_loop
    )
)

echo [INFO] Killing residual node server.js processes...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'backend[\\/]+server\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo [INFO] Killing residual import/media worker processes...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'backend[\\/]+src[\\/]+workers[\\/]+(importWorker|mediaWorker)\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul 2>&1

if /I "%BUSINESS_OS_REMOTE_PROVIDER%"=="tailscale" if defined TAILSCALE_CMD (
    echo.
    echo [INFO] Stopping Tailscale Funnel...
    powershell -NoProfile -Command "& '!TAILSCALE_CMD!' serve reset" >nul 2>&1
    echo [OK] Tailscale Funnel stopped.
)

echo.
echo [INFO] Stopping Cloudflare Tunnel...
powershell -NoProfile -Command "$tokenPath='%CLOUDFLARE_TUNNEL_TOKEN_FILE%'; Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { ([string]$_.CommandLine) -match [regex]::Escape($tokenPath) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
echo [OK] Cloudflare Tunnel stop command executed.

if /I "%~1"=="--with-services" (
    echo.
    echo [INFO] Stopping Docker scale services...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Scale -ScaleAction down
    if errorlevel 1 (
        echo [WARN] Docker scale services could not be stopped automatically.
    ) else (
        echo [OK] Docker scale services stopped.
    )
)

set "PORT_STILL_BUSY="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%.*LISTENING" 2^>nul') do set "PORT_STILL_BUSY=1"

echo.
if defined PORT_STILL_BUSY (
    echo [WARN] Port %PORT% is still busy. Try running this script as Administrator.
    echo [%DATE% %TIME%] STOP warning port=%PORT% still-listening>>"%RUN_LOG%"
    if /I not "%~1"=="--elevated" (
        net session >nul 2>&1
        if errorlevel 1 (
            echo [INFO] Attempting one Administrator retry...
            powershell -NoProfile -Command "try { Start-Process -FilePath '%~f0' -ArgumentList '--elevated' -Verb RunAs -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
            if errorlevel 1 (
                echo [WARN] Administrator retry was not started.
            ) else (
                echo [INFO] Administrator retry started in a new window.
            )
        )
    )
) else (
    echo [DONE] Business OS server stopped.
    echo [%DATE% %TIME%] STOP succeeded port=%PORT%>>"%RUN_LOG%"
)
echo.
echo Next step: double-click Start Business OS.bat when you want to run again.
echo Support log: %RUN_LOG%
echo.
if not "%BUSINESS_OS_NO_PAUSE%"=="1" (
    echo Press any key to close this window.
    pause >nul
)
exit /b 0
