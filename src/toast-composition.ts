import type { Toast, ToastDevice } from './model';

export function toastComposition(toast: Toast) {
  const pictures = (toast.devices?.length ? toast.devices : [toast.device]).slice(0, 3);
  const count = Math.max(pictures.length, toast.count ?? 1);
  return { pictures, count, overflow: Math.max(0, count - pictures.length) };
}
const single = [[0, 0, 1]] as const;
const pair = [[-17, -15, .60], [17, 17, .54]] as const;
const trio = [[-21, -19, .51], [22, -14, .48], [0, 20, .82]] as const;
export function toastPhotoPosition(index: number, size: number, art: ToastDevice['art']) {
  const [x, y, scale] = (size === 1 ? single[0] : size === 2 ? pair[index] : trio[index]) ?? single[0];
  // The bottom slot is wider, but non-keyboard assets need spare vertical breathing room.
  return { x, y, scale: size === 3 && index === 2 && art !== 'keyboard' ? .54 : scale };
}
