import { Bell, BellOff, ChevronDown, ChevronRight, ExternalLink, Grip, Pin, PinOff, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { inventoryState, isConnected, muteDurationLabel, severity, type Device, type Snapshot, type Toast } from './model';
import { api, Art, Brand, dateLabel, readingLabel } from './ui';
import s from './panel.module.css';
import preferences from './preferences.module.css';
import tray from './tray.module.css';

function TrayDevice({ device, state, kind }: { device: Device; state: Snapshot; kind: 'live' | 'cached' | 'offline' }) {
  const { reading } = device;
  const alert = kind === 'live' ? severity(device, state.settings, state.deviceSettings[device.id]) : undefined;
  const connection = device.connection.replace(' 共享接收器', ' · 共享');
  const status = alert === 'critical' ? '电量告急' : alert === 'low' ? '低电量' : device.status !== 'current'
    ? device.reason || '读数待确认' : reading?.power === 'charging' ? '充电中' : reading?.power === 'full' ? '已充满' : reading ? '已连接' : '电量未知';
  const description = kind === 'cached' ? '上次记录' + (device.lastRead ? ' · ' + dateLabel(device.lastRead) : '')
    : [connection, kind === 'offline' ? '未连接' : status].filter(Boolean).join(' · ');
  const display = reading ? readingLabel(reading) : '未知';
  return <button type="button" className={tray.row} data-kind={kind} data-alert={alert}
    data-tray-device={device.id} title={device.name}
    aria-label={device.name + '，' + description + '，' + (kind === 'live' ? '电量' : '上次电量') + display}
    onClick={() => { void api.command({ type: 'open', id: device.id }); }}>
    <div className={tray.art}><Art device={device} /></div>
    <span className={tray.copy}><b>{device.name}</b><small>{description}</small></span>
    <span className={tray.reading}><strong>{display}</strong>
      {reading && <span className={tray.track} aria-hidden="true"><i style={{ width: reading.low + '%' }} />
        {reading.high !== reading.low && <i className={tray.band} style={{ left: reading.low + '%', width: reading.high - reading.low + '%' }} />}</span>}
    </span>
    <ChevronRight size={13} aria-hidden="true" className={tray.chevron} />
  </button>;
}

export function QuickPanel({ state }: { state: Snapshot }) {
  const [pinned, setPinned] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const request = useRef(false);
  const mute = state.mutedUntil > Date.now();
  const muteLabel = mute ? '恢复提醒' : '静音 ' + muteDurationLabel(state.settings.muteMinutes);
  const inventory = inventoryState(state);
  const online = state.devices.filter(isConnected);
  const waiting = state.devices.filter(device => device.status === 'stale');
  const offline = state.devices.filter(device => device.status !== 'stale' && !isConnected(device));
  const alert = (device: Device) => severity(device, state.settings, state.deviceSettings[device.id]);
  const priority = (device: Device) => alert(device) === 'critical' ? 0 : alert(device) === 'low' ? 1 : 2;
  const ordered = [...online].sort((a, b) => priority(a) - priority(b));
  const critical = online.filter(device => alert(device) === 'critical').length;
  const low = online.filter(device => alert(device) === 'low').length;
  const updating = state.refreshing || refreshing;
  const waitingFor = state.collector === 'occupied' ? '等待旧版退出后接管采集'
    : state.collector === 'retrying' ? '正在重新连接采集程序' : '正在确认连接';
  const close = () => { void api.command({ type: 'closeSurface' }); };
  async function refresh() {
    if (request.current || state.refreshing || inventory !== 'ready') return;
    request.current = true;
    setRefreshing(true);
    setRefreshError('');
    try {
      const result = await api.command({ type: 'refresh' });
      if (!result.ok) setRefreshError(result.error || '刷新未完成，请重试');
    } catch {
      setRefreshError('刷新未完成，请重试');
    } finally {
      request.current = false;
      setRefreshing(false);
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) close(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  return <main className={tray.panel} data-pinned={pinned} data-inventory={inventory} aria-label="托盘面板">
    <header className={tray.header}><Brand />{pinned && <Grip size={14} className={tray.grip} aria-hidden="true" />}
      <div className={tray.tools}>
        <button type="button" className={tray.icon} aria-label={muteLabel} title={muteLabel} aria-pressed={mute}
          onClick={() => { void api.command({ type: 'mute' }); }}>{mute ? <BellOff size={16} /> : <Bell size={16} />}</button>
        <button type="button" className={tray.icon} aria-label={pinned ? '取消置顶' : '置顶面板'} title={pinned ? '取消置顶' : '置顶面板'}
          aria-pressed={pinned} onClick={() => { void api.command({ type: 'pin' }).then(reply => { if (reply.ok) setPinned(!!reply.pinned); }); }}>
          {pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
        <button type="button" className={tray.icon} aria-label="关闭托盘面板" title="关闭托盘面板" onClick={close}><X size={16} /></button>
      </div>
    </header>
    <div className={tray.intro}><div><h1>设备电量</h1>
      <div className={tray.status} role="status">
        {updating ? <><i aria-hidden="true" />正在刷新 · 保留上次电量</>
          : inventory === 'ready' ? <><span>{online.length} 台在线</span>{critical > 0 && <span data-alert="critical">· {critical} 台电量告急</span>}{low > 0 && <span data-alert="low">· {low} 台低电量</span>}</>
          : inventory === 'cached' ? <><i aria-hidden="true" />显示上次记录 · {waitingFor}</>
          : inventory === 'cold' ? <><i aria-hidden="true" />正在读取设备和电量…</>
          : <><i aria-hidden="true" />设备状态暂不可用 · {waitingFor}</>}
      </div></div>
      <button type="button" className={tray.icon} aria-label="立即刷新" title="立即刷新" disabled={inventory !== 'ready' || updating}
        onClick={() => { void refresh(); }}><RefreshCw size={15} /></button>
    </div>
    <div className={tray.content}>
      {(refreshError || state.error) && <p className={tray.message} role="alert">{refreshError || state.error}</p>}
      {inventory === 'cached' && <div className={tray.list} aria-label="上次记录">
        {state.devices.map(device => <TrayDevice key={device.id} device={device} state={state} kind="cached" />)}
      </div>}
      {inventory === 'ready' && <>
        {ordered.length > 0 ? <div className={tray.list} aria-label="在线设备">
          {ordered.map(device => <TrayDevice key={device.id} device={device} state={state} kind="live" />)}
        </div> : <p className={tray.message}>暂无已连接设备</p>}
        {waiting.length > 0 && <><p className={tray.group}>等待新读数（{waiting.length}）</p><div className={tray.list}>
          {waiting.map(device => <TrayDevice key={device.id} device={device} state={state} kind="cached" />)}
        </div></>}
        {offline.length > 0 && <>
          <button type="button" className={tray.offline} aria-expanded={expanded} aria-controls="tray-offline-devices"
            onClick={() => setExpanded(value => !value)}>
            未连接设备（{offline.length}）<ChevronDown size={14} aria-hidden="true" />
          </button>
          <div className={tray.list} id="tray-offline-devices" hidden={!expanded}>
            {expanded && offline.map(device => <TrayDevice key={device.id} device={device} state={state} kind="offline" />)}
          </div>
        </>}
      </>}
    </div>
    <footer className={tray.footer}>
      <span><i aria-hidden="true" />{inventory === 'ready' ? (state.demo ? '示例数据' : '后台监测中') : '等待新读数'}</span>
      <button type="button" className={tray.primary} onClick={() => { void api.command({ type: 'open' }); }}>
        打开余电 <ExternalLink size={14} aria-hidden="true" />
      </button>
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
