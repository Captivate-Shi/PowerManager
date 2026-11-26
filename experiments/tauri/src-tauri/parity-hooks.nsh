!macro NSIS_HOOK_POSTUNINSTALL
  Push $0
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PowerManagerWebView2"
  StrCmp $0 '$\"$INSTDIR\powermanager-tauri-lab.exe$\" --background' 0 +2
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "PowerManagerWebView2"
  Pop $0
!macroend
