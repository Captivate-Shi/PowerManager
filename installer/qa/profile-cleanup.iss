; Disposable Windows CI fixture. This exercises the same cleanup code as the
; uninstaller, but only on synthetic paths in Inno's private temp directory.
[Setup]
AppName=PowerManager Profile Cleanup QA
AppVersion=1.0
DefaultDirName={tmp}\qa-unused
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
OutputBaseFilename=PowerManager-Profile-Cleanup-QA

[Code]
const
  InvalidAttributes = $FFFFFFFF;
  ReparsePoint = $400;
  DirectoryAttribute = $10;

#include "..\profile-cleanup.issinc"

function Fixture(Path: String): Boolean;
begin
  Result := False;
  if not ForceDirectories(Path) then Exit;
  Result := SaveStringToFile(AddBackslash(Path) + 'marker.txt', 'keep me', False);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Root, Profile, OwnFile, Outside, ForeignFile, Junction: String;
  Code: Integer;
begin
  Result := 'Cannot create isolated profile fixtures';
  Root := ExpandConstant('{tmp}\profile-cleanup-fixtures');
  Profile := Root + '\PowerManager-H5';
  OwnFile := Profile + '\nested\marker.txt';
  Outside := Root + '\unrelated';
  ForeignFile := Outside + '\marker.txt';
  if not Fixture(Profile + '\nested') or not Fixture(Outside) then Exit;

  Result := 'Declined cleanup did not preserve both markers';
  if not ApplyProfileCleanup(Profile, False) then Exit;
  if not FileExists(OwnFile) or not FileExists(ForeignFile) then Exit;
  Log('PASS: declined cleanup preserves profile');

  Result := 'Confirmed cleanup did not remove only the profile';
  if not ApplyProfileCleanup(Profile, True) then Exit;
  if DirExists(Profile) or not FileExists(ForeignFile) then Exit;
  Log('PASS: confirmed cleanup removes only profile');

  Result := 'Cannot recreate isolated profile fixtures';
  if not Fixture(Profile + '\nested') then Exit;
  Result := 'Cannot create isolated folder-link fixture';
  Junction := Profile + '\linked';
  if not Exec(ExpandConstant('{cmd}'),
    '/D /C mklink /J ' + AddQuotes(Junction) + ' ' + AddQuotes(Outside),
    Root, SW_HIDE, ewWaitUntilTerminated, Code) then Exit;
  if Code <> 0 then Exit;
  try
    Result := 'Cleanup did not reject a profile containing a folder link';
    if ApplyProfileCleanup(Profile, True) then Exit;
    if not FileExists(OwnFile) or not FileExists(ForeignFile) then Exit;
    Log('PASS: nested folder link is rejected without deleting either marker');
  finally
    RemoveDir(Junction);
  end;

  Junction := Root + '\linked-profile';
  Result := 'Cannot create isolated linked profile';
  if not Exec(ExpandConstant('{cmd}'),
    '/D /C mklink /J ' + AddQuotes(Junction) + ' ' + AddQuotes(Outside),
    Root, SW_HIDE, ewWaitUntilTerminated, Code) then Exit;
  if Code <> 0 then Exit;
  try
    Result := 'Cleanup did not reject a linked profile root';
    if ApplyProfileCleanup(Junction, True) or not FileExists(ForeignFile) then Exit;
    Log('PASS: linked profile root is rejected without deleting the outside marker');
  finally
    RemoveDir(Junction);
  end;
  Result := '';
end;
