#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "$root"
: "${MAKENSIS:?set path to makensis}"
: "${SEVEN_ZIP:?set path to 7-Zip}"
: "${WEBVIEW_BOOTSTRAPPER:?set path to the official Microsoft Evergreen bootstrapper}"
app="$root/experiments/tauri/src-tauri/target/x86_64-pc-windows-gnu/release/powermanager-tauri-lab.exe"
assets="$root/verified-inputs"
out="${1:?supply output directory}"
mkdir -p "$out"
out="$(cd -- "$out" && pwd)"
name=PowerManager-Setup-0.2.0.exe
file "$app" | grep -Eq 'PE32\+.*x86-64'
file "$assets/collector.exe" | grep -Eq 'PE32\+.*x86-64'
file "$assets/WebView2Loader.dll" | grep -Eq 'PE32\+.*x86-64'
"$MAKENSIS" -V3 -INPUTCHARSET UTF8 -DOUT="$out/$name" -DAPP="$app" \
  -DAPP_ICON="$root/experiments/tauri/src-tauri/icons/icon.ico" -DPAYLOAD="$assets" \
  -DBOOTSTRAPPER="$WEBVIEW_BOOTSTRAPPER" "$root/installer/webview2/setup.nsi"
"$SEVEN_ZIP" t "$out/$name"
check="$(mktemp -d)"
"$SEVEN_ZIP" x -y "-o$check" "$out/$name" >/dev/null
cmp "$app" "$check/PowerManager.exe"
cmp "$assets/collector.exe" "$check/lab/collector.exe"
cmp "$assets/WebView2Loader.dll" "$check/WebView2Loader.dll"
embedded="$(find "$check" -name MicrosoftEdgeWebview2Setup.exe -print -quit)"
cmp "$WEBVIEW_BOOTSTRAPPER" "$embedded"
(cd "$out"; sha256sum "$name" > SHA256SUMS.txt; zip -9 "${name%.exe}.zip" "$name" SHA256SUMS.txt)
