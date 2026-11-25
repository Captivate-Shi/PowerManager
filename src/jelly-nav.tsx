import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { LiquidSelection } from './liquid-selection';
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
      // Retarget from the actual painted pill on rapid reversals, not the old tab.
      const fromCenter = startX + live.width / 2;
      const toCenter = next.x + next.width / 2;
      const distance = toCenter - fromCenter;
      const sign = Math.sign(distance);
      const stretch = Math.min(.43, Math.abs(distance) / next.width * .31);
      const overshoot = Math.min(10, Math.abs(distance) * .12);
      const centerY = next.y + next.height / 2;
      const at = (center: number, sx: number, sy: number) =>
        pose(center - next.width * sx / 2, centerY - next.height * sy / 2, sx, sy);
      // Leading edge pulls ahead, then the trailing edge catches up on landing.
      // Transform only: do not resize the displacement map or animate the label.
      motion.current = indicator.animate([
        { offset: 0, transform: pose(startX, startY, live.width / next.width, live.height / next.height),
          easing: 'cubic-bezier(.28,.15,.35,1)' },
        { offset: .31, transform: at(fromCenter + distance * .57, 1 + stretch, .77),
          easing: 'cubic-bezier(.21,.7,.27,1)' },
        { offset: .59, transform: at(toCenter + sign * overshoot, .87, 1.15),
          easing: 'cubic-bezier(.3,.05,.55,1)' },
        { offset: .79, transform: at(toCenter - sign * overshoot * .37, 1.065, .94), easing: 'ease-out' },
        { offset: .92, transform: at(toCenter + sign * overshoot * .12, .99, 1.02), easing: 'ease-out' },
        { offset: 1, transform: pose(next.x, next.y) },
      ], { duration: 420 });
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
    <span className={scene.jellyGlass} ref={pill} data-nav-indicator="" aria-hidden="true"><LiquidSelection kind="tab" /></span>
    {children}
  </nav>;
}
