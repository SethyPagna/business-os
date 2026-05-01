@echo off
for %%I in ("%~dp0..") do set "BUSINESS_OS_REPO_ROOT=%%~fI"
call "%BUSINESS_OS_REPO_ROOT%\run\build-release.bat" %*
