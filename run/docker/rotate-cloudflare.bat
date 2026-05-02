@echo off
chcp 65001 >nul 2>&1
setlocal
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
node "%ROOT%\ops\scripts\runtime\rotate-cloudflare-tunnel-token.mjs" --mode docker %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Cloudflare tunnel token rotation finished. Next: run run\docker\start.bat or restart Business OS.
) else (
  echo [ERROR] Cloudflare rotation failed. Check the API token permissions and ops\runtime\secrets.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
