import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { MainView, Snapshot, Toast } from './model';
import { api, Brand } from './ui';
import { Dashboard } from './dashboard';
import { QuickPanel, ToastPanel } from './surfaces';
import startup from './startup.module.css';

const surface = new URLSearchParams(location.search).get('surface') ?? 'main';
document.body.dataset.surface = surface;

function App() {
  const [state, setState] = useState<Snapshot>();
  const [toast, setToast] = useState<Toast | null>();
  const [error, setError] = useState('');
  const [remembered, setRemembered] = useState<MainView>();
  const [viewReady, setViewReady] = useState(surface !== 'main' || !api.mainView);
  useEffect(() => {
    let active = true;
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
    if (surface === 'toast') void api.toast().then(value => { if (active) setToast(value); });
    return () => { active = false; remove(); };
  }, []);
  if (surface === 'toast') return toast ? <ToastPanel toast={toast} /> : null;
  if (!state || !viewReady) return <main className={startup.shell}>
    <div className={startup.brand}><Brand /></div>
    <div className={startup.waiting} role={error ? 'alert' : 'status'}>
      <p>{error || '正在连接应用主进程…'}</p>
      {!error && <i aria-hidden="true" />}
    </div>
  </main>;
  return surface === 'tray' ? <QuickPanel state={state} /> : <Dashboard state={state} remembered={remembered} />;
}

createRoot(document.getElementById('root')!).render(<App />);
