import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import type { Snapshot, Toast } from './model';
import { api } from './ui';
import { Dashboard } from './dashboard';
import { QuickPanel, ToastPanel } from './surfaces';
import s from './panel.module.css';

const surface = new URLSearchParams(location.search).get('surface') ?? 'main';
document.body.dataset.surface = surface;

function App() {
  const [state, setState] = useState<Snapshot>();
  const [toast, setToast] = useState<Toast | null>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let received = false;
    const remove = api.onSnapshot(value => { received = true; setState(value); });
    void api.snapshot().then(value => { if (active && !received) setState(value); }).catch(() => setError('无法连接应用主进程，请从托盘退出后重试。'));
    if (surface === 'toast') void api.toast().then(value => { if (active) setToast(value); });
    return () => { active = false; remove(); };
  }, []);
  if (error) return <div className={s.loading} role="alert">{error}</div>;
  if (surface === 'toast') return toast ? <ToastPanel toast={toast} /> : null;
  if (!state) return <div className={s.loading}>正在载入外设电量管理器…</div>;
  return surface === 'tray' ? <QuickPanel state={state} /> : <Dashboard state={state} />;
}

createRoot(document.getElementById('root')!).render(<App />);
