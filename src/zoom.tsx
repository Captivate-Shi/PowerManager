import { useEffect, useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CommandResult } from './model';
import s from './panel.module.css';
import { DetentSlider } from './detent-slider';

const zoomDetents = [{ value: 75 }, { value: 100, major: true }, { value: 125 }, { value: 150 }];

export function ZoomControl({ name, value, apply }: {
  name: string; value: number; apply: (value: number) => Promise<CommandResult>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(String(value)); }, [value]);
  const number = Number(draft);
  const valid = Number.isInteger(number) && number >= 75 && number <= 150;
  const sliderValue = valid ? number : value;

  async function save(next: number) {
    setApplying(true);
    setError('');
    const result = await apply(next);
    if (!result.ok) setError(result.error);
    else setDraft(String(next));
    setApplying(false);
  }

  return <form className={s.zoomForm} onSubmit={event => {
    event.preventDefault();
    if (valid) void save(number);
    else setError('请输入 75 到 150 之间的整数。');
  }}>
    <label htmlFor={id}>{name}</label><small>75%–150%</small>
    <div className={s.zoomControls}>
      <DetentSlider inline name="zoom-slider" aria-label={name + '缩放滑块'} min={75} max={150} value={sliderValue}
        detents={zoomDetents} detentLabel={name + '快捷缩放'} selectedDetent={sliderValue}
        onValue={value => { setError(''); setDraft(String(value)); }}
        onDetent={value => { setError(''); setDraft(String(value)); }} />
      <div className={s.zoomNumber} data-zoom-number>
        <input id={id} name="zoom-percent" type="number" autoComplete="off" min={75} max={150}
          value={draft} aria-label={name + '缩放百分比'} aria-invalid={!!error} aria-describedby={error ? id + '-error' : undefined}
          onChange={event => { setError(''); setDraft(event.target.value); }} required /><span aria-hidden="true">%</span>
      </div>
      <button className={s.button} type="submit" disabled={applying || number === value}>{applying ? '应用中…' : '应用'}</button>
      <button className={s.iconButton} type="button" title="恢复 100%" aria-label={name + '恢复 100%'} disabled={applying || (value === 100 && number === 100)}
        onClick={() => { if (value === 100) { setDraft('100'); setError(''); } else void save(100); }}><RefreshCw size={15} aria-hidden="true" /></button>
    </div>
    {error && <p id={id + '-error'} className={s.formError} role="alert">{error}</p>}
  </form>;
}
