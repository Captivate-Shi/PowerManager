$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')
function Check-Native { if ($LASTEXITCODE -ne 0) { throw "Build command failed: $LASTEXITCODE" } }

$version = node -p "require('./package.json').version"
Check-Native
if ($version -notmatch '^\d+\.\d+\.\d+(-rc\.\d+)?$') { throw 'Invalid version' }
$tauri = 'experiments/tauri/src-tauri'
if ((Get-Content "$tauri/tauri.conf.json" -Raw | ConvertFrom-Json).version -ne $version) { throw 'Version mismatch' }

pnpm exec tsc --noEmit
Check-Native
$suites = Get-ChildItem tests -Filter '*.test.ts' | ForEach-Object FullName
node --import tsx --test @suites
Check-Native
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-native.ps1 -Test
Check-Native
pnpm run build:web
Check-Native
node experiments/tauri/prepare.mjs
Check-Native
pnpm exec esbuild experiments/tauri/desktop-bridge-diag.js --bundle --format=iife --platform=browser --alias:node:crypto=./experiments/tauri/browser-crypto.mjs --outfile=dist/ui/desktop-bridge.js
Check-Native

$payload = (New-Item -ItemType Directory "$tauri/payload" -Force).FullName
Copy-Item '.native/collector.exe' $payload
$target = 'x86_64-pc-windows-msvc'
cargo build --manifest-path "$tauri/Cargo.toml" --release --locked --target $target
Check-Native
$app = (Resolve-Path "$tauri/target/$target/release/powermanager-tauri-lab.exe").Path
$dll = @(Get-ChildItem "$tauri/target/$target/release/build" -Directory -Filter 'webview2-com-sys-*' | ForEach-Object {
    Get-Item (Join-Path $_.FullName 'out\x64\WebView2Loader.dll') -ErrorAction SilentlyContinue
} | Select-Object -First 1)
if ($dll.Count -ne 1) { throw 'Missing WebView2 SDK loader' }
Copy-Item $dll[0].FullName $payload
$env:PATH = "$payload;$env:PATH"
cargo test --manifest-path "$tauri/Cargo.toml" --release --locked --target $target
Check-Native

$bootstrap = Join-Path $env:RUNNER_TEMP 'MicrosoftEdgeWebview2Setup.exe'
Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrap
$sig = Get-AuthenticodeSignature -LiteralPath $bootstrap
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '(^|, )O=Microsoft Corporation(,|$)') {
    throw 'WebView2 runtime bootstrapper is not signed by Microsoft'
}
$nsis = @('C:\Program Files (x86)\NSIS\makensis.exe','C:\Program Files\NSIS\makensis.exe') |
    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$nsis) { throw 'Could not locate makensis' }
$out = (New-Item -ItemType Directory "out/$version" -Force).FullName
$exe = Join-Path $out "PowerManager-Setup-$version.exe"
$icon = (Resolve-Path "$tauri/icons/icon.ico").Path
& $nsis /WX /V3 /INPUTCHARSET UTF8 "/DOUT=$exe" "/DAPP=$app" "/DAPP_ICON=$icon" "/DPAYLOAD=$payload" "/DBOOTSTRAPPER=$bootstrap" (Resolve-Path 'installer/webview2/setup.nsi').Path
Check-Native
$checksum = Join-Path $out 'SHA256SUMS.txt'
'{0}  {1}' -f (Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant(), (Split-Path $exe -Leaf) |
  Set-Content -LiteralPath $checksum -Encoding ascii
Compress-Archive -LiteralPath $exe,$checksum -DestinationPath (Join-Path $out "PowerManager-Setup-$version.zip") -Force
