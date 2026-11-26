const { core, event } = window.__TAURI__;
const invoke = (method, data) => core.invoke('desktop', { method, data: data ?? null });
function listen(name, callback) {
  let active = true;
  let unlisten;
  void event.listen(name, ({ payload }) => { if (active) callback(payload ?? undefined); })
    .then(stop => { if (active) unlisten = stop; else stop(); })
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
  mainView: () => invoke('view').then(value => value ?? undefined),
  rememberMainView: view => invoke('remember', view),
  command: command => invoke('command', command).catch(error => ({ ok: false, error: String(error) })),
  onSnapshot: callback => listen('pm-state', callback),
  onNavigate: callback => listen('pm-navigate', callback)
};
