@echo off
set "RELEASE_SCRIPT=%~dp0release\business-os\stop-server.bat"
if not exist "%RELEASE_SCRIPT%" (
  echo [ERROR] Release stop script not found. Build a release first.
  exit /b 1
)
call "%RELEASE_SCRIPT%" %*
