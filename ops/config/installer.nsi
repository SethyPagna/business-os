; ============================================================
;  Business OS  -  Windows Installer (NSIS)
;  Build:  makensis ops\config\installer.nsi
;  Requires: NSIS 3.x  https://nsis.sourceforge.io
;
;  Run build-release.bat first so release\business-os\ is populated.
;  This script lives under ops\config\, so paths below are rooted with ..\..
; ============================================================

!define APP_NAME        "Business OS"
!define APP_EXE         "business-os-server.exe"
!define RELEASE_DIR     "..\..\release\business-os"
!define UNINSTALL_KEY   "Software\Microsoft\Windows\CurrentVersion\Uninstall\BusinessOS"
!define REG_KEY         "Software\BusinessOS"

!ifdef APP_VERSION
  ; passed via /DAPP_VERSION=x.x.x on command line
!else
  !define APP_VERSION "6.0.0"
!endif

; ---- Output ------------------------------------------------------------
Name              "${APP_NAME} v${APP_VERSION}"
OutFile           "..\..\release\BusinessOS-Setup-v${APP_VERSION}.exe"
InstallDir        "$PROGRAMFILES64\Business OS"
InstallDirRegKey  HKLM "${REG_KEY}" "InstallDir"
RequestExecutionLevel admin
SetCompressor     /SOLID lzma
Unicode           True

; ---- Pages -------------------------------------------------------------
!include "MUI2.nsh"
!define MUI_ABORTWARNING
; Note: no custom icon - avoids dependency on an external .ico file.
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; ---- Installer ---------------------------------------------------------
Section "Business OS" SecMain
  SectionIn RO

  ; ---- Server exe -------------------------------------------------------
  SetOutPath "$INSTDIR"
  File "${RELEASE_DIR}\${APP_EXE}"
  File "${RELEASE_DIR}\start-server.bat"
  File "${RELEASE_DIR}\stop-server.bat"
  File "${RELEASE_DIR}\README.txt"

  ; ---- Runtime automation and Compose config ----------------------------
  SetOutPath "$INSTDIR\ops"
  File /r "${RELEASE_DIR}\ops\*.*"

  ; ---- Sharp native binaries (optional - only if present) ---------------
  !if /FileExists "${RELEASE_DIR}\@img\*.*"
    SetOutPath "$INSTDIR\@img"
    File /r "${RELEASE_DIR}\@img\*.*"
  !endif

  !if /FileExists "${RELEASE_DIR}\sharp\*.*"
    SetOutPath "$INSTDIR\sharp"
    File /r "${RELEASE_DIR}\sharp\*.*"
  !endif

  ; ---- Data folder (preserved on reinstall / update) --------------------
  ReadRegStr $0 HKLM "${REG_KEY}" "DataDir"
  ${If} $0 == ""
    StrCpy $0 "$INSTDIR\business-os-data"
  ${EndIf}
  CreateDirectory "$0\organizations"

  ; ---- .env beside the exe (backend config reads RUNTIME_DIR\.env) ------
  ; Only copy the prepared release .env on fresh install - never overwrite an existing .env.
  SetOutPath "$INSTDIR"
  IfFileExists "$INSTDIR\.env" env_exists env_missing
  env_missing:
    File "${RELEASE_DIR}\.env"
  env_exists:

  ; ---- Registry entries -------------------------------------------------
  WriteRegStr HKLM "${REG_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${REG_KEY}" "DataDir"    "$0"
  WriteRegStr HKLM "${REG_KEY}" "Version"    "${APP_VERSION}"

  ; ---- Add/Remove Programs entry ----------------------------------------
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "Publisher"       "Business OS"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify"        1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair"        1

  ; ---- Start Menu shortcuts ---------------------------------------------
  CreateDirectory "$SMPROGRAMS\Business OS"
  CreateShortcut  "$SMPROGRAMS\Business OS\Start Server.lnk"  "$INSTDIR\start-server.bat"
  CreateShortcut  "$SMPROGRAMS\Business OS\Stop Server.lnk"   "$INSTDIR\stop-server.bat"
  CreateShortcut  "$SMPROGRAMS\Business OS\Open App.lnk"      "http://localhost:4000"
  CreateShortcut  "$SMPROGRAMS\Business OS\Data Folder.lnk"   "$0"
  CreateShortcut  "$SMPROGRAMS\Business OS\Uninstall.lnk"     "$INSTDIR\uninstall.exe"

  ; ---- Desktop shortcut -------------------------------------------------
  CreateShortcut  "$DESKTOP\Business OS.lnk" "$INSTDIR\start-server.bat"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  MessageBox MB_OK \
    "Business OS installed!$\r$\n$\r$\nDouble-click 'Start Server' on your Desktop$\r$\nor from Start Menu > Business OS,$\r$\nthen open: http://localhost:4000$\r$\n$\r$\nData folder:$\r$\n$0"

SectionEnd

; ---- Uninstaller -------------------------------------------------------
Section "Uninstall"

  ; Stop the server first
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command Stop-Process -Name business-os-server -Force -ErrorAction SilentlyContinue' $0

  ; Remove app files only - NEVER remove the data folder
  RMDir /r "$INSTDIR\ops"
  RMDir /r "$INSTDIR\@img"
  RMDir /r "$INSTDIR\sharp"
  Delete   "$INSTDIR\README.txt"
  Delete   "$INSTDIR\${APP_EXE}"
  Delete   "$INSTDIR\start-server.bat"
  Delete   "$INSTDIR\stop-server.bat"
  Delete   "$INSTDIR\uninstall.exe"
  RMDir    "$INSTDIR"

  ; Start menu + desktop
  RMDir /r "$SMPROGRAMS\Business OS"
  Delete   "$DESKTOP\Business OS.lnk"

  ; Registry
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  DeleteRegKey HKLM "${REG_KEY}"

  MessageBox MB_OK \
    "Business OS uninstalled.$\r$\n$\r$\nData files are NOT removed.$\r$\nYour data is safe in the business-os-data folder."

SectionEnd
