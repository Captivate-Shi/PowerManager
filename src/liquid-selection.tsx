import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import css from './liquid-selection.module.css';

// Rounded-rectangle distance + RG displacement adapted from Shu Ding's
// MIT-licensed liquid-glass.js (a2d2e847); see public/licenses/shuding-liquid-glass.txt.
type MapImage = { w: number; h: number; url: string };
const cached = new Map<string, string>();
function displacement(w: number, h: number, radius: number) {
  const key = `${w}:${h}:${radius}`;
  const hit = cached.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  const factor = Math.min(1, 220 / w, 108 / h);
  canvas.width = Math.max(1, Math.round(w * factor));
  canvas.height = Math.max(1, Math.round(h * factor));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const pixels = ctx.createImageData(canvas.width, canvas.height);
  const r = Math.min(radius, w / 2, h / 2), rim = Math.min(h * .42, 15);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = (x + .5) / canvas.width * w - w / 2;
      const py = (y + .5) / canvas.height * h - h / 2;
      const qx = Math.abs(px) - w / 2 + r, qy = Math.abs(py) - h / 2 + r;
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0), outside = Math.hypot(ox, oy);
      const distance = Math.min(Math.max(qx, qy), 0) + outside - r;
      const u = Math.max(0, Math.min(1, 1 + distance / rim));
      const fade = u * u * (3 - 2 * u) * .44;
      const nx = Math.sign(px) * (outside ? ox / outside : Number(qx >= qy));
      const ny = Math.sign(py) * (outside ? oy / outside : Number(qy > qx));
      const i = (y * canvas.width + x) * 4;
      pixels.data[i] = 128 - 255 * fade * nx;
      pixels.data[i + 1] = 128 - 255 * fade * ny;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const url = canvas.toDataURL();
  if (cached.size >= 24) cached.delete(cached.keys().next().value!);
  cached.set(key, url);
  return url;
}

export function LiquidSelection({ kind = 'row' }: { kind?: 'tab' | 'row' | 'card' }) {
  const id = 'selection-lens-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const layer = useRef<HTMLSpanElement>(null);
  const [map, setMap] = useState<MapImage>();
  const refractionScale = kind === 'tab' ? 17 : kind === 'card' ? 25 : 22;
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el || !CSS.supports('backdrop-filter', 'url(#test)')) return;
    const preference = matchMedia('(prefers-reduced-transparency: reduce), (forced-colors: active)');
    const measure = () => {
      if (preference.matches) { setMap(undefined); return; }
      const w = el.offsetWidth, h = el.offsetHeight;
      if (!w || !h) return;
      setMap(previous => previous?.w === w && previous.h === h ? previous :
        { w, h, url: displacement(w, h, kind === 'tab' ? 9 : 11) });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    preference.addEventListener('change', measure);
    measure();
    return () => { observer.disconnect(); preference.removeEventListener('change', measure); };
  }, [kind]);
  return <>
    <span ref={layer} className={css.glass} data-liquid-selection={kind} data-refracting={!!map?.url || undefined}
      style={map?.url ? { '--lens': `url("#${id}")` } as CSSProperties : undefined} aria-hidden="true" />
    {map?.url && createPortal(<svg className={css.definitions} width="0" height="0" aria-hidden="true">
      <defs><filter id={id} x={0} y={0} width={map.w} height={map.h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
        <feImage href={map.url} x={0} y={0} width={map.w} height={map.h} preserveAspectRatio="none" result="glassMap" />
        <feDisplacementMap in="SourceGraphic" in2="glassMap" scale={refractionScale} xChannelSelector="R" yChannelSelector="G" />
      </filter></defs>
    </svg>, document.body)}
  </>;
}
