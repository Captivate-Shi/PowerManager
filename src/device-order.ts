import { isConnected, type Device } from './model';

const names = new Intl.Collator('zh-CN-u-co-pinyin', { sensitivity: 'base', numeric: true });

export function rememberSortConnections(devices: readonly Device[], previous: ReadonlyMap<string, boolean>): ReadonlyMap<string, boolean> {
  const next = new Map<string, boolean>();
  for (const device of devices) {
    // Battery/transport uncertainty does not override a confirmed connection.
    const confirmed = device.status === 'current' ? true : device.status === 'offline' ? false : previous.get(device.id);
    if (confirmed !== undefined) next.set(device.id, confirmed);
  }
  return next.size === previous.size && [...next].every(([id, connected]) => previous.get(id) === connected) ? previous : next;
}

export function compareDevices(a: Device, b: Device, sort: string, connections?: ReadonlyMap<string, boolean>): number {
  const connectedForSort = (device: Device) => connections?.get(device.id) ?? isConnected(device);
  const primary = sort === 'state' ? Number(connectedForSort(b)) - Number(connectedForSort(a)) :
    sort === 'low' ? (a.reading?.low ?? 101) - (b.reading?.low ?? 101) : 0;
  return primary || names.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
