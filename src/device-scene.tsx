import type { CSSProperties } from 'react';
import { Art, BatteryTrack, studioPath, tone } from './ui';
import { isLiveDualSenseFull, type Device, type Snapshot } from './model';
import view from './scene.module.css';

type Phase = 'initial' | 'refreshing' | 'ready';

// Intrinsic aspect and lowest visible row of each studio hero.
const reflectionGeometry = {
  mouse: [1008 / 611, '95.5%'],
  keyboard: [1008 / 491, '94.4%'],
  dualsense: [1008 / 753, '96.3%'],
  xbox: [1008 / 796, '96.5%'],
  controller: [686 / 483, '94.9%'],
  headset: [423 / 493, '96.2%'],
  earbuds: [421 / 426, '96.1%'],
  stylus: [796 / 265, '89.6%'],
} satisfies Record<Exclude<Device['art'], 'unknown'>, [number, string]>;

export function SceneStage({ device, loading = false, detail = false, reflect = false, revealPhoto = false, onArtReady }: {
  device?: Device; loading?: boolean; detail?: boolean; reflect?: boolean; revealPhoto?: boolean; onArtReady?: () => void;
}) {
  const reflected = reflect && device && device.art !== 'unknown' && !loading ? device.art : undefined;
  const geometry = reflected && reflectionGeometry[reflected];
  return <div className={view.visual} data-art={device?.art} data-detail={detail} data-loading={loading}>
    {reflected && geometry && <i className={view.reflection} aria-hidden="true" data-device-reflection="" style={{
      '--reflection-image': `url("${studioPath(reflected + '-hero.webp')}")`,
      '--reflection-aspect': geometry[0], '--reflection-contact': geometry[1],
    } as CSSProperties} />}
    {device ? <Art device={device} variant={detail ? 'detail' : 'stage'} loading={loading} revealPhoto={revealPhoto} onReady={onArtReady} /> :
      <i className={view.emptyStage} aria-hidden="true" />}
  </div>;
}

export function SceneBattery({ device, state, phase }: { device?: Device; state: Snapshot; phase: Phase }) {
  const reading = device?.reading;
  const color = device ? tone(device, state) : 'normal';
  const initial = phase === 'initial';
  const full = isLiveDualSenseFull(device);
  const hasRange = !!reading && reading.low !== reading.high;
  return <div className={view.meter} data-phase={phase} data-tone={color} data-charge-complete={full || undefined}>
    {!initial && <strong>{full ? '已充满' : reading ? <>{reading.source === 'hid_voltage' && !hasRange && <small className={view.rangeDash}>约 </small>}{reading.low}{hasRange && <><span className={view.rangeDash}>–</span>{reading.high}</>}
      <small className={view.percentUnit}>%</small></> : '—'}</strong>}
    {initial ? <div role="progressbar" className={view.progress} aria-label="正在读取电量"><i aria-hidden="true" /></div> :
      !full && <BatteryTrack className={view.track} reading={reading} label="电量" />}
  </div>;
}
