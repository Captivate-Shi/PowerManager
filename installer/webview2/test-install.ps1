param([Parameter(Mandatory)][string]$SetupPath)
$ErrorActionPreference='Stop'
$setup=(Resolve-Path -LiteralPath $SetupPath).Path
$folder=Join-Path $env:RUNNER_TEMP ('PowerManager-Smoke-'+[Guid]::NewGuid().ToString('N'))
$reg='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PowerManager'
if (Test-Path -LiteralPath $reg) { throw 'Installer smoke test requires a fresh runner' }
$install=Start-Process -FilePath $setup -ArgumentList '/S',"/D=$folder" -WindowStyle Hidden -Wait -PassThru
if ($install.ExitCode -ne 0) { throw 'Silent installation failed' }
$app=Join-Path $folder 'PowerManager.exe'
$uninstall=Join-Path $folder 'Uninstall.exe'
if (!(Test-Path -LiteralPath $app) -or !(Test-Path -LiteralPath $uninstall)) { throw 'Missing installed app or uninstaller' }
if ((Get-ItemProperty -LiteralPath $reg).InstallLocation -ne $folder) { throw 'Incorrect install location' }
if (Get-Process PowerManager -ErrorAction SilentlyContinue) { throw 'Silent setup launched the app' }
$sentinel=Join-Path $folder 'do-not-delete.txt'
Set-Content -LiteralPath $sentinel -Value 'unrelated file'
$un=Start-Process -FilePath $uninstall -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($un.ExitCode -ne 0 -or (Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath $reg) -or !(Test-Path -LiteralPath $sentinel)) {
    throw 'Uninstall did not remove exactly the expected files'
}
