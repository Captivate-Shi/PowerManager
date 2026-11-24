import * as Collapsible from '@radix-ui/react-collapsible';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Activity, ArrowLeft, Bell, BellOff, Bluetooth, Cable, ChevronDown, ChevronRight, CircleAlert, Clock, Ellipsis, LayoutGrid, List, MonitorSmartphone, Pencil, Plus, RefreshCw, Search, ShieldCheck, TriangleAlert, Unplug, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ColdStartMotion } from './cold-start-motion';
import { flushSync } from 'react-dom';
import { canProbeBluetooth, inventoryState, isConnected, isMuteDuration, muteDurationLabel, muteDurations, severity, type Command, type CommandResult, type Device, type Found, type Snapshot } from './model';
import { api, Art, BatteryMeter, Brand, Chart, CompareChart, Connection, dateLabel, Modal, prepareHero, readingLabel, SectionTitle, SelectControl, SettingRow, StatusTag, studioPath, SwitchControl, tone } from './ui';
import s from './panel.module.css';
import look from './scene.module.css';
import listLook from './overview-list.module.css';
import { allowOverviewMotion, OverviewModeMotion } from './overview-mode-motion';
import { JellyNav } from './jelly-nav';
import { SceneBattery, SceneStage } from './device-scene';
import { DeviceThreshold } from './device-threshold';
import { ZoomControl } from './zoom';
import preferences from './preferences.module.css';
import { previewDevice as makePreviewDevice } from './demo';
import { compareLimit, toggleHistorySelection } from './history-plot';

const pages = [
  ['overview', '总览'], ['devices', '设备'], ['alerts', '提醒'], ['history', '记录'], ['settings', '设置'],
] as const;
type Page = typeof pages[number][0];
type Filter = 'all' | 'online' | 'low' | 'offline' | 'recent';
type Run = (command: Command) => Promise<CommandResult>;
const palettes = [['graphite', '石墨白'], ['ice', '冰蓝灰'], ['warm', '暖钛灰']] as const;
type Palette = typeof palettes[number][0];
const paletteKey = 'yudian.appearance.palette';
function readPalette(): Palette {
  try {
    const value = localStorage.getItem(paletteKey);
    return palettes.find(([id]) => id === value)?.[0] ?? 'graphite';
  } catch { return 'graphite'; }
}


const level = (device: Device, state: Snapshot) => severity(device, state.settings, state.deviceSettings[device.id]);
const needCharge = (state: Snapshot) => state.devices.filter(device => level(device, state));
const minutes = (values: number[]) => values.map(value => ({ value: String(value), label: value ? value + ' 分钟' : '关闭' }));
const powerLabels = { charging: '充电中', full: '已充满', discharging: '电池供电', unknown: '设备未上报' };

export function Dashboard({ state }: { state: Snapshot }) {
  const [page, setPage] = useState<Page>('overview');
  const [palette, setPalette] = useState(readPalette);
  const choosePalette = (value: Palette) => {
    setPalette(value);
    try { localStorage.setItem(paletteKey, value); } catch { /* Keep the selection for this window. */ }
  };
  const [selected, select] = useState<string>();
  const [detailId, setDetailId] = useState<string>();
  const main = useRef<HTMLElement>(null);
  const detailBack = useRef<HTMLButtonElement>(null);
  const returnScroll = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sourcePhoto = useRef<Element | null>(null);
  const activeTransition = useRef<{ transition: ViewTransition; photo: Element; updating: boolean } | null>(null);
  const detailed = state.devices.find(device => device.id === detailId);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, search] = useState('');
  const [finding, setFinding] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  const starting = state.collector === 'starting';
  const inventory = inventoryState(state);
  const low = needCharge(state);
  useEffect(() => api.onNavigate(id => {
    if (id) {
      cancelTransition();
      returnFocus.current = null;
      sourcePhoto.current = null;
      returnScroll.current = 0;
      setFinding(false);
      setFilter('all');
      search('');
      select(id);
      setPage('devices');
      setDetailId(id);
      window.scrollTo(0, 0);
    }
  }), []);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(undefined), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const run: Run = async command => {
    const result = await api.command(command).catch((): CommandResult => ({ ok: false, error: '与应用主进程的连接已断开' }));
    if (!result.ok) setFeedback({ text: result.error, error: true });
    else setFeedback(result.message ? { text: result.message } : undefined);
    return result;
  };
  useEffect(() => {
    if (!detailed) return;
    detailBack.current?.focus({ preventScroll: true });
    const onBack = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      closeDetail();
    };
    window.addEventListener('keydown', onBack);
    return () => window.removeEventListener('keydown', onBack);
  }, [detailed?.id]);

  function cancelTransition() {
    const active = activeTransition.current;
    if (!active) return;
    activeTransition.current = null;
    active.photo.classList.remove(s.transitionArt);
    delete document.documentElement.dataset.detailDirection;
    active.transition.skipTransition();
  }

  function transitionDetail(update: () => void, photo?: Element, returning = false) {
    cancelTransition();
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches || !photo) {
      update();
      return;
    }
    if (!returning) photo.classList.add(s.transitionArt);
    document.documentElement.dataset.detailDirection = returning ? 'back' : 'forward';
    const transition = document.startViewTransition(() => {
      if (activeTransition.current !== active) return;
      if (returning) photo.classList.add(s.transitionArt);
      try { update(); } finally { active.updating = false; }
    });
    const active = { transition, photo, updating: true };
    activeTransition.current = active;
    void transition.ready.catch(() => {});
    void transition.finished.catch(() => {}).finally(() => {
      if (activeTransition.current !== active) return;
      photo.classList.remove(s.transitionArt);
      delete document.documentElement.dataset.detailDirection;
      activeTransition.current = null;
    });
  }
  function openDetail(id: string, source?: HTMLElement) {
    if (activeTransition.current?.updating) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : source ?? null;
    returnScroll.current = window.scrollY;
    const photo = source?.querySelector('[data-active-stage] [data-device-art], [data-device-art]:not([data-departing] *)') ?? undefined;
    sourcePhoto.current = photo ?? null;
    const device = state.devices.find(item => item.id === id);
    if (device) prepareHero(device);
    transitionDetail(() => {
      flushSync(() => setDetailId(id));
      window.scrollTo(0, 0);
    }, photo);
  }

  function closeDetail() {
    if (activeTransition.current?.updating) return;
    const photo = sourcePhoto.current;
    transitionDetail(() => {
      flushSync(() => setDetailId(undefined));
      window.scrollTo(0, returnScroll.current);
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      if (!main.current?.contains(document.activeElement)) main.current?.focus({ preventScroll: true });
    }, photo?.isConnected ? photo : undefined, true);
  }
  useEffect(() => {
    const skip = () => activeTransition.current?.transition.skipTransition();
    document.addEventListener('visibilitychange', skip);
    window.addEventListener('resize', skip);
    return () => {
      document.removeEventListener('visibilitychange', skip);
      window.removeEventListener('resize', skip);
      cancelTransition();
    };
  }, []);

  function open(id: string) { search(''); setFilter('all'); select(id); setPage('devices'); setDetailId(undefined); }
  function showDevices(next: Filter) { search(''); select(undefined); setFilter(next); setPage('devices'); setDetailId(undefined); }
  const waiting = state.devices.filter(device => device.status === 'stale').length;
  const connected = state.devices.filter(isConnected).length;
  const descriptions: Record<Page, [string, string]> = {
    overview: ['我的桌面', inventory === 'cold' ? '首次扫描，正在识别设备' :
      inventory === 'cached' ? '显示上次设备与读数 · 当前状态待确认' :
      inventory === 'unavailable' ? '暂无法确认设备状态' :
      connected + ' 台在线 · ' + (state.devices.length - connected - waiting) + ' 台未连接' + (waiting ? ' · ' + waiting + ' 台待确认' : '')],
    devices: ['我的设备', '查看设备连接与电量'],
    alerts: ['提醒', '待充电设备和通知偏好'],
    history: ['电量记录', '过去 24 小时的设备读数'],
    settings: ['设置', '显示、监测与诊断'],
  };
  return <div className={s.shell + ' ' + look.shell + ' ' + preferences.mainPalette} data-theme={palette} data-view={detailed ? 'detail' : page}
    style={{ '--studio-stage': `url("${studioPath('stage.webp')}")` } as CSSProperties}>
    <ColdStartMotion cold={inventory === 'cold'} visible={page === 'overview' && !detailed} />
    <a className={s.skipLink} href="#main-content">跳到主要内容</a>
    <header className={s.topbar + ' ' + look.topbar}>
      <Brand />
      <JellyNav current={page}>{pages.map(([id, label]) => <button key={id} className={s.navItem + ' ' + look.navItem}
        aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => { cancelTransition(); setDetailId(undefined); if (page !== id) search(""); setPage(id); window.scrollTo(0, 0); }}><span>{label}</span>
        {id === 'alerts' && low.length > 0 && <i aria-hidden="true" />}</button>)}</JellyNav>
    </header>
    <main className={s.content + ' ' + look.content} id="main-content" tabIndex={-1} ref={main}>
      <div hidden={!!detailed}>
      <header className={s.heading + (page === 'overview' ? ' ' + look.deskToolbar : '')} data-history={page === 'history'} data-page-heading={page}><div><h1>{page === 'history' ? '电量对比' : descriptions[page][0]}</h1><p>{page === 'history' ? '近 24 小时 · 设备记录' : descriptions[page][1]}</p></div>
        {((page === 'overview' && inventory !== 'cold') || page === 'devices') && <div className={s.headingActions}>
          {page === "devices" && !starting && <label className={s.searchBox}><Search size={17} aria-hidden="true" />
            <input type="search" autoComplete="off" name="device-search" aria-label="搜索设备" value={query}
              onChange={event => search(event.target.value)} placeholder="搜索设备" />
          </label>}
          <button className={s.iconButton} title="立即刷新" aria-label="立即刷新" disabled={starting || state.refreshing} onClick={() => { void run({ type: 'refresh' }); }}>
            <RefreshCw size={18} className={state.refreshing ? s.spin : ''} /></button>
          <button className={page === "devices" ? s.primary : s.button} onClick={() => setFinding(true)}><Plus size={18} />查找设备</button>
        </div>}
      </header>
      {(state.collector !== 'ready' && !(page === 'overview' && starting)) && <div className={s.notice} role="status"><Activity size={19} /><span>{
        { starting: inventory === 'cached' ? '显示上次记录，正在确认连接和电量。' : '正在读取设备和电量…', occupied: '旧版 PowerManager 正在监测。请从旧版托盘退出，新版会自动接管。',
          retrying: '采集暂时中断，正在尝试重新连接。' }[state.collector]}</span></div>}
      {state.error && <div className={s.notice} role="alert"><TriangleAlert size={19} />{state.error}</div>}
      {page === 'overview' && <Overview state={state} openDetail={openDetail} showDevices={showDevices} find={() => setFinding(true)} />}
      {page === 'devices' && (inventory === 'cold' ? <DeviceSkeleton /> :
        inventory === 'unavailable' ? <Empty>暂无法读取设备，等待采集恢复</Empty> :
        <Devices state={state} selected={selected} pick={select} filter={filter} setFilter={setFilter} query={query} openDetail={openDetail} run={run} find={() => setFinding(true)} />)}
      {page === 'alerts' && <Alerts state={state} run={run} open={open} />}
      {page === 'history' && <History state={state} starting={inventory === 'cold'} />}
      {page === 'settings' && <Settings state={state} run={run} palette={palette} choosePalette={choosePalette} />}
      </div>
      {detailed && <div>
        <header className={s.fullHeader + ' ' + look.detailBack}>
          <button className={look.ghost} ref={detailBack} onClick={closeDetail}><ArrowLeft size={16} aria-hidden="true" />返回{page === 'overview' ? '总览' : '设备'}</button>
        </header>
        <Details key={detailed.id} device={detailed} state={state} run={run} full />
      </div>}
      <footer className={s.appFooter + ' ' + look.footer} data-cold={page === 'overview' && !detailed && inventory === 'cold'}>
        {page === "overview" && !detailed && <span><Bell size={16} />{state.settings.fullscreenSound ? "全屏时使用提示音" : "全屏提示音已关闭"}</span>}
        <span className={s.monitorState}><i data-state={state.collector} />{state.collector === "ready" ? "后台监测中" : "等待采集"}</span>
        {page === "overview" && !detailed && <button className={s.textButton} onClick={() => { setPage("alerts"); window.scrollTo(0, 0); }}>管理提醒 <ChevronRight size={16} /></button>}
        {state.demo && <small>示例数据</small>}
      </footer>
    </main>
    {finding && <FindDevices state={state} run={run} close={() => setFinding(false)} />}
    {feedback && <div className={s.feedback} data-error={!!feedback.error} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
  </div>;
}
function Empty({ children, button }: { children: ReactNode; button?: () => void }) {
  return <div className={s.empty}><MonitorSmartphone size={32} /><p>{children}</p>
    {button && <button className={s.button} onClick={button}><Plus size={17} />查找设备</button>}</div>;
}
function DeviceSkeleton() {
  return <div className={s.deviceSplit} aria-hidden="true">
    <div className={s.skeletonHero} />
    <div>{[0, 1, 2, 3].map(index => <div className={s.skeletonRow} key={index} />)}</div>
  </div>;
}

function batteryState(device: Device, state: Snapshot) {
  if (device.status !== 'current' || !device.reading) return device.reason;
  const alert = level(device, state);
  if (alert) return alert === 'critical' ? '电量告急' : '建议充电';
  if (device.reading.power === 'charging') return '正在充电';
  if (device.reading.power === 'full') return '已充满';
  return '电量正常';
}

function overviewOrder(state: Snapshot) {
  return [...state.devices].sort((a, b) =>
    Number(isConnected(b)) - Number(isConnected(a)) ||
    Number(!!level(b, state)) - Number(!!level(a, state))).map(device => device.id);
}

function deviceLowThreshold(device: Device, state: Snapshot) {
  return state.deviceSettings[device.id]?.low ?? state.settings.low;
}

function overviewListFacts(device: Device, state: Snapshot, live: boolean) {
  const threshold = deviceLowThreshold(device, state);
  const limit = `低电量阈值：${threshold}%（${state.deviceSettings[device.id]?.low === undefined ? '跟随全局' : '设备自定义'}）`;
  const readTime = device.lastRead != null && Number.isFinite(device.lastRead) && device.lastRead > 0 ? dateLabel(device.lastRead) : undefined;
  const time = '上次读数：' + (readTime ?? '暂无记录');
  const power = live && device.status === 'current' ? device.reading?.power : undefined;
  const powerLabel = ({ ...powerLabels, unknown: '未上报', discharging: '供电' })[power ?? 'unknown'];
  const powerDescription = '充电状态：' + (power ? powerLabels[power] : '未确认');
  const hasConnection = !!device.connection && isConnected(device);
  return {
    threshold, limit, readTime, time, power, powerLabel, powerDescription, hasConnection,
    description: [(device.status === 'current' ? '电量：' : '上次电量：') + readingLabel(device.reading),
      limit, time, powerDescription, ...(hasConnection ? ['连接方式：' + device.connection] : [])].join('；'),
  };
}

function Overview({ state, openDetail, showDevices, find }: { state: Snapshot;
  openDetail: (id: string, source?: HTMLElement) => void;
  showDevices: (value: Filter) => void; find: () => void }) {
  const [order, setOrder] = useState(() => overviewOrder(state));
  const [chosen, choose] = useState<string>();
  const [mode, setMode] = useState<'stage' | 'list'>('stage');
  const [stageResumed, setStageResumed] = useState(false);
  const [modeInfo, setModeInfo] = useState<'entry' | 'exit'>();
  const [direction, setDirection] = useState<'next' | 'previous'>('next');
  const [departing, setDeparting] = useState<Device>();
  const [listOutgoing, setListOutgoing] = useState<{ device: Device; opacity: number; y: number }>();
  const listArtwork = useRef<HTMLDivElement>(null);
  const overviewDesk = useRef<HTMLDivElement>(null);
  const overviewPlane = useRef<HTMLDivElement>(null);
  const modeMotion = useRef<OverviewModeMotion | undefined>(undefined);
  const [travel, setTravel] = useState(0);
  const drag = useRef<{ pointer: number; at: number; y: number } | null>(null);
  const hero = useRef<HTMLElement>(null);
  const deviceById = new Map(state.devices.map(device => [device.id, device]));
  const ordered = [...new Set([...order, ...overviewOrder(state)])].flatMap(id => {
    const device = deviceById.get(id);
    return device ? [device] : [];
  });
  const featured = (chosen ? deviceById.get(chosen) : undefined) ?? ordered[0];
  const index = ordered.findIndex(device => device.id === featured?.id);
  const inventory = inventoryState(state);
  const initial = inventory === 'cold';
  const [previousInitial, setPreviousInitial] = useState(initial);
  const [revealId, setRevealId] = useState<string>();
  const [reveal, setReveal] = useState(false);
  if (initial !== previousInitial) {
    setPreviousInitial(initial);
    const revealDevice = !initial && inventory === 'ready' && featured && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    setRevealId(revealDevice ? featured.id : undefined);
    setReveal(!!revealDevice);
  }
  useEffect(() => {
    if (!reveal) return;
    const timer = window.setTimeout(() => setReveal(false), 340);
    return () => clearTimeout(timer);
  }, [reveal]);
  const phase = initial ? 'initial' : inventory === 'ready' && state.refreshing ? 'refreshing' : 'ready';
  useEffect(() => {
    const ranked = overviewOrder(state);
    const available = new Set(ranked);
    setOrder(previous => {
      const retained = previous.filter(id => available.has(id));
      const additions = ranked.filter(id => !retained.includes(id));
      return additions.length || retained.length !== previous.length ? [...retained, ...additions] : previous;
    });
    if (chosen && !available.has(chosen)) choose(undefined);
  }, [state, chosen]);
  useEffect(() => {
    if (initial) return;
    const neighbors = [featured, ordered[index - 1], ordered[index + 1], ordered[0]].filter((item): item is Device => !!item);
    neighbors.forEach(prepareHero);
  }, [initial, featured?.art, index, ordered.length]);
  useEffect(() => {
    if (!departing) return;
    const timer = window.setTimeout(() => setDeparting(undefined), 440);
    return () => clearTimeout(timer);
  }, [departing]);

  useEffect(() => {
    if (!listOutgoing) return;
    const timer = window.setTimeout(() => setListOutgoing(undefined), 250);
    return () => clearTimeout(timer);
  }, [listOutgoing]);

  useEffect(() => {
    const cancel = () => modeMotion.current?.cancel();
    const policy = matchMedia('(min-width: 771px) and (prefers-reduced-motion: no-preference)');
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', cancel);
    policy.addEventListener('change', cancel);
    return () => {
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', cancel);
      policy.removeEventListener('change', cancel);
      cancel();
    };
  }, []);

  useEffect(() => { modeMotion.current?.cancel(); }, [featured?.id]);

  function switchMode(next: 'stage' | 'list') {
    if (next === mode) return;
    const animate = !!featured && allowOverviewMotion() && overviewDesk.current && overviewPlane.current;
    let motion = modeMotion.current;
    if (animate && !motion) motion = modeMotion.current = new OverviewModeMotion(overviewDesk.current!, overviewPlane.current!);
    const before = animate && featured ? motion?.read(mode, featured.id) : undefined;
    motion?.cancel();
    const commit = () => {
      setListOutgoing(undefined);
      setDeparting(undefined);
      setRevealId(undefined);
      setStageResumed(next === 'stage' && !before?.photo);
      setModeInfo(before?.rail ? next === 'list' ? 'entry' : 'exit' : undefined);
      setMode(next);
    };
    if (!before || !motion || !featured) { commit(); return; }
    flushSync(commit);
    motion.play(before, motion.read(next, featured.id, false), next);
  }

  function previewInList(device: Device) {
    modeMotion.current?.cancel();
    if (device.id === featured?.id) return;
    let outgoing: typeof listOutgoing;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && featured && listArtwork.current) {
      // Retarget from the brightest visible layer, not from a mostly transparent new device.
      const live = [...listArtwork.current.querySelectorAll<HTMLElement>('[data-list-art-layer]')].map(node => {
        const style = getComputedStyle(node);
        return { id: node.dataset.deviceId, opacity: Number(style.opacity),
          y: style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m42 };
      }).sort((a, b) => b.opacity - a.opacity)[0];
      const visible = live?.id === featured.id ? featured : listOutgoing?.device.id === live?.id ? listOutgoing?.device : undefined;
      if (visible && visible.id !== device.id && live)
        outgoing = { device: visible, opacity: live.opacity, y: live.y };
    }
    setListOutgoing(outgoing);
    setDeparting(undefined);
    choose(device.id);
  }
  const connectionStatus = !featured || featured.status === 'stale' || inventory !== 'ready'
    ? 'pending' : featured.status === 'offline' ? 'offline' : isConnected(featured) ? 'connected' : 'pending';
  const critical = !!featured && inventory === 'ready' && level(featured, state) === 'critical';

  function activate(device: Device, way?: 'next' | 'previous') {
    modeMotion.current?.cancel();
    if (initial || device.id === featured?.id) return;
    const destination = ordered.findIndex(item => item.id === device.id);
    setDirection(way ?? (destination < index ? 'previous' : 'next'));
    setDeparting(matchMedia('(prefers-reduced-motion: reduce)').matches ? undefined : featured);
    setRevealId(undefined);
    choose(device.id);
  }
  function step(delta: number) {
    if (ordered.length < 2) return;
    activate(ordered[(index + delta + ordered.length) % ordered.length], delta > 0 ? 'next' : 'previous');
  }
  function endDrag(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    if (drag.current?.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.current.at;
    const dy = event.clientY - drag.current.y;
    drag.current = null;
    setTravel(0);
    if (commit && Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.1) step(dx < 0 ? 1 : -1);
  }
  return <div ref={overviewDesk} className={look.desk + ' ' + listLook.modeDesk + (mode === 'list' ? ' ' + listLook.listDesk : '')} data-load-state={inventory === 'cached' || inventory === 'unavailable' ? inventory : phase} data-mode={mode} data-cold-reveal={reveal || undefined} data-mode-featured={!!featured && !initial || undefined}
    data-mode-info-entry={modeInfo === 'entry' || undefined} data-mode-info-exit={modeInfo === 'exit' || undefined}>
    <div className={listLook.modeOverlay} ref={overviewPlane} aria-hidden="true" />
    <div className={listLook.bottomVeil} data-mode-bottom-veil="" aria-hidden="true" />
    {(initial || reveal) && <div className={look.coldCopy} data-cold-copy="" data-exiting={!initial || undefined} aria-hidden={!initial || undefined}>
      <h2>正在识别设备</h2>
      <p role={initial ? 'status' : undefined}>正在读取设备…</p>
    </div>}
    {featured && !initial && mode === 'stage' && <section ref={hero} className={look.hero + (stageResumed ? ' ' + listLook.stageResume : '')} aria-label="主设备">
      <div className={look.heroData + ' ' + listLook.modeStageCopy} aria-live="polite">
        <h2 title={featured?.name}>{featured.name}</h2>
        <SceneBattery device={featured} state={state} phase={phase} />
        <div className={look.heroState} data-tone={featured && !initial ? tone(featured, state) : 'normal'}>
          {phase === 'refreshing' && featured?.status === 'current' ? <span role="status">正在更新 · 保留上次读数</span> : featured && <><i aria-hidden="true" />{batteryState(featured, state)}{featured.status !== 'current' && featured.reading && <small>上次电量 · {dateLabel(featured.lastRead)}</small>}</>}
        </div>
        {featured && <button className={look.ghost} onClick={() => { modeMotion.current?.cancel(); openDetail(featured.id, hero.current ?? undefined); }}>
          查看详情 <ChevronRight size={14} aria-hidden="true" />
        </button>}
      </div>
      <div className={look.carousel} data-direction={direction} data-dragging={travel !== 0}
        role="group" aria-label="主设备视觉展示" tabIndex={initial || ordered.length <= 1 ? -1 : 0}
        style={{ transform: travel ? `translateX(${travel * .14}px)` : undefined }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1);
        }}
        onPointerDown={event => {
          if (initial || ordered.length < 2 || !event.isPrimary || event.button !== 0 || (event.target as Element).closest('button')) return;
          modeMotion.current?.cancel();
          drag.current = { pointer: event.pointerId, at: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current?.pointer === event.pointerId) setTravel(Math.max(-140, Math.min(140, event.clientX - drag.current.at)));
        }}
        onPointerUp={event => endDrag(event, true)}
        onPointerCancel={event => endDrag(event, false)}
        onLostPointerCapture={event => endDrag(event, false)}>
        {departing && !initial && <div className={look.departing} data-departing="" key={'out-' + departing.id} aria-hidden="true"><SceneStage device={departing} /></div>}
        <div className={look.arriving} data-active-stage="" key={featured.id} data-animate={!!departing}><SceneStage device={featured} revealPhoto={revealId === featured.id} /></div>
        {ordered.length > 1 && ordered.length <= 8 && <div className={look.dots} aria-label="主设备切换">{ordered.map(device => <button
          key={device.id} aria-label={'展示 ' + device.name} aria-pressed={device.id === featured?.id} disabled={initial}
          onClick={() => activate(device)} />)}</div>}
      </div>
    </section>}
    {!featured && !initial && mode === 'stage' && (inventory === 'unavailable'
      ? <Empty>暂无法读取设备，等待采集恢复</Empty> : <Empty button={find}>尚未监测到外设</Empty>)}
    {!initial && mode === 'list' && featured && <>
      <div className={listLook.artFrame} ref={listArtwork} data-list-artwork="" aria-hidden="true">
        {listOutgoing && <div className={listLook.artLayer} data-list-art-layer="" data-device-id={listOutgoing.device.id}
          data-exiting="" key={listOutgoing.device.id}
          style={{ '--list-art-opacity': listOutgoing.opacity, '--list-art-y': listOutgoing.y + 'px' } as CSSProperties}><Art device={listOutgoing.device} variant="stage" /></div>}
        <div className={listLook.artLayer} data-list-art-layer="" data-device-id={featured.id}
          data-animated={!!listOutgoing || undefined} key={featured.id}><Art device={featured} variant="stage" /></div>
      </div>
    </>}
    {!initial && featured && (mode === 'list' || modeInfo === 'exit') &&
      <div className={listLook.status} role={mode === 'list' ? 'status' : undefined} aria-hidden={mode !== 'list' || undefined}
        aria-label="所选设备状态" data-connection-state={connectionStatus}>
        <span className={listLook.connection}><i aria-hidden="true" />{{
          pending: '连接待确认', offline: '未连接', connected: '已连接',
        }[connectionStatus]}</span>
        {critical && <span className={listLook.critical} data-list-critical=""><CircleAlert size={15} aria-hidden="true" />电量告急</span>}
      </div>}
    {!initial && <section className={look.rail + ' ' + listLook.modeRail + (mode === 'list' ? ' ' + listLook.rail : '')} data-mode-rail="" aria-label="切换设备">
      <header className={look.railHeader}>
        <div className={look.modeControl} role="group" aria-label="总览显示方式">
          <button disabled={initial} aria-label="展台模式" aria-pressed={mode === 'stage'} onClick={() => switchMode('stage')}><LayoutGrid size={15} /></button>
          <button disabled={initial} aria-label="列表模式" aria-pressed={mode === 'list'} onClick={() => switchMode('list')}><List size={17} /></button>
        </div>
        <button className={look.ghost} onClick={() => showDevices('all')}>全部设备 <ChevronRight size={14} aria-hidden="true" /></button>
      </header>
      <div className={look.railRows + ' ' + listLook.sharedRows} data-mode-rail-scroll="" aria-busy={initial || undefined}>
        {ordered.map(device => {
          const facts = overviewListFacts(device, state, inventory === 'ready');
          return <div key={device.id} className={listLook.entry} data-mode-row=""
          data-list-selected={mode === 'list' && device.id === featured?.id ? '' : undefined}>
          <button className={look.railRow + ' ' + listLook.selectRow} aria-label={device.name}
            aria-description={mode === 'list' ? facts.description : undefined}
            aria-pressed={device.id === featured?.id} disabled={initial}
            title={device.name} onClick={() => mode === 'stage' ? activate(device) : previewInList(device)}
            onDoubleClick={event => { if (mode === 'stage') { modeMotion.current?.cancel(); openDetail(device.id, event.currentTarget); } }}>
            <Art device={device} variant="card" />
            <div className={look.railInfo + ' ' + listLook.sharedInfo}>
              <div className={look.railName}><b>{device.name}</b></div>
              <strong className={look.railValue} data-tone={tone(device, state)}>{device.status !== 'current' && device.reading &&
                <small className={look.lastReading}>上次 </small>}{readingLabel(device.reading)}</strong>
              <span className={listLook.modeExtra} data-mode-extra="" aria-hidden={mode !== 'list' || undefined}>
                <span data-list-field="threshold" title={facts.limit}><Bell aria-hidden="true" /><span>{facts.threshold}%</span></span>
                <span data-list-field="last-read" title={facts.time}><Clock aria-hidden="true" /><span>{facts.readTime ?? '—'}</span></span>
                <span data-list-field="power" data-power={facts.power ?? 'unconfirmed'} title={facts.powerDescription}>
                  <Zap aria-hidden="true" /><span>{facts.power ? facts.powerLabel : '—'}</span>
                </span>
                {facts.hasConnection && <span data-list-field="connection" title={'连接方式：' + device.connection}>
                  <Connection device={device} />
                </span>}
              </span>
            </div>
          </button>
          {mode === 'stage' ? <span className={listLook.stageArrow} aria-hidden="true"><ChevronRight size={15} /></span> :
            <button className={listLook.details} aria-label={'查看详情 · ' + device.name} title="查看详情"
            onClick={event => { previewInList(device); openDetail(device.id, event.currentTarget.parentElement ?? undefined); }}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>}
        </div>})}
        {!ordered.length && !initial && <p className={s.smallEmpty}>{inventory === 'unavailable' ? '设备状态暂不可用' : '暂无受监测设备'}</p>}
      </div>
    </section>}
  </div>;
}

function Devices({ state, selected, pick, filter, setFilter, query, openDetail, run, find }: {
  state: Snapshot; selected?: string; pick: (id?: string) => void; filter: Filter; setFilter: (value: Filter) => void; query: string; openDetail: (id: string, source?: HTMLElement) => void; run: Run; find: () => void;
}) {
  const [sort, setSort] = useState('state');
  const { devices, alerts } = state;
  const online = devices.filter(isConnected);
  const low = needCharge(state);
  const offline = devices.filter(device => device.status !== 'stale' && !isConnected(device));
  const recent = devices.filter(device => (alerts[device.id]?.lastNoticeAt ?? 0) >= Date.now() - 86400000);
  const groups = { all: devices, online, low, offline, recent };
  const menus: [Filter, string][] = [['all', '全部设备'], ['online', '已连接'],
    ['low', '低电量'], ['offline', '未连接'], ['recent', '最近提醒']];
  const needle = query.trim().toLocaleLowerCase();
  const visible = groups[filter].filter(device => [device.name, device.connection, device.art].some(value => value.toLocaleLowerCase().includes(needle)));
  const readingOrder = (device: Device) => device.reading?.low ?? 101;
  visible.sort((a, b) => sort === 'low' ? readingOrder(a) - readingOrder(b) :
    sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : Number(isConnected(b)) - Number(isConnected(a)));
  const detail = visible.find(device => device.id === selected) ?? (state.demo && !selected && filter === 'all' && !needle
    ? visible.find(device => device.art === 'dualsense') : visible[0]);
  return <>
    <div className={s.deviceToolbar}>
      <div className={s.filters} role="group" aria-label="设备筛选">{menus.map(([id, name]) => <button key={id} data-filter={id}
        aria-pressed={filter === id} onClick={() => { setFilter(id); pick(undefined); }}>{name}<b>{groups[id].length}</b></button>)}</div>
      <SelectControl label="设备排序" value={sort} onChange={setSort} choices={[
          { value: 'state', label: '按状态排序' }, { value: 'low', label: '按电量排序' }, { value: 'name', label: '按名称排序' },
        ]} />
    </div>
    <div className={s.deviceSplit + ' ' + look.deviceSplit}>
      <section className={s.deviceListing + ' ' + look.deviceListing}>
        {visible.length ? <table className={s.deviceTable + ' ' + look.deviceTable}><caption>设备（{visible.length}）</caption>
          <thead><tr><th scope="col">设备</th><th scope="col">连接</th><th scope="col">电量</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
          <tbody>{visible.map(device => <tr key={device.id} data-selected={device.id === detail?.id}
            onClick={() => pick(device.id)} onDoubleClick={event => openDetail(device.id, event.currentTarget)}>
            <td><button className={s.deviceName} type="button" aria-pressed={device.id === detail?.id} title={device.name}
              aria-description="单击选择预览，双击或按 Enter 查看详情"
              onClick={event => { if (event.detail === 0) openDetail(device.id, event.currentTarget); }}>
              <Art device={device} /><b>{device.name}</b>
            </button></td>
            <td>{device.status === 'stale' ? '待确认' : <Connection device={device} />}</td>
            <td className={s.rowReading} data-tone={tone(device, state)}><strong>{readingLabel(device.reading)}</strong>
              {device.status !== 'current' && device.reading && <small title={dateLabel(device.lastRead)}>上次 · {dateLabel(device.lastRead)}</small>}</td>
            <td><StatusTag device={device} state={state} /></td>
            <td onDoubleClick={event => event.stopPropagation()}><button className={s.iconButton} aria-label={'查看详情 · ' + device.name} title="查看详情"
              onClick={event => { event.stopPropagation(); openDetail(device.id, event.currentTarget.closest('tr') ?? undefined); }}><ChevronRight size={17} /></button></td>
          </tr>)}</tbody>
        </table> : <Empty button={!devices.length ? find : undefined}>{devices.length ? '没有符合筛选条件的设备' : '暂无受监测设备'}</Empty>}
      </section>
      {detail && <Details key={detail.id} device={detail} state={state} run={run} openFull={source => openDetail(detail.id, source)} />}
    </div>
  </>;
}
function Details({ device, state, run, full, openFull }: { device: Device; state: Snapshot; run: Run; full?: boolean; openFull?: (source: HTMLElement) => void }) {
  const detailRef = useRef<HTMLElement>(null);
  const [editing, edit] = useState(false);
  const [alias, setAlias] = useState(device.name);
  const [confirmRemove, setRemove] = useState(false);
  const [confirmBluetooth, setConfirmBluetooth] = useState(false);
  const [probing, setProbing] = useState(false);
  const rules = state.deviceSettings[device.id];
  const savedLimit = deviceLowThreshold(device, state);
  useEffect(() => { if (!full) prepareHero(device); }, [device.art, full]);
  const low = level(device, state);
  const send = (command: Command) => { void run(command); };
  return <section ref={detailRef} className={s.details + ' ' + (full ? look.fullDetail : look.devicePreview)} data-full={!!full} aria-label={full ? "设备详情" : "设备预览"}>
    {!full && <h2 className={s.previewTitle}>设备预览</h2>}
    <div className={s.detailTop + (full ? ' ' + look.detailTop : '')}>
      <div className={s.detailsHeader + (full ? ' ' + look.detailsHeader : '')}><div className={s.detailName}>{full ? <h1>{device.name}</h1> : <h3>{device.name}</h3>}
          <div><StatusTag device={device} state={state} />{device.status !== 'stale' && <Connection device={device} />}</div></div>
        <SceneStage device={device} shared={full} detail />
        <button className={s.iconButton} aria-label="编辑设备名称" onClick={() => { setAlias(device.name); edit(true); }}><Pencil size={17} /></button></div>
      <div className={s.detailReadout + (full ? ' ' + look.detailReadout : '')}><div className={s.batteryPanel} data-tone={tone(device, state)}>
        <div className={s.readoutLabel}><span>{!device.reading ? '暂无电量读数' : device.status === 'current' ? '当前电量' : '上次有效电量'}</span>{full && <span className={s.readingState}>{batteryState(device, state)}</span>}</div>
        <SceneBattery state={state} device={device} phase={state.refreshing ? "refreshing" : "ready"} /></div>
        <dl className={s.detailsFacts}>
          <div><ShieldCheck size={21} /><div><dt>读取状态</dt><dd>{device.reason}</dd></div></div>
          <div><Cable size={21} /><div><dt>读数来源</dt><dd>{device.reading ? device.reading.source === 'hid' ? '设备 HID' : 'Windows 电量属性' : '—'}</dd></div></div>
          <div><Zap size={21} /><div><dt>{device.status === 'current' ? '充电状态' : '上次充电状态'}</dt><dd>{device.reading ? powerLabels[device.reading.power] : '—'}</dd></div></div>
          <div><Clock size={21} /><div><dt>上次读数</dt><dd>{dateLabel(device.lastRead)}</dd></div></div>
        </dl>

        <Collapsible.Root defaultOpen={!full}>
          {full ? <div className={s.reminderSummary}><span>低电量阈值 <b>{savedLimit}%</b></span>
            <Collapsible.Trigger className={s.primary}>调整提醒 <ChevronDown size={15} aria-hidden="true" /></Collapsible.Trigger>
          </div> : <h3 className={s.detailSection}>提醒设置</h3>}
          <Collapsible.Content className={s.reminderContent}>
          <DeviceThreshold deviceId={device.id} saved={rules?.low} global={state.settings.low} critical={state.settings.critical}
            save={value => run({ type: 'deviceSettings', id: device.id, patch: { low: value } })} />
          <SettingRow title="静音提醒" copy="暂停此设备的提醒"><SwitchControl label="静音此设备" checked={!!rules?.muted}
            onChange={value => send({ type: 'deviceSettings', id: device.id, patch: { muted: value } })} /></SettingRow>
          </Collapsible.Content>
        </Collapsible.Root>
        {canProbeBluetooth(device) && <div className={s.bluetoothOption}>
          <SettingRow title="DualSense 蓝牙电量" copy={isConnected(device) ? '读取本次连接的完整电量报告' : '唤醒手柄并连接蓝牙后可读取'}>
            <button className={s.button} disabled={probing || device.status === 'offline' || device.status === 'stale'}
              onClick={() => setConfirmBluetooth(true)}><Bluetooth size={16} aria-hidden="true" />{probing ? '正在读取…' : '读取蓝牙电量'}</button>
          </SettingRow>
        </div>}
        <footer className={s.detailActions}>{openFull && <button className={s.primary} onClick={() => { if (detailRef.current) openFull(detailRef.current); }}>查看详情 <ChevronRight size={16} aria-hidden="true" /></button>}<button className={s.button} onClick={() => send({ type: 'preview', severity: low ?? 'low', id: device.id })}><Bell size={19} />提醒测试</button>
          <Menu.Root><Menu.Trigger asChild><button className={s.button}><Ellipsis size={20} />更多操作</button></Menu.Trigger>
            <Menu.Portal><Menu.Content align="end" sideOffset={5} className={s.popover}>
              <Menu.Item className={s.menuOption} onSelect={() => send({ type: 'refresh' })}><RefreshCw size={15} aria-hidden="true" />立即刷新</Menu.Item>
              <Menu.Item className={s.menuOption} disabled={!low} onSelect={() => send({ type: 'snooze', id: device.id })}><Clock size={15} aria-hidden="true" />稍后提醒</Menu.Item>
              <Menu.Item className={s.menuOption} disabled={!low} onSelect={() => send({ type: 'ignore', id: device.id })}><BellOff size={15} aria-hidden="true" />忽略本次</Menu.Item>
              {device.watched && <><Menu.Separator className={s.menuDivider} /><Menu.Item className={s.menuOption} data-destructive onSelect={() => setRemove(true)}>
                <MonitorSmartphone size={15} aria-hidden="true" />停止监测</Menu.Item></>}
            </Menu.Content></Menu.Portal></Menu.Root>
        </footer>
        {full && <section className={s.detailHistory + ' ' + look.detailHistory}>
          <SectionTitle>电量趋势 <span>近 24 小时</span></SectionTitle>
          <Chart device={device} revision={device.lastRead} threshold={savedLimit} large />
        </section>}
      </div>
    </div>
    {confirmBluetooth && <Modal title="启用 DualSense 蓝牙增强读取？"
      description="手柄会在本次连接发送完整报告，部分 DirectInput 游戏可能受影响。关机重连可恢复。"
      onClose={() => { if (!probing) setConfirmBluetooth(false); }}>
      <button className={s.primary} disabled={probing} onClick={() => {
        setProbing(true);
        void run({ type: 'bluetooth', id: device.id }).then(reply => {
          setProbing(false);
          if (reply.ok) setConfirmBluetooth(false);
        });
      }}>{probing ? '正在读取…' : '确认读取蓝牙电量'}</button>
    </Modal>}
    {editing && <Modal title="编辑设备名称" description="清空名称可恢复设备原名。" onClose={() => edit(false)}>
      <form className={s.modalForm} onSubmit={event => {
        event.preventDefault();
        void run({ type: 'deviceSettings', id: device.id, patch: { alias } }).then(reply => { if (reply.ok) edit(false); });
      }}><input autoComplete="off" name="device-name" aria-label="设备名称" value={alias} maxLength={80} onChange={event => setAlias(event.target.value)} />
        <button type="submit" className={s.primary}>保存名称</button></form>
    </Modal>}
    {confirmRemove && <Modal title="停止监测设备？" description={device.name + '将从设备列表移除，可通过查找设备重新添加。'} onClose={() => setRemove(false)}>
      <button className={s.button} onClick={() => {
        void run({ type: 'remove', id: device.id }).then(reply => { if (reply.ok) setRemove(false); });
      }}>停止监测</button>
    </Modal>}
  </section>;
}

function Alerts({ state, run, open }: { state: Snapshot; run: Run; open: (id: string) => void }) {
  const devices = needCharge(state).sort((a, b) => Number(level(b, state) === 'critical') - Number(level(a, state) === 'critical'));
  const [low, setLow] = useState(String(state.settings.low));
  const [critical, setCritical] = useState(String(state.settings.critical));
  const [preview, setPreview] = useState<'low' | 'critical'>('low');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setLow(String(state.settings.low)); setCritical(String(state.settings.critical)); }, [state.settings.low, state.settings.critical]);
  const muted = state.mutedUntil > Date.now();
  const previewTarget = devices.find(device => level(device, state) === preview) ?? devices[0] ?? state.devices.find(device => device.art === 'dualsense') ?? state.devices[0];
  const previewDevice = makePreviewDevice(preview, previewTarget);
  const dirty = Number(low) !== state.settings.low || Number(critical) !== state.settings.critical;
  const patch = (value: Partial<Snapshot['settings']>) => { void run({ type: 'settings', patch: value }); };
  return <div className={preferences.reminders} data-page="reminders">
    <section className={preferences.queue} aria-labelledby="charge-heading">
      <h2 id="charge-heading">待充电 <span>{devices.length ? devices.length + ' 台设备' : ''}</span></h2>
      {!devices.length && <div className={preferences.empty}><ShieldCheck size={40} strokeWidth={1.25} /><h3>暂无待充电设备</h3><p>电量达到提醒阈值时，设备会显示在这里。</p></div>}
      {devices.map(device => {
        const severityValue = level(device, state);
        const status = state.alerts[device.id];
        return <article className={preferences.chargeDevice} key={device.id} data-level={severityValue}>
          <button className={preferences.deviceImage} aria-label={'查看 ' + device.name} onClick={() => open(device.id)}><Art device={device} variant="hero" /></button>
          <div className={preferences.deviceInfo}><button className={s.linkTitle} onClick={() => open(device.id)}>{device.name}</button>
            <BatteryMeter device={device} state={state} />
            <small>{state.deviceSettings[device.id]?.muted ? '已静音' : status?.ignored === severityValue ? '已忽略本次' : (status?.snoozeUntil ?? 0) > Date.now() ? '已设为稍后提醒' : severityValue === 'critical' ? '电量告急' : ''}</small>
          </div>
          <div className={preferences.chargeActions}><button className={s.button} onClick={() => { void run({ type: 'snooze', id: device.id }); }}>稍后提醒</button>
            <Menu.Root><Menu.Trigger asChild><button className={s.iconButton} aria-label={device.name + '的提醒操作'}><Ellipsis size={19} /></button></Menu.Trigger>
              <Menu.Portal><Menu.Content className={s.popover} align="end" sideOffset={5}><Menu.Item className={s.menuOption} onSelect={() => { void run({ type: 'ignore', id: device.id }); }}>忽略本次</Menu.Item></Menu.Content></Menu.Portal>
            </Menu.Root>
          </div>
        </article>;
      })}
    </section>
    <section className={preferences.reminderSettings} aria-labelledby="reminder-heading">
      <h2 id="reminder-heading">提醒设置</h2>
      <form className={preferences.thresholds} onSubmit={event => {
        event.preventDefault();
        if (Number(critical) >= Number(low)) { setError('紧急阈值需低于低电量阈值。'); return; }
        setSaving(true); setError('');
        void run({ type: 'settings', patch: { low: Number(low), critical: Number(critical) } }).then(reply => {
          if (!reply.ok) setError(reply.error);
        }).finally(() => setSaving(false));
      }}>
        <label>低电量 <span><input type="number" name="low-threshold" min="2" max="95" aria-label="全局低电量阈值" value={low} onChange={event => setLow(event.target.value)} required />%</span></label>
        <label>紧急 <span><input type="number" name="critical-threshold" min="1" max="94" aria-label="全局紧急阈值" value={critical} onChange={event => setCritical(event.target.value)} required />%</span></label>
        {(dirty || error) && <div className={preferences.thresholdApply}>{error && <p role="alert">{error}</p>}<button className={s.button} disabled={saving || !dirty}>{saving ? '应用中…' : '应用阈值'}</button></div>}
      </form>
      <div className={preferences.repeat}><SettingRow title="重复提醒"><SelectControl label="重复提醒间隔" value={String(state.settings.repeat)} onChange={value => patch({ repeat: Number(value) })} choices={minutes([0, 15, 30, 60, 120])} /></SettingRow></div>
      <div className={preferences.notificationPreview}>
        <h3>桌面通知预览</h3>
        <button className={preferences.notificationCard} aria-label={'发送' + (preview === 'low' ? '低电量' : '紧急') + '测试通知'} onClick={() => { void run({ type: 'preview', severity: preview, ...(previewTarget ? { id: previewTarget.id } : {}) }); }}>
          <Art device={previewDevice} /><span><small>余电 · 示例读数</small><span>{previewDevice.name} <strong data-level={preview}>{readingLabel(previewDevice.reading)}</strong></span></span><Bell size={16} aria-hidden="true" />
        </button>
        <div className={preferences.previewSwitch} role="group" aria-label="通知预览级别">{(['low', 'critical'] as const).map(value => <button key={value} aria-pressed={preview === value} onClick={() => setPreview(value)}>{value === 'low' ? '低电量' : '紧急'}</button>)}</div>
      </div>
      <details className={preferences.morePreferences}><summary>通知与静音 <ChevronDown size={16} /></summary>
        <SettingRow title="右下角弹窗" copy="关闭后由 Windows 投递通知"><SwitchControl label="右下角弹窗" checked={state.settings.desktopToasts} onChange={() => { void run({ type: 'toggleAlertSetting', key: 'desktopToasts' }); }} /></SettingRow>
        <SettingRow title="全屏提示音" copy="全屏时用短音提示"><SwitchControl label="全屏提示音" checked={state.settings.fullscreenSound} onChange={() => { void run({ type: 'toggleAlertSetting', key: 'fullscreenSound' }); }} /></SettingRow>
        <SettingRow title="仅提示音" copy="桌面场景仅播放短音"><SwitchControl label="仅提示音" checked={state.settings.soundOnly} onChange={() => { void run({ type: 'toggleAlertSetting', key: 'soundOnly' }); }} /></SettingRow>
        <SettingRow title="稍后提醒"><SelectControl label="稍后提醒时间" value={String(state.settings.snooze)} onChange={value => patch({ snooze: Number(value) })} choices={minutes([5, 15, 30, 60])} /></SettingRow>
        <SettingRow title="静音时长"><SelectControl label="全局静音时长" value={String(state.settings.muteMinutes)} onChange={value => { const duration = Number(value); if (isMuteDuration(duration)) patch({ muteMinutes: duration }); }} choices={muteDurations.map(value => ({ value: String(value), label: muteDurationLabel(value) }))} /></SettingRow>
        <SettingRow title={muted ? '提醒已静音' : '暂停提醒'} copy={muted ? '静音至 ' + dateLabel(state.mutedUntil) : '设备电量仍会更新'}><button className={s.button} onClick={() => { void run({ type: 'mute' }); }}>{muted ? '恢复提醒' : '静音 ' + muteDurationLabel(state.settings.muteMinutes)}</button></SettingRow>
      </details>
    </section>
  </div>;
}

const historyClock = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function History({ state, starting }: { state: Snapshot; starting: boolean }) {
  const [ids, select] = useState<string[]>();
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const sync = () => { if (!document.hidden) setClock(Date.now()); };
    const timer = window.setInterval(sync, 30_000);
    document.addEventListener('visibilitychange', sync);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, []);
  const first = state.devices.find(item => item.art === 'mouse') ?? state.devices[0];
  const second = state.devices.find(item => item.id !== first?.id && item.art === 'dualsense');
  const selected = (ids ?? [first?.id, second?.id]).map(id => state.devices.find(item => item.id === id))
    .filter((item): item is Device => !!item);
  if (!selected.length && first) selected.push(first);
  const activeIds = selected.map(item => item.id);
  if (!first && !starting) return <Empty>设备产生读数后，可在这里查看电量变化</Empty>;
  const single = selected.length === 1 ? selected[0] : undefined;
  const now = Math.max(clock, ...selected.map(item => item.lastRead ?? 0));
  return <section className={s.history} aria-label="电量对比记录">
    <div className={s.historyToolbar}>
      <div className={s.historySpan}><b>24 小时</b><span aria-label="实际查看时段">{historyClock.format(now - 86400000)} – {historyClock.format(now)}</span></div>
      <div className={s.historyChoices} role="group" aria-label="选择对比设备">
        {selected.map((item, index) => <button type="button" key={item.id} className={s.historyChoice}
          data-series={index} data-device={item.id} aria-pressed="true" disabled={activeIds.length === 1}
          aria-label={activeIds.length > 1 ? '移除对比：' + item.name : item.name} title={item.name}
          onClick={() => select(toggleHistorySelection(activeIds, item.id))}>
          <Art device={item} /><i aria-hidden="true" /><span>{item.name}</span>
          {item.status === 'offline' && <Unplug size={13} aria-label="当前断开" />}
          {activeIds.length > 1 && <X className={s.historyRemove} size={12} aria-hidden="true" />}
        </button>)}
        {state.devices.length > 1 && <Menu.Root>
          <Menu.Trigger asChild><button className={s.historyAdd}><Plus size={15} aria-hidden="true" />设备</button></Menu.Trigger>
          <Menu.Portal><Menu.Content align="end" sideOffset={6} className={s.historyMenu} aria-label="可对比设备">
            {state.devices.map(item => {
              const checked = activeIds.includes(item.id);
              return <Menu.CheckboxItem key={item.id} checked={checked} className={s.menuOption}
                disabled={checked ? activeIds.length === 1 : activeIds.length >= compareLimit}
                onCheckedChange={() => select(toggleHistorySelection(activeIds, item.id))}>
                <span>{item.name}</span><Menu.ItemIndicator aria-hidden="true">✓</Menu.ItemIndicator>
              </Menu.CheckboxItem>;
            })}
          </Menu.Content></Menu.Portal>
        </Menu.Root>}
      </div>
    </div>
    <CompareChart devices={selected} starting={starting} anchor={now}
      threshold={single ? state.deviceSettings[single.id]?.low ?? state.settings.low : undefined} />
  </section>;
}
function Settings({ state, run, palette, choosePalette }: { state: Snapshot; run: Run; palette: Palette; choosePalette: (palette: Palette) => void }) {
  const [context, setContext] = useState('');
  const [exporting, setExporting] = useState(false);
  const [active, setActive] = useState('appearance');
  const sections = useRef<HTMLDivElement>(null);
  const send = (command: Command) => { void run(command); };
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id.replace('settings-', ''));
    }, { rootMargin: '-100px 0px -55% 0px', threshold: 0 });
    sections.current?.querySelectorAll('section').forEach(section => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  return <div className={preferences.settings} data-page="settings">
    <nav className={preferences.settingsNav} aria-label="设置分类">{[['appearance', '外观'], ['runtime', '运行与托盘'], ['diagnostics', '诊断']].map(([id, title]) =>
      <button key={id} aria-current={active === id ? 'location' : undefined} onClick={() => {
        setActive(id); document.getElementById('settings-' + id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      }}>{title}</button>)}</nav>
    <div className={preferences.settingsSections} ref={sections}>
      <section id="settings-appearance" className={preferences.appearance} aria-labelledby="appearance-heading">
        <h2 id="appearance-heading">外观</h2>
        <div className={preferences.currentColor} role="group" aria-label="配色"><span>配色</span>
          <div>{palettes.map(([id, label]) => <label key={id} data-palette={id}>
            <input type="radio" name="appearance-palette" checked={palette === id} onChange={() => choosePalette(id)} />
            <i aria-hidden="true">{palette === id ? '✓' : ''}</i>{label}
          </label>)}</div>
        </div>
        <ZoomControl name="主界面" value={state.settings.zoom} apply={value => run({ type: 'settings', patch: { zoom: value } })} />
        <ZoomControl name="托盘浮窗" value={state.settings.trayZoom} apply={value => run({ type: 'settings', patch: { trayZoom: value } })} />
      </section>
      <section id="settings-runtime" className={preferences.settingsSection} aria-labelledby="runtime-heading">
        <h2 id="runtime-heading">运行与托盘</h2>
        <SettingRow title="开机启动" copy="随 Windows 登录，在托盘开始监测"><SwitchControl label="随 Windows 登录启动" checked={state.settings.startup} onChange={value => send({ type: 'settings', patch: { startup: value } })} /></SettingRow>
        <SettingRow title="智能检测" copy="低电量和充电中的设备会更频繁更新，读取失败时自动重试。"><button className={s.button} disabled={state.refreshing || state.collector === 'starting'} onClick={() => send({ type: 'refresh' })}>{state.refreshing ? '刷新中…' : '立即刷新'}</button></SettingRow>
      </section>
      <section id="settings-diagnostics" className={preferences.settingsSection} aria-labelledby="diagnostics-heading">
        <h2 id="diagnostics-heading">诊断</h2>
        <SettingRow title="记录 DualSense 电池电压" copy="实验数据保存在本地诊断目录"><SwitchControl label="记录 DualSense 电池电压" checked={state.settings.voltage} onChange={value => send({ type: 'settings', patch: { voltage: value } })} /></SettingRow>
        <SettingRow title="诊断日志" copy="查看采集、错误和性能采样记录"><button className={s.button} onClick={() => send({ type: 'diagnostics' })}>打开诊断目录 <ChevronRight size={16} /></button></SettingRow>
        <form className={preferences.compatibility} onSubmit={event => {
          event.preventDefault(); setExporting(true);
          void run({ type: 'compatibility', context }).finally(() => setExporting(false));
        }}>
          <label htmlFor="compat-context">兼容性反馈说明 <small>选填</small></label>
          <input id="compat-context" name="compatibility-context" maxLength={240} autoComplete="off" placeholder="例如 V98 Pro V3，2.4 GHz，唤醒后仍无电量…" value={context} onChange={event => setContext(event.target.value)} />
          <button className={s.button} type="submit" disabled={exporting || state.demo}>{exporting ? '正在生成…' : '生成兼容性报告'}</button>
        </form>
      </section>
    </div>
  </div>;
}

function FindDevices({ state, run, close }: { state: Snapshot; run: Run; close: () => void }) {
  const [found, setFound] = useState<Found[]>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
   async function search() {
    setLoading(true);
    const reply = await run({ type: 'discover' });
    setLoading(false);
    if (reply.ok) { setFound(reply.found); setError(''); }
    else setError(reply.error);
  }
  useEffect(() => { void search(); }, []);
  return <Modal title="查找设备"
    description="先在 Windows 中连接或配对外设，再选择支持电量读取的设备。"
    onClose={close}>
      <button className={s.button} disabled={loading} onClick={() => { void search(); }}><RefreshCw size={16} />重新扫描</button>
      <div className={s.discovery} aria-live="polite">
        {loading ? <p>正在扫描 Windows 设备…</p> : error ? <p>{error}</p> : !found?.length ? <p>暂未发现外设。</p> : found.map(device => {
          const watched = state.devices.some(item => item.id === device.id);
          return <div key={device.id} className={s.discoveryRow}><div><b>{device.name}</b><small>{device.connection} · {
            device.automatic || watched ? '已监测' : !device.connected ? '未连接' : device.reading ? '可添加 · ' + readingLabel(device.reading) : 'Windows 暂无可用电量'}</small></div>
            {device.connected && device.reading && !device.automatic && !watched && <button className={s.button} disabled={!!pending} onClick={() => {
                setPending(device.id);
                void run({ type: 'add', id: device.id }).then(reply => {
                  setPending(null);
                  if (reply.ok) setFound(items => items?.map(item => item.id === device.id ? { ...item, automatic: true } : item));
                });
              }}>添加到监测</button>}
          </div>;
        })}
      </div>
  </Modal>;
}
