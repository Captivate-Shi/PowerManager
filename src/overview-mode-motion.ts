import { containedImage, fadeReflection, stageReflection } from './device-art-motion';

type Box = Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>;
type Photo = { src: string; deviceId: string; rect: Box; filter: string; opacity: number; matteRight: number };
type Frame = { photo?: Photo; rail?: Box };
type Mode = 'stage' | 'list';
type Running = { animations: Animation[]; node?: HTMLImageElement; reflection?: ReturnType<typeof fadeReflection> };

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
        filter: style.filter, opacity: Number(style.opacity), matteRight: this.liveMatteRight() } };
    }
    const target = this.desk.querySelector<HTMLImageElement>(
      mode === 'stage'
        ? '[data-active-stage] img[data-device-art]'
        : '[data-list-art-layer]:not([data-exiting]) img[data-device-art]',
    );
    if (!target?.complete || !target.naturalWidth || !target.naturalHeight) return { rail };
    const fitted = containedImage(target);
    if (fitted.width < 2 || fitted.height < 2) return { rail };
    const frame = target.closest('[data-list-artwork]');
    const layer = target.closest('[data-list-art-layer], [data-active-stage]');
    return { rail, photo: { src: target.currentSrc || target.src, deviceId, rect: fitted,
      filter: getComputedStyle(layer ?? target).filter,
      opacity: (layer ? Number(getComputedStyle(layer).opacity) : 1) * (frame ? Number(getComputedStyle(frame).opacity) : 1),
      matteRight: frame?.getBoundingClientRect().right ?? innerWidth } };
  }

  private liveMatteRight() {
    const plane = this.plane.getBoundingClientRect();
    const mask = getComputedStyle(this.plane).maskSize.match(/^([\d.]+)px\s/);
    return mask ? plane.left + Number(mask[1]) : plane.right;
  }

  cancel() {
    const old = this.current;
    this.current = undefined;
    old?.animations.forEach(animation => animation.cancel());
    old?.node?.remove();
    old?.reflection?.cleanup();
    delete this.desk.dataset.overviewMorph;
    delete this.desk.dataset.overviewRailMotion;
  }

  play(from: Frame, to: Frame, mode: Mode, savedReflection?: HTMLElement) {
    this.cancel();
    const animations: Animation[] = [];
    const rail = this.desk.querySelector<HTMLElement>('[data-mode-rail]');
    let node: HTMLImageElement | undefined;
    if (from.photo && to.photo && from.photo.deviceId === to.photo.deviceId && from.photo.src === to.photo.src) {
      const first = from.photo, last = to.photo, dest = last.rect;
      const plane = this.plane.getBoundingClientRect();
      const x = first.rect.x - dest.x, y = first.rect.y - dest.y;
      const sx = first.rect.width / dest.width, sy = first.rect.height / dest.height;
      const candidate = document.createElement('img');
      candidate.src = first.src;
      if (candidate.complete && candidate.naturalWidth) node = candidate;
      if (node) {
        node.alt = '';
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
        // Use the same soft edge as the real list artwork, moving its width
        // instead of swapping a hard clip for a feathered one at handoff.
        const matte = (right: number) => `${Math.max(0, right - plane.left)}px 100%`;
        animations.push(this.plane.animate([{ maskSize: matte(first.matteRight) }, { maskSize: matte(last.matteRight) }], timing));
      }
    }
    if (rail && from.rail && to.rail && from.rail.width > 0 && to.rail.width > 0) {
      const before = from.rail, after = to.rail;
      const dx = before.x - after.x;
      const spring = mode === 'list' ? Math.min(27, Math.round(after.width * .037),
        Math.max(0, innerWidth - after.x - after.width - 12)) : -6;
      const leading = mode === 'list' ? -Math.min(9, Math.round(spring * .35), Math.max(0, after.x - 12)) : 3;
      this.desk.dataset.overviewRailMotion = mode;
      const transform = getComputedStyle(rail).transform;
      const base = transform === 'none' ? '' : ' ' + transform;
      const pose = (x: number) => `translate3d(${x}px,0,0)` + base;
      animations.push(rail.animate([
        { transform: pose(dx), width: before.width + 'px' },
        { offset: .58, transform: pose(dx * .19), width: (before.width + (after.width - before.width) * .82) + 'px', easing: 'cubic-bezier(.25,.55,.38,1)' },
        { offset: .81, transform: pose(leading), width: (after.width + spring) + 'px', easing: 'cubic-bezier(.32,0,.43,1)' },
        { transform: pose(0), width: after.width + 'px' },
      ], { duration: 440, fill: 'both', easing: 'linear' }));
    }
    const layer = mode === 'stage' ? stageReflection(this.desk) : savedReflection;
    const reflection = layer && (mode === 'stage' ? fadeReflection(layer, true, 250, node ? 160 : 0) : fadeReflection(layer, false, 250));
    if (!animations.length && !reflection) return;
    const running = { animations, node, reflection };
    this.current = running;
    const pending = animations.map(animation => animation.finished);
    if (reflection) pending.push(reflection.finished);
    void Promise.allSettled(pending).then(() => {
      if (this.current === running) this.cancel();
    });
  }
}
