import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HistoryDay, HistoryPoint, Reading } from '../src/model';
import { historyRanges } from '../src/model';
import { historyBucketLimit, historyPointLimit } from '../src/history-plot';
import { historyStorageBudget, historyStorageEstimate } from '../src/history-storage';

test('all retention options budget serialized high-volume samples plus daily summaries', () => {
  const at = 1_795_510_000_000;
  // The native raw field is a signed int. Include the longest state and ID source.
  const reading: Reading = { low: 100, high: 100, raw: -2_147_483_648, power: 'discharging', source: 'windows' };
  const point: HistoryPoint = { time: at, reading };
  const sample = Array.from({ length: historyPointLimit }, () => point);
  const bucket: HistoryDay = { day: at, lowest: { time: at, reading }, lastCharge: at, count: 99_999 };
  let previous = 0;
  for (const range of historyRanges) {
    const bytes = Buffer.byteLength(JSON.stringify({ history: { device: sample },
      historyDays: { device: Array.from({ length: historyBucketLimit[range] }, () => bucket) } }));
    const budget = historyStorageBudget(range);
    assert(bytes <= budget);
    assert(budget > previous);
    assert.match(historyStorageEstimate(range), /^预计 ≤ .+ KB\/台$/);
    previous = budget;
  }
});
