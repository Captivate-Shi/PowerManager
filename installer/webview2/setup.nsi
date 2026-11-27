Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "nsDialogs.nsh"

!define PRODUCT "PowerManager"
!define DISPLAY_VERSION "0.2.1"
!define APP_EXE "PowerManager.exe"
!define PRODUCT_REG "Software\PowerManager\Desktop"
!define UNINSTALL_REG "Software\Microsoft\Windows\CurrentVersion\Uninstall\PowerManager"
!define OLD_RC_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\PowerManager-WebView2"
!define OLD_ELECTRON_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\PowerManager.CaptivateShi_is1"
!define RUN_REG "Software\Microsoft\Windows\CurrentVersion\Run"
!define RUNTIME_REG "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define OWNER "PowerManager|io.powermanager.webview2"
!define MARKER ".PowerManager-owner"
Name "${PRODUCT} ${DISPLAY_VERSION}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\PowerManager"
InstallDirRegKey HKCU "${PRODUCT_REG}" "InstallDir"
VIProductVersion "0.2.1.0"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "ProductVersion" "${DISPLAY_VERSION}"
VIAddVersionKey "FileDescription" "PowerManager x64 Setup"
VIAddVersionKey "FileVersion" "${DISPLAY_VERSION}"
VIAddVersionKey "LegalCopyright" "PowerManager contributors"

!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom ShortcutPage ShortcutLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "$(LaunchNow)"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

LangString AlreadyOwned ${LANG_SIMPCHINESE} "请选空文件夹，或这版余电自己的安装目录。"
LangString AlreadyOwned ${LANG_ENGLISH} "Choose an empty folder or this edition's existing install folder."
LangString HasLink ${LANG_SIMPCHINESE} "安装路径不能是符号链接或目录联接。"
LangString HasLink ${LANG_ENGLISH} "The install folder cannot be a link or junction."
LangString MissingRuntime ${LANG_SIMPCHINESE} "未检测到 WebView2，且未能补装。请联网后重试。"
LangString MissingRuntime ${LANG_ENGLISH} "Could not install the WebView2 Runtime. Connect to the internet and retry."
LangString BadUninstall ${LANG_SIMPCHINESE} "无法确认这是这一版余电的安装目录。未删除文件。"
LangString BadUninstall ${LANG_ENGLISH} "Could not confirm this version owns this folder. Nothing was removed."
LangString DesktopLink ${LANG_SIMPCHINESE} "创建桌面快捷方式"
LangString DesktopLink ${LANG_ENGLISH} "Create a desktop shortcut"
LangString LaunchNow ${LANG_SIMPCHINESE} "立即启动 PowerManager"
LangString LaunchNow ${LANG_ENGLISH} "Launch PowerManager now"
LangString Shortcuts ${LANG_SIMPCHINESE} "快捷方式"
LangString Shortcuts ${LANG_ENGLISH} "Shortcuts"
LangString UninstallPrevious ${LANG_SIMPCHINESE} "请先在 Windows 设置中卸载旧版余电，再重新运行安装包。"
LangString UninstallPrevious ${LANG_ENGLISH} "Uninstall the previous PowerManager version in Windows Settings, then run Setup again."

Var DesktopCheckbox
Var DesktopState

Function ShortcutPage
  !insertmacro MUI_HEADER_TEXT "$(Shortcuts)" ""
  nsDialogs::Create 1018
  Pop $0
  StrCmp $0 error 0 +2
  Abort
  ${NSD_CreateCheckbox} 0 12u 100% 14u "$(DesktopLink)"
  Pop $DesktopCheckbox
  ${NSD_SetState} $DesktopCheckbox $DesktopState
  nsDialogs::Show
FunctionEnd

Function ShortcutLeave
  ${NSD_GetState} $DesktopCheckbox $DesktopState
FunctionEnd


Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Windows x64 required."
    Quit
  ${EndIf}
  SetShellVarContext current
  SetRegView 32
  ReadRegStr $0 HKCU "${OLD_RC_UNINSTALL}" "UninstallString"
  StrCmp $0 "" 0 previous
  ReadRegStr $0 HKCU "${OLD_ELECTRON_UNINSTALL}" "UninstallString"
  StrCmp $0 "" 0 previous
  ReadRegStr $0 HKLM "${OLD_ELECTRON_UNINSTALL}" "UninstallString"
  StrCmp $0 "" 0 previous
  SetRegView 64
  ReadRegStr $0 HKCU "${OLD_ELECTRON_UNINSTALL}" "UninstallString"
  StrCmp $0 "" 0 previous
  ReadRegStr $0 HKLM "${OLD_ELECTRON_UNINSTALL}" "UninstallString"
  StrCmp $0 "" 0 previous
  SetRegView 32
  StrCpy $DesktopState ${BST_UNCHECKED}
  Return
  previous:
    MessageBox MB_ICONSTOP "$(UninstallPrevious)" /SD IDOK
    SetErrorLevel 2
    Quit
FunctionEnd

!macro CheckOwned
  StrCpy $0 ""
  ReadRegStr $0 HKCU "${PRODUCT_REG}" "InstallDir"
  StrCmp $0 $INSTDIR 0 denied
  ClearErrors
  FileOpen $1 "$INSTDIR\${MARKER}" r
  IfErrors denied
  FileRead $1 $0
  FileClose $1
  StrCmp $0 "${OWNER}" 0 denied
!macroend

!macro CheckNoReparse SUBPATH
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR${SUBPATH}") i .r0'
  ${If} $0 != -1
    IntOp $0 $0 & 0x400
    ${If} $0 != 0
      Goto linked
    ${EndIf}
  ${EndIf}
!macroend

Function CheckFolder
  ReadRegStr $0 HKCU "${PRODUCT_REG}" "InstallDir"
  StrCmp $0 "" path_ok
  StrCmp $0 $INSTDIR path_ok denied
  path_ok:
  !insertmacro CheckNoReparse ""
  !insertmacro CheckNoReparse "\lab"
  !insertmacro CheckNoReparse "\${APP_EXE}"
  !insertmacro CheckNoReparse "\WebView2Loader.dll"
  !insertmacro CheckNoReparse "\lab\collector.exe"
  !insertmacro CheckNoReparse "\Uninstall.exe"
  !insertmacro CheckNoReparse "\${MARKER}"
  IfFileExists "$INSTDIR\*" 0 allowed
  ClearErrors
  FindFirst $2 $3 "$INSTDIR\*"
  IfErrors denied
  loop:
    StrCmp $3 "" empty
    StrCmp $3 "." next
    StrCmp $3 ".." next
    FindClose $2
    !insertmacro CheckOwned
    Goto allowed
  next:
    FindNext $2 $3
    Goto loop
  empty:
    FindClose $2
    Goto allowed
  linked:
    MessageBox MB_ICONSTOP "$(HasLink)"
    Abort
  denied:
    MessageBox MB_ICONSTOP "$(AlreadyOwned)"
    Abort
  allowed:
FunctionEnd

Function DetectWebView
  StrCpy $4 ""
  ReadRegStr $4 HKLM "${RUNTIME_REG}" "pv"
  StrCmp $4 "" user
  StrCmp $4 "0.0.0.0" user done
  user:
    ReadRegStr $4 HKCU "${RUNTIME_REG}" "pv"
    StrCmp $4 "0.0.0.0" 0 done
    StrCpy $4 ""
  done:
FunctionEnd

Section "-Install"
  Call CheckFolder
  Call DetectWebView
  ${If} $4 == ""
    InitPluginsDir
    File /oname=$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe "${BOOTSTRAPPER}"
    ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install'
    Call DetectWebView
    ${If} $4 == ""
      MessageBox MB_ICONSTOP "$(MissingRuntime)"
      Abort
    ${EndIf}
  ${EndIf}
  SetOutPath "$INSTDIR"
  File /oname=${APP_EXE} "${APP}"
  File /oname=WebView2Loader.dll "${LOADER}"
  SetOutPath "$INSTDIR\lab"
  File /oname=collector.exe "${COLLECTOR}"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  FileOpen $0 "$INSTDIR\${MARKER}" w
  FileWrite $0 "${OWNER}"
  FileClose $0
  WriteRegStr HKCU "${PRODUCT_REG}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_REG}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNINSTALL_REG}" "DisplayVersion" "${DISPLAY_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_REG}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_REG}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINSTALL_REG}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "${UNINSTALL_REG}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_REG}" "NoRepair" 1
  IfFileExists "$SMPROGRAMS\${PRODUCT}.lnk" start_done
  ClearErrors
  CreateShortcut "$SMPROGRAMS\${PRODUCT}.lnk" "$INSTDIR\${APP_EXE}"
  IfErrors start_done
  WriteRegDWORD HKCU "${PRODUCT_REG}" "StartShortcutCreated" 1
  start_done:
  StrCmp $DesktopState ${BST_CHECKED} 0 desktop_done
  IfFileExists "$DESKTOP\${PRODUCT}.lnk" desktop_done
  ClearErrors
  CreateShortcut "$DESKTOP\${PRODUCT}.lnk" "$INSTDIR\${APP_EXE}"
  IfErrors desktop_done
  WriteRegDWORD HKCU "${PRODUCT_REG}" "DesktopShortcutCreated" 1
  desktop_done:
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 32
  !insertmacro CheckNoReparse ""
  !insertmacro CheckNoReparse "\lab"
  !insertmacro CheckNoReparse "\${APP_EXE}"
  !insertmacro CheckNoReparse "\WebView2Loader.dll"
  !insertmacro CheckNoReparse "\lab\collector.exe"
  !insertmacro CheckNoReparse "\Uninstall.exe"
  !insertmacro CheckNoReparse "\${MARKER}"
  !insertmacro CheckOwned
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\lab\collector.exe"
  IfFileExists "$INSTDIR\${APP_EXE}" locked
  IfFileExists "$INSTDIR\WebView2Loader.dll" locked
  IfFileExists "$INSTDIR\lab\collector.exe" locked
  ReadRegStr $0 HKCU "${RUN_REG}" "PowerManagerWebView2"
  StrCmp $0 '$\"$INSTDIR\${APP_EXE}$\" --background' 0 +2
  DeleteRegValue HKCU "${RUN_REG}" "PowerManagerWebView2"
  ReadRegDWORD $0 HKCU "${PRODUCT_REG}" "StartShortcutCreated"
  StrCmp $0 1 0 +2
  Delete "$SMPROGRAMS\${PRODUCT}.lnk"
  ReadRegDWORD $0 HKCU "${PRODUCT_REG}" "DesktopShortcutCreated"
  StrCmp $0 1 0 +2
  Delete "$DESKTOP\${PRODUCT}.lnk"
  DeleteRegValue HKCU "${PRODUCT_REG}" "StartShortcutCreated"
  DeleteRegValue HKCU "${PRODUCT_REG}" "DesktopShortcutCreated"
  DeleteRegKey HKCU "${UNINSTALL_REG}"
  DeleteRegValue HKCU "${PRODUCT_REG}" "InstallDir"
  DeleteRegKey /ifempty HKCU "${PRODUCT_REG}"
  Delete "$INSTDIR\${MARKER}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR\lab"
  RMDir "$INSTDIR"
  Goto done
  locked:
    MessageBox MB_ICONSTOP "Close PowerManager before uninstalling."
    Abort
  linked:
  denied:
    MessageBox MB_ICONSTOP "$(BadUninstall)"
    Abort
  done:
SectionEnd
