param([Parameter(Mandatory)][string]$IsccPath)

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This fixture is for a disposable GitHub-hosted runner only.' }
$directory = New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP ('pm-profile-qa-' + [guid]::NewGuid().ToString('N')))
$source = Join-Path $PSScriptRoot '..\installer\qa\profile-cleanup.iss'
& $IsccPath "/O$($directory.FullName)" $source
if ($LASTEXITCODE -ne 0) { throw "Profile QA compile returned $LASTEXITCODE." }
$log = Join-Path $directory.FullName 'cleanup.log'
$fixture = Join-Path $directory.FullName 'PowerManager-Profile-Cleanup-QA.exe'
$proc = Start-Process -FilePath $fixture -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG=`"$log`"" -PassThru
if (!$proc.WaitForExit(45000)) { Stop-Process -Id $proc.Id -Force; throw 'Profile QA timed out.' }
$trace = Get-Content -LiteralPath $log
$trace | Select-String -SimpleMatch 'PASS:'
if ($proc.ExitCode -ne 0 -or @($trace | Select-String -SimpleMatch 'PASS:').Count -ne 4) {
    $trace | Select-Object -Last 60 | Write-Host
    throw "Profile cleanup QA failed (exit $($proc.ExitCode))."
}
