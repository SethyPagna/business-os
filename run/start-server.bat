@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Source Runtime Launcher
REM
REM  Runtime flow:
REM    1. start/verify required Business OS Docker services
REM    2. confirm backend deps and frontend build exist
REM    3. start with PM2 when possible, otherwise fall back to background node
REM    4. start Cloudflare Tunnel for the custom domain
REM    5. wait for /health, then print admin + customer portal URLs
REM ========================================================================

if defined BUSINESS_OS_REPO_ROOT (
    set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
    for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "LOG_DIR=%ROOT%\ops\runtime\logs"
set "RUN_LOG=%LOG_DIR%\start-server.log"
set "ENV_FILE=%ROOT%\backend\.env"
set "DATA_DIR=%ROOT%\business-os-data"
set "PM2_HOME=%ROOT%\ops\runtime\pm2"
set "PORT=4000"
set "PM2_CMD="
set "TAILSCALE_CMD="
set "CLOUDFLARED_CMD="
set "USING_PM2=0"
set "TAILSCALE_URL_FOUND="
set "PUBLIC_URL_FOUND="
set "PUBLIC_URL_KIND="
if not defined BUSINESS_OS_REMOTE_PROVIDER set "BUSINESS_OS_REMOTE_PROVIDER=cloudflare"
set "CLOUDFLARE_PUBLIC_URL=https://leangcosmetics.dpdns.org"
set "CLOUDFLARE_ADMIN_URL=https://admin.leangcosmetics.dpdns.org"
set "PUBLIC_BASE_URL="
set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%ROOT%\ops\runtime\secrets\cloudflare-business-os-leangcosmetics.token"
set "TAILSCALE_NET_OK="
set "LOCAL_API=http://127.0.0.1:4000"
set "SERVER_ALREADY_RUNNING=0"
set "BUSINESS_OS_APP_RUNTIME="
set "BUSINESS_OS_REQUIRE_SCALE_SERVICES=1"
set "JOB_QUEUE_DRIVER=bullmq"
set "WORKER_RUNTIME=host"
if not defined REDIS_URL set "REDIS_URL=redis://127.0.0.1:6379"
if not defined RUNTIME_CACHE_ENABLED set "RUNTIME_CACHE_ENABLED=1"
if not defined CACHE_REDIS_URL set "CACHE_REDIS_URL=redis://127.0.0.1:6380"
if not defined DATABASE_DRIVER set "DATABASE_DRIVER=sqlite"
if not defined OBJECT_STORAGE_DRIVER set "OBJECT_STORAGE_DRIVER=local"
if not defined SQLITE_BUSY_TIMEOUT_MS set "SQLITE_BUSY_TIMEOUT_MS=30000"
if not defined SQLITE_CACHE_SIZE_KB set "SQLITE_CACHE_SIZE_KB=196608"
if not defined SQLITE_MMAP_SIZE_MB set "SQLITE_MMAP_SIZE_MB=1024"
if not defined SQLITE_WAL_AUTOCHECKPOINT set "SQLITE_WAL_AUTOCHECKPOINT=4000"
if not defined SQLITE_JOURNAL_SIZE_LIMIT_MB set "SQLITE_JOURNAL_SIZE_LIMIT_MB=128"
if not defined SQLITE_SYNCHRONOUS set "SQLITE_SYNCHRONOUS=NORMAL"
if not defined IMPORT_QUEUE_CONCURRENCY set "IMPORT_QUEUE_CONCURRENCY=1"
if not defined MEDIA_QUEUE_CONCURRENCY set "MEDIA_QUEUE_CONCURRENCY=4"
if not defined IMPORT_ROW_BATCH_SIZE set "IMPORT_ROW_BATCH_SIZE=400"
if not defined IMPORT_BATCH_PAUSE_MS set "IMPORT_BATCH_PAUSE_MS=20"
if not defined IMPORT_IMAGE_CONCURRENCY set "IMPORT_IMAGE_CONCURRENCY=4"
if not defined UPLOAD_CHUNK_MB set "UPLOAD_CHUNK_MB=12"

if exist "%ENV_FILE%" (
    for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PORT="') do set "PORT=%%a"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PUBLIC_BASE_URL="') do set "PUBLIC_BASE_URL=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^CLOUDFLARE_PUBLIC_URL="') do set "CLOUDFLARE_PUBLIC_URL=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^CLOUDFLARE_ADMIN_URL="') do set "CLOUDFLARE_ADMIN_URL=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^CLOUDFLARE_TUNNEL_TOKEN_FILE="') do set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^BUSINESS_OS_REMOTE_PROVIDER="') do set "BUSINESS_OS_REMOTE_PROVIDER=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^BUSINESS_OS_APP_RUNTIME="') do set "BUSINESS_OS_APP_RUNTIME=%%b"
)
if "%PORT%"=="" set "PORT=4000"
if "%CLOUDFLARE_PUBLIC_URL%"=="" set "CLOUDFLARE_PUBLIC_URL=https://leangcosmetics.dpdns.org"
if "%CLOUDFLARE_ADMIN_URL%"=="" set "CLOUDFLARE_ADMIN_URL=https://admin.leangcosmetics.dpdns.org"
if "%PUBLIC_BASE_URL%"=="" set "PUBLIC_BASE_URL=%CLOUDFLARE_PUBLIC_URL%"
if "%BUSINESS_OS_REMOTE_PROVIDER%"=="" set "BUSINESS_OS_REMOTE_PROVIDER=cloudflare"
if "%BUSINESS_OS_APP_RUNTIME%"=="" set "BUSINESS_OS_APP_RUNTIME=docker"
set "LOCAL_API=http://127.0.0.1:%PORT%"
if not exist "%PM2_HOME%" mkdir "%PM2_HOME%" >nul 2>&1
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
echo [%DATE% %TIME%] START requested (port=%PORT%)>>"%RUN_LOG%"

if /I "%BUSINESS_OS_APP_RUNTIME%"=="docker" (
    echo.
    echo [INFO] Docker runtime selected.
    echo        This launcher owns setup, Docker services, workers, and Cloudflare access.
    echo        Progress and failures are logged under ops\runtime\logs.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\start-runtime.ps1" -Root "%ROOT%"
    set "DOCKER_START_EXIT=!ERRORLEVEL!"
    echo.
    if not "!DOCKER_START_EXIT!"=="0" (
        echo [ERROR] Docker runtime launcher failed with exit code !DOCKER_START_EXIT!.
        echo         Log folder: %LOG_DIR%
        echo         Safest repair command: run\docker\doctor.bat
    )
    echo.
    if not "%BUSINESS_OS_NO_PAUSE%"=="1" (
        echo Press any key to close this window.
        pause >nul
    )
    exit /b !DOCKER_START_EXIT!
)

echo.
echo [INFO] Starting required runtime services...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Start -StartServices -RequireServices
if errorlevel 1 (
    echo.
    echo [ERROR] Required runtime services are not ready.
    echo         Open Docker Desktop, finish any setup/restart prompts, then double-click Start Business OS.bat again.
    echo.
    pause
    echo [%DATE% %TIME%] START failed: runtime bootstrap failed>>"%RUN_LOG%"
    exit /b 1
)

for %%g in (cloudflared.exe cloudflared.cmd cloudflared.bat cloudflared) do (
    if not defined CLOUDFLARED_CMD (
        for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined CLOUDFLARED_CMD set "CLOUDFLARED_CMD=%%p"
    )
)
if not defined CLOUDFLARED_CMD (
    for %%p in ("%ProgramFiles%\cloudflared\cloudflared.exe" "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" "%LOCALAPPDATA%\cloudflared\cloudflared.exe") do (
        if exist "%%~p" if not defined CLOUDFLARED_CMD set "CLOUDFLARED_CMD=%%~p"
    )
)

if not exist "%ROOT%\backend\node_modules" (
    echo.
    echo [ERROR] Backend dependencies are missing.
    echo         Run run\setup.bat first, then try again.
    echo.
    pause
    echo [%DATE% %TIME%] START failed: missing backend node_modules>>"%RUN_LOG%"
    exit /b 1
)

if not exist "%ROOT%\frontend\dist\index.html" (
    echo.
    echo [ERROR] Frontend build is missing.
    echo         Run run\setup.bat first, then try again.
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

set "PRESTART_HTTP=0"
for /f "tokens=*" %%r in ('powershell -Command "try { (Invoke-WebRequest -Uri %LOCAL_API%/health -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" 2^>nul') do set "PRESTART_HTTP=%%r"
if "!PRESTART_HTTP!"=="200" (
    echo [OK] Server is already responding on http://localhost:%PORT%
    set "SERVER_ALREADY_RUNNING=1"
) else (
    set "PORT_PID="
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING" 2^>nul') do if not defined PORT_PID set "PORT_PID=%%a"
    if defined PORT_PID (
        powershell -NoProfile -Command "$pid=%PORT_PID%; try { $proc = Get-CimInstance Win32_Process -Filter \"ProcessId=$pid\"; $name = [string]$proc.Name; $cmd = [string]$proc.CommandLine; if (($name -match '^(node|business-os-server)\.exe$') -or ($cmd -match 'backend[\\/]+server\.js') -or ($cmd -match 'ProcessContainerFork\.js')) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
        if not errorlevel 1 (
            echo [WARN] Clearing stale Business OS listener on port %PORT% ^(PID !PORT_PID!^)...
            powershell -NoProfile -Command "try { Stop-Process -Id %PORT_PID% -Force -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
            powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul 2>&1
        ) else (
            echo [ERROR] Port %PORT% is already being used by another program ^(PID !PORT_PID!^).
            echo         Stop that program or change PORT= in %ENV_FILE%, then try again.
            echo.
            pause
            echo [%DATE% %TIME%] START failed: port %PORT% owned by foreign process !PORT_PID!>>"%RUN_LOG%"
            exit /b 1
        )
    )
)

echo [INFO] Checking PM2 (process manager)...
REM Prefer PM2 because it gives restart/log/status support for support cases.
for %%g in (pm2.cmd pm2.exe pm2.bat pm2) do (
    if not defined PM2_CMD (
        for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined PM2_CMD set "PM2_CMD=%%p"
    )
)

if not defined PM2_CMD (
    echo [WARN] PM2 is not installed. Using background node mode.
    echo [INFO] This support launcher does not install global packages automatically.
    if "!SERVER_ALREADY_RUNNING!"=="1" goto :after_pm2_start
    goto :background_start
)

if "!SERVER_ALREADY_RUNNING!"=="1" (
    call "!PM2_CMD!" describe business-os >nul 2>&1
    if not errorlevel 1 (
        echo [INFO] Restarting existing PM2 server so it picks up current code and environment...
        call "!PM2_CMD!" restart business-os --update-env >nul 2>&1
        set "USING_PM2=1"
    ) else (
        echo [INFO] Reusing the running server instance.
    )
    goto :after_pm2_start
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
    echo [OK] Server started with PM2 ^(auto-restart enabled^)
) else (
    echo [INFO] Continuing without PM2 control.
)

:after_pm2_start
echo.
echo [INFO] Starting background import/media workers...
if "!USING_PM2!"=="1" (
    call "!PM2_CMD!" stop business-os-import-worker >nul 2>&1
    call "!PM2_CMD!" delete business-os-import-worker >nul 2>&1
    call "!PM2_CMD!" start src/workers/importWorker.js --name "business-os-import-worker" --update-env >nul 2>&1
    if errorlevel 1 (
        echo [WARN] PM2 could not start import worker. Large imports will stay queued until a worker is available.
    ) else (
        echo [OK] Import worker started with PM2.
    )
    call "!PM2_CMD!" stop business-os-media-worker >nul 2>&1
    call "!PM2_CMD!" delete business-os-media-worker >nul 2>&1
    call "!PM2_CMD!" start src/workers/mediaWorker.js --name "business-os-media-worker" --update-env >nul 2>&1
    if errorlevel 1 (
        echo [WARN] PM2 could not start media worker. Media optimization will stay queued until a worker is available.
    ) else (
        echo [OK] Media worker started with PM2.
    )
    call "!PM2_CMD!" save >nul 2>&1
) else (
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'backend[\\/]+src[\\/]+workers[\\/]+(importWorker|mediaWorker)\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
    powershell -Command "$argsList=@('src/workers/importWorker.js'); $p = Start-Process -FilePath 'node' -ArgumentList $argsList -WorkingDirectory '%ROOT%\backend' -WindowStyle Hidden -PassThru; if ($p) { exit 0 } else { exit 1 }" >nul 2>&1
    if errorlevel 1 (
        echo [WARN] Background import worker launch failed.
    ) else (
        echo [OK] Import worker launched in background node mode.
    )
    powershell -Command "$argsList=@('src/workers/mediaWorker.js'); $p = Start-Process -FilePath 'node' -ArgumentList $argsList -WorkingDirectory '%ROOT%\backend' -WindowStyle Hidden -PassThru; if ($p) { exit 0 } else { exit 1 }" >nul 2>&1
    if errorlevel 1 (
        echo [WARN] Background media worker launch failed.
    ) else (
        echo [OK] Media worker launched in background node mode.
    )
)

echo.
echo [INFO] Checking Cloudflare Tunnel for custom public domain...
if defined CLOUDFLARED_CMD (
    if exist "!CLOUDFLARE_TUNNEL_TOKEN_FILE!" (
        echo [INFO] Using cloudflared: !CLOUDFLARED_CMD!
        powershell -NoProfile -Command "$tokenPath='!CLOUDFLARE_TUNNEL_TOKEN_FILE!'; Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { ([string]$_.CommandLine) -match [regex]::Escape($tokenPath) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
        powershell -NoProfile -Command "$envFile='%ENV_FILE%'; $public='!PUBLIC_BASE_URL!'; $cloud='!CLOUDFLARE_PUBLIC_URL!'; $admin='!CLOUDFLARE_ADMIN_URL!'; if(Test-Path $envFile){ $lines=Get-Content $envFile; foreach($pair in @(@('PUBLIC_BASE_URL',$public),@('CLOUDFLARE_PUBLIC_URL',$cloud),@('CLOUDFLARE_ADMIN_URL',$admin))){ $key=$pair[0]; $value=$pair[1]; if($lines -match ('^'+[regex]::Escape($key)+'=')){ $lines=$lines -replace ('^'+[regex]::Escape($key)+'=.*'), ($key+'='+$value) } else { $lines += ($key+'='+$value) } }; Set-Content -Encoding UTF8 $envFile $lines }" >nul 2>&1
        powershell -NoProfile -Command "$argsList=@('tunnel','--no-autoupdate','--loglevel','warn','--logfile','%LOG_DIR%\cloudflared.log','run','--url','http://127.0.0.1:%PORT%','--token-file','!CLOUDFLARE_TUNNEL_TOKEN_FILE!'); $p = Start-Process -FilePath '!CLOUDFLARED_CMD!' -ArgumentList $argsList -WindowStyle Hidden -PassThru; if ($p) { exit 0 } else { exit 1 }" >nul 2>&1
        if errorlevel 1 (
            echo [WARN] Cloudflare Tunnel could not be started. Remote access may be unavailable.
        ) else (
            set "PUBLIC_URL_FOUND=!PUBLIC_BASE_URL!"
            set "PUBLIC_URL_KIND=cloudflare"
            echo [OK] Cloudflare Tunnel requested: !PUBLIC_URL_FOUND!
        )
    ) else (
        echo [WARN] Cloudflare tunnel token file is missing:
        echo        !CLOUDFLARE_TUNNEL_TOKEN_FILE!
        echo        Remote access needs the Cloudflare tunnel token file.
    )
) else (
    echo [WARN] cloudflared was not found. Remote access may be unavailable.
)

if /I not "!BUSINESS_OS_REMOTE_PROVIDER!"=="tailscale" goto :after_remote_access_provider

echo.
echo [INFO] Checking legacy Tailscale remote access...
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
if defined TAILSCALE_CMD (
    echo [INFO] Using Tailscale CLI: !TAILSCALE_CMD!
    echo [INFO] Starting Tailscale Funnel on port %PORT%...
    powershell -NoProfile -Command "& '!TAILSCALE_CMD!' funnel --bg --yes 'http://127.0.0.1:%PORT%'" >nul 2>&1
    if not errorlevel 1 (
        for /l %%N in (1,1,6) do (
            if "!TAILSCALE_URL_FOUND!"=="" (
                powershell -Command "$tailscale='!TAILSCALE_CMD!'; $url=''; $port='%PORT%'; try { $lines=@(& $tailscale funnel status 2>$null); $current=''; foreach($raw in $lines){ $line=[string]$raw; if($line -match '^(https://\S+)\s+\(Funnel on\)\s*$'){ $current=$matches[1].TrimEnd('/'); continue } if($current -and $line -match '^\|--\s+/\s+proxy\s+http://(?:127\.0\.0\.1|localhost):(\d+)\s*$'){ $mapped=[int]$matches[1]; if($mapped -eq [int]$port){ $url=$current; break }; $current='' } } } catch {}; try { if(-not $url){ $status=(& $tailscale status --json 2>$null | ConvertFrom-Json); $dns=[string]$status.Self.DNSName; if($dns){ $url=('https://'+$dns.TrimEnd('.')).TrimEnd('/') } } } catch {}; if($url){ [Console]::WriteLine($url.TrimEnd('/')) }" > "%TEMP%\bos_ts_url.txt" 2>nul
                if exist "%TEMP%\bos_ts_url.txt" (
                    set /p TAILSCALE_URL_FOUND=<"%TEMP%\bos_ts_url.txt"
                    del "%TEMP%\bos_ts_url.txt" 2>nul
                )
                if "!TAILSCALE_URL_FOUND!"=="" if %%N LSS 6 powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul 2>&1
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
            if not defined PUBLIC_URL_FOUND (
                set "PUBLIC_URL_FOUND=!CLEAN_URL!"
                set "PUBLIC_URL_KIND=tailscale"
            )
            echo [INFO] Checking Tailscale relay health...
            powershell -NoProfile -Command "$tailscale='!TAILSCALE_CMD!'; $out=@(& $tailscale netcheck 2>&1); $text=($out -join [Environment]::NewLine); if($text -match 'Nearest DERP:\s+unknown' -or $text -match 'no response to latency probes' -or $text -match 'could not connect') { $text | Set-Content -Encoding UTF8 '%TEMP%\bos_tailscale_netcheck.txt'; exit 1 }; exit 0" >nul 2>&1
            if errorlevel 1 (
                echo [WARN] Tailscale relay health failed. Attempting automatic relay repair...
                if exist "%TEMP%\bos_tailscale_netcheck.txt" (
                    type "%TEMP%\bos_tailscale_netcheck.txt"
                    del "%TEMP%\bos_tailscale_netcheck.txt" >nul 2>&1
                )
                powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\tailscale-health-monitor.ps1" -Mode RepairOnce -Root "%ROOT%" -TailscalePath "!TAILSCALE_CMD!" -IntervalSeconds 60 >nul 2>&1
                powershell -NoProfile -Command "$tailscale='!TAILSCALE_CMD!'; $out=@(& $tailscale netcheck 2>&1); $text=($out -join [Environment]::NewLine); if($text -match 'Nearest DERP:\s+unknown' -or $text -match 'no response to latency probes' -or $text -match 'could not connect') { $text | Set-Content -Encoding UTF8 '%TEMP%\bos_tailscale_netcheck_retry.txt'; exit 1 }; exit 0" >nul 2>&1
                if errorlevel 1 (
                    echo [WARN] Tailscale relay health still failed. Public internet devices may time out.
                    if exist "%TEMP%\bos_tailscale_netcheck_retry.txt" (
                        type "%TEMP%\bos_tailscale_netcheck_retry.txt"
                        del "%TEMP%\bos_tailscale_netcheck_retry.txt" >nul 2>&1
                    )
                    echo      Check VPN/firewall/proxy rules. Tailscale needs outbound HTTPS to control/DERP relays.
                ) else (
                    set "TAILSCALE_NET_OK=1"
                    echo [OK] Tailscale relay health repaired.
                )
            ) else (
                set "TAILSCALE_NET_OK=1"
                echo [OK] Tailscale relay health passed.
            )
        ) else (
            echo [OK] Tailscale Funnel started ^(URL could not be detected automatically^)
            echo      Run: tailscale funnel status
        )
    ) else (
        echo [WARN] Tailscale funnel command failed.
        echo      Enable HTTPS and Funnel in Tailscale admin, then retry.
        echo      If output shows "Access is denied", run this script as Administrator.
    )
) else (
    echo [WARN] Tailscale CLI not found. Local access only.
)

if defined TAILSCALE_CMD (
    echo [INFO] Starting Tailscale health monitor...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\tailscale-health-monitor.ps1" -Mode Start -Root "%ROOT%" -TailscalePath "!TAILSCALE_CMD!" -IntervalSeconds 60
)

:after_remote_access_provider

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
goto :after_pm2_start

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
    powershell -NoProfile -Command "Start-Sleep -Seconds 3" >nul 2>&1
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
set "PUBLIC_URL_OK="
if not "!PUBLIC_URL_FOUND!"=="" (
    echo [INFO] Verifying public URL with Node HTTPS...
    set "BUSINESS_OS_STRICT_PUBLIC_INGRESS=1"
    node "%ROOT%\ops\scripts\runtime\check-public-url.mjs" "!PUBLIC_URL_FOUND!" "!CUSTOMER_PORTAL_PATH!" >"%TEMP%\bos_public_check.txt" 2>&1
    if not errorlevel 1 (
        if /I "!PUBLIC_URL_KIND!"=="cloudflare" (
            set "PUBLIC_URL_OK=1"
            echo [OK] Public URL verification passed.
            echo [%DATE% %TIME%] START verified Cloudflare public URL !PUBLIC_URL_FOUND!>>"%RUN_LOG%"
        ) else if defined TAILSCALE_NET_OK (
            set "PUBLIC_URL_OK=1"
            echo [OK] Public URL verification passed.
            echo [%DATE% %TIME%] START verified public URL !PUBLIC_URL_FOUND!>>"%RUN_LOG%"
        ) else (
            echo [WARN] Public route responded locally, but Tailscale relay health failed.
            type "%TEMP%\bos_public_check.txt"
            echo [%DATE% %TIME%] START warning: Tailscale relay health failed for !PUBLIC_URL_FOUND!>>"%RUN_LOG%"
        )
    ) else (
        echo [WARN] Public URL verification failed.
        type "%TEMP%\bos_public_check.txt"
        if /I "!PUBLIC_URL_KIND!"=="tailscale" (
            if defined TAILSCALE_CMD (
                echo [INFO] Resetting stale Tailscale Serve/Funnel config and retrying...
                powershell -NoProfile -Command "& '!TAILSCALE_CMD!' serve reset" >nul 2>&1
                powershell -NoProfile -Command "& '!TAILSCALE_CMD!' funnel --bg --yes 'http://127.0.0.1:%PORT%'" >nul 2>&1
                set "BUSINESS_OS_STRICT_PUBLIC_INGRESS=1"
                node "%ROOT%\ops\scripts\runtime\check-public-url.mjs" "!PUBLIC_URL_FOUND!" "!CUSTOMER_PORTAL_PATH!" >"%TEMP%\bos_public_check_retry.txt" 2>&1
                if not errorlevel 1 (
                    if defined TAILSCALE_NET_OK (
                        set "PUBLIC_URL_OK=1"
                        echo [OK] Public URL verification passed after Tailscale reset.
                        echo [%DATE% %TIME%] START repaired and verified public URL !PUBLIC_URL_FOUND!>>"%RUN_LOG%"
                    ) else (
                        echo [WARN] Public route responded after reset, but Tailscale relay health failed.
                        type "%TEMP%\bos_public_check_retry.txt"
                        echo [%DATE% %TIME%] START warning: Tailscale relay health failed after reset for !PUBLIC_URL_FOUND!>>"%RUN_LOG%"
                    )
                ) else (
                    echo [WARN] Public URL verification still failed after Tailscale reset.
                    type "%TEMP%\bos_public_check_retry.txt"
                    echo [%DATE% %TIME%] START warning: public URL verification failed for !PUBLIC_URL_FOUND!>>"%RUN_LOG%"
                )
                del "%TEMP%\bos_public_check_retry.txt" >nul 2>&1
            ) else (
                echo [WARN] Tailscale CLI is not available for automatic retry.
                echo [%DATE% %TIME%] START warning: public URL verification failed for !PUBLIC_URL_FOUND!>>"%RUN_LOG%"
            )
        ) else (
            echo [INFO] For Cloudflare, check %LOG_DIR%\cloudflared.log and Cloudflare Tunnel health.
            echo [%DATE% %TIME%] START warning: public URL verification failed for !PUBLIC_URL_FOUND!>>"%RUN_LOG%"
        )
    )
    del "%TEMP%\bos_public_check.txt" >nul 2>&1
)

echo.
echo ========================================================================
echo   Start Server Complete
echo ========================================================================
echo.
echo   Local Admin:  http://localhost:%PORT%
echo   Local Portal: http://localhost:%PORT%!CUSTOMER_PORTAL_PATH!
if not "!CLOUDFLARE_ADMIN_URL!"=="" echo   Remote Admin: !CLOUDFLARE_ADMIN_URL!
if not "!CUSTOMER_PUBLIC_URL!"=="" (
    echo   Customer URL: !CUSTOMER_PUBLIC_URL!
) else (
    if not "!PUBLIC_URL_FOUND!"=="" echo   Customer URL: !PUBLIC_URL_FOUND!!CUSTOMER_PORTAL_PATH!
)
if defined PUBLIC_URL_OK (
    echo   Public URL check: passed
) else (
    if not "!PUBLIC_URL_FOUND!"=="" echo   Public URL check: warning - see log output above
)
if not defined PUBLIC_URL_OK if not "!PUBLIC_URL_FOUND!"=="" (
    echo   Multi-device note: check the Cloudflare Tunnel status if public devices cannot connect.
)
echo.
echo   Factory-reset default login: admin / admin
echo   Data folder:   %DATA_DIR%
echo.
if "!USING_PM2!"=="1" (
    echo   Useful commands:
    echo     pm2 status
    echo     pm2 logs business-os
    echo     pm2 restart business-os --update-env
) else (
    echo   Process mode: Background node.exe
    echo   Use run\stop-server.bat to stop the server.
)
echo.
echo ========================================================================
echo.
echo Press any key to close this window (server keeps running in background)
powershell -NoProfile -Command "if (-not [Console]::IsInputRedirected) { Write-Host 'Press any key to close...'; $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') }" >nul 2>&1
exit /b 0
