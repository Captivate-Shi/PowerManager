import { useLayoutEffect, useRef, type ReactNode } from 'react';
import scene from './scene.module.css';

type Target = { x: number; y: number; width: number; height: number };
const near = (a: number, b: number) => Math.abs(a - b) < .5;
const same = (a: Target, b: Target) => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
const pose = (x: number, y: number, sx = 1, sy = 1) =>
  `translate3d(${x}px, ${y}px, 0) scale(${sx}, ${sy})`;

export function JellyNav({ current, children }: { current: string; children: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const resting = useRef<Target>(null);
  const motion = useRef<Animation>(null);
  useLayoutEffect(() => {
    const container = nav.current;
    const indicator = pill.current;
    const button = container?.querySelector<HTMLButtonElement>('button[aria-current="page"]');
    if (!container || !indicator || !button) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    function fit(animate: boolean) {
      if (!container || !indicator || !button) return;
      const next = { x: button.offsetLeft, y: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight };
      if (next.width <= 0 || next.height <= 0) return;
      const previous = resting.current;
      if (previous && same(previous, next)) return;
      if (next.x < container.scrollLeft) container.scrollLeft = next.x;
      else if (next.x + next.width > container.scrollLeft + container.clientWidth)
        container.scrollLeft = next.x + next.width - container.clientWidth;
      const bounds = container.getBoundingClientRect();
      const live = indicator.getBoundingClientRect();
      const startX = live.left - bounds.left + container.scrollLeft;
      const startY = live.top - bounds.top + container.scrollTop;
      motion.current?.cancel();
      indicator.style.width = next.width + 'px';
      indicator.style.height = next.height + 'px';
      indicator.style.transform = pose(next.x, next.y);
      indicator.dataset.ready = '';
      resting.current = next;
      if (!previous || !animate || reduced.matches || typeof indicator.animate !== 'function') return;
      const shift = next.x - startX;
      const direction = Math.sign(shift);
      const stretch = Math.min(.21, Math.abs(shift) / next.width * .15);
      motion.current = indicator.animate([
        { offset: 0, transform: pose(startX, startY, live.width / next.width, live.height / next.height) },
        { offset: .42, transform: pose(startX + shift * .75 - next.width * stretch / 2, next.y + 1, 1 + stretch, .94), easing: 'cubic-bezier(.2,.55,.26,1)' },
        { offset: .7, transform: pose(next.x + direction * Math.min(4, Math.abs(shift) * .09), next.y - .4, .98, 1.025) },
        { offset: .88, transform: pose(next.x - direction * 1.3, next.y, 1.008, 1) },
        { offset: 1, transform: pose(next.x, next.y) },
      ], { duration: 345, easing: 'cubic-bezier(.22,.61,.34,1)' });
    }
    fit(true);
    const observer = new ResizeObserver(() => fit(false));
    observer.observe(container);
    observer.observe(button);
    const onPreference = () => { if (reduced.matches) motion.current?.cancel(); };
    reduced.addEventListener('change', onPreference);
    return () => {
      observer.disconnect();
      reduced.removeEventListener('change', onPreference);
    };
  }, [current]);

  return <nav ref={nav} className={scene.jellyNav} aria-label="主导航">
    <span className={scene.jellyGlass} ref={pill} data-nav-indicator="" aria-hidden="true" />
    {children}
  </nav>;
}
