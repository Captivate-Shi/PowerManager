import type { CSSProperties } from 'react';
import { Art, readingLabel, studioPath, tone } from './ui';
import { midpoint, type Device, type Snapshot } from './model';
import view from './scene.module.css';

type Phase = 'initial' | 'refreshing' | 'ready';

export function SceneStage({ device, loading = false, shared = false, detail = false }: {
  device?: Device; loading?: boolean; shared?: boolean; detail?: boolean;
}) {
  const reflected = device && device.art !== 'unknown' && !loading ? `url("${studioPath(device.art + '-hero.webp')}")` : undefined;
  return <div className={view.visual} data-art={device?.art} data-detail={detail} data-loading={loading}
    style={reflected ? { '--reflection': reflected } as CSSProperties : undefined}>
    {device ? <Art device={device} variant={detail ? 'detail' : 'stage'} shared={shared} loading={loading} /> :
      <i className={view.emptyStage} aria-hidden="true" />}
  </div>;
}

export function SceneBattery({ device, state, phase }: { device?: Device; state: Snapshot; phase: Phase }) {
  const reading = device?.reading;
  const color = device ? tone(device, state) : 'normal';
  const initial = phase === 'initial';
  const hasRange = !!reading && reading.low !== reading.high;
  return <div className={view.meter} data-phase={phase} data-tone={color}>
    {initial ? <i className={view.numberGhost} aria-hidden="true">—</i> : <strong>{readingLabel(reading ?? null)}</strong>}
    {initial ? <div role="progressbar" className={view.progress} aria-label="正在读取电量"><i aria-hidden="true" /></div> :
      <div role={reading ? "meter" : undefined} className={view.track} aria-hidden={!reading || undefined} aria-label={reading ? "电量" : undefined}
        aria-valuemin={reading ? 0 : undefined} aria-valuemax={reading ? 100 : undefined}
        aria-valuenow={reading ? midpoint(reading) : undefined} aria-valuetext={reading ? readingLabel(reading) : undefined}>
        {reading && (hasRange ? <>
          <i className={view.interval} style={{ left: reading.low + '%', width: (reading.high - reading.low) + '%' }} />
          <i className={view.bound} style={{ left: reading.low + '%' }} />
          <i className={view.bound} style={{ left: reading.high + '%' }} />
        </> : <i className={view.exact} style={{ width: reading.low + '%' }} />)}
      </div>}
  </div>;
}
