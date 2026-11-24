import * as Collapsible from '@radix-ui/react-collapsible';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';
import { Activity, ArrowLeft, Bell, BellOff, Bluetooth, Cable, ChevronDown, ChevronRight, Clock, Ellipsis, MonitorSmartphone, Pencil, Plus, RefreshCw, Search, ShieldCheck, TriangleAlert, Unplug, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { canProbeBluetooth, isConnected, isMuteDuration, muteDurationLabel, muteDurations, severity, type Command, type CommandResult, type Device, type Found, type Snapshot } from './model';
import { api, Art, BatteryMeter, Brand, Chart, CompareChart, Connection, dateLabel, Modal, prepareHero, readingLabel, SectionTitle, SelectControl, SettingRow, StatusTag, SwitchControl, tone } from './ui';
import s from './panel.module.css';
import { ZoomControl } from './zoom';
import { compareLimit, toggleHistorySelection } from './history-plot';

const pages = [
  ['overview', '总览'], ['devices', '设备'], ['alerts', '提醒'], ['history', '记录'], ['settings', '设置'],
] as const;
type Page = typeof pages[number][0];
type Filter = 'all' | 'online' | 'low' | 'offline' | 'recent';
type Run = (command: Command) => Promise<CommandResult>;

const level = (device: Device, state: Snapshot) => severity(device, state.settings, state.deviceSettings[device.id]);
const needCharge = (state: Snapshot) => state.devices.filter(device => level(device, state));
const minutes = (values: number[]) => values.map(value => ({ value: String(value), label: value ? value + ' 分钟' : '关闭' }));
const powerLabels = { charging: '充电中', full: '已充满', discharging: '电池供电', unknown: '设备未上报' };

export function Dashboard({ state }: { state: Snapshot }) {
  const [page, setPage] = useState<Page>('overview');
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
    const photo = source?.querySelector('[data-device-art]') ?? undefined;
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
  const descriptions: Record<Page, [string, string]> = {
    overview: ['我的桌面', state.devices.filter(isConnected).length + ' 台在线 · ' + state.devices.filter(device => !isConnected(device)).length + ' 台未连接'],
    devices: ['我的设备', '查看设备连接与电量'],
    alerts: ['提醒中心', '待充电设备和通知偏好'],
    history: ['电量记录', '过去 24 小时的设备读数'],
    settings: ['设置', '显示、监测与诊断'],
  };
  return <div className={s.shell}>
    <a className={s.skipLink} href="#main-content">跳到主要内容</a>
    <header className={s.topbar}>
      <Brand />
      <nav aria-label="主导航">{pages.map(([id, label]) => <button key={id} className={s.navItem}
        aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => { cancelTransition(); setDetailId(undefined); if (page !== id) search(""); setPage(id); window.scrollTo(0, 0); }}><span>{label}</span>
        {id === 'alerts' && low.length > 0 && <i aria-hidden="true" />}</button>)}</nav>
    </header>
    <main className={s.content} id="main-content" tabIndex={-1} ref={main}>
      <div hidden={!!detailed}>
      <header className={s.heading}><div><h1>{descriptions[page][0]}</h1><p>{descriptions[page][1]}</p></div>
        {(page === 'overview' || page === 'devices') && <div className={s.headingActions}>
          {page === "devices" && !starting && <label className={s.searchBox}><Search size={17} aria-hidden="true" />
            <input type="search" autoComplete="off" name="device-search" aria-label="搜索设备" value={query}
              onChange={event => search(event.target.value)} placeholder="搜索设备" />
          </label>}
          <button className={s.iconButton} title="立即刷新" aria-label="立即刷新" disabled={starting || state.refreshing} onClick={() => { void run({ type: 'refresh' }); }}>
            <RefreshCw size={18} className={state.refreshing ? s.spin : ''} /></button>
          <button className={page === "devices" ? s.primary : s.button} onClick={() => setFinding(true)}><Plus size={18} />查找设备</button>
        </div>}
      </header>
      {state.collector !== 'ready' && <div className={s.notice} role="status"><Activity size={19} /><span>{
        { starting: '正在读取设备和电量…', occupied: '旧版 PowerManager 正在监测。请从旧版托盘退出，新版会自动接管。',
          retrying: '采集暂时中断，正在尝试重新连接。' }[state.collector]}</span></div>}
      {state.error && <div className={s.notice} role="alert"><TriangleAlert size={19} />{state.error}</div>}
      {page === 'overview' && (starting ? <DeviceSkeleton overview /> :
        <Overview state={state} openDetail={openDetail} showDevices={showDevices} find={() => setFinding(true)} />)}
      {page === 'devices' && (starting ? <DeviceSkeleton /> :
        <Devices state={state} selected={selected} pick={select} filter={filter} setFilter={setFilter} query={query} openDetail={openDetail} run={run} find={() => setFinding(true)} />)}
      {page === 'alerts' && <Alerts state={state} run={run} open={open} />}
      {page === 'history' && <History state={state} starting={starting} />}
      {page === 'settings' && <Settings state={state} run={run} />}
      </div>
      {detailed && <div>
        <header className={s.fullHeader}>
          <button className={s.button} ref={detailBack} onClick={closeDetail}><ArrowLeft size={16} aria-hidden="true" />返回{page === 'overview' ? '总览' : '设备'}</button>
        </header>
        <Details key={detailed.id} device={detailed} state={state} run={run} full />
      </div>}
      <footer className={s.appFooter}>
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
function DeviceSkeleton({ overview = false }: { overview?: boolean }) {
  return <div className={overview ? s.overviewTop : s.deviceSplit} aria-hidden="true">
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

function Overview({ state, openDetail, showDevices, find }: { state: Snapshot;
  openDetail: (id: string, source?: HTMLElement) => void;
  showDevices: (value: Filter) => void; find: () => void }) {
  const [order, setOrder] = useState(() => overviewOrder(state));
  const online = state.devices.filter(isConnected);
  useEffect(() => {
    const ranked = overviewOrder(state);
    setOrder(previous => {
      const available = new Set(ranked);
      const retained = previous.filter(id => available.has(id));
      const known = new Set(retained);
      const additions = ranked.filter(id => !known.has(id));
      return additions.length || retained.length !== previous.length ? [...retained, ...additions] : previous;
    });
  }, [state]);
  const byId = new Map(state.devices.map(device => [device.id, device]));
  const ordered = order.flatMap(id => {
    const device = byId.get(id);
    return device ? [device] : [];
  });
  const featured = online.length ? ordered[0] ?? online[0] : undefined;
  useEffect(() => { if (featured) prepareHero(featured); }, [featured?.art]);
  const others = ordered.filter(device => device.id !== featured?.id);
  const hero = useRef<HTMLElement>(null);
  return <>
    <div className={s.overviewTop}>
      {featured ? <section className={s.hero} ref={hero} aria-label="主设备">
        <header><h2 title={featured.name}>{featured.name}</h2><span className={s.readingState} data-tone={tone(featured, state)}>{batteryState(featured, state)}</span></header>
        <div className={s.heroBody}>
          <div className={s.stage}><Art device={featured} variant="card" /></div>
          <div className={s.heroReadout}>
            <span>{!featured.reading ? "暂无电量读数" : featured.status === "current" ? "当前电量" : "上次电量"}</span>
            <BatteryMeter device={featured} state={state} />
            {featured.status !== "current" && featured.reading && <small>{dateLabel(featured.lastRead)}</small>}
            <button className={s.primary} onClick={() => openDetail(featured.id, hero.current ?? undefined)}>查看详情 <ChevronRight size={16} /></button>
          </div>
        </div>
      </section> : <Empty button={find}>{state.devices.length ? '设备均未连接，其他设备列表保留上次读数' : '尚未监测到外设'}</Empty>}
      <section className={s.otherDevices}>
        <SectionTitle aside={<button className={s.textButton} onClick={() => showDevices('all')}>全部设备 <ChevronRight size={15} /></button>}>其他设备</SectionTitle>
        <div className={s.overviewRows}>
        {others.map(device => <button className={s.overviewRow} key={device.id} onClick={event => openDetail(device.id, event.currentTarget)}>
          <Art device={device} /><div><b title={device.name}>{device.name}</b><Connection device={device} />
            {!isConnected(device) && <small>未连接 · {dateLabel(device.lastRead)}</small>}
          </div><div className={s.rowReading} data-tone={tone(device, state)}>
            {device.status !== 'current' && device.reading && <small>上次电量</small>}<strong>{readingLabel(device.reading)}</strong>
            {tone(device, state) !== 'normal' && isConnected(device) && <small>{batteryState(device, state)}</small>}
          </div>
        </button>)}
        {!others.length && <p className={s.smallEmpty}>暂无其他设备</p>}
        </div>
      </section>
    </div>
  </>;
}

function Devices({ state, selected, pick, filter, setFilter, query, openDetail, run, find }: {
  state: Snapshot; selected?: string; pick: (id?: string) => void; filter: Filter; setFilter: (value: Filter) => void; query: string; openDetail: (id: string, source?: HTMLElement) => void; run: Run; find: () => void;
}) {
  const [sort, setSort] = useState('state');
  const { devices, alerts } = state;
  const online = devices.filter(isConnected);
  const low = needCharge(state);
  const offline = devices.filter(device => !isConnected(device));
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
    <div className={s.deviceSplit}>
      <section className={s.deviceListing}>
        {visible.length ? <table className={s.deviceTable}><caption>设备（{visible.length}）</caption>
          <thead><tr><th scope="col">设备</th><th scope="col">连接</th><th scope="col">电量</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead>
          <tbody>{visible.map(device => <tr key={device.id} data-selected={device.id === detail?.id}
            onClick={() => pick(device.id)} onDoubleClick={event => openDetail(device.id, event.currentTarget)}>
            <td><button className={s.deviceName} type="button" aria-pressed={device.id === detail?.id} title={device.name}
              aria-description="单击选择预览，双击或按 Enter 查看详情"
              onClick={event => { if (event.detail === 0) openDetail(device.id, event.currentTarget); }}>
              <Art device={device} /><b>{device.name}</b>
            </button></td>
            <td><Connection device={device} /></td>
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
  const savedLimit = rules?.low ?? state.settings.low;
  const [limit, setLimit] = useState(String(savedLimit));
  const [savingLimit, setSavingLimit] = useState(false);
  useEffect(() => { if (!full) prepareHero(device); }, [device.art, full]);
  useEffect(() => { setLimit(String(savedLimit)); }, [savedLimit, rules?.low]);
  async function saveLimit(value: number | undefined) {
    setSavingLimit(true);
    try {
      const result = await run({ type: 'deviceSettings', id: device.id, patch: { low: value } });
      if (result.ok) setLimit(String(value ?? state.settings.low));
    } finally { setSavingLimit(false); }
  }
  const low = level(device, state);
  const send = (command: Command) => { void run(command); };
  return <section ref={detailRef} className={s.details} data-full={!!full} aria-label={full ? "设备详情" : "设备预览"}>
    {!full && <h2 className={s.previewTitle}>设备预览</h2>}
    <div className={s.detailTop}>
      <div className={s.detailsHeader}><div className={s.detailName}>{full ? <h1>{device.name}</h1> : <h3>{device.name}</h3>}
          <div><StatusTag device={device} state={state} /><Connection device={device} /></div></div>
        <div className={s.stage}><Art device={device} variant={full ? "hero" : "card"} shared={full} /></div>
        <button className={s.iconButton} aria-label="编辑设备名称" onClick={() => { setAlias(device.name); edit(true); }}><Pencil size={17} /></button></div>
      <div className={s.detailReadout}><div className={s.batteryPanel} data-tone={tone(device, state)}><div className={s.readoutLabel}><span>{!device.reading ? '暂无电量读数' : device.status === 'current' ? '当前电量' : '上次有效电量'}</span>{full && <span className={s.readingState}>{batteryState(device, state)}</span>}</div><BatteryMeter state={state} device={device} /></div>
        <dl className={s.detailsFacts}>
          <div><ShieldCheck size={21} /><div><dt>读取状态</dt><dd>{device.reason}</dd></div></div>
          <div><Cable size={21} /><div><dt>读数来源</dt><dd>{device.reading ? device.reading.source === 'hid' ? '设备 HID' : 'Windows 电量属性' : '—'}</dd></div></div>
          <div><Zap size={21} /><div><dt>充电状态</dt><dd>{device.reading ? powerLabels[device.reading.power] : '—'}</dd></div></div>
          <div><Clock size={21} /><div><dt>上次读数</dt><dd>{dateLabel(device.lastRead)}</dd></div></div>
        </dl>

        <Collapsible.Root defaultOpen={!full}>
          {full ? <div className={s.reminderSummary}><span>低电量阈值 <b>{savedLimit}%</b></span>
            <Collapsible.Trigger className={s.primary}>调整提醒 <ChevronDown size={15} aria-hidden="true" /></Collapsible.Trigger>
          </div> : <h3 className={s.detailSection}>提醒设置</h3>}
          <Collapsible.Content className={s.reminderContent}>
          <SettingRow title="设备低电量阈值" copy={rules?.low === undefined
            ? '跟随全局 ' + state.settings.low + '% · 紧急线 ' + state.settings.critical + '%'
            : rules.low <= state.settings.critical
              ? '自定义 ' + rules.low + '% · 达到 ' + state.settings.critical + '% 时直接进入紧急提醒'
              : '自定义 ' + rules.low + '% · 紧急线 ' + state.settings.critical + '%'}>
            <form className={s.thresholdForm} onSubmit={event => {
              event.preventDefault();
              void saveLimit(Number(limit));
            }}>
              <input className={s.number} type="number" autoComplete="off" name="device-threshold"
                aria-label="设备低电量阈值" value={limit} min={1} max={95} step={1} required
                onChange={event => setLimit(event.target.value)} />
              <button className={s.button} type="submit" disabled={savingLimit || (rules?.low !== undefined && Number(limit) === savedLimit)}>应用</button>
              {rules?.low !== undefined && <button className={s.textButton} type="button" disabled={savingLimit}
                onClick={() => { void saveLimit(undefined); }}>恢复全局阈值</button>}
            </form>
          </SettingRow>
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
      </div>
    </div>
    {full && <section className={s.detailHistory}>
      <SectionTitle>电量趋势 <span>近 24 小时</span></SectionTitle>
      <Chart device={device} revision={device.lastRead} threshold={savedLimit} large />
    </section>}
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
  const devices = needCharge(state);
  const [low, setLow] = useState(String(state.settings.low));
  const [critical, setCritical] = useState(String(state.settings.critical));
  const muted = state.mutedUntil > Date.now();
  const patch = (value: Partial<Snapshot['settings']>) => { void run({ type: 'settings', patch: value }); };
  return <div className={s.alertsLayout}>
    <div className={s.alertQueue}>
      {(['critical', 'low'] as const).map(severityValue => {
        const group = devices.filter(device => level(device, state) === severityValue);
        return <section className={s.alertGroup} data-level={severityValue} key={severityValue}>
          <div className={s.chargeTitle}><span className={s.medallion}>{severityValue === 'critical' ? <Zap /> : <TriangleAlert />}</span>
            <div><h2>{severityValue === 'critical' ? '电量告急' : '低电量提醒'}（{group.length}）</h2>
              <p>{group.length ? '连接电源或更换电池可恢复提醒状态。' : '当前没有此级别的待充电设备。'}</p></div></div>
          {group.map(device => {
            const status = state.alerts[device.id];
            return <div className={s.alertDevice} key={device.id}>
              <Art device={device} /><div><button className={s.linkTitle} onClick={() => open(device.id)}>{device.name}</button>
                <strong>{readingLabel(device.reading)}</strong><small>{state.deviceSettings[device.id]?.muted ? '已静音' :
                  status?.ignored === severityValue ? '已忽略本次' : (status?.snoozeUntil ?? 0) > Date.now() ? '已设为稍后提醒' : ''}</small></div>
              <div className={s.alertButtons}><button className={s.button} onClick={() => { void run({ type: 'snooze', id: device.id }); }}><Clock size={16} />稍后提醒</button>
                <button className={s.button} onClick={() => { void run({ type: 'ignore', id: device.id }); }}><BellOff size={16} />忽略本次</button></div>
            </div>;
          })}
        </section>;
      })}
    </div>
    <div>
      <div className={s.alertIntro}><div className={s.ring}><Bell /></div><div><h2>提醒状态</h2><p>{muted ? '静音至 ' + dateLabel(state.mutedUntil) + '，设备电量仍会更新。' : '电量达到阈值时发送通知。'}</p></div>
        <button className={s.button} onClick={() => { void run({ type: 'mute' }); }}><BellOff size={17} />{muted ? '恢复提醒' : '静音 ' + muteDurationLabel(state.settings.muteMinutes)}</button></div>
      <section className={s.settingsPanel}>
        <SectionTitle>提醒设置</SectionTitle>
        <form onSubmit={event => { event.preventDefault(); patch({ low: Number(low), critical: Number(critical) }); }}>
          <SettingRow title="提醒阈值" copy="低电量阈值 / 紧急阈值。设备可单独设置低电量线，紧急线对所有设备优先。">
            <div className={s.inlineForm}><input type="number" className={s.number} autoComplete="off" name="low-threshold" min="2" max="95" aria-label="全局低电量阈值"
              value={low} onChange={event => setLow(event.target.value)} required />
            <input type="number" className={s.number} autoComplete="off" name="critical-threshold" min="1" max="94" aria-label="全局紧急阈值" value={critical}
              onChange={event => setCritical(event.target.value)} required /><button className={s.button}>应用</button></div>
          </SettingRow>
        </form>
        <SettingRow title="重复提醒间隔" copy="对仍处于低电量的设备再次提醒"><SelectControl label="重复提醒间隔"
          value={String(state.settings.repeat)} onChange={value => patch({ repeat: Number(value) })} choices={minutes([0, 15, 30, 60, 120])} /></SettingRow>
        <SettingRow title="全局静音时长" copy="下次静音时生效，期间仍会读取设备电量。"><SelectControl label="全局静音时长"
          value={String(state.settings.muteMinutes)} onChange={value => {
            const duration = Number(value);
            if (isMuteDuration(duration)) patch({ muteMinutes: duration });
          }} choices={muteDurations.map(value => ({ value: String(value), label: muteDurationLabel(value) }))} /></SettingRow>
        <SettingRow title="全屏提示音" copy="全屏时用短音提示"><SwitchControl label="全屏提示音" checked={state.settings.fullscreenSound}
          onChange={() => { void run({ type: 'toggleAlertSetting', key: 'fullscreenSound' }); }} /></SettingRow>
        <SettingRow title="仅提示音" copy="桌面场景仅播放短音"><SwitchControl label="仅提示音" checked={state.settings.soundOnly}
          onChange={() => { void run({ type: 'toggleAlertSetting', key: 'soundOnly' }); }} /></SettingRow>
        <SettingRow title="稍后提醒" copy="暂缓单个设备的低电量提醒"><SelectControl label="稍后提醒时间" value={String(state.settings.snooze)}
          onChange={value => patch({ snooze: Number(value) })} choices={minutes([5, 15, 30, 60])} /></SettingRow>
      </section>
    </div>
    <div>
      <section className={s.settingsPanel}>
        <SectionTitle>桌面通知</SectionTitle>
        <SettingRow title="右下角弹窗" copy="关闭后由 Windows 投递通知"><SwitchControl label="右下角弹窗"
          checked={state.settings.desktopToasts} onChange={() => { void run({ type: 'toggleAlertSetting', key: 'desktopToasts' }); }} /></SettingRow>
        <div className={s.previewActions}><button className={s.button} onClick={() => { void run({ type: 'preview', severity: 'low' }); }}><Bell size={17} />预览低电量</button>
          <button className={s.button} onClick={() => { void run({ type: 'preview', severity: 'critical' }); }}><Zap size={17} />预览紧急提醒</button></div>
      </section>
    </div>
  </div>;
}

function History({ state, starting }: { state: Snapshot; starting: boolean }) {
  const [ids, select] = useState<string[]>([]);
  const fallback = state.devices.find(item => item.art === 'dualsense') ?? state.devices[0];
  const selected = ids.map(id => state.devices.find(item => item.id === id)).filter((item): item is Device => !!item);
  if (!selected.length && fallback) selected.push(fallback);
  const activeIds = selected.map(item => item.id);
  if (!fallback && !starting) return <Empty>设备产生读数后，可在这里查看电量变化</Empty>;
  const single = selected.length === 1 ? selected[0] : undefined;
  return <section className={s.history}>
    <SectionTitle>近 24 小时 <span>最多对比 {compareLimit} 台</span></SectionTitle>
    <div className={s.historyChoices} role="group" aria-label="选择对比设备">
      {state.devices.map(item => {
        const index = activeIds.indexOf(item.id);
        const pressed = index !== -1;
        return <button key={item.id} className={s.historyChoice} aria-pressed={pressed} data-series={pressed ? index : undefined}
          disabled={!pressed && activeIds.length >= compareLimit} title={item.status === 'offline' ? item.name + ' · 当前断开' : item.name}
          aria-label={item.status === 'offline' ? item.name + '，当前断开' : undefined}
          onClick={() => select(toggleHistorySelection(activeIds, item.id))}>
          <i aria-hidden="true" />{pressed && <small aria-hidden="true">{index + 1}</small>}<span>{item.name}</span>{item.status === 'offline' && <Unplug size={12} aria-hidden="true" />}
        </button>;
      })}
    </div>
    <CompareChart devices={selected} starting={starting}
      threshold={single ? state.deviceSettings[single.id]?.low ?? state.settings.low : undefined} />
  </section>;
}
function Settings({ state, run }: { state: Snapshot; run: Run }) {
  const [context, setContext] = useState('');
  const [exporting, setExporting] = useState(false);
  const send = (command: Command) => { void run(command); };
  return <Tabs.Root className={s.settingsPage} orientation="vertical" defaultValue="display">
    <Tabs.List className={s.settingsNav} aria-label="设置分类">
      <Tabs.Trigger value="display">外观</Tabs.Trigger>
      <Tabs.Trigger value="monitoring">监测与运行</Tabs.Trigger>
      <Tabs.Trigger value="diagnostics">诊断</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="display" className={s.settingsContent}>
      <SectionTitle>外观 <span>缩放即刻预览</span></SectionTitle>
      <ZoomControl name="主界面" value={state.settings.zoom} apply={value => run({ type: 'settings', patch: { zoom: value } })} />
      <ZoomControl name="托盘浮窗" value={state.settings.trayZoom} apply={value => run({ type: 'settings', patch: { trayZoom: value } })} />
    </Tabs.Content>
    <Tabs.Content value="monitoring" className={s.settingsContent}>
      <SectionTitle>监测与运行</SectionTitle>
      <SettingRow title="智能检测" copy="普通设备定期读取，低电量和充电中的设备更频繁更新。读取失败时会自动重试。"><button className={s.button} disabled={state.refreshing || state.collector === 'starting'} onClick={() => send({ type: 'refresh' })}>立即刷新</button></SettingRow>
      <SettingRow title="随 Windows 登录启动" copy="登录后在托盘开始监测"><SwitchControl label="随 Windows 登录启动" checked={state.settings.startup}
        onChange={value => send({ type: 'settings', patch: { startup: value } })} /></SettingRow>
      <SettingRow title="记录 DualSense 电池电压" copy="实验数据保存在本地诊断目录"><SwitchControl label="记录 DualSense 电池电压" checked={state.settings.voltage}
        onChange={value => send({ type: 'settings', patch: { voltage: value } })} /></SettingRow>
    </Tabs.Content>
    <Tabs.Content value="diagnostics" className={s.settingsContent}>
      <SectionTitle>诊断</SectionTitle>
      <SettingRow title="诊断日志" copy="查看采集、错误和性能采样记录"><button className={s.button} onClick={() => send({ type: 'diagnostics' })}>打开诊断目录 <ChevronRight size={16} /></button></SettingRow>
      <form className={s.compatibilityForm} onSubmit={event => {
        event.preventDefault();
        setExporting(true);
        void run({ type: 'compatibility', context }).finally(() => setExporting(false));
      }}>
        <label htmlFor="compat-context">兼容性反馈说明（选填）</label>
        <input id="compat-context" name="compatibility-context" maxLength={240} autoComplete="off"
          placeholder="例如 V98 Pro V3，2.4 GHz，唤醒后仍无电量…" value={context} onChange={event => setContext(event.target.value)} />
        <button className={s.button} type="submit" disabled={exporting || state.demo}>
          {exporting ? '正在生成…' : '生成兼容性报告'}
        </button>
      </form>
    </Tabs.Content>
  </Tabs.Root>;
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
