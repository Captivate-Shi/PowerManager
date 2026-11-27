import { compareLimit } from './history-plot';

type Slots = (string | undefined)[];
const key = 'yudian.history.comparison.v1';

export function parseHistorySlots(value: unknown): Slots | undefined {
  if (!Array.isArray(value)) return;
  const seen = new Set<string>();
  const slots = Array.from({ length: compareLimit }, (_, index) => {
    const id: unknown = value[index];
    if (typeof id !== 'string' || !id.trim() || seen.has(id)) return;
    seen.add(id);
    return id;
  });
  return seen.size ? slots : undefined;
}

export function readHistorySlots(): Slots | undefined {
  try { return parseHistorySlots(JSON.parse(localStorage.getItem(key) ?? 'null')); }
  catch { return undefined; }
}

export function saveHistorySlots(slots: Slots) {
  try { localStorage.setItem(key, JSON.stringify(slots)); }
  catch { /* The current window still keeps the selection. */ }
}

export function historyComparisonSlots(saved: Slots | undefined, defaults: Slots, available: ReadonlySet<string>): Slots {
  const slots = Array.from({ length: compareLimit }, (_, index) => (saved ?? defaults)[index]);
  if (slots.some(id => id && available.has(id))) return slots;
  const fallback = defaults[0];
  if (fallback && available.has(fallback)) slots[Math.max(0, slots.indexOf(undefined))] = fallback;
  return slots;
}

export function updateHistoryComparison(slots: Slots, id: string, available: ReadonlySet<string>): Slots {
  if (!available.has(id)) return slots;
  const existing = slots.indexOf(id);
  if (existing !== -1) {
    return slots.filter(value => value && available.has(value)).length > 1
      ? slots.map((value, index) => index === existing ? undefined : value) : slots;
  }
  const empty = slots.indexOf(undefined);
  const position = empty >= 0 ? empty : slots.findIndex(value => !value || !available.has(value));
  return position >= 0 ? slots.map((value, index) => index === position ? id : value) : slots;
}
