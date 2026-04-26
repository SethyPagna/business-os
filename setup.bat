@echo off
chcp 1252 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Source Setup
REM
REM  One-time workstation bootstrap:
REM    1. verify Node/npm exist
REM    2. create the default business-os-data folders
REM    3. write backend/.env while preserving important existing secrets
REM    4. install backend/frontend dependencies
REM    5. build the frontend
REM    6. install PM2 when available
REM ========================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "DATA_DIR=%ROOT%\business-os-data"
set "ENV_FILE=%ROOT%\backend\.env"

echo.
echo ========================================================================
echo   Business OS  ^|  Setup
echo ========================================================================
echo.
echo   Run ONCE to install dependencies and build the frontend.
echo   After setup, use start-server.bat to launch.
echo.

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
if not exist "%DATA_DIR%\db"      mkdir "%DATA_DIR%\db"
if not exist "%DATA_DIR%\uploads" mkdir "%DATA_DIR%\uploads"
echo [OK] DB:      %DATA_DIR%\db\business.db  (created on first server run)
echo [OK] Uploads: %DATA_DIR%\uploads

REM ---- Write .env (preserve existing SYNC_TOKEN and provider settings) ---
echo.
echo [INFO] Writing backend configuration...
set "EXISTING_TAILSCALE_URL="
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
if exist "%ENV_FILE%" (
    for /f "tokens=1,* delims==" %%a in ('type "%ENV_FILE%" ^| findstr /i "^TAILSCALE_URL"') do (
        set "EXISTING_TAILSCALE_URL=%%b"
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
)
(
    echo # Business OS - Backend Configuration
    echo # Generated by setup.bat
    echo.
    echo PORT=4000
    echo.
    echo # Tailscale Funnel URL ^(auto-filled by start-server.bat^)
    echo TAILSCALE_URL=!EXISTING_TAILSCALE_URL!
    echo.
    echo # Optional extra security token. Leave blank when using Tailscale.
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
    echo # Optional: Supabase Auth provider ^(Auth only - keep local SQLite data^)
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
) > "%ENV_FILE%"
echo [OK] Written: %ENV_FILE%

REM ---- Backend dependencies -----------------------------------------------
echo.
echo [INFO] Installing backend dependencies...
cd /d "%ROOT%\backend"
call npm install --loglevel=warn
if errorlevel 1 (
    echo [ERROR] Backend npm install failed. Check internet connection.
    pause
    exit /b 1
)
echo [OK] Backend dependencies installed

REM ---- Frontend install + build ------------------------------------------
echo.
echo [INFO] Installing frontend dependencies...
cd /d "%ROOT%\frontend"
call npm install --loglevel=warn
if errorlevel 1 (
    echo [ERROR] Frontend npm install failed.
    pause
    exit /b 1
)
echo.
echo [INFO] Building frontend ^(~30 seconds^)...
call npm run build
if errorlevel 1 (
    echo [WARN] Frontend build failed in cmd. Retrying via PowerShell...
    powershell -NoProfile -Command "Set-Location '%ROOT%\frontend'; npm run build"
    if errorlevel 1 (
        echo [ERROR] Frontend build failed.
        pause
        exit /b 1
    )
)
echo [OK] Frontend built successfully

REM ---- PM2 (optional process manager) ------------------------------------
REM Used by start-server.bat for auto-restart/background execution.
echo.
echo [INFO] Checking PM2...
where pm2 >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing PM2 globally...
    call npm install -g pm2 --loglevel=warn
    if errorlevel 1 (
        echo [WARN] PM2 install failed - server will run in foreground mode.
    ) else (
        echo [OK] PM2 installed
    )
) else (
    echo [OK] PM2 already installed
)

echo.
echo ========================================================================
echo   SETUP COMPLETE
echo ========================================================================
echo.
echo   Next steps:
echo     1. Run start-server.bat  to launch the server
echo     2. Open http://localhost:4000 in your browser
echo     3. Default login: admin / admin  ^(change after first login^)
echo.
echo   Data stored at: %DATA_DIR%
echo.
pause
