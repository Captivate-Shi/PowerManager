const fs = require('node:fs');
const path = require('node:path');

const mib = 1024 * 1024;
const round = (value) => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const peak = (values) => values.length ? Math.max(...values) : null;
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
};
function readSamples(file) {
  return [file + '.1', file].flatMap(name => {
    if (!fs.existsSync(name)) return [];
    return fs.readFileSync(name, 'utf8').split(/\r?\n/).flatMap(line => {
      try {
        const sample = JSON.parse(line);
        return sample.version === 1 && sample.session && Number.isFinite(sample.monotonicMs) ? [sample] : [];
      } catch { return []; } // The last record can be partial when inspecting a running app.
    });
  });
}

function segment(samples) {
  const idle = [];
  let cpuSeconds = 0;
  let capacitySeconds = 0;
  let nativePairs = 0;
  const onlyBackground = sample => !sample.surfaces.main && !sample.surfaces.tray && !sample.surfaces.toast;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!onlyBackground(previous) || !onlyBackground(current)) continue;
    const elapsed = (current.monotonicMs - previous.monotonicMs) / 1000;
    if (elapsed <= 0) continue;
    const previousProcesses = new Map(previous.electron.map(item => [item.pid + ':' + item.created, item]));
    let delta = 0;
    for (const item of current.electron) {
      const before = previousProcesses.get(item.pid + ':' + item.created)?.cpuSeconds;
      if (Number.isFinite(before) && Number.isFinite(item.cpuSeconds) && item.cpuSeconds >= before) delta += item.cpuSeconds - before;
    }
    if (previous.native && current.native && previous.native.pid === current.native.pid &&
        Number.isFinite(previous.native.cpuSeconds) && Number.isFinite(current.native.cpuSeconds) &&
        current.native.cpuSeconds >= previous.native.cpuSeconds) {
      nativePairs++;
      delta += current.native.cpuSeconds - previous.native.cpuSeconds;
    }
    capacitySeconds += elapsed * current.cores;
    cpuSeconds += delta;
    idle.push(delta * 100 / (elapsed * current.cores));
  }
  return { intervals: idle.length, nativePairs, averagePercent: capacitySeconds ? round(cpuSeconds * 100 / capacitySeconds) : null,
    peakPercent: round(peak(idle)) };
}
function series(values, scale = 1) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return { count: 0, peak: null, drift: null };
  const width = Math.min(3, Math.floor(valid.length / 2));
  return { count: valid.length, peak: round(peak(valid) / scale), drift: width ?
    round((median(valid.slice(-width)) - median(valid.slice(0, width))) / scale) : null };
}
function summary(all) {
  const session = all.at(-1)?.session;
  const samples = all.filter(item => item.session === session).sort((a, b) => a.monotonicMs - b.monotonicMs);
  if (!samples.length) throw new Error('No performance samples found');
  const first = samples[0];
  const last = samples.at(-1);
  const idle = samples.filter(item => !item.surfaces.main && !item.surfaces.tray && !item.surfaces.toast);
  const steady = (idle.length ? idle : samples).slice(2);
  const duration = (last.monotonicMs - first.monotonicMs) / 1000;
  const backgroundCpu = segment(samples);
  const pollCount = last.counters.polls - first.counters.polls;
  return {
    session, start: first.time, end: last.time, sampleCount: samples.length, durationSeconds: duration,
    backgroundCpu, steadySamples: steady.length,
    electronPrivateMiB: series(steady.map(item => {
      if (!item.electron.length || item.electron.some(process => !Number.isFinite(process.privateBytes))) return null;
      return item.electron.reduce((sum, process) => sum + process.privateBytes, 0);
    }), mib),
    mainHeapMiB: series(steady.map(item => item.heapUsedBytes), mib),
    nativePrivateMiB: series(steady.map(item => item.native?.privateBytes), mib),
    nativeHandles: series(steady.map(item => item.native?.handles)),
    eventLoopAverageActivePercent: round(mean(samples.map(item => item.eventLoopActivePercent))),
    localCollectPeakMs: round(peak(samples.map(item => item.localCollectMs))),
    logWritePeakMs: round(peak(samples.map(item => item.previousLogWriteMs))),
    pollCount, failedPolls: last.counters.failedPolls - first.counters.failedPolls,
    collectorExits: last.counters.childExits - first.counters.childExits,
    meanPollMs: pollCount > 0 ? round((last.counters.pollMs - first.counters.pollMs) / pollCount) : null,
    maxPollMsSinceLaunch: round(last.counters.maxPollMs), pendingPeak: peak(samples.map(item => item.pending)),
    historyPointGrowth: last.historyPoints - first.historyPoints,
  };
}
if (require.main === module) {
  try {
    const folder = process.env.LOCALAPPDATA || process.cwd();
    const file = process.argv[2] || path.join(folder, 'PowerManager-H5', 'metrics.jsonl');
    console.log(JSON.stringify(summary(readSamples(file)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { summary, readSamples };
