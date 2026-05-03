@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Source Setup
REM
REM  One-time workstation bootstrap:
REM    1. install/verify Windows prerequisites where possible
REM    2. start required Business OS Docker services
REM    3. create the default business-os-data folders
REM    4. write backend/.env while preserving important existing secrets
REM    5. install backend/frontend dependencies
REM    6. build the frontend
REM    7. install PM2 when available
REM ========================================================================

if defined BUSINESS_OS_REPO_ROOT (
    set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
    for %%I in ("%~dp0..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "DATA_DIR=%ROOT%\business-os-data"
set "ENV_FILE=%ROOT%\backend\.env"

echo.
echo ========================================================================
echo   Business OS  ^|  Setup
echo ========================================================================
echo.
echo   Run ONCE on a source checkout to install dependencies and build the frontend.
echo   After setup, double-click Start Business OS.bat to launch.
echo.

REM ---- Workstation/runtime bootstrap --------------------------------------
echo [INFO] Preparing Windows prerequisites and required runtime services...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\runtime-bootstrap.ps1" -Mode Setup -InstallMissing -StartServices -RequireServices
if errorlevel 1 (
    echo.
    echo [ERROR] Runtime bootstrap failed.
    echo         Finish any installer, administrator, Docker Desktop, or restart prompt, then run run\setup.bat again.
    echo         Support command: run\docker\doctor.bat
    echo.
    pause
    exit /b 1
)

REM ---- Node.js check -------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    echo         Download from: https://nodejs.org  ^(LTS version^)
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

REM ---- Create data directories --------------------------------------------
echo.
echo [INFO] Creating data directories...
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%DATA_DIR%\organizations" mkdir "%DATA_DIR%\organizations"
echo [OK] Data root: %DATA_DIR%
echo [OK] Organizations root: %DATA_DIR%\organizations

REM ---- Write .env (preserve existing SYNC_TOKEN and provider settings) ---
echo.
echo [INFO] Writing backend configuration...
set "EXISTING_REMOTE_PROVIDER="
set "EXISTING_TAILSCALE_URL="
set "EXISTING_PUBLIC_BASE_URL="
set "EXISTING_CLOUDFLARE_PUBLIC_URL="
set "EXISTING_CLOUDFLARE_ADMIN_URL="
set "EXISTING_CLOUDFLARE_ACCOUNT_ID="
set "EXISTING_CLOUDFLARE_ZONE_ID="
set "EXISTING_CLOUDFLARE_TUNNEL_ID="
set "EXISTING_CLOUDFLARE_TUNNEL_TOKEN_FILE="
set "EXISTING_APP_RUNTIME="
set "EXISTING_TOKEN="
set "EXISTING_APP_ENCRYPTION_KEY="
set "EXISTING_RESEND_API_KEY="
set "EXISTING_RESEND_FROM_EMAIL="
set "EXISTING_SENDGRID_API_KEY="
set "EXISTING_SENDGRID_FROM_EMAIL="
set "EXISTING_EMAIL_WEBHOOK_URL="
set "EXISTING_TWILIO_ACCOUNT_SID="
set "EXISTING_TWILIO_AUTH_TOKEN="
set "EXISTING_TWILIO_FROM_NUMBER="
set "EXISTING_SMS_WEBHOOK_URL="
set "EXISTING_SUPABASE_AUTH_ENABLED="
set "EXISTING_SUPABASE_URL="
set "EXISTING_SUPABASE_ANON_KEY="
set "EXISTING_SUPABASE_SERVICE_ROLE_KEY="
set "EXISTING_SUPABASE_EMAIL_AUTH_ENABLED="
set "EXISTING_SUPABASE_MAGIC_LINK_ENABLED="
set "EXISTING_SUPABASE_INVITE_ENABLED="
set "EXISTING_SUPABASE_GOOGLE_OAUTH_ENABLED="
set "EXISTING_SUPABASE_FACEBOOK_OAUTH_ENABLED="
set "EXISTING_SUPABASE_MFA_TOTP_ENABLED="
set "EXISTING_GOOGLE_DRIVE_CLIENT_ID="
set "EXISTING_GOOGLE_DRIVE_CLIENT_SECRET="
set "EXISTING_GOOGLE_DRIVE_OAUTH_REDIRECT_URI="
if exist "%ENV_FILE%" (
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^TAILSCALE_URL"') do (
        set "EXISTING_TAILSCALE_URL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^BUSINESS_OS_REMOTE_PROVIDER"') do (
        set "EXISTING_REMOTE_PROVIDER=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^PUBLIC_BASE_URL"') do (
        set "EXISTING_PUBLIC_BASE_URL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^CLOUDFLARE_PUBLIC_URL"') do (
        set "EXISTING_CLOUDFLARE_PUBLIC_URL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^CLOUDFLARE_ADMIN_URL"') do (
        set "EXISTING_CLOUDFLARE_ADMIN_URL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^CLOUDFLARE_ACCOUNT_ID"') do (
        set "EXISTING_CLOUDFLARE_ACCOUNT_ID=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^CLOUDFLARE_ZONE_ID"') do (
        set "EXISTING_CLOUDFLARE_ZONE_ID=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^CLOUDFLARE_TUNNEL_ID"') do (
        set "EXISTING_CLOUDFLARE_TUNNEL_ID=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^CLOUDFLARE_TUNNEL_TOKEN_FILE"') do (
        set "EXISTING_CLOUDFLARE_TUNNEL_TOKEN_FILE=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^BUSINESS_OS_APP_RUNTIME"') do (
        set "EXISTING_APP_RUNTIME=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SYNC_TOKEN"') do (
        set "EXISTING_TOKEN=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^APP_ENCRYPTION_KEY"') do (
        set "EXISTING_APP_ENCRYPTION_KEY=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^RESEND_API_KEY"') do (
        set "EXISTING_RESEND_API_KEY=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^RESEND_FROM_EMAIL"') do (
        set "EXISTING_RESEND_FROM_EMAIL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SENDGRID_API_KEY"') do (
        set "EXISTING_SENDGRID_API_KEY=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SENDGRID_FROM_EMAIL"') do (
        set "EXISTING_SENDGRID_FROM_EMAIL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^EMAIL_WEBHOOK_URL"') do (
        set "EXISTING_EMAIL_WEBHOOK_URL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^TWILIO_ACCOUNT_SID"') do (
        set "EXISTING_TWILIO_ACCOUNT_SID=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^TWILIO_AUTH_TOKEN"') do (
        set "EXISTING_TWILIO_AUTH_TOKEN=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^TWILIO_FROM_NUMBER"') do (
        set "EXISTING_TWILIO_FROM_NUMBER=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SMS_WEBHOOK_URL"') do (
        set "EXISTING_SMS_WEBHOOK_URL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_AUTH_ENABLED"') do (
        set "EXISTING_SUPABASE_AUTH_ENABLED=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_URL"') do (
        set "EXISTING_SUPABASE_URL=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_ANON_KEY"') do (
        set "EXISTING_SUPABASE_ANON_KEY=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_SERVICE_ROLE_KEY"') do (
        set "EXISTING_SUPABASE_SERVICE_ROLE_KEY=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_EMAIL_AUTH_ENABLED"') do (
        set "EXISTING_SUPABASE_EMAIL_AUTH_ENABLED=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_MAGIC_LINK_ENABLED"') do (
        set "EXISTING_SUPABASE_MAGIC_LINK_ENABLED=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_INVITE_ENABLED"') do (
        set "EXISTING_SUPABASE_INVITE_ENABLED=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_GOOGLE_OAUTH_ENABLED"') do (
        set "EXISTING_SUPABASE_GOOGLE_OAUTH_ENABLED=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_FACEBOOK_OAUTH_ENABLED"') do (
        set "EXISTING_SUPABASE_FACEBOOK_OAUTH_ENABLED=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^SUPABASE_MFA_TOTP_ENABLED"') do (
        set "EXISTING_SUPABASE_MFA_TOTP_ENABLED=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^GOOGLE_DRIVE_CLIENT_ID"') do (
        set "EXISTING_GOOGLE_DRIVE_CLIENT_ID=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^GOOGLE_DRIVE_CLIENT_SECRET"') do (
        set "EXISTING_GOOGLE_DRIVE_CLIENT_SECRET=%%b"
    )
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^GOOGLE_DRIVE_OAUTH_REDIRECT_URI"') do (
        set "EXISTING_GOOGLE_DRIVE_OAUTH_REDIRECT_URI=%%b"
    )
)
if "!EXISTING_GOOGLE_DRIVE_CLIENT_ID!"=="" set "EXISTING_GOOGLE_DRIVE_CLIENT_ID=%GOOGLE_DRIVE_CLIENT_ID%"
if "!EXISTING_GOOGLE_DRIVE_CLIENT_SECRET!"=="" set "EXISTING_GOOGLE_DRIVE_CLIENT_SECRET=%GOOGLE_DRIVE_CLIENT_SECRET%"
if "!EXISTING_GOOGLE_DRIVE_OAUTH_REDIRECT_URI!"=="" set "EXISTING_GOOGLE_DRIVE_OAUTH_REDIRECT_URI=%GOOGLE_DRIVE_OAUTH_REDIRECT_URI%"
if not "%BUSINESS_OS_REMOTE_PROVIDER%"=="" set "EXISTING_REMOTE_PROVIDER=%BUSINESS_OS_REMOTE_PROVIDER%"
if "!EXISTING_REMOTE_PROVIDER!"=="" set "EXISTING_REMOTE_PROVIDER=cloudflare"
if "!EXISTING_PUBLIC_BASE_URL!"=="" set "EXISTING_PUBLIC_BASE_URL=https://leangcosmetics.dpdns.org"
if "!EXISTING_CLOUDFLARE_PUBLIC_URL!"=="" set "EXISTING_CLOUDFLARE_PUBLIC_URL=https://leangcosmetics.dpdns.org"
if "!EXISTING_CLOUDFLARE_ADMIN_URL!"=="" set "EXISTING_CLOUDFLARE_ADMIN_URL=https://admin.leangcosmetics.dpdns.org"
if "!EXISTING_CLOUDFLARE_ACCOUNT_ID!"=="" set "EXISTING_CLOUDFLARE_ACCOUNT_ID=743e5b727d139e85ed11679097f6f99e"
if "!EXISTING_CLOUDFLARE_ZONE_ID!"=="" set "EXISTING_CLOUDFLARE_ZONE_ID=c5f99cba9062112ef5f73f9baa4fdbd6"
if "!EXISTING_CLOUDFLARE_TUNNEL_ID!"=="" set "EXISTING_CLOUDFLARE_TUNNEL_ID=b6d18448-a7eb-45ae-8a45-e19a3647130d"
if "!EXISTING_CLOUDFLARE_TUNNEL_TOKEN_FILE!"=="" set "EXISTING_CLOUDFLARE_TUNNEL_TOKEN_FILE=%ROOT%\ops\runtime\secrets\cloudflare-business-os-leangcosmetics.token"
if "!EXISTING_APP_RUNTIME!"=="" set "EXISTING_APP_RUNTIME=docker"
if "!EXISTING_GOOGLE_DRIVE_OAUTH_REDIRECT_URI!"=="" set "EXISTING_GOOGLE_DRIVE_OAUTH_REDIRECT_URI=https://leangcosmetics.dpdns.org/api/system/drive-sync/oauth/callback"
(
    echo # Business OS - Backend Configuration
    echo # Generated by setup.bat
    echo.
    echo PORT=4000
    echo.
    echo # Remote access provider. Cloudflare is the normal public route.
    echo BUSINESS_OS_REMOTE_PROVIDER=!EXISTING_REMOTE_PROVIDER!
    if /I "!EXISTING_REMOTE_PROVIDER!"=="tailscale" echo TAILSCALE_URL=!EXISTING_TAILSCALE_URL!
    echo.
    echo # Cloudflare Tunnel custom domain
    echo PUBLIC_BASE_URL=!EXISTING_PUBLIC_BASE_URL!
    echo CLOUDFLARE_PUBLIC_URL=!EXISTING_CLOUDFLARE_PUBLIC_URL!
    echo CLOUDFLARE_ADMIN_URL=!EXISTING_CLOUDFLARE_ADMIN_URL!
    echo CLOUDFLARE_ACCOUNT_ID=!EXISTING_CLOUDFLARE_ACCOUNT_ID!
    echo CLOUDFLARE_ZONE_ID=!EXISTING_CLOUDFLARE_ZONE_ID!
    echo CLOUDFLARE_TUNNEL_ID=!EXISTING_CLOUDFLARE_TUNNEL_ID!
    echo CLOUDFLARE_TUNNEL_TOKEN_FILE=!EXISTING_CLOUDFLARE_TUNNEL_TOKEN_FILE!
    echo.
    echo # Optional extra security token.
    echo SYNC_TOKEN=!EXISTING_TOKEN!
    echo.
    echo # OTP secret encryption key ^(32-byte key as hex/base64^)
    echo APP_ENCRYPTION_KEY=!EXISTING_APP_ENCRYPTION_KEY!
    echo.
    echo # Email verification providers ^(choose one^)
    echo RESEND_API_KEY=!EXISTING_RESEND_API_KEY!
    echo RESEND_FROM_EMAIL=!EXISTING_RESEND_FROM_EMAIL!
    echo SENDGRID_API_KEY=!EXISTING_SENDGRID_API_KEY!
    echo SENDGRID_FROM_EMAIL=!EXISTING_SENDGRID_FROM_EMAIL!
    echo EMAIL_WEBHOOK_URL=!EXISTING_EMAIL_WEBHOOK_URL!
    echo.
    echo # SMS verification is disabled in this build.
    echo.
    echo # Optional: Supabase Auth provider ^(Auth only - Business OS Postgres remains authoritative^)
    echo SUPABASE_AUTH_ENABLED=!EXISTING_SUPABASE_AUTH_ENABLED!
    echo SUPABASE_URL=!EXISTING_SUPABASE_URL!
    echo SUPABASE_ANON_KEY=!EXISTING_SUPABASE_ANON_KEY!
    echo SUPABASE_SERVICE_ROLE_KEY=!EXISTING_SUPABASE_SERVICE_ROLE_KEY!
    echo SUPABASE_EMAIL_AUTH_ENABLED=!EXISTING_SUPABASE_EMAIL_AUTH_ENABLED!
    echo SUPABASE_MAGIC_LINK_ENABLED=!EXISTING_SUPABASE_MAGIC_LINK_ENABLED!
    echo SUPABASE_INVITE_ENABLED=!EXISTING_SUPABASE_INVITE_ENABLED!
    echo SUPABASE_GOOGLE_OAUTH_ENABLED=!EXISTING_SUPABASE_GOOGLE_OAUTH_ENABLED!
    echo SUPABASE_FACEBOOK_OAUTH_ENABLED=!EXISTING_SUPABASE_FACEBOOK_OAUTH_ENABLED!
    echo SUPABASE_MFA_TOTP_ENABLED=!EXISTING_SUPABASE_MFA_TOTP_ENABLED!
    echo.
    echo # Google Drive sync defaults ^(preserved unless explicitly forgotten^)
    echo # Leave client ID/secret blank in source control; keep real values in your local .env or machine environment.
    echo GOOGLE_DRIVE_CLIENT_ID=!EXISTING_GOOGLE_DRIVE_CLIENT_ID!
    echo GOOGLE_DRIVE_CLIENT_SECRET=!EXISTING_GOOGLE_DRIVE_CLIENT_SECRET!
    echo GOOGLE_DRIVE_OAUTH_REDIRECT_URI=!EXISTING_GOOGLE_DRIVE_OAUTH_REDIRECT_URI!
    echo.
    echo # Required local Docker services ^(started automatically by setup/start^)
    echo BUSINESS_OS_APP_RUNTIME=!EXISTING_APP_RUNTIME!
    echo BUSINESS_OS_REQUIRE_SCALE_SERVICES=1
    echo JOB_QUEUE_DRIVER=bullmq
    echo REDIS_URL=redis://127.0.0.1:6379
    echo RUNTIME_CACHE_ENABLED=1
    echo CACHE_REDIS_URL=redis://127.0.0.1:6380
    echo DATABASE_DRIVER=postgres
    echo DATABASE_URL=postgres://business_os:business_os_dev@127.0.0.1:55432/business_os
echo OBJECT_STORAGE_DRIVER=r2
    echo S3_ENDPOINT=http://127.0.0.1:9000
    echo S3_ACCESS_KEY_ID=
    echo S3_SECRET_ACCESS_KEY=
    echo S3_BUCKET=business-os-assets
    echo MINIO_LICENSE_FILE=
    echo IMPORT_QUEUE_CONCURRENCY=1
    echo MEDIA_QUEUE_CONCURRENCY=4
    echo IMPORT_WORKER_REPLICAS=2
    echo MEDIA_WORKER_REPLICAS=2
    echo IMPORT_ROW_BATCH_SIZE=400
    echo IMPORT_BATCH_PAUSE_MS=20
    echo IMPORT_IMAGE_CONCURRENCY=4
    echo SEARCH_CACHE_TTL_SECONDS=15
    echo POSTGRES_ENABLE_SEARCH_EXTENSIONS=1
    echo UPLOAD_CHUNK_MB=12
    echo IMPORT_MAX_CSV_MB=80
    echo IMPORT_MAX_ZIP_MB=2048
) > "%ENV_FILE%"
echo [OK] Written: %ENV_FILE%

REM ---- Backend dependencies -----------------------------------------------
echo.
echo [INFO] Installing backend dependencies...
cd /d "%ROOT%\backend"
set "BACKEND_INSTALL_MODE=install"
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$path='%ROOT%\backend'; $stamp=Join-Path $path 'node_modules/.package-lock.json'; $lock=Join-Path $path 'package-lock.json'; $pkg=Join-Path $path 'package.json'; if ((Test-Path $stamp) -and (Test-Path $lock) -and (Test-Path $pkg)) { $latest = @((Get-Item $pkg).LastWriteTimeUtc, (Get-Item $lock).LastWriteTimeUtc) | Sort-Object -Descending | Select-Object -First 1; $installed = (Get-Item $stamp).LastWriteTimeUtc; if ($installed -ge $latest) { 'skip' } else { 'install' } } else { 'install' }"`) do set "BACKEND_INSTALL_MODE=%%s"
if /i "!BACKEND_INSTALL_MODE!"=="skip" (
    echo [OK] Backend dependencies already up to date
) else (
    call npm install --prefer-offline --no-audit --loglevel=warn
    if errorlevel 1 (
        echo [ERROR] Backend npm install failed. Check internet connection.
        pause
        exit /b 1
    )
    echo [OK] Backend dependencies installed
)

REM ---- Frontend install + build ------------------------------------------
echo.
echo [INFO] Installing frontend dependencies...
cd /d "%ROOT%\frontend"
set "FRONTEND_INSTALL_MODE=install"
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$path='%ROOT%\frontend'; $stamp=Join-Path $path 'node_modules/.package-lock.json'; $lock=Join-Path $path 'package-lock.json'; $pkg=Join-Path $path 'package.json'; if ((Test-Path $stamp) -and (Test-Path $lock) -and (Test-Path $pkg)) { $latest = @((Get-Item $pkg).LastWriteTimeUtc, (Get-Item $lock).LastWriteTimeUtc) | Sort-Object -Descending | Select-Object -First 1; $installed = (Get-Item $stamp).LastWriteTimeUtc; if ($installed -ge $latest) { 'skip' } else { 'install' } } else { 'install' }"`) do set "FRONTEND_INSTALL_MODE=%%s"
if /i "!FRONTEND_INSTALL_MODE!"=="skip" (
    echo [OK] Frontend dependencies already up to date
) else (
    call npm install --prefer-offline --no-audit --loglevel=warn
    if errorlevel 1 (
        echo [ERROR] Frontend npm install failed.
        pause
        exit /b 1
    )
)
echo.
echo [INFO] Running shared local verification...
cd /d "%ROOT%"
call "%ROOT%\run\verify-local.bat"
if errorlevel 1 (
    echo [ERROR] Local verification failed.
    pause
    exit /b 1
)
echo [OK] Shared local verification passed

REM ---- PM2 (optional process manager) ------------------------------------
REM Used by start-server.bat for auto-restart/background execution.
echo.
echo [INFO] Checking PM2...
where pm2 >nul 2>&1
if errorlevel 1 (
    echo [INFO] PM2 is not installed. This is optional.
    echo [INFO] start-server.bat will use background node mode unless you install PM2 manually.
) else (
    echo [OK] PM2 already installed
)

echo.
echo ========================================================================
echo   SETUP COMPLETE
echo ========================================================================
echo.
echo   Next steps:
echo     1. Double-click Start Business OS.bat
echo     2. Support only: run\docker\doctor.bat if startup fails
echo     3. Open http://localhost:4000 in your browser
echo     4. Default login: admin / admin  ^(change after first login^)
echo.
echo   Data stored at: %DATA_DIR%
echo.
pause
