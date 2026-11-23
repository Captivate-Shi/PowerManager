param([string]$ToolchainBin = $env:POWER_MANAGER_TOOLCHAIN_BIN, [switch]$Test)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
    $compiler = if ($ToolchainBin) { Join-Path $ToolchainBin 'g++.exe' } else { 'g++.exe' }
    if (-not (Get-Command $compiler -ErrorAction SilentlyContinue)) {
        throw 'Set POWER_MANAGER_TOOLCHAIN_BIN to the bin folder of x64 w64devkit.'
    }
    New-Item -ItemType Directory -Path .tools,.native -ErrorAction SilentlyContinue | Out-Null
    $header = '.tools/json.hpp'
    if (-not (Test-Path -LiteralPath $header)) {
        & curl.exe -fLsS 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp' -o $header
        if ($LASTEXITCODE -ne 0) { throw 'Unable to download nlohmann/json.hpp.' }
    }
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = [BitConverter]::ToString($algorithm.ComputeHash([IO.File]::ReadAllBytes((Join-Path (Get-Location) $header)))).Replace('-', '')
    } finally { $algorithm.Dispose() }
    if ($hash -ne 'AAF127C04CB31C406E5B04A63F1AE89369FCCDE6D8FA7CDDA1ED4F32DFC5DE63') {
        throw 'Unexpected SHA-256 for nlohmann/json.hpp.'
    }
    $flags = @('-std=c++20','-O2','-Wall','-Wextra','-Wpedantic','-static','-DUNICODE','-D_UNICODE',
        '-DNOMINMAX','-DWIN32_LEAN_AND_MEAN','-D_WIN32_WINNT=0x0A00')
    & $compiler @flags -Inative/providers -I.tools native/collector.cpp native/providers/battery.cpp native/providers/hid.cpp native/providers/device_search.cpp -o .native/collector.exe -lhid -lsetupapi -lcfgmgr32 -lole32 -lshell32 -ldwmapi -lwtsapi32 -lruntimeobject -lbthprops -lpsapi
    if ($LASTEXITCODE -ne 0) { throw "Collector compilation failed ($LASTEXITCODE)" }
    if ($Test) {
        & $compiler @flags -I.tools tests/collector-fixture.cpp -o .native/collector-fixture.exe
        if ($LASTEXITCODE -ne 0) { throw 'Collector fixture compilation failed' }
        & $compiler @flags -Inative/providers tests/discovery_test.cpp native/providers/battery.cpp native/providers/device_search.cpp -o .native/discovery-test.exe -lsetupapi -lcfgmgr32 -lole32
        if ($LASTEXITCODE -ne 0) { throw 'Windows discovery test compilation failed' }
        & .native/discovery-test.exe
        if ($LASTEXITCODE -ne 0) { throw 'Windows discovery test failed' }
        & $compiler @flags -Inative/providers tests/peripheral_test.cpp -o .native/peripheral-test.exe
        if ($LASTEXITCODE -ne 0) { throw 'Peripheral protocol test compilation failed' }
        & .native/peripheral-test.exe
        if ($LASTEXITCODE -ne 0) { throw 'Peripheral protocol test failed' }
        foreach ($suite in @('battery','history')) {
            & $compiler @flags -Inative/providers "tests/${suite}_test.cpp" "native/providers/$suite.cpp" -o ".native/${suite}_test.exe"
            if ($LASTEXITCODE -ne 0) { throw "$suite test compilation failed" }
            & ".native/${suite}_test.exe"
            if ($LASTEXITCODE -ne 0) { throw "$suite test failed" }
        }
    }
} finally { Pop-Location }
