import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { CommandResult } from './model';
import styles from './device-threshold.module.css';

const presets = Array.from({ length: 10 }, (_, index) => (index + 1) * 5);
const inRange = (value: number) => Math.min(50, Math.max(1, value));
type Threshold = number | undefined;
type Save = (value: Threshold) => Promise<CommandResult>;
const writes = new Map<string, Promise<unknown>>();

function enqueue(id: string, value: Threshold, save: Save) {
  const send = () => save(value);
  const request = (writes.get(id) ?? Promise.resolve()).then(send, send);
  writes.set(id, request);
  void request.finally(() => { if (writes.get(id) === request) writes.delete(id); }).catch(() => {});
  return request;
}

export function DeviceThreshold({ deviceId, saved, global, critical, save }: {
  deviceId: string; saved: Threshold; global: number; critical: number; save: Save;
}) {
  const id = useId();
  const [dragValue, setDragValue] = useState<number>();
  const dragPending = useRef<number | undefined>(undefined);
  const [draft, setDraft] = useState<{ value: Threshold }>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [confirmed, confirm] = useState<{ value: Threshold }>();
  const mounted = useRef(true);
  const revision = useRef(0);
  const pointer = useRef<number | null>(null);
  const pending = useRef<{ value: Threshold; revision: number } | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;
  const actual = dragValue ?? (draft ? draft.value : saved) ?? global;
  const sliderValue = inRange(actual);
  const isCustom = dragValue !== undefined || (draft ? draft.value : saved) !== undefined;

  function flush() {
    window.clearTimeout(timer.current);
    const change = pending.current;
    if (!change) return;
    pending.current = undefined;
    const settle = (message?: string) => {
      if (!mounted.current || change.revision !== revision.current) return;
      if (message) {
        setError(true); setStatus(message);
      } else {
        confirm({ value: change.value });
        setStatus('已保存 · 下次巡检生效');
      }
    };
    void enqueue(deviceId, change.value, saveRef.current).then(
      result => settle(result.ok ? undefined : result.error),
      () => settle('无法保存阈值，请重试'),
    );
  }

  function update(value: Threshold, immediate: boolean) {
    const next = { value, revision: ++revision.current };
    pending.current = next;
    setDraft(next);
    confirm(undefined);
    setError(false);
    setStatus('正在保存…');
    window.clearTimeout(timer.current);
    if (immediate) flush();
    else if (pointer.current === null) timer.current = window.setTimeout(flush, 230);
  }

  useEffect(() => {
    if (confirmed && confirmed.value === saved) {
      setDraft(undefined); confirm(undefined);
    }
  }, [confirmed, saved]);

  useEffect(() => {
    mounted.current = true;
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointer.current) return;
      const value = dragPending.current;
      pointer.current = null;
      dragPending.current = undefined;
      setDragValue(undefined);
      if (event.type === 'pointerup' && value !== undefined) update(value, true);
      else if (pending.current) timer.current = window.setTimeout(flush, 230);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      mounted.current = false;
      // Preserve the last keyboard edit on navigation; never write an unfinished drag.
      if (pointer.current === null) flush();
      else { window.clearTimeout(timer.current); pending.current = undefined; pointer.current = null; }
    };
  }, [deviceId]);

  return <section className={styles.editor} aria-labelledby={id} data-device-threshold>
    <header><h4 id={id}>设备低电量阈值</h4><output>{actual}%</output></header>
    <p id={id + '-hint'}>{isCustom ? '设备自定义' : '跟随全局'} · 紧急线 {critical}% 优先
      {actual > 50 && ' · 旧值或全局值超出滑块范围，调整后使用 1%–50%'}</p>
    <input type="range" min={1} max={50} step={1} value={sliderValue}
      name="device-threshold" aria-label="设备低电量阈值" aria-valuetext={sliderValue + '%'}
      aria-describedby={id + '-hint'}
      style={{ '--threshold-fill': (sliderValue - 1) / 49 * 100 + '%' } as CSSProperties}
      onPointerDown={event => { if (event.button === 0) { pointer.current = event.pointerId; window.clearTimeout(timer.current); } }}
      onChange={event => {
        const value = Number(event.currentTarget.value);
        if (pointer.current === null) update(value, false);
        else { dragPending.current = value; setDragValue(value); }
      }}
      onBlur={() => { if (pointer.current === null) flush(); }} />
    <div className={styles.presets} role="group" aria-label="快速选择低电量阈值">
      {presets.map(value => <button key={value} type="button" aria-pressed={actual === value && isCustom}
        onClick={() => update(value, true)}>{value}%</button>)}
    </div>
    <footer><span role={error ? 'alert' : 'status'}>{dragValue !== undefined ? '松开后保存' : status || '调整后自动保存，不立即发送提醒'}</span>
      {error && draft && <button type="button" onClick={() => update(draft.value, true)}>重试</button>}
      {(isCustom || saved !== undefined) && <button type="button" onClick={() => update(undefined, true)}>恢复全局阈值</button>}
    </footer>
  </section>;
}
