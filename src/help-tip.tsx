import { useEffect, useId, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import style from './help-tip.module.css';

export function HelpTip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const leave = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const show = () => { window.clearTimeout(leave.current); setOpen(true); };
  const hide = () => { window.clearTimeout(leave.current); setOpen(false); };
  const delayHide = () => {
    window.clearTimeout(leave.current);
    leave.current = window.setTimeout(() => {
      if (document.activeElement !== anchor.current) setOpen(false);
    }, 115);
  };

  useEffect(() => {
    if (!open) return;
    const node = tip.current;
    const button = anchor.current;
    if (!node || !button) return;
    try { node.showPopover?.(); } catch { /* The visible fallback uses fixed positioning. */ }
    const position = () => {
      const frame = button.getBoundingClientRect();
      if (frame.bottom <= 0 || frame.top >= window.innerHeight) return hide();
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      const left = Math.min(window.innerWidth - width - 8, Math.max(8, frame.left + frame.width / 2 - width / 2));
      const below = frame.bottom + 7;
      node.style.left = Math.max(8, left) + 'px';
      node.style.top = (below + height <= window.innerHeight - 8 ? below : Math.max(8, frame.top - 7 - height)) + 'px';
    };
    const outside = (event: PointerEvent) => {
      if (!event.composedPath().includes(button) && !event.composedPath().includes(node)) hide();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      hide();
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    // Capture before the enclosing Radix dialog's Escape handler.
    window.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      if (node.hidePopover && node.matches(':popover-open')) node.hidePopover();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(leave.current), []);

  return <span className={style.wrap}>
    <button ref={anchor} type="button" className={style.button} data-copy-tip=""
      aria-label={label + '说明'} aria-describedby={id} onFocus={show} onBlur={hide}
      onPointerEnter={show} onPointerLeave={delayHide} onClick={show}>
      <CircleAlert size={14} aria-hidden="true" />
    </button>
    <span className={style.sr} id={id}>{text}</span>
    {open && <span ref={tip} className={style.tip} popover={typeof HTMLElement.prototype.showPopover === 'function' ? 'manual' : undefined}
      role="tooltip" onPointerEnter={show} onPointerLeave={delayHide}>{text}</span>}
  </span>;
}
