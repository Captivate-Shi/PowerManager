import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
const html = resolve(base, '../../dist/ui/index.html');
const source = readFileSync(html, 'utf8');
if (!/http-equiv="Content-Security-Policy"/.test(source) || source.includes('desktop-bridge.js') || !source.includes('type="module"'))
  throw Error('Expected a clean npm build:web artifact');
const policy = /^<meta http-equiv="Content-Security-Policy"[^>]+>\r?\n/m;
// Tauri injects its own CSP with the exact local IPC origins in tauri.conf.json.
writeFileSync(html, source.replace(policy, '').replace('</title>', '</title>\n<script src="./desktop-bridge.js"></script>'));
copyFileSync(resolve(base, 'desktop-bridge.js'), resolve(dirname(html), 'desktop-bridge.js'));
const exe = process.argv[2];
if (exe) {
  const payload = resolve(base, 'src-tauri/payload');
  mkdirSync(payload, { recursive: true });
  copyFileSync(exe, resolve(payload,'node.exe'));
  copyFileSync(resolve(base, '../../.native/collector.exe'), resolve(payload,'collector.exe'));
}
