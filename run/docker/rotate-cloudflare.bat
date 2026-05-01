@echo off
chcp 65001 >nul 2>&1
setlocal
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
node "%ROOT%\ops\scripts\runtime\rotate-cloudflare-tunnel-token.mjs" --mode docker %*
exit /b %ERRORLEVEL%
