import { compatibilityJson } from '../../src/compatibility-report';
const { core, event } = window.__TAURI__;
const invoke = (method, data) => core.invoke('desktop', { method, data: data ?? null });
function listen(name, callback, ready) {
  let active = true;
  let unlisten;
  void event.listen(name, ({ payload }) => { if (active) callback(payload ?? undefined); })
    .then(stop => { if (active) { unlisten = stop; ready?.(); } else stop(); })
    .catch(console.error);
  return () => { active = false; unlisten?.(); };
}
window.powerManager = {
  snapshot: () => invoke('snapshot').then(value => {
    if ((new URLSearchParams(location.search).get('surface') ?? 'main') === 'main')
      requestAnimationFrame(() => requestAnimationFrame(() => void invoke('evidence').catch(() => {})));
    return value;
  }),
  toast: () => invoke('toast'),
  onToast: callback => {
    let active = true, received = false;
    // Register before the snapshot so an update during startup cannot be missed.
    const stop = listen('pm-toast', value => { received = true; callback(value ?? null); },
      () => { void invoke('toast').then(value => { if (active && !received) callback(value); }).catch(() => {}); });
    return () => { active = false; stop(); };
  },
  toastPresent: () => invoke('toast-present'),
  trayPresent: () => invoke('tray-present'),
  mainPresent: () => invoke('main-present'),
  windowAction: action => invoke('window-action', action),
  mainView: () => invoke('view').then(value => value ?? undefined),
  rememberMainView: view => invoke('remember', view),
  command: async command => {
    try {
      const value = await invoke('command', command);
      if (command.type === 'compatibility' && command.selection && value.captureToken) {
        const json = compatibilityJson(value.metadata, value.snapshot, new Date(), value.subject);
        return await invoke('command', {type:'compatibility', captureToken:value.captureToken, json});
      }
      return value;
    } catch (error) { return {ok:false,error:String(error)}; }
  },
  onSnapshot: callback => listen('pm-state', callback),
  onNavigate: callback => listen('pm-navigate', callback)
};
