import type { HistoryRange } from './model';
import { historyBucketLimit, historyPointLimit } from './history-plot';

// Published as a high-activity estimate per device, not a cap on the full
// monitor.json file. Budget includes each serialized record and its separator.
const pointBytes = 116;
const bucketBytes = 190;
export function historyStorageBudget(range: HistoryRange) {
  return historyPointLimit * pointBytes + historyBucketLimit[range] * bucketBytes;
}
export function historyStorageEstimate(range: HistoryRange) {
  const rounded = Math.ceil(historyStorageBudget(range) / 1000);
  return '预计 ≤ ' + rounded.toLocaleString('zh-CN') + ' KB/台';
}
