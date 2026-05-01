@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

if defined BUSINESS_OS_REPO_ROOT (
  set "ROOT=%BUSINESS_OS_REPO_ROOT%"
) else (
  for %%I in ("%~dp0..\..\..") do set "ROOT=%%~fI"
)
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

if "%~1"=="" (
  echo Usage: scale-services.bat up^|down^|status^|logs
  exit /b 2
)

node ops\scripts\verify-scale-services.js --require --print-compose-command
if errorlevel 1 exit /b 1

set "DOCKER_CONFIG=%ROOT%\ops\runtime\docker-config"
if not exist "%DOCKER_CONFIG%" mkdir "%DOCKER_CONFIG%" >nul 2>&1

set "DOCKER_EXE="
for /f "delims=" %%D in ('where docker 2^>nul') do (
  if not defined DOCKER_EXE set "DOCKER_EXE=%%D"
)
if not defined DOCKER_EXE if exist "C:\Program Files\Docker\Docker\resources\bin\docker.exe" set "DOCKER_EXE=C:\Program Files\Docker\Docker\resources\bin\docker.exe"
if not defined DOCKER_EXE (
  echo Docker CLI not found.
  exit /b 1
)

set "COMPOSE=%ROOT%\ops\docker\compose.scale.yml"
if /i "%~1"=="up" (
  "%DOCKER_EXE%" compose -f "%COMPOSE%" up -d
  exit /b %ERRORLEVEL%
)
if /i "%~1"=="down" (
  "%DOCKER_EXE%" compose -f "%COMPOSE%" down
  exit /b %ERRORLEVEL%
)
if /i "%~1"=="status" (
  "%DOCKER_EXE%" compose -f "%COMPOSE%" ps
  exit /b %ERRORLEVEL%
)
if /i "%~1"=="logs" (
  "%DOCKER_EXE%" compose -f "%COMPOSE%" logs --tail=200
  exit /b %ERRORLEVEL%
)

echo Unknown command: %~1
exit /b 2
