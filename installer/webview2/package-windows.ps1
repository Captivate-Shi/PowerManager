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
$cargoMetadata = cargo metadata --manifest-path "$tauri/Cargo.toml" --locked --format-version 1 --filter-platform $target
Check-Native
$sdk = @(($cargoMetadata | ConvertFrom-Json).packages | Where-Object name -eq 'webview2-com-sys')
if ($sdk.Count -ne 1 -or $sdk[0].version -ne '0.39.1') { throw 'Unexpected pinned WebView2 SDK' }
$dll = Join-Path (Split-Path $sdk[0].manifest_path -Parent) 'x64/WebView2Loader.dll'
if ((Get-FileHash -LiteralPath $dll).Hash -ne '86545B66CDB0603BC26B626FB9AD610CB6E71F28D468F5EA66DF23B03DDA96D5') {
    throw 'Unexpected WebView2 SDK loader SHA-256'
}
Copy-Item -LiteralPath $dll -Destination $payload
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
& $nsis /WX /V3 /INPUTCHARSET UTF8 "/DOUT=$exe" "/DAPP=$app" "/DAPP_ICON=$icon" "/DLOADER=$( (Get-Item -LiteralPath (Join-Path $payload WebView2Loader.dll)).FullName )" "/DCOLLECTOR=$( (Get-Item -LiteralPath (Join-Path $payload collector.exe)).FullName )" "/DBOOTSTRAPPER=$bootstrap" (Resolve-Path 'installer/webview2/setup.nsi').Path
Check-Native
$checksum = Join-Path $out 'SHA256SUMS.txt'
'{0}  {1}' -f (Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant(), (Split-Path $exe -Leaf) |
  Set-Content -LiteralPath $checksum -Encoding ascii
Compress-Archive -LiteralPath $exe,$checksum -DestinationPath (Join-Path $out "PowerManager-Setup-$version.zip") -Force
