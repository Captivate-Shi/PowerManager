type Box = Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;
type Photo = { src: string; deviceId: string; rect: Box; filter: string; opacity: number; clipRight: number };
type Frame = { photo?: Photo; rail?: Box };
type Mode = 'stage' | 'list';
type Running = { animations: Animation[]; node?: HTMLImageElement };

function align(token: string | undefined, spare: number) {
  if (!token || token === 'center') return spare / 2;
  if (token.endsWith('%')) return spare * Number.parseFloat(token) / 100;
  if (token === 'left' || token === 'top') return 0;
  if (token === 'right' || token === 'bottom') return spare;
  const pixels = Number.parseFloat(token);
  return Number.isFinite(pixels) ? pixels : spare / 2;
}

function contained(image: HTMLImageElement): Box {
  const r = image.getBoundingClientRect();
  const ratio = Math.min(r.width / image.naturalWidth, r.height / image.naturalHeight);
  const w = image.naturalWidth * ratio, h = image.naturalHeight * ratio;
  const [x, y] = getComputedStyle(image).objectPosition.split(/\s+/);
  return { x: r.x + align(x, r.width - w), y: r.y + align(y, r.height - h), width: w, height: h };
}

export function allowOverviewMotion() {
  return typeof Element.prototype.animate === 'function' &&
    matchMedia('(min-width: 771px) and (prefers-reduced-motion: no-preference)').matches;
}

export class OverviewModeMotion {
  private current?: Running;
  constructor(private desk: HTMLDivElement, private plane: HTMLDivElement) {}

  read(mode: Mode, deviceId: string, useLiveProxy = true): Frame {
    const rail = this.desk.querySelector('[data-mode-rail]')?.getBoundingClientRect();
    const proxy = useLiveProxy ? this.current?.node : undefined;
    if (proxy?.dataset.deviceId === deviceId) {
      const style = getComputedStyle(proxy);
      return { rail, photo: { src: proxy.src, deviceId, rect: proxy.getBoundingClientRect(),
        filter: style.filter, opacity: Number(style.opacity), clipRight: this.clip() } };
    }
    const target = this.desk.querySelector<HTMLImageElement>(
      mode === 'stage'
        ? '[data-active-stage] img[data-device-art]'
        : '[data-list-art-layer]:not([data-exiting]) img[data-device-art]',
    );
    if (!target?.complete || !target.naturalWidth || !target.naturalHeight) return { rail };
    const fitted = contained(target);
    if (fitted.width < 2 || fitted.height < 2) return { rail };
    const frame = target.closest('[data-list-artwork]');
    const layer = target.closest('[data-list-art-layer]');
    return { rail, photo: { src: target.currentSrc || target.src, deviceId, rect: fitted,
      filter: getComputedStyle(layer ?? target).filter,
      opacity: layer ? Number(getComputedStyle(layer).opacity) : 1,
      clipRight: frame?.getBoundingClientRect().right ?? innerWidth } };
  }

  private clip() {
    const inset = getComputedStyle(this.plane).clipPath.match(/^inset\(0px ([\d.]+)px/);
    return inset ? this.plane.getBoundingClientRect().right - Number(inset[1]) : this.plane.getBoundingClientRect().right;
  }

  cancel() {
    const old = this.current;
    this.current = undefined;
    old?.animations.forEach(animation => animation.cancel());
    old?.node?.remove();
    delete this.desk.dataset.overviewMorph;
  }

  play(from: Frame, to: Frame, mode: Mode) {
    this.cancel();
    const animations: Animation[] = [];
    const rail = this.desk.querySelector<HTMLElement>('[data-mode-rail]');
    let node: HTMLImageElement | undefined;
    if (from.photo && to.photo && from.photo.deviceId === to.photo.deviceId && from.photo.src === to.photo.src) {
      const first = from.photo, last = to.photo, dest = last.rect;
      const plane = this.plane.getBoundingClientRect();
      const x = first.rect.x - dest.x, y = first.rect.y - dest.y;
      const sx = first.rect.width / dest.width, sy = first.rect.height / dest.height;
      node = document.createElement('img');
      node.alt = '';
      node.src = first.src;
      node.draggable = false;
      node.dataset.modeHero = '';
      node.dataset.deviceId = first.deviceId;
      Object.assign(node.style, { left: dest.x - plane.x + 'px', top: dest.y - plane.y + 'px',
        width: dest.width + 'px', height: dest.height + 'px' });
      this.plane.append(node);
      this.desk.dataset.overviewMorph = mode;
      const travel = 450;
      const timing = { duration: travel, easing: 'cubic-bezier(.25,.69,.26,1)', fill: 'both' as const };
      animations.push(node.animate([
        { transform: `translate3d(${x}px,${y}px,0) scale(${sx},${sy})`, filter: first.filter, opacity: first.opacity },
        { transform: 'translate3d(0,0,0) scale(1)', filter: last.filter, opacity: last.opacity },
      ], timing));
      const clip = (right: number) => `inset(0px ${Math.max(0, plane.right - right)}px 0px 0px)`;
      animations.push(this.plane.animate([{ clipPath: clip(first.clipRight) }, { clipPath: clip(last.clipRight) }], timing));
    }
    if (rail && from.rail && to.rail && from.rail.width > 0 && to.rail.width > 0) {
      const before = from.rail, after = to.rail;
      const dx = before.x - after.x;
      const transform = getComputedStyle(rail).transform;
      const base = transform === 'none' ? '' : ' ' + transform;
      const pose = (x: number) => `translate3d(${x}px,0,0)` + base;
      animations.push(rail.animate([
        { transform: pose(dx), width: before.width + 'px' },
        { offset: .58, transform: pose(dx * .19), width: (before.width + (after.width - before.width) * .82) + 'px', easing: 'cubic-bezier(.25,.55,.38,1)' },
        { offset: .83, transform: pose(mode === 'list' ? -4 : 3), width: (after.width + (mode === 'list' ? 13 : -6)) + 'px', easing: 'cubic-bezier(.38,0,.32,1)' },
        { transform: pose(0), width: after.width + 'px' },
      ], { duration: 420, fill: 'both', easing: 'linear' }));
    }
    if (!animations.length) return;
    const running = { animations, node };
    this.current = running;
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (this.current === running) this.cancel();
    });
  }
}
