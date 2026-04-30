@echo off
set "BUSINESS_OS_REPO_ROOT=%~dp0"
call "%~dp0ops\run\bat\start-server.bat" %*
