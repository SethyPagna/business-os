@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Source Runtime Launcher
REM
REM  Runtime flow:
REM    1. confirm backend deps and frontend build exist
REM    2. start with PM2 when possible, otherwise fall back to background node
REM    3. update Tailscale Funnel / stored URL when available
REM    4. wait for /health, then print admin + customer portal URLs
REM ========================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "LOG_DIR=%ROOT%\ops\runtime\logs"
set "RUN_LOG=%LOG_DIR%\start-server.log"
set "ENV_FILE=%ROOT%\backend\.env"
set "DATA_DIR=%ROOT%\business-os-data"
set "PM2_HOME=%ROOT%\ops\runtime\pm2"
set "PORT=4000"
set "PM2_CMD="
set "USING_PM2=0"
set "TAILSCALE_URL_FOUND="
set "LOCAL_API=http://127.0.0.1:4000"

if exist "%ENV_FILE%" (
    for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PORT="') do set "PORT=%%a"
)
if "%PORT%"=="" set "PORT=4000"
set "LOCAL_API=http://127.0.0.1:%PORT%"
if not exist "%PM2_HOME%" mkdir "%PM2_HOME%" >nul 2>&1
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
echo [%DATE% %TIME%] START requested (port=%PORT%)>>"%RUN_LOG%"

if not exist "%ROOT%\backend\node_modules" (
    echo.
    echo [ERROR] Backend dependencies are missing.
    echo         Run setup.bat first, then try again.
    echo.
    pause
    echo [%DATE% %TIME%] START failed: missing backend node_modules>>"%RUN_LOG%"
    exit /b 1
)

if not exist "%ROOT%\frontend\dist\index.html" (
    echo.
    echo [ERROR] Frontend build is missing.
    echo         Run setup.bat first, then try again.
    echo.
    pause
    echo [%DATE% %TIME%] START failed: missing frontend build>>"%RUN_LOG%"
    exit /b 1
)

title Business OS ^| Server

echo.
echo ============================================================
echo   Business OS  ^|  Starting Server
echo ============================================================
echo.

cd /d "%ROOT%\backend"

echo [INFO] Checking PM2 (process manager)...
REM Prefer PM2 because it gives restart/log/status support for support cases.
for %%g in (pm2.cmd pm2.exe pm2.bat pm2) do (
    if not defined PM2_CMD (
        for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined PM2_CMD set "PM2_CMD=%%p"
    )
)

if not defined PM2_CMD (
    echo [INFO] Installing PM2 globally...
    call npm install -g pm2 --loglevel=warn
    if errorlevel 1 (
        echo [WARN] PM2 install failed. Using background node mode.
        goto :background_start
    )
    for %%g in (pm2.cmd pm2.exe pm2.bat pm2) do (
        if not defined PM2_CMD (
            for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined PM2_CMD set "PM2_CMD=%%p"
        )
    )
)

if not defined PM2_CMD (
    echo [WARN] PM2 is still not available. Using background node mode.
    goto :background_start
)

echo [OK] Using PM2: !PM2_CMD!
echo.
echo [INFO] Starting Business OS server with PM2...
call "!PM2_CMD!" stop business-os >nul 2>&1
call "!PM2_CMD!" delete business-os >nul 2>&1
call "!PM2_CMD!" start server.js --name "business-os" --update-env >nul 2>&1
if errorlevel 1 (
    echo [WARN] PM2 reported a startup error. Checking if server is already running...
    set "PM2_HTTP=0"
    for /f "tokens=*" %%r in ('powershell -Command "try { (Invoke-WebRequest -Uri %LOCAL_API%/health -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 0 }" 2^>nul') do set "PM2_HTTP=%%r"
    if "!PM2_HTTP!"=="200" (
        echo [OK] Server is already running on port %PORT%. Continuing.
        set "USING_PM2=0"
    ) else (
        echo [WARN] PM2 could not start server. Switching to background node mode.
        goto :background_start
    )
) else (
    set "USING_PM2=1"
    call "!PM2_CMD!" save >nul 2>&1
)
if "!USING_PM2!"=="1" (
    echo [OK] Server started with PM2 (auto-restart enabled)
) else (
    echo [INFO] Continuing without PM2 control.
)

echo.
echo [INFO] Checking Tailscale for remote access...
where tailscale >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Starting Tailscale Funnel on port %PORT%...
    tailscale funnel --bg %PORT% >nul 2>&1
    if not errorlevel 1 (
        for /l %%N in (1,1,6) do (
            if "!TAILSCALE_URL_FOUND!"=="" (
                powershell -Command "$url=''; $port='%PORT%'; try { $lines=@(tailscale funnel status 2>$null); $current=''; foreach($raw in $lines){ $line=[string]$raw; if($line -match '^(https://\S+)\s+\(Funnel on\)\s*$'){ $current=$matches[1].TrimEnd('/'); continue } if($current -and $line -match '^\|--\s+/\s+proxy\s+http://(?:127\.0\.0\.1|localhost):(\d+)\s*$'){ $mapped=[int]$matches[1]; if($mapped -eq [int]$port){ $url=$current; break }; $current='' } } } catch {}; try { if(-not $url){ $status=tailscale status --json 2>$null | ConvertFrom-Json; $dns=[string]$status.Self.DNSName; if($dns){ $url=('https://'+$dns.TrimEnd('.')).TrimEnd('/') } } } catch {}; if($url){ [Console]::WriteLine($url.TrimEnd('/')) }" > "%TEMP%\bos_ts_url.txt" 2>nul
                if exist "%TEMP%\bos_ts_url.txt" (
                    set /p TAILSCALE_URL_FOUND=<"%TEMP%\bos_ts_url.txt"
                    del "%TEMP%\bos_ts_url.txt" 2>nul
                )
                if "!TAILSCALE_URL_FOUND!"=="" if %%N LSS 6 timeout /t 2 /nobreak >nul
            )
        )
        if "!TAILSCALE_URL_FOUND!"=="" (
            for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^TAILSCALE_URL="') do set "TAILSCALE_URL_FOUND=%%a"
        )
        if not "!TAILSCALE_URL_FOUND!"=="" (
            set "CLEAN_URL=!TAILSCALE_URL_FOUND!"
            if "!CLEAN_URL:~-1!"=="/" set "CLEAN_URL=!CLEAN_URL:~0,-1!"
            powershell -Command "$p='%ENV_FILE%'; if(Test-Path $p){$lines=Get-Content $p; if($lines -match '^TAILSCALE_URL='){ $lines=$lines -replace '^TAILSCALE_URL=.*','TAILSCALE_URL=!CLEAN_URL!' } else { $lines += 'TAILSCALE_URL=!CLEAN_URL!' }; Set-Content $p $lines }" >nul 2>&1
            echo [OK] Tailscale Funnel active: !CLEAN_URL!
        ) else (
            echo [OK] Tailscale Funnel started (URL could not be detected automatically)
            echo      Run: tailscale funnel status
        )
    ) else (
        echo [WARN] Tailscale funnel command failed.
        echo      Enable HTTPS and Funnel in Tailscale admin, then retry.
        echo      If output shows "Access is denied", run this script as Administrator.
    )
) else (
    echo [WARN] Tailscale not installed. Local access only.
)

echo.
if "!USING_PM2!"=="1" (
    echo [INFO] Restarting PM2 app to pick up updated environment...
    call "!PM2_CMD!" restart business-os --update-env >nul 2>&1
)

goto :after_start

:background_start
REM Fallback path when PM2 is unavailable or fails to start the app cleanly.
echo.
echo [INFO] Starting server in background node mode...
powershell -Command "$p = Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%ROOT%\backend' -WindowStyle Hidden -PassThru; if ($p) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [WARN] Background start failed. Falling back to foreground mode.
    goto :foreground
)
echo [OK] Background node process launched.
goto :after_start

:foreground
echo.
echo [INFO] Running in foreground mode (PM2 unavailable).
echo       Keep this window open. Closing it stops the server.
echo.
echo       Local: http://localhost:%PORT%
echo       Login: admin / admin
echo.
echo       Press Ctrl+C to stop the server.
echo ============================================================
echo.

set "FG_HTTP=0"
for /f "tokens=*" %%r in ('powershell -Command "try { (Invoke-WebRequest -Uri %LOCAL_API%/health -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" 2^>nul') do set "FG_HTTP=%%r"
if "!FG_HTTP!"=="200" (
    echo [INFO] A server is already running on port %PORT%, so foreground launch is skipped.
    echo.
    echo Press any key to close this window.
    pause
    exit /b 0
)

node server.js

echo.
echo [INFO] Server stopped.
echo.
pause

:after_start
REM Poll /health so operators get a real success/failure result instead of a
REM blind "process launched" message.
echo.
echo [INFO] Waiting for server response...
set "SERVER_OK="
set "HTTP_STATUS=0"
for /l %%N in (1,1,20) do (
    set "HTTP_STATUS=0"
    for /f "tokens=*" %%r in ('powershell -Command "try { (Invoke-WebRequest -Uri %LOCAL_API%/health -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 0 }" 2^>nul') do set "HTTP_STATUS=%%r"
    if "!HTTP_STATUS!"=="200" (
        set "SERVER_OK=1"
        goto :after_health_done
    )
    timeout /t 3 /nobreak >nul
)

:after_health_done
if "!SERVER_OK!"=="1" (
    echo [OK] Server is responding on http://localhost:%PORT%
    echo [%DATE% %TIME%] START succeeded on port %PORT%>>"%RUN_LOG%"
) else (
    echo [WARN] Server is still starting or not responding on port %PORT%.
    echo [%DATE% %TIME%] START warning: health check timed out on port %PORT%>>"%RUN_LOG%"
)

set "CUSTOMER_PORTAL_PATH=/customer-portal"
for /f "tokens=*" %%r in ('powershell -Command "try { $cfg = Invoke-RestMethod -Uri %LOCAL_API%/api/portal/config -UseBasicParsing -TimeoutSec 3; if ($cfg.publicPath) { [Console]::WriteLine([string]$cfg.publicPath) } } catch {}" 2^>nul') do set "CUSTOMER_PORTAL_PATH=%%r"
if not "!CUSTOMER_PORTAL_PATH!"=="" if not "!CUSTOMER_PORTAL_PATH:~0,1!"=="/" set "CUSTOMER_PORTAL_PATH=/!CUSTOMER_PORTAL_PATH!"
set "CUSTOMER_PUBLIC_URL="
for /f "tokens=*" %%r in ('powershell -Command "try { $cfg = Invoke-RestMethod -Uri %LOCAL_API%/api/portal/config -UseBasicParsing -TimeoutSec 3; if ($cfg.publicUrl) { [Console]::WriteLine([string]$cfg.publicUrl) } } catch {}" 2^>nul') do set "CUSTOMER_PUBLIC_URL=%%r"

echo.
echo ========================================================================
echo   Start Server Complete
echo ========================================================================
echo.
echo   Local Admin:  http://localhost:%PORT%
echo   Local Portal: http://localhost:%PORT%!CUSTOMER_PORTAL_PATH!
if not "!TAILSCALE_URL_FOUND!"=="" echo   Remote Admin: !TAILSCALE_URL_FOUND!
if not "!CUSTOMER_PUBLIC_URL!"=="" (
    echo   Customer URL: !CUSTOMER_PUBLIC_URL!
) else (
    if not "!TAILSCALE_URL_FOUND!"=="" echo   Customer URL: !TAILSCALE_URL_FOUND!!CUSTOMER_PORTAL_PATH!
)
echo.
echo   Default login: admin / admin
echo   Data folder:   %DATA_DIR%
echo.
if "!USING_PM2!"=="1" (
    echo   Useful commands:
    echo     pm2 status
    echo     pm2 logs business-os
    echo     pm2 restart business-os --update-env
) else (
    echo   Process mode: Background node.exe
    echo   Use stop-server.bat to stop the server.
)
echo.
echo ========================================================================
echo.
echo Press any key to close this window (server keeps running in background)
pause >nul
exit /b 0
