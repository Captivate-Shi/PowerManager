param([Parameter(Mandatory)][string]$SetupPath)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This smoke test is for a disposable GitHub-hosted runner only.' }
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$app = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)) 'PowerManager'
$key = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PowerManager.CaptivateShi_is1'
$profile = Join-Path $env:LOCALAPPDATA 'PowerManager-H5'
$profileProbe = Join-Path $profile ('ci-keep-' + [guid]::NewGuid().ToString('N'))
$programs = [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms)
$shortcut = Join-Path $programs 'PowerManager.lnk'
if ((Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath $key) -or
    (Test-Path -LiteralPath $shortcut)) { throw 'Unexpected previous install; refusing to modify it.' }

function Invoke-Inno($exe, $verb, $argsPrefix) {
    $log = Join-Path $env:RUNNER_TEMP "powermanager-$verb.log"
    $proc = Start-Process -FilePath $exe -ArgumentList "$argsPrefix /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG=`"$log`"" -PassThru
    if (!$proc.WaitForExit(90000)) { Stop-Process -Id $proc.Id -Force; throw "$verb timed out." }
    if ($proc.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $log) { Get-Content -Tail 65 -LiteralPath $log | Write-Host }
        throw "$verb returned $($proc.ExitCode)."
    }
}

try {
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    Set-Content -LiteralPath $profileProbe -Value 'user data marker'
    Invoke-Inno $setup 'install' '/ALLUSERS /LANG=chs'
    $install = Get-ItemProperty -LiteralPath $key
    if ($install.InstallLocation.TrimEnd('\') -ine $app) { throw 'Setup did not use the system Program Files folder.' }
    if (!(Test-Path -LiteralPath (Join-Path $app 'PowerManager-H5.exe'))) { throw 'Application EXE missing.' }
    if (!(Test-Path -LiteralPath $shortcut)) { throw 'Common Start menu shortcut missing.' }
    $foreign = Join-Path $app 'foreign-file.txt'
    Set-Content -LiteralPath $foreign -Value 'not owned by Setup'
    Invoke-Inno $setup 'upgrade' '/ALLUSERS /LANG=chs'
    if (!(Test-Path -LiteralPath $foreign)) { throw 'Upgrade removed an unrelated file.' }
    if (Test-Path -LiteralPath (Join-Path $app '.installer-maintenance')) { throw 'Upgrade left its maintenance marker behind.' }
    $uninstall = (Get-ItemProperty -LiteralPath $key).UninstallString.Trim('"')
    if (!(Test-Path -LiteralPath $uninstall)) { throw 'Registered uninstaller missing.' }
    Invoke-Inno $uninstall 'uninstall' ''
    if ((Test-Path -LiteralPath (Join-Path $app 'PowerManager-H5.exe')) -or
        (Test-Path -LiteralPath $shortcut) -or (Test-Path -LiteralPath $key)) { throw 'Owned files, shortcut, or registration remain.' }
    if (!(Test-Path -LiteralPath $foreign) -or !(Test-Path -LiteralPath $profileProbe)) { throw 'Uninstall removed unrelated files or user data.' }
    if (Test-Path -LiteralPath (Join-Path $app '.installer-maintenance')) { throw 'Uninstall left its maintenance marker behind.' }
    Write-Host 'System installer, same-path update, and uninstall passed; unrelated file and user data preserved.'
} finally {
    if (Test-Path -LiteralPath $profileProbe) { Remove-Item -LiteralPath $profileProbe }
}
