import { createRoot } from 'react-dom/client';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { MainView, Snapshot, Toast } from './model';
import { api, Brand } from './ui';
import { QuickPanel, ToastPanel } from './surfaces';
import './theme.css';
import { applyMainPalette, readPalette } from './theme';
import startup from './startup.module.css';

const surface = new URLSearchParams(location.search).get('surface') ?? 'main';
document.body.dataset.surface = surface;
const loadDashboard = () => import('./dashboard').then(module => ({ default: module.Dashboard }));
const dashboardModule = surface === 'main' ? loadDashboard() : undefined;
const Dashboard = lazy(() => dashboardModule ?? loadDashboard());
if (surface === 'main') applyMainPalette(readPalette());

function MainFirstFrame() {
  useEffect(() => {
    if (surface !== 'main' || !api.mainPresent) return;
    let sent = false;
    let second = 0;
    const reveal = () => {
      if (sent) return;
      sent = true;
      void api.mainPresent?.().catch(() => {});
    };
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(reveal); });
    // Hidden WebView2 may pause RAF. React has already committed the content.
    const deadline = window.setTimeout(reveal, 48);
    return () => { sent = true; cancelAnimationFrame(first); cancelAnimationFrame(second); window.clearTimeout(deadline); };
  }, []);
  return null;
}

function App() {
  const [state, setState] = useState<Snapshot>();
  const [toast, setToast] = useState<Toast | null>();
  const [error, setError] = useState('');
  const [remembered, setRemembered] = useState<MainView>();
  const [viewReady, setViewReady] = useState(surface !== 'main' || !api.mainView);
  useEffect(() => {
    let active = true;
    if (surface === "toast") {
      void api.toast().then(value => { if (active) setToast(value); }).catch(() => {});
      return () => { active = false; };
    }
    let received = false;
    const remove = api.onSnapshot(value => {
      if (!active) return;
      received = true;
      setState(value);
      setError('');
    });
    void api.snapshot().then(value => { if (active && !received) setState(value); }).catch(() => {
      if (active && !received) setError('暂时无法连接应用主进程。可等待恢复，或从托盘退出后重试。');
    });
    if (surface === 'main' && api.mainView) {
      void api.mainView().then(view => { if (active) setRemembered(view); })
        .catch(() => {}).finally(() => { if (active) setViewReady(true); });
    }

    return () => { active = false; remove(); };
  }, []);
  useEffect(() => {
    if (surface !== 'toast' || !toast || !api.toastPresent) return;
    let active = true;
    let shown = false;
    const reveal = () => {
      if (!active || shown) return;
      shown = true;
      void api.toastPresent?.().catch(() => {});
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(reveal));
    // Hidden WebViews may suspend animation frames. React has already committed the card.
    const deadline = window.setTimeout(reveal, 110);
    return () => { active = false; cancelAnimationFrame(frame); window.clearTimeout(deadline); };
  }, [toast]);
  const trayReady = surface === 'tray' && (!!state || !!error);
  useEffect(() => {
    if (!trayReady || !api.trayPresent) return;
    // A hidden WebView can throttle animation frames; let the committed panel paint.
    const timer = window.setTimeout(() => { void api.trayPresent?.().catch(() => {}); }, 35);
    return () => window.clearTimeout(timer);
  }, [trayReady]);
  if (surface === 'toast') return toast ? <ToastPanel toast={toast} /> : null;
  if (!state || !viewReady) return <main className={startup.shell}>
    {error && <MainFirstFrame />}
    <div className={startup.brand}><Brand /></div>
    <div className={startup.waiting} role={error ? 'alert' : 'status'}>
      <p>{error || '正在连接应用主进程…'}</p>
      {!error && <i aria-hidden="true" />}
    </div>
  </main>;
  return surface === 'tray' ? <QuickPanel state={state} /> : <Suspense fallback={<main className={startup.shell}><div className={startup.brand}><Brand /></div></main>}><Dashboard state={state} remembered={remembered} /><MainFirstFrame /></Suspense>;
}

createRoot(document.getElementById('root')!).render(<App />);
