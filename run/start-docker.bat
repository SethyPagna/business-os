@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Docker Runtime Launcher
REM
REM  Runs the app, import worker, and media worker in Docker. SQLite/local
REM  files remain the authoritative business data source until the verified
REM  Postgres/MinIO migration wizard is implemented and explicitly run.
REM ========================================================================

if defined BUSINESS_OS_REPO_ROOT (
    set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
    for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

if /I "%~1"=="--help" (
    echo Usage: run\start-docker.bat
    echo.
    echo Starts Docker scale services, Docker app/runtime containers, and Cloudflare Tunnel.
    echo Set BUSINESS_OS_CLOUDFLARED_RUNTIME=docker only after Cloudflare origins use http://app:4000.
    exit /b 0
)

set "ENV_FILE=%ROOT%\backend\.env"
set "LOG_DIR=%ROOT%\ops\runtime\logs"
set "COMPOSE_FILE=%ROOT%\ops\docker\compose.scale.yml"
set "DOCKER_ENV=%ROOT%\ops\runtime\docker-scale.env"
set "DOCKER_CONFIG=%ROOT%\ops\runtime\docker-config"
set "DOCKER_APP_LOG=%LOG_DIR%\docker-compose-app.log"
set "DOCKER_WORKER_LOG=%LOG_DIR%\docker-compose-workers.log"
set "DOCKER_TUNNEL_LOG=%LOG_DIR%\docker-compose-cloudflared.log"
set "PORT=4000"
set "LOCAL_API=http://127.0.0.1:4000"
set "PUBLIC_BASE_URL=https://leangcosmetics.dpdns.org"
set "CLOUDFLARE_PUBLIC_URL=https://leangcosmetics.dpdns.org"
set "CLOUDFLARE_ADMIN_URL=https://admin.leangcosmetics.dpdns.org"
set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%ROOT%\ops\runtime\secrets\cloudflare-business-os-leangcosmetics.token"
set "CLOUDFLARED_CMD="
set "DOCKER_CMD="
if not defined BUSINESS_OS_CLOUDFLARED_RUNTIME set "BUSINESS_OS_CLOUDFLARED_RUNTIME=host"

if exist "%ENV_FILE%" (
    for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PORT="') do set "PORT=%%a"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PUBLIC_BASE_URL="') do set "PUBLIC_BASE_URL=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^CLOUDFLARE_PUBLIC_URL="') do set "CLOUDFLARE_PUBLIC_URL=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^CLOUDFLARE_ADMIN_URL="') do set "CLOUDFLARE_ADMIN_URL=%%b"
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^CLOUDFLARE_TUNNEL_TOKEN_FILE="') do set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%%b"
)
if "%PORT%"=="" set "PORT=4000"
set "LOCAL_API=http://127.0.0.1:%PORT%"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
if not exist "%DOCKER_CONFIG%" mkdir "%DOCKER_CONFIG%" >nul 2>&1

echo.
echo ============================================================
echo   Business OS  ^|  Docker Runtime
echo ============================================================
echo.

echo [INFO] Preparing Docker services and runtime profile...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Start -StartServices -RequireServices
if errorlevel 1 (
    echo.
    echo [ERROR] Docker services are not ready. Open Docker Desktop, wait until it says Running, then retry.
    exit /b 1
)

for %%g in (docker.exe docker.cmd docker.bat docker) do (
    if not defined DOCKER_CMD (
        for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined DOCKER_CMD set "DOCKER_CMD=%%p"
    )
)
if not defined DOCKER_CMD (
    if exist "%ProgramFiles%\Docker\Docker\resources\bin\docker.exe" set "DOCKER_CMD=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"
)
if not defined DOCKER_CMD (
    echo [ERROR] Docker CLI was not found.
    exit /b 1
)

set "MINIO_LICENSE_HOST_FILE=%ROOT%\ops\runtime\secrets\minio.license"
set "CLOUDFLARE_TUNNEL_TOKEN_HOST_FILE=%CLOUDFLARE_TUNNEL_TOKEN_FILE%"
set "DATABASE_DRIVER=sqlite"
set "OBJECT_STORAGE_DRIVER=local"
set "BUSINESS_OS_REMOTE_PROVIDER=cloudflare"
set "PUBLIC_BASE_URL=%PUBLIC_BASE_URL%"
set "CLOUDFLARE_PUBLIC_URL=%CLOUDFLARE_PUBLIC_URL%"
set "CLOUDFLARE_ADMIN_URL=%CLOUDFLARE_ADMIN_URL%"

echo [INFO] Starting Docker app container...
"%DOCKER_CMD%" compose --env-file "%DOCKER_ENV%" -f "%COMPOSE_FILE%" --progress quiet --profile runtime up -d --remove-orphans app >"%DOCKER_APP_LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] Docker app runtime failed to start.
    type "%DOCKER_APP_LOG%"
    exit /b 1
)

if /I "%BUSINESS_OS_CLOUDFLARED_RUNTIME%"=="docker" (
    echo [INFO] Starting Cloudflare Tunnel inside Docker...
    "%DOCKER_CMD%" compose --env-file "%DOCKER_ENV%" -f "%COMPOSE_FILE%" --progress quiet --profile runtime --profile cloudflare-runtime up -d cloudflared >"%DOCKER_TUNNEL_LOG%" 2>&1
    if errorlevel 1 (
        echo [WARN] Docker Cloudflare Tunnel failed to start.
        type "%DOCKER_TUNNEL_LOG%"
    ) else (
        echo [OK] Docker Cloudflare Tunnel requested.
        echo      Cloudflare Tunnel public hostname origins must use: http://app:%PORT%
    )
) else (
    echo [INFO] Starting Cloudflare Tunnel on the host for the existing dashboard origin...
    set "EXISTING_CLOUDFLARED="
    for /f "tokens=2" %%p in ('tasklist /FI "IMAGENAME eq cloudflared.exe" /NH 2^>nul ^| findstr /i "cloudflared.exe"') do if not defined EXISTING_CLOUDFLARED set "EXISTING_CLOUDFLARED=%%p"
    if defined EXISTING_CLOUDFLARED (
        set "PUBLIC_HEALTH_STATUS=0"
        for /f "tokens=*" %%r in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri '%CLOUDFLARE_PUBLIC_URL%/health' -UseBasicParsing -TimeoutSec 5).StatusCode } catch { 0 }" 2^>nul') do set "PUBLIC_HEALTH_STATUS=%%r"
        if "!PUBLIC_HEALTH_STATUS!"=="200" (
            echo [OK] Existing host Cloudflare Tunnel process detected ^(PID !EXISTING_CLOUDFLARED!^).
            goto :after_cloudflare_start
        )
        echo [WARN] A cloudflared process exists, but the public health check is not passing. Starting this app's tunnel token too.
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
    if defined CLOUDFLARED_CMD if exist "%CLOUDFLARE_TUNNEL_TOKEN_FILE%" (
        powershell -NoProfile -Command "$tokenPath='%CLOUDFLARE_TUNNEL_TOKEN_FILE%'; Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { ([string]$_.CommandLine) -match [regex]::Escape($tokenPath) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
        powershell -NoProfile -Command "$argsList=@('tunnel','--no-autoupdate','--loglevel','warn','--logfile','%LOG_DIR%\cloudflared.log','run','--url','http://127.0.0.1:%PORT%','--token-file','%CLOUDFLARE_TUNNEL_TOKEN_FILE%'); $p = Start-Process -FilePath '%CLOUDFLARED_CMD%' -ArgumentList $argsList -WindowStyle Hidden -PassThru; if ($p) { exit 0 } else { exit 1 }" >nul 2>&1
        if errorlevel 1 (
            echo [WARN] Host Cloudflare Tunnel could not be started.
        ) else (
            echo [OK] Host Cloudflare Tunnel requested.
            echo      Cloudflare Tunnel public hostname origins should use: http://127.0.0.1:%PORT%
        )
    ) else (
        echo [WARN] cloudflared or its tunnel token file was not found. Remote access may be unavailable.
    )
)

:after_cloudflare_start

echo [INFO] Waiting for app health...
set "HEALTH_OK="
for /l %%N in (1,1,150) do (
    if not defined HEALTH_OK (
        for /f "tokens=*" %%r in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri %LOCAL_API%/health -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }" 2^>nul') do set "HTTP_STATUS=%%r"
        if "!HTTP_STATUS!"=="200" (
            set "HEALTH_OK=1"
        ) else (
            powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul 2>&1
        )
    )
)
if not defined HEALTH_OK (
    echo [ERROR] Docker app did not become healthy at %LOCAL_API%/health.
    echo         Run: run\scale-services.bat logs
    exit /b 1
)

echo [INFO] Starting Docker workers after app health is confirmed...
"%DOCKER_CMD%" compose --env-file "%DOCKER_ENV%" -f "%COMPOSE_FILE%" --progress quiet --profile runtime up -d import-worker media-worker >"%DOCKER_WORKER_LOG%" 2>&1
if errorlevel 1 (
    echo [WARN] Docker workers could not be started. Large imports/media jobs will stay queued.
    type "%DOCKER_WORKER_LOG%"
) else (
    echo [OK] Docker import and media workers are running or starting.
)

echo.
echo [DONE] Business OS Docker runtime is ready.
echo   Local Admin:  http://127.0.0.1:%PORT%
echo   Local Portal: http://127.0.0.1:%PORT%/public
echo   Remote Admin: %CLOUDFLARE_ADMIN_URL%
echo   Customer URL: %CLOUDFLARE_PUBLIC_URL%/public
echo.
exit /b 0
