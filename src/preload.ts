import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, Snapshot } from './model';

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('snapshot'),
  toast: () => ipcRenderer.invoke('toast'),
  command: command => ipcRenderer.invoke('command', command),
  onSnapshot(callback) {
    const listener = (_event: unknown, state: Snapshot) => callback(state);
    ipcRenderer.on('state', listener);
    return () => { ipcRenderer.removeListener('state', listener); };
  },
  onNavigate(callback) {
    const listener = (_event: unknown, id?: string) => callback(id);
    let active = true;
    let received = false;
    const routeEvent = (_event: unknown, id?: string) => { received = true; listener(_event, id); };
    ipcRenderer.on('navigate', routeEvent);
    void ipcRenderer.invoke('initial-route').then((id?: string) => { if (active && !received && id) callback(id); });
    return () => { active = false; ipcRenderer.removeListener('navigate', routeEvent); };
  },
};
contextBridge.exposeInMainWorld('powerManager', api);
