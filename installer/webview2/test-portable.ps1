param([Parameter(Mandatory)] [string]$ZipPath)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Run on a disposable GitHub-hosted Windows runner only.'
}
$zip = (Resolve-Path -LiteralPath $ZipPath).Path
$dir = Join-Path $env:RUNNER_TEMP ('PowerManager-Zip-Smoke-' + [Guid]::NewGuid().ToString('N'))
$testProfile = Join-Path $env:LOCALAPPDATA 'PowerManager-WebView2-RC-Test'
$log = Join-Path $testProfile 'bench.ndjson'
if (Test-Path -LiteralPath $testProfile) { throw 'Expected a fresh benchmark profile' }
$app = $null
$collector = Join-Path $dir 'lab\collector.exe'
try {
    Expand-Archive -LiteralPath $zip -DestinationPath $dir
    foreach ($file in @('PowerManager.exe', 'WebView2Loader.dll', 'lab\collector.exe')) {
        if (!(Test-Path -LiteralPath (Join-Path $dir $file) -PathType Leaf)) { throw "Portable ZIP missing $file" }
    }
    if (Get-ChildItem -LiteralPath $dir -Filter '*Setup*.exe' -Recurse) {
        throw 'Portable ZIP must not contain a setup wrapper'
    }
    $app = Start-Process -FilePath (Join-Path $dir 'PowerManager.exe') -ArgumentList '--benchmark' -WorkingDirectory $env:RUNNER_TEMP -PassThru
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        if ($app.HasExited) { throw "Portable application exited: $($app.ExitCode)" }
        if (Test-Path -LiteralPath $log) {
            $evidence = Get-Content -LiteralPath $log -Raw
            if ($evidence -match '"name":"renderer-ready"' -and $evidence -match '"name":"poll"') {
                $ready = $true
                break
            }
        }
        Start-Sleep -Milliseconds 500
    }
    if (!$ready) { throw 'No renderer-ready and collector poll evidence from the portable build' }
} finally {
    if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    Get-Process -Name collector -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $collector } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}
