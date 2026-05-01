@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Packaged Release Launcher
REM
REM  Runtime flow:
REM    1. validate the packaged EXE and release data folders
REM    2. create a default .env if the release has never been started
REM    3. start/verify required Docker scale services
REM    4. stop stale listeners on the configured port
REM    5. start business-os-server.exe in the background
REM    6. wait for /health and print local/remote/customer URLs
REM ========================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "RUNTIME_DIR=%ROOT%\runtime"
set "LOG_DIR=%RUNTIME_DIR%\logs"
set "RUN_LOG=%LOG_DIR%\start-server.log"
set "EXE=%ROOT%\business-os-server.exe"
set "DATA_DIR=%ROOT%\business-os-data"
set "PKG_NATIVE_CACHE_DIR=%DATA_DIR%\pkg-native-cache"
set "ENV_FILE=%ROOT%\.env"
set "TAILSCALE_CMD="
set "DEFAULT_GOOGLE_DRIVE_CLIENT_ID=%GOOGLE_DRIVE_CLIENT_ID%"
set "DEFAULT_GOOGLE_DRIVE_CLIENT_SECRET=%GOOGLE_DRIVE_CLIENT_SECRET%"
set "DEFAULT_GOOGLE_DRIVE_OAUTH_REDIRECT_URI=%GOOGLE_DRIVE_OAUTH_REDIRECT_URI%"
if "%DEFAULT_GOOGLE_DRIVE_OAUTH_REDIRECT_URI%"=="" set "DEFAULT_GOOGLE_DRIVE_OAUTH_REDIRECT_URI=https://leangcosmetics.crane-qilin.ts.net/api/system/drive-sync/oauth/callback"
set "BUSINESS_OS_REQUIRE_SCALE_SERVICES=1"
set "JOB_QUEUE_DRIVER=bullmq"
set "WORKER_RUNTIME=host"
if not defined REDIS_URL set "REDIS_URL=redis://127.0.0.1:6379"
if not defined DATABASE_DRIVER set "DATABASE_DRIVER=sqlite"
if not defined OBJECT_STORAGE_DRIVER set "OBJECT_STORAGE_DRIVER=local"
if not defined IMPORT_QUEUE_CONCURRENCY set "IMPORT_QUEUE_CONCURRENCY=1"
if not defined MEDIA_QUEUE_CONCURRENCY set "MEDIA_QUEUE_CONCURRENCY=2"
if not defined IMPORT_ROW_BATCH_SIZE set "IMPORT_ROW_BATCH_SIZE=300"
if not defined IMPORT_BATCH_PAUSE_MS set "IMPORT_BATCH_PAUSE_MS=50"
if not defined UPLOAD_CHUNK_MB set "UPLOAD_CHUNK_MB=8"

title Business OS  ^|  Server

echo.
echo ========================================================================
echo   Business OS  ^|  Start Server
echo ========================================================================
echo.

pushd "%ROOT%" >nul 2>&1
if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%" >nul 2>&1
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
echo [%DATE% %TIME%] START requested (port-check pending)>>"%RUN_LOG%"
if errorlevel 1 (
    echo [ERROR] Could not switch to the release folder.
    echo         Expected: %ROOT%
    echo.
    pause
    echo [%DATE% %TIME%] START failed: invalid working directory>>"%RUN_LOG%"
    exit /b 1
)

if not exist "%EXE%" (
    echo [ERROR] business-os-server.exe not found.
    echo         Expected: %EXE%
    echo.
    pause
    echo [%DATE% %TIME%] START failed: missing business-os-server.exe>>"%RUN_LOG%"
    exit /b 1
)
echo [OK] Found: business-os-server.exe

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\organizations" mkdir "%DATA_DIR%\organizations"
if not exist "%PKG_NATIVE_CACHE_DIR%" mkdir "%PKG_NATIVE_CACHE_DIR%"
set "PKG_NATIVE_CACHE_PATH=%PKG_NATIVE_CACHE_DIR%"
echo [OK] Data directories ready

if not exist "%ENV_FILE%" (
    echo [INFO] Creating default .env at %ENV_FILE%
    (
        echo PORT=4000
        echo TAILSCALE_URL=
        echo SYNC_TOKEN=
        echo # Provide real Google Drive app credentials via the local .env or machine environment.
        echo GOOGLE_DRIVE_CLIENT_ID=!DEFAULT_GOOGLE_DRIVE_CLIENT_ID!
        echo GOOGLE_DRIVE_CLIENT_SECRET=!DEFAULT_GOOGLE_DRIVE_CLIENT_SECRET!
        echo GOOGLE_DRIVE_OAUTH_REDIRECT_URI=!DEFAULT_GOOGLE_DRIVE_OAUTH_REDIRECT_URI!
        echo.
        echo # Required local scale services ^(started automatically by start-server.bat^)
        echo BUSINESS_OS_REQUIRE_SCALE_SERVICES=1
        echo JOB_QUEUE_DRIVER=bullmq
        echo REDIS_URL=redis://127.0.0.1:6379
        echo DATABASE_DRIVER=sqlite
        echo DATABASE_URL=
        echo OBJECT_STORAGE_DRIVER=local
        echo S3_ENDPOINT=http://127.0.0.1:9000
        echo S3_ACCESS_KEY_ID=
        echo S3_SECRET_ACCESS_KEY=
        echo S3_BUCKET=business-os-assets
        echo MINIO_LICENSE_FILE=
        echo WORKER_RUNTIME=host
        echo IMPORT_QUEUE_CONCURRENCY=1
        echo MEDIA_QUEUE_CONCURRENCY=2
        echo IMPORT_ROW_BATCH_SIZE=300
        echo IMPORT_BATCH_PAUSE_MS=50
        echo IMPORT_IMAGE_CONCURRENCY=3
        echo UPLOAD_CHUNK_MB=8
        echo IMPORT_MAX_CSV_MB=80
        echo IMPORT_MAX_ZIP_MB=2048
        echo.
        echo # ---- Security / Verification Providers ----
        echo # APP_ENCRYPTION_KEY=
        echo # RESEND_API_KEY=
        echo # RESEND_FROM_EMAIL=
        echo # SENDGRID_API_KEY=
        echo # SENDGRID_FROM_EMAIL=
        echo # EMAIL_WEBHOOK_URL=
        echo # SMS verification is disabled in this build.
        echo # SUPABASE_AUTH_ENABLED=false
        echo # SUPABASE_URL=
        echo # SUPABASE_ANON_KEY=
        echo # SUPABASE_SERVICE_ROLE_KEY=
        echo # SUPABASE_EMAIL_AUTH_ENABLED=true
        echo # SUPABASE_MAGIC_LINK_ENABLED=true
        echo # SUPABASE_INVITE_ENABLED=true
        echo # SUPABASE_GOOGLE_OAUTH_ENABLED=false
        echo # SUPABASE_FACEBOOK_OAUTH_ENABLED=false
        echo # SUPABASE_MFA_TOTP_ENABLED=false
    ) > "%ENV_FILE%"
    echo [OK] Default .env created.
)

echo.
echo [INFO] Starting required runtime services...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Start -StartServices -RequireServices
if errorlevel 1 (
    echo.
    echo [ERROR] Required runtime services are not ready.
    echo         Open Docker Desktop, finish any setup/restart prompts, then run start-server.bat again.
    echo.
    pause
    echo [%DATE% %TIME%] START failed: runtime bootstrap failed>>"%RUN_LOG%"
    exit /b 1
)

set "PORT=4000"
set "LOCAL_API=http://127.0.0.1:4000"
for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PORT="') do set "PORT=%%a"
set "LOCAL_API=http://127.0.0.1:%PORT%"

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

echo [INFO] Checking if port %PORT% is available...

set "PORT_PID="
netstat -ano > "%TEMP%\bos_netstat.txt" 2>nul
findstr /c:":%PORT% " "%TEMP%\bos_netstat.txt" | findstr /i /c:"LISTENING" > "%TEMP%\bos_listening.txt" 2>nul
for /f "usebackq tokens=5" %%P in ("%TEMP%\bos_listening.txt") do if not defined PORT_PID set "PORT_PID=%%P"
del "%TEMP%\bos_netstat.txt" "%TEMP%\bos_listening.txt" 2>nul

if defined PORT_PID (
    echo [WARN] Port %PORT% is already in use by process PID !PORT_PID!.
    powershell -Command "if (Get-Process business-os-server -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        echo [INFO] Stopping existing Business OS instance...
        powershell -Command "Stop-Process -Name 'business-os-server' -Force -ErrorAction Stop" >nul 2>&1
        timeout /t 3 /nobreak >nul
    ) else (
        echo [ERROR] Port %PORT% is taken by a different program.
        echo         Change PORT= in %ENV_FILE% to a free port ^(e.g. 4001^).
        echo.
        pause
        exit /b 1
    )
) else (
    powershell -Command "if (Get-Process business-os-server -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        echo [INFO] Stopping stale Business OS instance...
        powershell -Command "Stop-Process -Name 'business-os-server' -Force -ErrorAction Stop" >nul 2>&1
        timeout /t 2 /nobreak >nul
    )
)

echo.
echo [INFO] Checking Tailscale for remote access...
set "TAILSCALE_URL_FOUND="

if defined TAILSCALE_CMD (
    echo [INFO] Using Tailscale CLI: !TAILSCALE_CMD!
    echo [INFO] Starting Tailscale Funnel on port %PORT%...
    call "!TAILSCALE_CMD!" funnel --bg --yes "http://127.0.0.1:%PORT%" >nul 2>&1
    if not errorlevel 1 (
        for /l %%N in (1,1,6) do (
            if "!TAILSCALE_URL_FOUND!"=="" (
                powershell -Command "$tailscale='!TAILSCALE_CMD!'; $url=''; $port='%PORT%'; try { $lines=@(& $tailscale funnel status 2>$null); $current=''; foreach($raw in $lines){ $line=[string]$raw; if($line -match '^(https://\S+)\s+\(Funnel on\)\s*$'){ $current=$matches[1].TrimEnd('/'); continue } if($current -and $line -match '^\|--\s+/\s+proxy\s+http://(?:127\.0\.0\.1|localhost):(\d+)\s*$'){ $mapped=[int]$matches[1]; if($mapped -eq [int]$port){ $url=$current; break }; $current='' } } } catch {}; try { if(-not $url){ $status=(& $tailscale status --json 2>$null | ConvertFrom-Json); $dns=[string]$status.Self.DNSName; if($dns){ $url=('https://'+$dns.TrimEnd('.')).TrimEnd('/') } } } catch {}; if($url){ [Console]::WriteLine($url.TrimEnd('/')) }" > "%TEMP%\ts_url.txt" 2>nul
                if exist "%TEMP%\ts_url.txt" (
                    set /p TAILSCALE_URL_FOUND=<"%TEMP%\ts_url.txt"
                    del "%TEMP%\ts_url.txt" 2>nul
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
            echo [OK] Tailscale Funnel started ^(run: tailscale funnel status^)
        )
    ) else (
        echo [WARN] Tailscale funnel failed. Enable HTTPS and Funnel ACLs.
        echo      If output shows "Access is denied", run this script as Administrator.
    )
) else (
    echo [INFO] Tailscale CLI not found. Local access only.
)

if defined TAILSCALE_CMD (
    echo [INFO] Checking Tailscale relay health...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\tailscale-health-monitor.ps1" -Mode RepairOnce -Root "%ROOT%" -TailscalePath "!TAILSCALE_CMD!" -IntervalSeconds 60
    if errorlevel 1 (
        echo [WARN] Tailscale relay health is still degraded. Other devices may time out until the network/VPN allows relay access.
    )
    echo [INFO] Starting Tailscale health monitor...
    powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\tailscale-health-monitor.ps1" -Mode Start -Root "%ROOT%" -TailscalePath "!TAILSCALE_CMD!" -IntervalSeconds 60
)

echo.
echo [INFO] Starting Business OS server...
REM The first packaged launch may spend time extracting native assets.
echo [INFO] First launch extracts files - may take up to 60 seconds.
powershell -Command "$p = Start-Process -FilePath '%EXE%' -WorkingDirectory '%ROOT%' -WindowStyle Hidden -PassThru; if ($p) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Could not launch business-os-server.exe.
    pause
    exit /b 1
)

set "PROC_WAIT=0"
:wait_for_proc
powershell -Command "if (Get-Process business-os-server -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [OK] Server process is running.
    goto proc_found
)
if !PROC_WAIT! LSS 10 (
    set /a PROC_WAIT+=1
    echo [INFO] Waiting for process... ^(!PROC_WAIT!/10^)
    timeout /t 2 /nobreak >nul
    goto wait_for_proc
)
echo [ERROR] Server failed to start. Try running as Administrator.
pause
exit /b 1

:proc_found
echo [INFO] Starting background import/media workers...
powershell -NoProfile -Command "$psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='%EXE%'; $psi.WorkingDirectory='%ROOT%'; $psi.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden; $psi.UseShellExecute=$false; $psi.EnvironmentVariables['BUSINESS_OS_WORKER_ROLE']='import-worker'; $p=[System.Diagnostics.Process]::Start($psi); if($p){exit 0}else{exit 1}" >nul 2>&1
if errorlevel 1 (
    echo [WARN] Import worker could not be started. Large imports will stay queued until a worker is available.
) else (
    echo [OK] Import worker started.
)
powershell -NoProfile -Command "$psi = New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='%EXE%'; $psi.WorkingDirectory='%ROOT%'; $psi.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden; $psi.UseShellExecute=$false; $psi.EnvironmentVariables['BUSINESS_OS_WORKER_ROLE']='media-worker'; $p=[System.Diagnostics.Process]::Start($psi); if($p){exit 0}else{exit 1}" >nul 2>&1
if errorlevel 1 (
    echo [WARN] Media worker could not be started. Media optimization will stay queued until a worker is available.
) else (
    echo [OK] Media worker started.
)

echo [INFO] Waiting for server to respond on port %PORT%...
set "SERVER_OK="
set "RETRY=0"

:health_retry
powershell -Command "if (Get-Process business-os-server -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Server crashed during startup.
    pause
    exit /b 1
)

set "HTTP_STATUS=0"
for /f "tokens=*" %%r in ('powershell -Command "try{(Invoke-WebRequest -Uri %LOCAL_API%/health -UseBasicParsing -TimeoutSec 3).StatusCode}catch{0}" 2^>nul') do set "HTTP_STATUS=%%r"
if "!HTTP_STATUS!"=="200" (
    set "SERVER_OK=1"
    echo [OK] Server is responding on http://localhost:%PORT%
    echo [%DATE% %TIME%] START succeeded on port %PORT%>>"%RUN_LOG%"
    goto health_done
)
if !RETRY! LSS 20 (
    set /a RETRY+=1
    timeout /t 3 /nobreak >nul
    goto health_retry
)
echo [WARN] Server did not respond after 60 seconds.
echo [%DATE% %TIME%] START warning: health check timed out on port %PORT%>>"%RUN_LOG%"

:health_done
set "CUSTOMER_PORTAL_PATH=/customer-portal"
for /f "tokens=*" %%r in ('powershell -Command "try { $cfg = Invoke-RestMethod -Uri %LOCAL_API%/api/portal/config -UseBasicParsing -TimeoutSec 3; if ($cfg.publicPath) { [Console]::WriteLine([string]$cfg.publicPath) } } catch {}" 2^>nul') do set "CUSTOMER_PORTAL_PATH=%%r"
if not "!CUSTOMER_PORTAL_PATH!"=="" if not "!CUSTOMER_PORTAL_PATH:~0,1!"=="/" set "CUSTOMER_PORTAL_PATH=/!CUSTOMER_PORTAL_PATH!"
set "CUSTOMER_PUBLIC_URL="
for /f "tokens=*" %%r in ('powershell -Command "try { $cfg = Invoke-RestMethod -Uri %LOCAL_API%/api/portal/config -UseBasicParsing -TimeoutSec 3; if ($cfg.publicUrl) { [Console]::WriteLine([string]$cfg.publicUrl) } } catch {}" 2^>nul') do set "CUSTOMER_PUBLIC_URL=%%r"

echo.
echo ========================================================================
echo   Business OS  -  Running
echo ========================================================================
echo.
echo   Local:   http://localhost:%PORT%
echo   Portal:  http://localhost:%PORT%!CUSTOMER_PORTAL_PATH!
if not "!TAILSCALE_URL_FOUND!"=="" echo   Remote:  !TAILSCALE_URL_FOUND!
if not "!CUSTOMER_PUBLIC_URL!"=="" (
echo   Customer: !CUSTOMER_PUBLIC_URL!
) else (
  if not "!TAILSCALE_URL_FOUND!"=="" echo   Customer: !TAILSCALE_URL_FOUND!!CUSTOMER_PORTAL_PATH!
)
echo.
echo   Customer portal uses the Portal path above by default.
echo   Set a different public customer URL inside Customer Portal settings if needed.
echo.
echo   Default login:  admin / admin
echo   Data folder:    %DATA_DIR%
echo   To stop:        stop-server.bat
echo.
echo ========================================================================
echo.
echo Server is running. You can close this window ^(server stays running^).
pause

popd >nul 2>&1
