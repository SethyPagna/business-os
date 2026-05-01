@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Packaged Release Stopper
REM
REM  Shutdown flow:
REM    1. stop business-os-server.exe if running
REM    2. kill any stray listeners on the configured port
REM    3. stop PM2/node leftovers and Tailscale Funnel
REM    4. retry with elevation if the port remains busy
REM ========================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "RUNTIME_DIR=%ROOT%\runtime"
set "LOG_DIR=%RUNTIME_DIR%\logs"
set "RUN_LOG=%LOG_DIR%\stop-server.log"
set "ENV_FILE=%ROOT%\.env"
set "PORT=4000"
set "TAILSCALE_CMD="

if exist "%ENV_FILE%" (
    for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PORT="') do set "PORT=%%a"
)
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%" >nul 2>&1
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
echo [%DATE% %TIME%] STOP requested port=%PORT%>>"%RUN_LOG%"

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

title Business OS  ^|  Stop Server

echo.
echo ========================================================================
echo   Business OS  ^|  Stop Server
echo ========================================================================
echo.

if defined TAILSCALE_CMD (
    echo [INFO] Stopping Tailscale health monitor...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\tailscale-health-monitor.ps1" -Mode Stop -Root "%ROOT%" -TailscalePath "!TAILSCALE_CMD!" >nul 2>&1
)

echo [INFO] Stopping business-os-server.exe...
set "KILLED="
set "PORT_KILLED="

powershell -Command "if (Get-Process business-os-server -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    powershell -Command "Stop-Process -Name 'business-os-server' -Force -ErrorAction Stop" >nul 2>&1
    if not errorlevel 1 (
        echo [OK] Server stopped.
        set "KILLED=1"
    ) else (
        echo [WARN] Could not stop the server. Try running as Administrator.
    )
) else (
    echo [INFO] Server was not running.
)

echo.
echo [INFO] Checking for stray node processes on port %PORT%...
for /f %%a in ('powershell -NoProfile -Command "try { (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique) -join ' ' } catch { '' }"') do (
    if not "%%a"=="" (
        set "PORT_KILLED=1"
        echo [INFO] Stopping listener PID %%a...
        powershell -NoProfile -Command "Stop-Process -Id %%a -Force -ErrorAction SilentlyContinue" >nul 2>&1
        set "KILLED=1"
    )
)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT%.*LISTENING"') do (
    set "PID=%%a"
    if not "!PID!"=="" (
        set "PORT_KILLED=1"
        echo [INFO] Killing listener PID !PID!...
        powershell -NoProfile -Command "try { Stop-Process -Id !PID! -Force -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
        if errorlevel 1 (
            taskkill /PID !PID! /F >nul 2>&1
        )
        set "KILLED=1"
    )
)
if defined PORT_KILLED timeout /t 2 /nobreak >nul

where pm2 >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Stopping PM2 processes...
    call pm2 stop business-os >nul 2>&1
    call pm2 delete business-os >nul 2>&1
    call pm2 kill >nul 2>&1
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'pm2' -or $_.CommandLine -match 'Daemon\\.js' -or $_.CommandLine -match 'backend[\\/]+server\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
)

if defined TAILSCALE_CMD (
    echo.
    echo [INFO] Stopping Tailscale Funnel...
    call "!TAILSCALE_CMD!" serve reset >nul 2>&1
    echo [OK] Tailscale Funnel stopped.
)

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

echo.
set "PORT_STILL_BUSY="
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT%.*LISTENING"') do set "PORT_STILL_BUSY=1"

if defined PORT_STILL_BUSY (
    echo [WARN] Port %PORT% is still in use. Try running this script as Administrator.
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
) else if defined KILLED (
    echo [DONE] Business OS server stopped.
    echo [%DATE% %TIME%] STOP succeeded killed-process>>"%RUN_LOG%"
) else (
    echo [DONE] No running server found.
    echo [%DATE% %TIME%] STOP completed no-running-process>>"%RUN_LOG%"
)
echo.
exit /b 0
