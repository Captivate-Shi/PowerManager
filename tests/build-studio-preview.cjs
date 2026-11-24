// Portable, offline preview of the same renderer source. This is not the native app.
const { readFileSync, writeFileSync, readdirSync, mkdirSync } = require('node:fs');
const { resolve, join, dirname } = require('node:path');
const { createHash } = require('node:crypto');
const { installMock } = require('./studio-review-mock.cjs');

const root = resolve(__dirname, '..');
const output = resolve(process.argv[2] || '余电-交互预览-离线Mock.html');
const mime = { png: 'image/png', webp: 'image/webp' };
function inlineAssets(folder, subdir = '', result = {}) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) inlineAssets(path, subdir + entry.name + '/', result);
    else {
      const kind = mime[entry.name.split('.').at(-1)];
      if (kind) result['./assets/' + subdir + entry.name] = 'data:' + kind + ';base64,' + readFileSync(path).toString('base64');
    }
  }
  return result;
}
async function main() {
  const assets = inlineAssets(join(root, 'public/assets'));
  const { build } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  let replaced = 0;
  const mapAssets = {
    name: 'resolve-offline-preview-assets',
    enforce: 'pre',
    transform(source, id) {
      if (id === join(root, 'src/ui.tsx')) {
        // Resolve the three device-art path expressions via the embedded asset table.
        for (const expression of [
          "'./assets/' + name + '.png'",
          "new URL('./assets/studio-v2/' + name, document.baseURI).href",
          "'./assets/' + device.art + '-' + (variant === 'stage' ? 'card' : variant === 'detail' ? 'hero' : variant) + '.webp'",
        ]) {
          if (source.includes(expression)) {
            replaced++;
            const relative = expression.startsWith('new URL(') ? "'./assets/studio-v2/' + name" : expression;
            source = source.replace(expression, 'globalThis.__offlineStudioAsset(' + relative + ')');
          }
        }
        return source;
      }
      if (id === join(root, 'src/dashboard.tsx')) {
        return source.replace(/url\((\.\/assets\/[^)]+)\)/g, (_, path) => {
          if (!assets[path]) throw Error('Offline preview missing ' + path);
          return 'url(' + assets[path] + ')';
        });
      }
    },
  };
  const out = await build({
    configFile: false, root, base: './', publicDir: false, plugins: [mapAssets, react()],
    build: { write: false, cssCodeSplit: false, modulePreload: false, assetsInlineLimit: Infinity,
      rollupOptions: { input: join(root, 'src/renderer.tsx'), output: { format: 'iife', inlineDynamicImports: true } } },
  });
  if (replaced !== 3) throw Error('Offline source mapping changed; expected all three asset expressions');
  const products = (Array.isArray(out) ? out : [out]).flatMap(result => result.output);
  const css = products.filter(result => result.fileName.endsWith('.css')).map(result => result.source).join('\n');
  const js = products.filter(result => result.type === 'chunk').map(result => result.code).join('\n');
  if (!css || !js) throw Error('Renderer build emitted no CSS or JavaScript');
  const walkthrough = process.env.STUDIO_REVIEW_WALKTHROUGH === '1';
  const boot = `(() => {
    const assets = ${JSON.stringify(assets)};
    globalThis.__offlineStudioAsset = path => assets[path] || 'data:,';
    (${installMock.toString()})({ portable: true, walkthrough: ${walkthrough} });
    if (new URLSearchParams(location.search).get('surface') === 'toast') {
      document.body.classList.add('offline-toast');
    }
  })();\n`;
  const script = (boot + js).replace(/<\/script/gi, '<\\/script');
  const hash = createHash('sha256').update(script).digest('base64');
  const custom = 'aside#offline-mode{position:fixed;z-index:300;right:15px;bottom:11px;padding:5px 9px;background:#161b24;color:#ccd3df;border:1px solid #323947;border-radius:6px;pointer-events:none;font:12px/1.3 sans-serif}.offline-toast{max-width:460px;margin:auto!important;background:#141820!important}.offline-toast #root{height:146px}.offline-toast main[aria-label="桌面电量提醒"]{height:124px}.offline-toast #offline-mode{display:none}';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'"><title>余电 · 离线交互预览</title><style>${css}\n${custom}</style></head><body><div id="root"></div><aside id="offline-mode">离线 Mock · 不读取硬件</aside><script>${script}</script></body></html>`;
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  console.log(output, Buffer.byteLength(html), 'bytes, no external assets');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
