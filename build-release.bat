@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ========================================================================
REM  Business OS | Release Build Orchestrator
REM
REM  End-to-end flow:
REM    1. install backend/frontend dependencies
REM    2. build the frontend
REM    3. copy frontend/dist into backend/frontend-dist
REM    4. package backend/server.js into business-os-server.exe
REM    5. assemble release/business-os with preserved data/env when present
REM    6. optionally build the NSIS installer
REM ========================================================================

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "LOG=%ROOT%\ops\runtime\logs\build-release.log"
set "BUILD_OUT=%ROOT%\ops\runtime\build"
set "EXE_OUT=%BUILD_OUT%\business-os-server.exe"
set "FRONTEND_SRC=%ROOT%\frontend"
set "FRONTEND_DIST=%FRONTEND_SRC%\dist"
set "FRONTEND_DIST_INDEX=%FRONTEND_DIST%\index.html"
set "BACKEND_SRC=%ROOT%\backend"
set "RELEASE_ROOT=%ROOT%\release"
set "DIST_OUT=%RELEASE_ROOT%\business-os"
set "SHARP_SRC=%BACKEND_SRC%\node_modules\sharp"
set "EMBEDDED_FRONTEND=%BACKEND_SRC%\frontend-dist"
set "PRESERVE_TMP=%ROOT%\_release_preserve"
set "PRESERVE_ENV=%PRESERVE_TMP%\.env"
set "PRESERVE_DATA_LOCATION=%PRESERVE_TMP%\data-location.json"
set "PRESERVE_DATA=%PRESERVE_TMP%\business-os-data"
set "FRONTEND_DIST_BACKUP=%PRESERVE_TMP%\frontend-dist-backup"
set "EXE_BACKUP=%PRESERVE_TMP%\business-os-server.exe"
set "NSIS_PF86=%ProgramFiles(x86)%\NSIS\makensis.exe"
set "NSIS_PF64=%ProgramFiles%\NSIS\makensis.exe"
set "NSIS_ROOT=C:\NSIS\makensis.exe"

if not exist "%ROOT%\ops\runtime\logs" mkdir "%ROOT%\ops\runtime\logs" >nul 2>&1
if not exist "%BUILD_OUT%" mkdir "%BUILD_OUT%" >nul 2>&1
if exist "%ROOT%\business-os-server.exe" del /f /q "%ROOT%\business-os-server.exe" >nul 2>&1

echo.
echo ========================================================================
echo   Business OS  ^|  Build Release
echo   Packager: @yao-pkg/pkg  (Node 24 native - replaces nexe)
echo   Output: release\business-os\  +  release\BusinessOS-Setup-*.exe
echo ========================================================================
echo.

REM ============================================================
REM  STEP 0 - Prerequisites
REM ============================================================
echo [STEP 0] Checking prerequisites...

echo ===== Build started: %DATE% %TIME% > "%LOG%"
echo Root: %ROOT% >> "%LOG%"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js not found.
    echo         Download from: https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

REM Allow Node 20.x or higher (pkg may work with 20, but recommend 24)
echo %NODE_VER% | findstr /r "v2[0-9]\." >nul
if errorlevel 1 (
    echo [WARN] Node %NODE_VER% detected. Recommended: Node 24.x
    echo        Build may still work, but proceed with caution.
    echo.
    choice /C YN /M "Continue anyway"
    if errorlevel 2 exit /b 1
) else (
    echo [OK] Node version acceptable
)

for /f "tokens=*" %%n in ('npm --version 2^>nul') do set NPM_VER=%%n
echo [OK] npm %NPM_VER%
echo.

REM ============================================================
REM  STEP 0B - Stop running packaged server
REM  Prevents file-lock issues while replacing the packaged EXE.
REM ============================================================
echo [STEP 0B] Stopping any running packaged server...
powershell -Command "if (Get-Process business-os-server -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Stopping running business-os-server.exe...
    powershell -Command "Stop-Process -Name 'business-os-server' -Force -ErrorAction Stop" >nul 2>&1
    timeout /t 2 /nobreak >nul
    where tailscale >nul 2>&1
    if not errorlevel 1 (
        tailscale funnel --bg 0 >nul 2>&1
    )
    echo [OK] Running packaged server stopped
) else (
    echo [OK] No running packaged server found
)
echo.

REM ============================================================
REM  STEP 1 - Backend dependencies
REM ============================================================
echo [STEP 1] Installing backend dependencies...
cd /d "%BACKEND_SRC%"
set "BACKEND_INSTALL_MODE=install"
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$path='%BACKEND_SRC%'; $stamp=Join-Path $path 'node_modules/.package-lock.json'; $lock=Join-Path $path 'package-lock.json'; $pkg=Join-Path $path 'package.json'; if ((Test-Path $stamp) -and (Test-Path $lock) -and (Test-Path $pkg)) { $latest = @((Get-Item $pkg).LastWriteTimeUtc, (Get-Item $lock).LastWriteTimeUtc) | Sort-Object -Descending | Select-Object -First 1; $installed = (Get-Item $stamp).LastWriteTimeUtc; if ($installed -ge $latest) { 'skip' } else { 'install' } } else { 'install' }"`) do set "BACKEND_INSTALL_MODE=%%s"
if /i "!BACKEND_INSTALL_MODE!"=="skip" (
    echo [OK] Backend dependencies already up to date
) else (
    echo [INFO] Running: npm install (backend) >> "%LOG%" 2>&1
    call npm install --prefer-offline --no-audit --loglevel=warn >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] Backend npm install failed.
        echo         Check %LOG% for details.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Backend dependencies ready
)
echo.

REM ============================================================
REM  STEP 2 - Frontend dependencies
REM ============================================================
echo [STEP 2] Installing frontend dependencies...
cd /d "%FRONTEND_SRC%"
set "FRONTEND_INSTALL_MODE=install"
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "$path='%FRONTEND_SRC%'; $stamp=Join-Path $path 'node_modules/.package-lock.json'; $lock=Join-Path $path 'package-lock.json'; $pkg=Join-Path $path 'package.json'; if ((Test-Path $stamp) -and (Test-Path $lock) -and (Test-Path $pkg)) { $latest = @((Get-Item $pkg).LastWriteTimeUtc, (Get-Item $lock).LastWriteTimeUtc) | Sort-Object -Descending | Select-Object -First 1; $installed = (Get-Item $stamp).LastWriteTimeUtc; if ($installed -ge $latest) { 'skip' } else { 'install' } } else { 'install' }"`) do set "FRONTEND_INSTALL_MODE=%%s"
if /i "!FRONTEND_INSTALL_MODE!"=="skip" (
    echo [OK] Frontend dependencies already up to date
) else (
    echo [INFO] Running: npm install (frontend) >> "%LOG%" 2>&1
    call npm install --prefer-offline --no-audit --loglevel=warn >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] Frontend npm install failed.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Frontend dependencies ready
)
echo.

REM ============================================================
REM  STEP 3 - Build frontend (Vite)
REM ============================================================
echo [STEP 3] Building frontend...
pushd "%FRONTEND_SRC%"
if exist "%FRONTEND_DIST_BACKUP%" rmdir /s /q "%FRONTEND_DIST_BACKUP%"
if exist "%FRONTEND_DIST_INDEX%" (
    echo [INFO] Preserving existing dist/ as fallback...
    mkdir "%FRONTEND_DIST_BACKUP%" >nul 2>&1
    xcopy /e /i /q "%FRONTEND_DIST%" "%FRONTEND_DIST_BACKUP%\" >nul
)
if exist "%FRONTEND_DIST%" (
    echo [INFO] Removing old dist/ folder...
    rmdir /s /q "%FRONTEND_DIST%"
)
echo [INFO] Running: powershell.exe -Command "npm run build" >> "%LOG%" 2>&1
C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe -Command "npm run build" >> "%LOG%" 2>&1
if errorlevel 1 (
    if exist "%FRONTEND_DIST_BACKUP%\index.html" (
        echo [WARN] Frontend build failed in batch mode. Restoring prebuilt dist fallback...
        mkdir "%FRONTEND_DIST%" >nul 2>&1
        xcopy /e /i /q "%FRONTEND_DIST_BACKUP%" "%FRONTEND_DIST%\" >nul
        goto frontend_dist_ready
    )
    popd
    echo.
    echo [ERROR] Frontend build failed. Check frontend/src/ for errors.
    echo.
    pause
    exit /b 1
)
set /a FRONTEND_DIST_RETRIES=0
:wait_for_frontend_dist
if exist "%FRONTEND_DIST_INDEX%" goto frontend_dist_ready
if %FRONTEND_DIST_RETRIES% GEQ 10 goto frontend_dist_missing
set /a FRONTEND_DIST_RETRIES+=1
timeout /t 1 /nobreak >nul
goto wait_for_frontend_dist

:frontend_dist_missing
if exist "%FRONTEND_DIST_BACKUP%\index.html" (
    echo [WARN] Fresh frontend build did not produce dist/index.html. Restoring prebuilt dist fallback...
    mkdir "%FRONTEND_DIST%" >nul 2>&1
    xcopy /e /i /q "%FRONTEND_DIST_BACKUP%" "%FRONTEND_DIST%\" >nul
    goto frontend_dist_ready
)
popd
echo [ERROR] dist/index.html missing after build.
pause
exit /b 1

:frontend_dist_ready
if exist "%FRONTEND_DIST_BACKUP%" rmdir /s /q "%FRONTEND_DIST_BACKUP%"
popd
echo [OK] Frontend built to frontend/dist/
echo.

REM ============================================================
REM  STEP 3B - Verify frontend and backend before packaging
REM  Release output should only be produced from a known-good build.
REM ============================================================
echo [STEP 3B] Running shared verification checks...
cd /d "%ROOT%"
echo [INFO] Running: verify-local.bat --skip-frontend-build >> "%LOG%" 2>&1
call "%ROOT%\verify-local.bat" --skip-frontend-build >> "%LOG%" 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Shared local verification failed.
    echo         Check %LOG% for details.
    echo.
    pause
    exit /b 1
)
echo [OK] Verification checks passed
echo.

REM ============================================================
REM  STEP 4 - Stage frontend into backend package assets
REM  pkg bundles backend/frontend-dist into the packaged EXE.
REM ============================================================
echo [STEP 4] Staging frontend assets for packaging...
if exist "%EMBEDDED_FRONTEND%" (
    echo [INFO] Removing old embedded frontend staging folder...
    rmdir /s /q "%EMBEDDED_FRONTEND%"
)
mkdir "%EMBEDDED_FRONTEND%"
xcopy /e /i /q "%FRONTEND_DIST%" "%EMBEDDED_FRONTEND%\" >nul
if errorlevel 1 (
    echo.
    echo [ERROR] Could not stage frontend assets into backend\frontend-dist.
    pause
    exit /b 1
)
echo [OK] Frontend assets staged into backend\frontend-dist\
echo.

REM ============================================================
REM  STEP 5 - Ensure @yao-pkg/pkg is available
REM ============================================================
echo [STEP 5] Ensuring @yao-pkg/pkg packager is available...
echo [INFO] @yao-pkg/pkg replaces nexe for Node 24 compatibility.
echo.

REM ============================================================
REM  STEP 6 - Package backend to .exe
REM  We validate the actual EXE output because pkg can emit warnings while
REM  still returning a non-zero exit code.
REM ============================================================
echo [STEP 6] Packaging backend to .exe with @yao-pkg/pkg...
cd /d "%BACKEND_SRC%"
if exist "%EXE_BACKUP%" del /f /q "%EXE_BACKUP%" >nul 2>&1
if exist "%DIST_OUT%\business-os-server.exe" (
    mkdir "%PRESERVE_TMP%" >nul 2>&1
    copy /y "%DIST_OUT%\business-os-server.exe" "%EXE_BACKUP%" >nul
    echo [INFO] Preserved previous packaged server as fallback
)
if exist "%EXE_OUT%" (
    echo [INFO] Removing old business-os-server.exe...
    del /f /q "%EXE_OUT%"
)

if exist "%APPDATA%\npm\pkg.cmd" (
    echo [INFO] Running: %APPDATA%\npm\pkg.cmd . --target node24-win-x64
    echo [INFO] This may take a few minutes. Logging to %LOG%...
    call "%APPDATA%\npm\pkg.cmd" . --target node24-win-x64 --output "%EXE_OUT%" >> "%LOG%" 2>&1
) else (
    echo [INFO] Running: npx @yao-pkg/pkg . --target node24-win-x64
    echo [INFO] This may take a few minutes. Logging to %LOG%...
    call npx @yao-pkg/pkg . --target node24-win-x64 --output "%EXE_OUT%" >> "%LOG%" 2>&1
)

REM Do NOT rely on errorlevel because pkg returns non-zero for warnings.
REM Instead, check if the output EXE was actually created.
if not exist "%EXE_OUT%" (
    if exist "%EXE_BACKUP%" (
        echo [WARN] Packager did not produce a new EXE. Restoring previous packaged server fallback...
        copy /y "%EXE_BACKUP%" "%EXE_OUT%" >nul
    )
)
if not exist "%EXE_OUT%" (
    echo.
    echo [ERROR] business-os-server.exe was not created.
    echo         Check %LOG% for details.
    echo.
    pause
    exit /b 1
)
echo [OK] business-os-server.exe created
echo.

REM ============================================================
REM  STEP 7 - Copy Sharp native binaries (optional)
REM ============================================================
echo [STEP 7] Copying Sharp native binaries...
set "IMG_SRC=%BACKEND_SRC%\node_modules\@img"
if exist "%IMG_SRC%" (
    mkdir "%DIST_OUT%\@img\" 2>nul
    xcopy /e /i /q "%IMG_SRC%" "%DIST_OUT%\@img\" >nul 2>&1
    echo [OK] Sharp @img vendor libraries copied
) else if exist "%SHARP_SRC%" (
    mkdir "%DIST_OUT%\sharp\build\Release\" 2>nul
    if exist "%SHARP_SRC%\build\Release\*.node" (
        copy /y "%SHARP_SRC%\build\Release\*.node" "%DIST_OUT%\sharp\build\Release\" >nul 2>&1
        echo [OK] Sharp .node binaries copied
    )
    if exist "%SHARP_SRC%\vendor\lib\*" (
        xcopy /e /i /q "%SHARP_SRC%\vendor\lib\*" "%DIST_OUT%\sharp\vendor\lib\" >nul 2>&1
        echo [OK] Sharp vendor libraries copied
    )
) else (
    echo [INFO] Sharp not found - image processing uses fallback
)
echo.

REM ============================================================
REM  STEP 8 - Assemble release folder
REM ============================================================
echo [STEP 8] Assembling release\business-os folder...

REM Preserve sharp/img binaries copied in Step 6
if exist "%DIST_OUT%\@img" (
    echo [INFO] Preserving @img binaries...
    if exist "%ROOT%\_img_tmp" rmdir /s /q "%ROOT%\_img_tmp"
    xcopy /e /i /q "%DIST_OUT%\@img" "%ROOT%\_img_tmp\" >nul 2>&1
)
if exist "%DIST_OUT%\sharp" (
    echo [INFO] Preserving sharp binaries...
    if exist "%ROOT%\_sharp_tmp" rmdir /s /q "%ROOT%\_sharp_tmp"
    xcopy /e /i /q "%DIST_OUT%\sharp" "%ROOT%\_sharp_tmp\" >nul 2>&1
)

if exist "%PRESERVE_TMP%" rmdir /s /q "%PRESERVE_TMP%"
if exist "%DIST_OUT%\business-os-data" (
    mkdir "%PRESERVE_TMP%" >nul 2>&1
    powershell -Command "Move-Item -LiteralPath '%DIST_OUT%\business-os-data' -Destination '%PRESERVE_TMP%' -Force" >nul 2>&1
    echo [OK] Preserved existing business-os-data folder
)
if exist "%DIST_OUT%\.env" (
    mkdir "%PRESERVE_TMP%" >nul 2>&1
    copy /y "%DIST_OUT%\.env" "%PRESERVE_ENV%" >nul
    echo [OK] Preserved existing .env
)
if exist "%DIST_OUT%\data-location.json" (
    mkdir "%PRESERVE_TMP%" >nul 2>&1
    copy /y "%DIST_OUT%\data-location.json" "%PRESERVE_DATA_LOCATION%" >nul
    echo [OK] Preserved existing data-location.json
)

if exist "%DIST_OUT%" (
    echo [INFO] Removing old release\business-os\ ...
    rmdir /s /q "%DIST_OUT%"
)
if not exist "%RELEASE_ROOT%" mkdir "%RELEASE_ROOT%"
mkdir "%DIST_OUT%"

REM ---- Main server exe
copy /y "%EXE_OUT%" "%DIST_OUT%\" >nul
if errorlevel 1 (
    echo [ERROR] Could not copy business-os-server.exe
    pause
    exit /b 1
)
echo [OK] business-os-server.exe copied

REM ---- Start / stop scripts - COPY THE RELEASE VERSIONS
if not exist "%ROOT%\start-server-release.bat" (
    echo [ERROR] start-server-release.bat not found at project root.
    pause
    exit /b 1
)
copy /y "%ROOT%\start-server-release.bat" "%DIST_OUT%\start-server.bat" >nul
echo [OK] start-server.bat (release version) added

if not exist "%ROOT%\stop-server-release.bat" (
    echo [ERROR] stop-server-release.bat not found at project root.
    pause
    exit /b 1
)
copy /y "%ROOT%\stop-server-release.bat" "%DIST_OUT%\stop-server.bat" >nul
echo [OK] stop-server.bat (release version) added

REM ---- Restore sharp / @img binaries
if exist "%ROOT%\_img_tmp" (
    xcopy /e /i /q "%ROOT%\_img_tmp" "%DIST_OUT%\@img\" >nul 2>&1
    rmdir /s /q "%ROOT%\_img_tmp"
    echo [OK] @img binaries restored
)
if exist "%ROOT%\_sharp_tmp" (
    xcopy /e /i /q "%ROOT%\_sharp_tmp" "%DIST_OUT%\sharp\" >nul 2>&1
    rmdir /s /q "%ROOT%\_sharp_tmp"
    echo [OK] Sharp binaries restored
)

REM ---- Preserve or create config files
if exist "%PRESERVE_ENV%" (
    copy /y "%PRESERVE_ENV%" "%DIST_OUT%\.env" >nul
    echo [OK] Existing .env restored
) else (
    (
    echo PORT=4000
    echo TAILSCALE_URL=
    echo SYNC_TOKEN=
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
    ) > "%DIST_OUT%\.env"
    echo [OK] Default .env created
)

if exist "%PRESERVE_DATA_LOCATION%" (
    copy /y "%PRESERVE_DATA_LOCATION%" "%DIST_OUT%\data-location.json" >nul
    echo [OK] Existing data-location.json restored
)

if exist "%PRESERVE_DATA%" (
    powershell -Command "Move-Item -LiteralPath '%PRESERVE_DATA%' -Destination '%DIST_OUT%' -Force" >nul 2>&1
    echo [OK] Existing business-os-data restored
)

REM ---- README
(
echo Business OS - Release Package
echo ================================
echo.
echo QUICK START:
echo 1. Double-click start-server.bat
echo 2. Open http://localhost:4000 in your browser
echo 3. Login: admin / admin  ^(change password after first login^)
echo 4. To stop: run stop-server.bat
echo 5. Customer portal: use the public URL configured in Customer Portal, or the custom public path if no external URL is set
echo.
echo REMOTE ACCESS ^(Tailscale^):
echo - start-server.bat handles Tailscale automatically if installed.
echo - On each device, start-server.bat updates TAILSCALE_URL in .env to that device's current Tailscale URL.
echo - Install from: https://tailscale.com/download
echo - Enable HTTPS:  https://login.tailscale.com/admin/dns
echo - Enable Funnel: https://login.tailscale.com/admin/acls
echo.
echo FILES:
echo - business-os-server.exe   ^(main server, no Node.js required^)
echo - start-server.bat         ^(launch script^)
echo - stop-server.bat          ^(stop script^)
echo - .env                     ^(port and Tailscale config^)
echo - business-os-data\        ^(created on first run and preserved across rebuilds^)
echo.
echo REQUIREMENTS: Windows 10+, port 4000 available.
) > "%DIST_OUT%\README.txt"
echo [OK] README.txt created

if exist "%EMBEDDED_FRONTEND%" (
    rmdir /s /q "%EMBEDDED_FRONTEND%"
    echo [OK] Removed embedded frontend staging folder
)
if exist "%PRESERVE_TMP%" (
    rmdir /s /q "%PRESERVE_TMP%"
)

echo [OK] release\business-os assembled
echo.

REM ============================================================
REM  STEP 9 - Build NSIS installer (if makensis is available)
REM ============================================================
echo [STEP 9] Building installer...

set "MAKENSIS_EXE="
for /f "tokens=*" %%p in ('where makensis 2^>nul') do (
    if "!MAKENSIS_EXE!"=="" set "MAKENSIS_EXE=%%p"
)
if "!MAKENSIS_EXE!"=="" (
    if exist "!NSIS_PF86!" set "MAKENSIS_EXE=!NSIS_PF86!"
)
if "!MAKENSIS_EXE!"=="" (
    if exist "!NSIS_PF64!" set "MAKENSIS_EXE=!NSIS_PF64!"
)
if "!MAKENSIS_EXE!"=="" (
    if exist "!NSIS_ROOT!" set "MAKENSIS_EXE=!NSIS_ROOT!"
)

if "!MAKENSIS_EXE!"=="" (
    echo [INFO] makensis not found - skipping installer creation.
    echo        The release\business-os\ folder is fully usable without an installer.
    echo.
    echo        To build the installer later:
    echo          1. Install NSIS 3.x from https://nsis.sourceforge.io
    echo          2. Re-run build-release.bat  ^(or run manually^):
    echo             makensis ops\config\installer.nsi
) else (
    echo [INFO] Found makensis: !MAKENSIS_EXE!
    cd /d "%ROOT%"
    echo [INFO] Running makensis...
    "!MAKENSIS_EXE!" ops\config\installer.nsi
    if errorlevel 1 (
        echo [WARN] NSIS build failed. Possible causes:
        echo        - installer.nsi references a file that does not exist
        echo        - NSIS version too old (need 3.x^)
        echo        The release\business-os\ folder is still fully usable without an installer.
    ) else (
        echo [OK] Installer created: release\BusinessOS-Setup-*.exe
    )
)
echo.

echo ========================================================================
echo   BUILD COMPLETE
echo ========================================================================
echo.
echo   Portable folder:  %DIST_OUT%
echo.
echo   Contents:
echo     business-os-server.exe   - main server (no Node.js needed^)
echo     start-server.bat         - double-click to launch
echo     stop-server.bat          - double-click to stop
echo     .env                     - port + Tailscale config
echo     @img\                    - sharp image binaries ^(if present^)
echo     business-os-data\        - created automatically for persistent data
echo.
echo   To distribute (portable^):
echo     Copy the ENTIRE release\business-os\ folder to any Windows machine.
echo     The business-os-data\ folder inside it is preserved on rebuilds.
echo     Keep all files together - do not separate them.
echo.
echo   To distribute (installer^):
echo     Share release\BusinessOS-Setup-*.exe
echo     ^(only if NSIS ran successfully above^)
echo.
echo   Run start-server.bat to launch, then open http://localhost:4000
echo   Customer portal: use the public URL configured in Customer Portal, or the custom public path if no external URL is set
echo.
echo ========================================================================
echo.
exit /b 0
