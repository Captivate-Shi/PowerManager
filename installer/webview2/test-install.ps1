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
$entry = Get-ItemProperty -LiteralPath $reg
if ($entry.InstallLocation -ne $folder) { throw 'Incorrect install location' }
$expectedVersion = [IO.Path]::GetFileNameWithoutExtension($setup) -replace '^PowerManager-Setup-', ''
$expectedWindowsVersion = (($expectedVersion -split '-')[0]) + '.0'
foreach ($exe in @($setup, $app)) {
    $info = (Get-Item -LiteralPath $exe).VersionInfo
    $numeric = @($info.ProductMajorPart, $info.ProductMinorPart, $info.ProductBuildPart, $info.ProductPrivatePart) -join '.'
    if ($info.ProductVersion -ne $expectedVersion -or $numeric -ne $expectedWindowsVersion) {
        throw "Unexpected product version in ${exe}: $($info.ProductVersion) ($numeric)"
    }
}
if ($entry.DisplayVersion -ne $expectedVersion) { throw 'Installer version and installed version do not match' }
if (Get-Process PowerManager -ErrorAction SilentlyContinue) { throw 'Silent setup launched the app' }
$sentinel=Join-Path $folder 'do-not-delete.txt'
Set-Content -LiteralPath $sentinel -Value 'unrelated file'
$un=Start-Process -FilePath $uninstall -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
if ($un.ExitCode -ne 0 -or (Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath $reg) -or !(Test-Path -LiteralPath $sentinel)) {
    throw 'Uninstall did not remove exactly the expected files'
}
