const { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { join, dirname } = require('node:path');
const { execFileSync } = require('node:child_process');
const { packager } = require('@electron/packager');
const manifest = require('../package.json');

async function build() {
  const root = join(__dirname, '..');
  const staging = join(root, '.stage');
  const output = join(root, 'out', manifest.version);
  mkdirSync(staging, { recursive: true });
  const stage = mkdtempSync(join(staging, 'app-'));
  let folder;
  try {
    cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
    writeFileSync(join(stage, 'package.json'), JSON.stringify({
      name: manifest.name, productName: manifest.productName, version: manifest.version, main: manifest.main,
    }));
    [folder] = await packager({
      dir: stage, out: output, name: 'PowerManager-H5', arch: 'x64', platform: 'win32',
      electronVersion: manifest.devDependencies.electron, electronZipDir: process.env.POWER_MANAGER_ELECTRON_ZIP_DIR,
      overwrite: true, asar: true, prune: false,
      icon: join(root, 'public', 'assets', 'powermanager.ico'),
      extraResource: [join(root, '.native', 'collector.exe')],
    });
  } finally {
    const target = realpathSync(stage);
    if (dirname(target) === realpathSync(staging)) rmSync(target, { recursive: true });
  }
  const zip = join(output, 'PowerManager-H5-win32-x64.zip');
  execFileSync('tar.exe', ['-a', '-cf', zip, '-C', output, 'PowerManager-H5-win32-x64'], { stdio: 'inherit' });
  console.log(folder);
  console.log(zip);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
