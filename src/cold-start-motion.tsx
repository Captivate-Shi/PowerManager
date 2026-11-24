import { useEffect, useRef } from 'react';
import { studioPath } from './ui';
import style from './cold-start-motion.module.css';

// Decorative only: paint the real stage first and stop trying if this is no
// longer the first scan, or decoding missed the useful part of that scan.
const START_DELAY = 160;
const FRAME_DEADLINE = 650;
const EXIT = 140;

export function ColdStartMotion({ cold, visible }: { cold: boolean; visible: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const attempted = useRef(false);
  const firstCold = useRef(cold);

  useEffect(() => {
    if (!firstCold.current || attempted.current || !cold || !visible) return;
    const media = videoRef.current!;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    if (document.hidden || preference.matches || !CSS.supports('mix-blend-mode', 'screen') || !media.requestVideoFrameCallback) {
      attempted.current = true;
      return;
    }

    let stopped = false;
    let painted = false;
    let frame = 0;
    let start = 0;
    let expiry = 0;
    let raf = 0;
    const began = performance.now();
    const discard = () => {
      media.removeAttribute('src');
      media.load();
    };
    const stop = (gentle = false) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(start);
      clearTimeout(expiry);
      cancelAnimationFrame(raf);
      if (frame) media.cancelVideoFrameCallback(frame);
      media.pause();
      media.removeAttribute('data-playing');
      if (painted && gentle) window.setTimeout(discard, EXIT);
      else if (media.hasAttribute('src')) discard();
    };
    const hide = () => { if (document.hidden) { attempted.current = true; stop(); } };
    const reduce = () => { if (preference.matches) { attempted.current = true; stop(); } };
    const fail = () => stop();
    media.addEventListener('error', fail);
    media.addEventListener('ended', fail);
    document.addEventListener('visibilitychange', hide);
    preference.addEventListener('change', reduce);

    // Double rAF makes space for a static paint before any media I/O.
    raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => {
      start = window.setTimeout(() => {
        if (stopped || document.hidden || preference.matches || performance.now() - began >= FRAME_DEADLINE) return;
        attempted.current = true;
        media.src = studioPath('startup-microdust.webm');
        frame = media.requestVideoFrameCallback(() => {
          if (stopped || document.hidden || preference.matches || performance.now() - began >= FRAME_DEADLINE) return stop();
          painted = true;
          clearTimeout(expiry);
          media.dataset.playing = '';
        });
        void media.play().catch(fail);
      }, START_DELAY);
    }); });
    expiry = window.setTimeout(() => { attempted.current = true; stop(); }, FRAME_DEADLINE);

    return () => {
      attempted.current = true;
      stop(true);
      media.removeEventListener('error', fail);
      media.removeEventListener('ended', fail);
      document.removeEventListener('visibilitychange', hide);
      preference.removeEventListener('change', reduce);
    };
  }, [cold, visible]);

  return <video ref={videoRef} className={style.motion} aria-hidden="true" muted playsInline preload="none"
    data-cold-motion="" tabIndex={-1} />;
}
