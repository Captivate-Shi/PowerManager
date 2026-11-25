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
VersionInfoVersion={#AppVersion}
VersionInfoProductTextVersion={#AppVersion}
AppPublisher=Captivate-Shi
DefaultDirName={code:DefaultDestination}
UsePreviousAppDir=yes
UsePreviousPrivileges=yes
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExe}
SetupIconFile=..\public\assets\yudian-app.ico
OutputBaseFilename=PowerManager-Setup-{#AppVersion}-x64
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
SetupMutex=Local\PowerManager.Installer
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chs"; MessagesFile: "compiler:Default.isl,lang\ChineseSimplified.isl"

[CustomMessages]
english.PMDesktop=Create a desktop shortcut
chs.PMDesktop=创建桌面快捷方式
english.PMLaunch=Open PowerManager
chs.PMLaunch=打开余电
english.PMScope=Install for:
chs.PMScope=安装范围：
english.PMScopeAll=All users
chs.PMScopeAll=所有用户
english.PMScopeUser=Current user only
chs.PMScopeUser=仅当前用户
english.PMScopeConflict=PowerManager already exists in the other install scope. Use that scope for updates.
chs.PMScopeConflict=另一个安装范围已有余电。请沿用原来的安装范围升级。
english.PMExistingPath=Update PowerManager in its existing directory:
chs.PMExistingPath=请在余电原来的安装目录中升级：
english.PMUnsafePath=Choose a dedicated local folder. Network paths, linked folders and drive roots are not supported.
chs.PMUnsafePath=请选择本机的独立目录。不支持网络路径、链接目录或磁盘根目录。
english.PMSystemPath=For all users, choose a dedicated subfolder directly under the system Program Files folder. If it is missing or unavailable, restart Setup and choose Current user only.
chs.PMSystemPath=为所有用户安装时，请选择系统 Program Files 下的独立子目录。如果系统目录不存在或不可用，请重新运行安装包并选择「仅为我安装」。
english.PMNotEmpty=Choose a new folder (an empty folder is also allowed for current-user installs). Setup will not overwrite files in an unregistered directory.
chs.PMNotEmpty=请选择新目录（仅为当前用户安装时也可选空目录）。安装程序不会覆盖未登记目录中的文件。
english.PMNewer=A newer PowerManager version is already installed.
chs.PMNewer=已安装较新版本的余电。
english.PMClose=Close PowerManager from its tray menu, including in any other signed-in session, then retry.
chs.PMClose=请从托盘退出余电（包括其他已登录会话中的余电），然后重试。
english.PMCheckFailed=Setup could not verify that PowerManager has exited. No files were changed.
chs.PMCheckFailed=无法确认余电已经退出。未更改文件。
english.PMLoginFailed=Could not remove the PowerManager sign-in entry.
chs.PMLoginFailed=无法移除余电的登录启动项。
english.PMPurge=Also remove the current user's PowerManager settings, battery history and diagnostic logs? This cannot be undone. Choose No to keep them.
chs.PMPurge=同时删除当前用户的余电设置、电量历史和诊断日志？此操作不可撤销。选「否」可保留数据。
english.PMPurgeFailed=PowerManager was uninstalled, but the local data could not be safely removed.
chs.PMPurgeFailed=余电已卸载，但未能安全移除本地数据。
english.PMUserElevated=For a current-user installation, reopen Setup normally instead of using Run as administrator.
chs.PMUserElevated=仅为当前用户安装时，请直接打开安装包，不要以管理员身份运行。

[Tasks]
Name: "desktopicon"; Description: "{cm:PMDesktop}"; Flags: unchecked

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "lang\LICENSE-ChineseSimplified.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "maintenance.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "maintenance.ps1"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\PowerManager"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"
Name: "{autodesktop}\PowerManager"; Filename: "{app}\{#AppExe}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Flags: nowait skipifsilent runasoriginaluser; Check: ReopenForeground
Filename: "{app}\{#AppExe}"; Parameters: "--background"; Flags: nowait skipifsilent runasoriginaluser; Check: ReopenTray
Filename: "{app}\{#AppExe}"; Description: "{cm:PMLaunch}"; Flags: postinstall nowait skipifsilent runasoriginaluser; Check: OfferLaunch

[UninstallDelete]
Type: files; Name: "{app}\.installer-maintenance"

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  UninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#ProductId}_is1';
  InvalidAttributes = $FFFFFFFF;
  ReparsePoint = $400;
  DirectoryAttribute = $10;
var
  GatePath: String;
  ResumeMode: Integer;
  PurgeData: Boolean;
  ExistingInstall: Boolean;

function GetFileAttributes(Name: String): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';

function GetDriveType(Path: String): LongWord;
  external 'GetDriveTypeW@kernel32.dll stdcall';

function CleanPath(Path: String): String;
begin
  Result := RemoveBackslashUnlessRoot(ExpandFileName(Path));
end;

function RegisteredPath(Root: Integer; var Path: String): Boolean;
begin
  Result := RegQueryStringValue(Root, UninstallKey, 'InstallLocation', Path) and (Trim(Path) <> '');
end;

function LinkedPath(Path: String): Boolean;
var
  Attr: LongWord;
  Parent: String;
begin
  Result := False;
  Path := CleanPath(Path);
  while Path <> '' do
  begin
    Attr := GetFileAttributes(Path);
    if (Attr <> InvalidAttributes) and ((Attr and ReparsePoint) <> 0) then
    begin
      Result := True;
      Exit;
    end;
    Parent := ExtractFileDir(Path);
    if CompareText(Parent, Path) = 0 then Exit;
    Path := Parent;
  end;
end;

function EmptyFolder(Path: String): Boolean;
var
  Entry: TFindRec;
  Attr: LongWord;
begin
  Attr := GetFileAttributes(Path);
  if Attr = InvalidAttributes then
  begin
    Result := not FileExists(Path) and not DirExists(Path);
    Exit;
  end;
  Result := False;
  if (Attr and DirectoryAttribute) = 0 then Exit;
  if not FindFirst(AddBackslash(Path) + '*', Entry) then Exit;
  try
    repeat
      if (Entry.Name <> '.') and (Entry.Name <> '..') then Exit;
    until not FindNext(Entry);
    Result := True;
  finally
    FindClose(Entry);
  end;
end;

function SafeProfileTree(Path: String; Depth: Integer): Boolean;
var
  Entry: TFindRec;
begin
  Result := False;
  if Depth > 64 then Exit;
  if not FindFirst(AddBackslash(Path) + '*', Entry) then Exit;
  try
    repeat
      if (Entry.Name <> '.') and (Entry.Name <> '..') then
      begin
        if (Entry.Attributes and ReparsePoint) <> 0 then Exit;
        if ((Entry.Attributes and DirectoryAttribute) <> 0) and
          not SafeProfileTree(AddBackslash(Path) + Entry.Name, Depth + 1) then Exit;
      end;
    until not FindNext(Entry);
    Result := True;
  finally
    FindClose(Entry);
  end;
end;

function IsSharedLocation(Path: String): Boolean;
var
  Programs: String;
begin
  Result := False;
  try
    Programs := CleanPath(ExpandConstant('{commonpf64}'));
    Result := DirExists(Programs) and not LinkedPath(Path) and
      (CompareText(ExtractFileDir(Path), Programs) = 0);
  except
    Log('The Windows Program Files folder could not be resolved.');
  end;
end;

function InOrUnder(Path, Parent: String): Boolean;
begin
  Result := CompareText(Copy(AddBackslash(Path), 1, Length(AddBackslash(Parent))),
    AddBackslash(Parent)) = 0;
end;

function ValidateDestination(Path: String): String;
var
  ThisPath, OtherPath, Profile: String;
  ThisRoot, OtherRoot: Integer;
  HasInstall: Boolean;
begin
  Result := '';
  Path := CleanPath(Path);
  ThisRoot := HKCU;
  OtherRoot := HKLM;
  if IsAdminInstallMode then
  begin
    ThisRoot := HKLM;
    OtherRoot := HKCU;
  end;
  HasInstall := RegisteredPath(ThisRoot, ThisPath);
  if RegisteredPath(OtherRoot, OtherPath) then
  begin
    Result := CustomMessage('PMScopeConflict');
    Exit;
  end;
  if HasInstall and (CompareText(CleanPath(ThisPath), Path) <> 0) then
  begin
    Result := CustomMessage('PMExistingPath') + #13#10 + ThisPath;
    Exit;
  end;
  if (Length(Path) < 4) or (Copy(Path, 2, 2) <> ':\') or (GetDriveType(Copy(Path, 1, 3)) <> 3) or LinkedPath(Path) then
  begin
    Result := CustomMessage('PMUnsafePath');
    Exit;
  end;
  if IsAdminInstallMode then
  begin
    if not IsSharedLocation(Path) then
    begin
      Result := CustomMessage('PMSystemPath');
      Exit;
    end;
  end
  else
  begin
    Profile := CleanPath(ExpandConstant('{localappdata}\PowerManager-H5'));
    if InOrUnder(Path, Profile) or InOrUnder(Profile, Path) then
    begin
      Result := CustomMessage('PMUnsafePath');
      Exit;
    end;
  end;
  if not HasInstall and ((IsAdminInstallMode and DirExists(Path)) or not EmptyFolder(Path)) then
    Result := CustomMessage('PMNotEmpty');
end;

function DefaultDestination(Param: String): String;
begin
  try
    Result := AddBackslash(ExpandConstant('{autopf}')) + 'PowerManager';
  except
    { Keep the wizard usable if Windows cannot resolve its known folder.
      System mode must still pass ValidateDestination; it never silently
      changes permission scope or installs under this fallback. }
    Result := ExpandConstant('{localappdata}\Programs\PowerManager');
  end;
end;

function InitializeSetup: Boolean;
begin
  Result := IsAdminInstallMode or not IsAdmin;
  if not Result then
    SuppressibleMsgBox(CustomMessage('PMUserElevated'), mbError, MB_OK, IDOK);
end;

procedure InitializeWizard;
var
  Registered: String;
begin
  if RegisteredPath(HKA, Registered) then
  begin
    WizardForm.DirEdit.Text := Registered;
    WizardForm.DirEdit.ReadOnly := True;
    WizardForm.DirBrowseButton.Enabled := False;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Problem: String;
begin
  Result := True;
  if CurPageID <> wpSelectDir then Exit;
  Problem := ValidateDestination(WizardDirValue);
  Result := Problem = '';
  if not Result then
    SuppressibleMsgBox(Problem, mbError, MB_OK, IDOK);
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  Scope: String;
begin
  Scope := CustomMessage('PMScopeUser');
  if IsAdminInstallMode then Scope := CustomMessage('PMScopeAll');
  Result := CustomMessage('PMScope') + NewLine + Space + Scope +
    NewLine + NewLine + MemoDirInfo;
  if MemoTasksInfo <> '' then Result := Result + NewLine + NewLine + MemoTasksInfo;
end;

function CheckSharedAppStopped: Integer;
var
  Parameters, Path, Checks: String;
begin
  { No execution from the installation directory or user profile while elevated.
    Check all sessions in the shared-install mode. WMI failure must block. }
  Result := 20;
  Path := CleanPath(ExpandConstant('{app}'));
  StringChangeEx(Path, '''' , '''''', True);
  Checks := '$ErrorActionPreference=''Stop''; try { ' +
    '$p = ''' + Path + '''; ' +
    '$apps = @(Get-CimInstance Win32_Process -Filter ''Name = ''''PowerManager-H5.exe'''' OR Name = ''''collector.exe'''''' ); ' +
    'foreach ($a in $apps) { if ($a.ExecutablePath -ieq ($p + ''\PowerManager-H5.exe'') -or ' +
    '$a.ExecutablePath -ieq ($p + ''\resources\collector.exe'') -or ' +
    '($a.Name -ieq ''PowerManager-H5.exe'' -and !$a.ExecutablePath)) { exit 21 } }; exit 0 ' +
    '} catch { exit 20 }';
  Parameters := '-NoProfile -NonInteractive -Command ' + AddQuotes(Checks);
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      Parameters, '', SW_HIDE, ewWaitUntilTerminated, Result) then
    Result := 20;
end;

function ExitMessage(Code: Integer): String;
begin
  if (IsAdminInstallMode or IsAdmin) and (Code <> 21) then
    Result := CustomMessage('PMCheckFailed')
  else
    Result := CustomMessage('PMClose');
end;

procedure ReleaseGate;
begin
  if GatePath <> '' then
  begin
    DeleteFile(GatePath);
    GatePath := '';
  end;
end;

function GateSharedApp: Boolean;
begin
  Result := False;
  if not IsSharedLocation(CleanPath(ExpandConstant('{app}'))) then Exit;
  GatePath := ExpandConstant('{app}\.installer-maintenance');
  Result := SaveStringToFile(GatePath, 'maintenance', False);
  if not Result then GatePath := '';
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
  InstalledExe: String;
  OldVersion, NewVersion: Int64;
begin
  Result := ValidateDestination(ExpandConstant('{app}'));
  if Result <> '' then Exit;
  InstalledExe := ExpandConstant('{app}\{#AppExe}');
  ExistingInstall := FileExists(InstalledExe);
  if GetPackedVersion(InstalledExe, OldVersion) and StrToVersion('{#AppVersion}', NewVersion) and
    (ComparePackedVersion(OldVersion, NewVersion) > 0) then
  begin
    Result := CustomMessage('PMNewer');
    Exit;
  end;
  if not ExistingInstall then Exit;
  if IsAdminInstallMode then
  begin
    if not GateSharedApp then
    begin
      Result := CustomMessage('PMCheckFailed');
      Exit;
    end;
  end
  else ExtractTemporaryFile('maintenance.ps1');
  repeat
    if IsAdminInstallMode then ResumeMode := CheckSharedAppStopped
    else ResumeMode := StopApp(ExpandConstant('{tmp}\maintenance.ps1'));
    if Stopped(ResumeMode) then Exit;
  until SuppressibleMsgBox(ExitMessage(ResumeMode), mbError, MB_RETRYCANCEL, IDCANCEL) <> IDRETRY;
  ReleaseGate;
  Result := ExitMessage(ResumeMode);
end;

function ReopenForeground: Boolean;
begin
  Result := (not IsAdminInstallMode) and (not IsAdmin) and (ResumeMode = 11);
end;
function ReopenTray: Boolean;
begin
  Result := (not IsAdminInstallMode) and (not IsAdmin) and (ResumeMode = 10);
end;
function OfferLaunch: Boolean;
begin
  Result := (not IsAdminInstallMode) and (not IsAdmin) and not ExistingInstall;
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
          RaiseException(CustomMessage('PMLoginFailed'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Profile: String;
  Shared: Boolean;
begin
  Shared := IsAdminInstallMode or IsAdmin;
  if CurUninstallStep = usUninstall then
  begin
    if IsAdminInstallMode and not GateSharedApp then
      RaiseException(CustomMessage('PMCheckFailed'));
    repeat
      if Shared then ResumeMode := CheckSharedAppStopped
      else ResumeMode := StopApp(ExpandConstant('{app}\maintenance.ps1'));
      if Stopped(ResumeMode) then Break;
      if SuppressibleMsgBox(ExitMessage(ResumeMode), mbError, MB_RETRYCANCEL, IDCANCEL) <> IDRETRY then
        RaiseException(ExitMessage(ResumeMode));
    until False;
    if not Shared then
    begin
      RemoveLoginItem;
      Profile := ExpandConstant('{localappdata}\PowerManager-H5');
      PurgeData := DirExists(Profile) and not UninstallSilent and
        (SuppressibleMsgBox(CustomMessage('PMPurge'), mbConfirmation,
          MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES);
    end;
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    ReleaseGate;
    { Do not remove the app directory recursively; Inno tracks package files. }
    RemoveDir(ExpandConstant('{app}'));
    if PurgeData then
    begin
      Profile := ExpandConstant('{localappdata}\PowerManager-H5');
      if DirExists(Profile) and
        (LinkedPath(Profile) or not SafeProfileTree(Profile, 0) or not DelTree(Profile, True, True, True)) then
        SuppressibleMsgBox(CustomMessage('PMPurgeFailed'), mbError, MB_OK, IDOK);
    end;
  end;
end;

procedure DeinitializeUninstall;
begin
  ReleaseGate;
end;
