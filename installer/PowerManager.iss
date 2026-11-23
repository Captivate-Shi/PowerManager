#ifndef AppVersion
  #error AppVersion must be supplied by scripts/package.cjs
#endif
#ifndef AppSource
  #error AppSource must be supplied by scripts/package.cjs
#endif

#define Product "PowerManager"
#define AppExe "PowerManager-H5.exe"
#define ProductId "PowerManager.CaptivateShi"

[Setup]
AppId={#ProductId}
AppName={#Product}
AppVersion={#AppVersion}
AppPublisher=Captivate-Shi
DefaultDirName={localappdata}\Programs\PowerManager
DisableDirPage=auto
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExe}
SetupIconFile=..\public\assets\powermanager.ico
OutputBaseFilename=PowerManager-Setup-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
SetupMutex=Local\PowerManager.Installer
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "maintenance.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "maintenance.ps1"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\PowerManager"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{autodesktop}\PowerManager"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: ReopenForeground
Filename: "{app}\{#AppExe}"; Parameters: "--background"; Flags: nowait; Check: ReopenTray
Filename: "{app}\{#AppExe}"; Description: "Open PowerManager"; Flags: postinstall nowait skipifsilent; Check: OfferLaunch

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#ProductId}_is1';
  ExitFailed = 'PowerManager or its collector could not exit safely. Choose Exit from the PowerManager tray menu, then try again.';
var
  GatePath: String;
  ResumeMode: Integer;
  PurgeData: Boolean;
  ExistingInstall: Boolean;

procedure ReleaseGate;
begin
  if GatePath <> '' then
  begin
    DeleteFile(GatePath);
    GatePath := '';
  end;
end;

function StopApp(ScriptPath: String): Integer;
var
  Parameters: String;
begin
  Result := 0;
  if not FileExists(ExpandConstant('{app}\{#AppExe}')) then
    Exit;
  GatePath := ExpandConstant('{app}\.installer-maintenance');
  if not SaveStringToFile(GatePath, 'maintenance', False) then
  begin
    Result := 20;
    Exit;
  end;
  Parameters := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' +
    AddQuotes(ScriptPath) + ' -InstallPath ' + AddQuotes(ExpandConstant('{app}'));
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters, '', SW_HIDE, ewWaitUntilTerminated, Result) then
    Result := 20;
  Log('PowerManager maintenance exit code: ' + IntToStr(Result));
end;

function Stopped(Code: Integer): Boolean;
begin
  Result := (Code = 0) or (Code = 10) or (Code = 11);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  InstalledPath, InstalledExe: String;
  OldVersion, NewVersion: Int64;
begin
  Result := '';
  if RegQueryStringValue(HKCU, UninstallKey, 'InstallLocation', InstalledPath) and
    (CompareText(RemoveBackslashUnlessRoot(InstalledPath), RemoveBackslashUnlessRoot(ExpandConstant('{app}'))) <> 0) then
  begin
    Result := 'Install the update in the existing PowerManager directory: ' + InstalledPath;
    Exit;
  end;
  InstalledExe := ExpandConstant('{app}\{#AppExe}');
  ExistingInstall := FileExists(InstalledExe);
  if GetPackedVersion(InstalledExe, OldVersion) and StrToVersion('{#AppVersion}', NewVersion) and
    (ComparePackedVersion(OldVersion, NewVersion) > 0) then
  begin
    Result := 'A newer PowerManager version is already installed.';
    Exit;
  end;
  if not ExistingInstall then
    Exit;
  ExtractTemporaryFile('maintenance.ps1');
  repeat
    ResumeMode := StopApp(ExpandConstant('{tmp}\maintenance.ps1'));
    if Stopped(ResumeMode) then Exit;
  until SuppressibleMsgBox(ExitFailed, mbError, MB_RETRYCANCEL, IDCANCEL) <> IDRETRY;
  ReleaseGate;
  Result := ExitFailed;
end;

function ReopenForeground: Boolean;
begin
  Result := ResumeMode = 11;
end;
function ReopenTray: Boolean;
begin
  Result := ResumeMode = 10;
end;
function OfferLaunch: Boolean;
begin
  Result := not ExistingInstall;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then ReleaseGate;
end;
procedure DeinitializeSetup;
begin
  ReleaseGate;
end;

procedure RemoveLoginItem;
var
  Names: TArrayOfString;
  Command, ExePath: String;
  I: Integer;
begin
  ExePath := ExpandConstant('{app}\{#AppExe}');
  if RegGetValueNames(HKCU, RunKey, Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if RegQueryStringValue(HKCU, RunKey, Names[I], Command) and
        ((CompareText(Trim(Command), AddQuotes(ExePath) + ' --background') = 0) or
         (CompareText(Trim(Command), AddQuotes(ExePath)) = 0) or
         (CompareText(Trim(Command), ExePath + ' --background') = 0) or
         (CompareText(Trim(Command), ExePath) = 0)) then
        if not RegDeleteValue(HKCU, RunKey, Names[I]) then
          RaiseException('Could not remove the PowerManager sign-in entry.');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    repeat
      ResumeMode := StopApp(ExpandConstant('{app}\maintenance.ps1'));
      if Stopped(ResumeMode) then Break;
      if SuppressibleMsgBox(ExitFailed, mbError, MB_RETRYCANCEL, IDCANCEL) <> IDRETRY then
        RaiseException(ExitFailed);
    until False;
    RemoveLoginItem;
    PurgeData := SuppressibleMsgBox(
      'Also remove PowerManager settings, battery history and diagnostic logs? Choose No to keep them for a future installation.',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES;
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    ReleaseGate;
    RemoveDir(ExpandConstant('{app}'));
    if PurgeData and DirExists(ExpandConstant('{localappdata}\PowerManager-H5')) then
      if not DelTree(ExpandConstant('{localappdata}\PowerManager-H5'), True, True, True) then
        SuppressibleMsgBox('PowerManager was uninstalled, but some local data could not be removed.', mbError, MB_OK, IDOK);
  end;
end;

procedure DeinitializeUninstall;
begin
  ReleaseGate;
end;
