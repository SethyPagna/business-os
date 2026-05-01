@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Packaged Release Launcher
REM ========================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "RUNTIME_DIR=%ROOT%\runtime"
set "LOG_DIR=%RUNTIME_DIR%\logs"
set "RUN_LOG=%LOG_DIR%\start-server.log"
set "EXE=%ROOT%\business-os-server.exe"
set "DATA_DIR=%ROOT%\business-os-data"
set "ENV_FILE=%ROOT%\.env"
set "PORT=4000"
set "CLOUDFLARED_CMD="
set "TAILSCALE_CMD="
set "CLOUDFLARE_TUNNEL_TOKEN_FILE=%ROOT%\runtime\secrets\cloudflare-business-os-leangcosmetics.token"
set "CLOUDFLARE_PUBLIC_URL=https://leangcosmetics.dpdns.org"

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

title Business OS ^| Server

if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%" >nul 2>&1
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%" >nul 2>&1
if not exist "%DATA_DIR%\organizations" mkdir "%DATA_DIR%\organizations" >nul 2>&1
echo [%DATE% %TIME%] START requested>>"%RUN_LOG%"

echo.
echo ========================================================================
echo   Business OS ^| Start Server
echo ========================================================================
echo.

if not exist "%EXE%" (
  echo [ERROR] business-os-server.exe not found.
  echo         Expected: %EXE%
  pause
  exit /b 1
)

if not exist "%ENV_FILE%" (
  echo [INFO] Creating default .env...
  (
    echo PORT=4000
    echo PUBLIC_BASE_URL=%CLOUDFLARE_PUBLIC_URL%
    echo CLOUDFLARE_PUBLIC_URL=%CLOUDFLARE_PUBLIC_URL%
    echo TAILSCALE_URL=
    echo SYNC_TOKEN=
    echo BUSINESS_OS_REQUIRE_SCALE_SERVICES=1
    echo JOB_QUEUE_DRIVER=bullmq
    echo REDIS_URL=redis://127.0.0.1:6379
    echo RUNTIME_CACHE_ENABLED=1
    echo CACHE_REDIS_URL=redis://127.0.0.1:6380
    echo DATABASE_DRIVER=sqlite
    echo OBJECT_STORAGE_DRIVER=local
    echo WORKER_RUNTIME=host
    echo SQLITE_BUSY_TIMEOUT_MS=30000
    echo SQLITE_CACHE_SIZE_KB=196608
    echo SQLITE_MMAP_SIZE_MB=1024
  ) > "%ENV_FILE%"
)

for /f "tokens=2 delims==" %%a in ('type "%ENV_FILE%" 2^>nul ^| findstr /i "^PORT="') do set "PORT=%%a"
if "%PORT%"=="" set "PORT=4000"
set "LOCAL_API=http://127.0.0.1:%PORT%"

echo [INFO] Starting required runtime services...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Start -StartServices -RequireServices
if errorlevel 1 (
  echo [ERROR] Required runtime services are not ready.
  pause
  exit /b 1
)

for %%g in (cloudflared.exe cloudflared.cmd cloudflared.bat cloudflared) do (
  if not defined CLOUDFLARED_CMD for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined CLOUDFLARED_CMD set "CLOUDFLARED_CMD=%%p"
)
if not defined CLOUDFLARED_CMD (
  for %%p in ("%ProgramFiles%\cloudflared\cloudflared.exe" "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" "%LOCALAPPDATA%\cloudflared\cloudflared.exe") do if exist "%%~p" if not defined CLOUDFLARED_CMD set "CLOUDFLARED_CMD=%%~p"
)

if defined CLOUDFLARED_CMD if exist "%CLOUDFLARE_TUNNEL_TOKEN_FILE%" (
  echo [INFO] Starting Cloudflare Tunnel...
  powershell -NoProfile -Command "$argsList=@('tunnel','--no-autoupdate','--loglevel','warn','--logfile','%LOG_DIR%\cloudflared.log','run','--url','http://127.0.0.1:%PORT%','--token-file','%CLOUDFLARE_TUNNEL_TOKEN_FILE%'); Start-Process -FilePath '%CLOUDFLARED_CMD%' -ArgumentList $argsList -WindowStyle Hidden | Out-Null" >nul 2>&1
)

for %%g in (tailscale.exe tailscale.cmd tailscale.bat tailscale) do (
  if not defined TAILSCALE_CMD for /f "tokens=*" %%p in ('where %%g 2^>nul') do if not defined TAILSCALE_CMD set "TAILSCALE_CMD=%%p"
)
if not defined TAILSCALE_CMD (
  for %%p in ("%ProgramFiles%\Tailscale\tailscale.exe" "%ProgramFiles(x86)%\Tailscale\tailscale.exe") do if exist "%%~p" if not defined TAILSCALE_CMD set "TAILSCALE_CMD=%%~p"
)
if defined TAILSCALE_CMD (
  powershell -NoProfile -Command "& '%TAILSCALE_CMD%' funnel --bg --yes 'http://127.0.0.1:%PORT%'" >nul 2>&1
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\tailscale-health-monitor.ps1" -Mode Start -Root "%ROOT%" -TailscalePath "%TAILSCALE_CMD%" -IntervalSeconds 60 >nul 2>&1
)

echo [INFO] Starting Business OS server...
powershell -NoProfile -Command "$p=Start-Process -FilePath '%EXE%' -WorkingDirectory '%ROOT%' -WindowStyle Hidden -PassThru; if($p){exit 0}else{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Could not launch business-os-server.exe.
  pause
  exit /b 1
)

echo [INFO] Starting import/media workers...
powershell -NoProfile -Command "$psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='%EXE%'; $psi.WorkingDirectory='%ROOT%'; $psi.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden; $psi.UseShellExecute=$false; $psi.EnvironmentVariables['BUSINESS_OS_WORKER_ROLE']='import-worker'; [System.Diagnostics.Process]::Start($psi) | Out-Null" >nul 2>&1
powershell -NoProfile -Command "$psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='%EXE%'; $psi.WorkingDirectory='%ROOT%'; $psi.WindowStyle=[System.Diagnostics.ProcessWindowStyle]::Hidden; $psi.UseShellExecute=$false; $psi.EnvironmentVariables['BUSINESS_OS_WORKER_ROLE']='media-worker'; [System.Diagnostics.Process]::Start($psi) | Out-Null" >nul 2>&1

echo [INFO] Waiting for server response...
set "SERVER_OK="
for /l %%N in (1,1,20) do (
  set "HTTP_STATUS=0"
  for /f "tokens=*" %%r in ('powershell -NoProfile -Command "try{(Invoke-WebRequest -Uri %LOCAL_API%/health -UseBasicParsing -TimeoutSec 3).StatusCode}catch{0}" 2^>nul') do set "HTTP_STATUS=%%r"
  if "!HTTP_STATUS!"=="200" (
    set "SERVER_OK=1"
    goto health_done
  )
  powershell -NoProfile -Command "Start-Sleep -Seconds 3" >nul 2>&1
)

:health_done
echo.
if defined SERVER_OK (
  echo [OK] Server is responding on %LOCAL_API%
) else (
  echo [WARN] Server started but health check is still waiting.
)
echo.
echo   Local Admin:  http://localhost:%PORT%
echo   Customer URL: %CLOUDFLARE_PUBLIC_URL%/public
echo   Data folder:  %DATA_DIR%
echo.
echo Press any key to close this window ^(server keeps running^).
powershell -NoProfile -Command "if (-not [Console]::IsInputRedirected) { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') }" >nul 2>&1
exit /b 0
