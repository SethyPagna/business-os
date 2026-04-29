@echo off
set "RELEASE_SCRIPT=%~dp0release\business-os\start-server.bat"
if not exist "%RELEASE_SCRIPT%" (
  echo [ERROR] Release start script not found. Build a release first.
  exit /b 1
)
call "%RELEASE_SCRIPT%" %*
