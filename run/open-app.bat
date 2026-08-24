@echo off
REM ==========================================================================
REM  Business OS is a permanently-deployed Cloudflare Worker - there is no
REM  local server to start or stop. This just opens the live admin URL.
REM  Set BUSINESS_OS_ADMIN_URL to override the default.
REM ==========================================================================
setlocal
if defined BUSINESS_OS_ADMIN_URL (
  set "URL=%BUSINESS_OS_ADMIN_URL%"
) else (
  set "URL=https://admin.leangcosmetics.dpdns.org"
)
echo Opening %URL% ...
start "" "%URL%"
endlocal
