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
    & $compiler @flags -Inative/providers -I.tools native/collector.cpp native/providers/battery.cpp native/providers/hid.cpp native/providers/device_search.cpp native/providers/ble_battery.cpp native/providers/gamepad_battery.cpp native/providers/rapoo_battery.cpp native/providers/supported_mouse_battery.cpp native/providers/rfcomm_battery_transport.cpp -o .native/collector.exe -lhid -lsetupapi -lcfgmgr32 -lole32 -lshell32 -ldwmapi -lwtsapi32 -lruntimeobject -lbthprops -lpsapi -lws2_32
    if ($LASTEXITCODE -ne 0) { throw "Collector compilation failed ($LASTEXITCODE)" }
    if ($Test) {
        $inventoryText = (& .native/collector.exe --inventory) -join "`n"
        if ($LASTEXITCODE -ne 0) { throw "The native read-only inventory failed to start ($LASTEXITCODE)." }
        $inventory = $inventoryText | ConvertFrom-Json
        if ($inventory.schemaVersion -lt 2 -or !$inventory.gamepads.wgiStatus -or !$inventory.gamepads.xinputStatus) {
            throw 'The native inventory did not emit its diagnostic contract.'
        }

        # Exercise the same async wire reply used by the desktop app, without
        # requiring real peripherals on the disposable Windows runner.
        $nativeStart = [Diagnostics.ProcessStartInfo]::new((Resolve-Path .native/collector.exe).Path)
        $nativeStart.UseShellExecute = $false
        $nativeStart.CreateNoWindow = $true
        $nativeStart.RedirectStandardInput = $true
        $nativeStart.RedirectStandardOutput = $true
        $nativeStart.StandardOutputEncoding = [Text.Encoding]::UTF8
        $native = [Diagnostics.Process]::Start($nativeStart)
        try {
            $native.StandardInput.WriteLine('{"id":1,"action":"poll","force":true,"generation":0,"sequence":1,"due":{},"watched":[],"voltage":false}')
            $native.StandardInput.Flush()
            $line = $native.StandardOutput.ReadLineAsync()
            if (!$line.Wait(15000) -or !$line.Result) { throw 'Native async poll did not reply.' }
            $poll = $line.Result | ConvertFrom-Json
            if ($poll.id -ne 1 -or $poll.error -or $poll.result.rows -isnot [array] -or $poll.result.workPending -isnot [bool] -or
                $poll.result.discoveryPending -isnot [bool]) {
                throw 'Native async poll reply did not match the desktop wire contract.'
            }
        } finally {
            $native.StandardInput.Close()
            if (!$native.WaitForExit(8000)) { $native.Kill(); $native.WaitForExit() }
            $native.Dispose()
        }

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
        foreach ($suite in @('battery_fallback', 'hid_batches', 'discovery_job', 'logitech_receiver_scan', 'diagnostic_scope', 'ble_battery', 'gamepad_battery', 'gamepad_vendor_battery', 'default_peripheral', 'rapoo_battery', 'langtu_t98', 'supported_mouse_battery', 'sony_headphone_battery', 'oppo_headphone_battery', 'huawei_headphone_battery', 'gamesir_battery', 'cn_mouse_codecs', 'cn_tail_codecs', 'lightspeed12', 'headset_battery', 'verified_mouse', 'atk_v75x', 'rog_keyboard_battery')) {
            & $compiler @flags -Inative/providers "tests/${suite}_test.cpp" -o ".native/${suite}_test.exe"
            if ($LASTEXITCODE -ne 0) { throw "$suite test compilation failed" }
            & ".native/${suite}_test.exe"
            if ($LASTEXITCODE -ne 0) { throw "$suite test failed" }
        }
        foreach ($suite in @('battery','history')) {
            & $compiler @flags -Inative/providers "tests/${suite}_test.cpp" "native/providers/$suite.cpp" -o ".native/${suite}_test.exe"
            if ($LASTEXITCODE -ne 0) { throw "$suite test compilation failed" }
            & ".native/${suite}_test.exe"
            if ($LASTEXITCODE -ne 0) { throw "$suite test failed" }
        }
    }
} finally { Pop-Location }
