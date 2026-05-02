@echo off
chcp 65001 >nul 2>&1
setlocal
for %%I in ("%~dp0..\..") do set "ROOT=%%~fI"
if "%~1"=="" (
  echo.
  echo Paste or drag the backup folder path, then press Enter.
  echo Example: C:\Backups\business-os\20260502-171000
  echo.
  set /p "BACKUP_PATH=Backup folder: "
  if "%BACKUP_PATH%"=="" (
    echo [ERROR] No backup folder selected.
    if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
    exit /b 1
  )
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\docker-release.ps1" -Action Restore -BackupPath "%BACKUP_PATH%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\docker-release.ps1" -Action Restore %*
)
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [DONE] Restore command finished. Next: run Start Business OS.bat and verify the data.
) else (
  echo [ERROR] Restore failed. Check the selected backup and ops\runtime\logs before retrying.
)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
