import { Bell, ChevronDown, ChevronRight, ExternalLink, Grip, Pin, PinOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { inventoryState, isConnected, muteDurationLabel, severity, type Snapshot, type Toast } from './model';
import { api, Art, BatteryMeter, Brand, Connection, dateLabel, readingLabel, SelectControl, StatusTag } from './ui';
import s from './panel.module.css';
import preferences from './preferences.module.css';

export function QuickPanel({ state }: { state: Snapshot }) {
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [sort, setSort] = useState('online');
  const inventory = inventoryState(state);
  const waiting = state.devices.filter(device => device.status === 'stale');
  const showDevices = inventory === 'cached' || inventory === 'ready';
  const online = state.devices.filter(isConnected);
  const offline = state.devices.filter(device => device.status !== 'stale' && !isConnected(device));
  const low = online.filter(device => severity(device, state.settings, state.deviceSettings[device.id]));
  const ordered = sort === 'low' ? [...online].sort((a, b) => (a.reading?.high ?? 101) - (b.reading?.high ?? 101)) : online;
  const close = () => { void api.command({ type: 'closeSurface' }); };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  return <main className={s.quick} data-pinned={pinned} aria-label="托盘面板">
    <header className={s.quickHeader}><Brand />{pinned && <Grip size={16} className={s.grip} aria-hidden="true" />}<div>
      <button className={s.iconButton} aria-label={pinned ? '取消置顶' : '置顶面板'} aria-pressed={pinned} onClick={() => {
        void api.command({ type: 'pin' }).then(reply => { if (reply.ok) setPinned(!!reply.pinned); });
      }}>{pinned ? <PinOff size={20} /> : <Pin size={20} />}</button>
      <button className={s.iconButton} aria-label="关闭托盘面板" onClick={close}><X size={21} /></button>
    </div></header>
    {inventory !== 'ready' ? <section className={s.quickSummary} role="status"><div>
      <h1>{inventory === 'cold' ? '正在读取设备和电量…' : inventory === 'cached' ? '显示上次记录' : '设备状态暂不可用'}</h1>
      {inventory !== 'cold' && <p>{state.collector === 'occupied' ? '等待旧版退出后接管采集' : state.collector === 'retrying' ? '正在重新连接采集程序' : '正在确认连接状态'}</p>}
    </div></section> :
    <section className={s.quickSummary}><div><h1>{online.length} 个设备在线 <span>· {low.length} 个低电量</span></h1>
      <p>{state.demo ? '示例模式' : state.collector === 'ready' ? '正在监测外设电量' : state.collector === 'occupied' ? '等待旧版退出后接管采集' : '等待电量采集'}</p></div></section>}
    <div className={s.quickScroll} hidden={!showDevices}>
      {waiting.length > 0 && <><div className={s.quickSection}><h2>等待新读数（{waiting.length}）</h2></div>
        {waiting.map(device => <button className={s.quickRow} key={device.id} onClick={() => { void api.command({ type: 'open', id: device.id }); }}>
          <Art device={device} /><div><b title={device.name}>{device.name}</b><StatusTag device={device} state={state} /></div>
          {device.reading && <div className={s.quickOffline}>上次电量 <strong>{readingLabel(device.reading)}</strong><br />{dateLabel(device.lastRead)}</div>}
        </button>)}</>}
      {inventory === 'ready' && <>
      <div className={s.quickSection}><h2>已连接设备（{online.length}）</h2><SelectControl label="托盘设备排序" value={sort} onChange={setSort}
        choices={[{ value: 'online', label: '按连接顺序' }, { value: 'low', label: '低电量优先' }]} /></div>
      {ordered.map(device => <button className={s.quickRow} key={device.id} onClick={() => { void api.command({ type: 'open', id: device.id }); }}>
        <Art device={device} /><div><b title={device.name}>{device.name}</b><div><Connection device={device} /><StatusTag device={device} state={state} /></div></div><BatteryMeter device={device} state={state} />
      </button>)}
      {!ordered.length && <p className={s.smallEmpty}>暂无已连接设备</p>}
      <button className={s.quickSection + ' ' + s.disclosure} type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <h2>未连接设备（{offline.length}）</h2><ChevronDown size={19} /></button>
      {expanded && offline.map(device => <button className={s.quickRow} key={device.id} onClick={() => { void api.command({ type: 'open', id: device.id }); }}>
        <Art device={device} /><div><b title={device.name}>{device.name}</b><StatusTag device={device} state={state} /></div><div className={s.quickOffline}>上次电量 <strong>{readingLabel(device.reading)}</strong><br />{dateLabel(device.lastRead)}</div>
      </button>)}
      </>}
    </div>
    <footer className={s.quickFooter}>
      <button className={s.button} disabled={inventory !== 'ready' || !offline.length} onClick={() => setExpanded(value => !value)}><ChevronDown size={17} />{expanded ? '折叠离线' : '展开全部'}</button>
      <button className={s.button} onClick={() => { void api.command({ type: 'mute' }); }}><Bell size={17} />{state.mutedUntil > Date.now() ? '恢复提醒' : '静音 ' + muteDurationLabel(state.settings.muteMinutes)}</button>
      <button className={s.primary} onClick={() => { void api.command({ type: 'open' }); }}><ExternalLink size={17} />打开余电</button>
    </footer>
  </main>;
}

export function ToastPanel({ toast }: { toast: Toast }) {
  const { device, severity, preview, detailId } = toast;
  const [showName, setShowName] = useState(false);
  const name = useRef<HTMLElement>(null);
  const revealName = () => {
    const element = name.current;
    setShowName(!!element && element.scrollWidth > element.clientWidth);
  };
  const dismiss = () => { void api.command({ type: 'closeSurface' }); };
  return <main className={s.toast + ' ' + preferences.toastSurface} aria-live="polite" data-critical={severity === 'critical'} data-has-detail={!!detailId} aria-label="桌面电量提醒">
    <button className={s.toastBody} onClick={dismiss}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) revealName(); }}
      onBlur={() => setShowName(false)} onKeyDown={event => { if (event.key === 'Escape') setShowName(false); }}>
      <span className={preferences.toastArt} aria-hidden="true"><Art device={device} /></span>
      <span className={s.toastCopy}>
        <strong className={s.toastName} ref={name} onPointerEnter={revealName} onPointerLeave={() => setShowName(false)}>{device.name}</strong>
        <span className={preferences.toastReading}>{readingLabel(device.reading)}</span>
        <small className={s.toastHint}>{severity === 'critical' ? '电量告急' : '低电量'} · 请及时充电{preview && ' · 测试提醒'}</small>
      </span>
    </button>
    {detailId && <button className={s.toastDetail} onClick={() => { void api.command({ type: 'open', id: detailId }); }}>
      查看详情 <ChevronRight size={15} aria-hidden="true" />
    </button>}
    <button className={s.toastClose} aria-label="关闭通知" onClick={dismiss}><X size={19} aria-hidden="true" /></button>
    {showName && <span className={s.toastFullName} aria-hidden="true">{device.name}</span>}
  </main>;
}
