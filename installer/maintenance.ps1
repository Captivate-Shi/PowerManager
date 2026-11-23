param(
    [Parameter(Mandatory)][string]$InstallPath
)

$ErrorActionPreference = 'Stop'
$appExe = Join-Path $InstallPath 'PowerManager-H5.exe'
$collectorExe = Join-Path $InstallPath 'resources\collector.exe'
$session = (Get-Process -Id $PID).SessionId

function Get-InstallProcesses {
    Get-CimInstance Win32_Process -Filter "SessionId=$session AND (Name='PowerManager-H5.exe' OR Name='collector.exe')" |
        Where-Object { $_.ExecutablePath -ieq $appExe -or $_.ExecutablePath -ieq $collectorExe }
}

$reply = $null
try {
    $running = @(Get-InstallProcesses)
    if ($running.Count -eq 0) { exit 0 }
    if (!($running | Where-Object ExecutablePath -IEQ $appExe)) {
        throw 'The installed collector is still running without its application.'
    }
    $id = [guid]::NewGuid().ToString('N')
    $directory = Join-Path $env:LOCALAPPDATA 'PowerManager-H5'
    $reply = Join-Path $directory ('.maintenance-' + $id + '.json')
    Start-Process -FilePath $appExe -ArgumentList "--maintenance-quit=$id" -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        if (Test-Path -LiteralPath $reply) {
            try { $response = Get-Content -Raw -LiteralPath $reply -Encoding UTF8 | ConvertFrom-Json } catch { $response = $null }
            if ($response.error) { throw $response.error }
            if ($response.display -and @(Get-InstallProcesses).Count -eq 0) {
                switch ($response.display) {
                    'closed' { exit 0 }
                    'tray' { exit 10 }
                    'foreground' { exit 11 }
                }
            }
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'Timed out waiting for the installed app and collector to exit.'
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 20
} finally {
    if ($reply -and (Test-Path -LiteralPath $reply)) { Remove-Item -LiteralPath $reply -ErrorAction SilentlyContinue }
}
