@echo off
for %%I in ("%~dp0..") do set "BUSINESS_OS_REPO_ROOT=%%~fI"
set "BUSINESS_OS_REMOTE_PROVIDER=tailscale"
call "%BUSINESS_OS_REPO_ROOT%\run\setup.bat" %*
