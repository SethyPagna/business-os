@echo off
chcp 65001 >nul 2>&1
setlocal
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\docker-release.ps1" -Action Start %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Docker start command finished. Next: open https://admin.leangcosmetics.dpdns.org or https://leangcosmetics.dpdns.org/public.
) else (
  echo [ERROR] Docker start failed. Run run\docker\doctor.bat and check ops\runtime\logs.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
