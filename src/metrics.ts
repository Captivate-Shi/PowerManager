import { app } from 'electron';
import { appendFile, rename, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Monitor } from './monitor';

const interval = 60_000;
const logCap = 2 * 1024 * 1024;
const round = (value: number) => Math.round(value * 1000) / 1000;

export function startMetrics(monitor: Monitor, surfaceState: () => Record<string, boolean>) {
  const file = join(monitor.directory, 'metrics.jsonl');
  const configured = Number(process.env.POWER_MANAGER_METRICS_INTERVAL_MS);
  const frequency = Number.isFinite(configured) && configured >= 5000 ? Math.min(configured, interval) : interval;
  const cores = availableParallelism();
  let previousLoop = performance.eventLoopUtilization();
  let lastWriteMs = 0;
  let active = false;
  let stopped = false;
  let warned = false;

  async function sample() {
    if (active || stopped) return;
    active = true;
    try {
      const start = performance.now();
      const metrics = app.getAppMetrics().map(item => ({
        pid: item.pid, type: item.type, created: item.creationTime,
        rssBytes: item.memory.workingSetSize * 1024,
        privateBytes: item.memory.privateBytes == null ? null : item.memory.privateBytes * 1024,
        cpuSeconds: item.cpu.cumulativeCPUUsage ?? null,
      }));
      const heap = process.memoryUsage();
      const currentLoop = performance.eventLoopUtilization();
      const loop = performance.eventLoopUtilization(currentLoop, previousLoop);
      previousLoop = currentLoop;
      const surfaces = surfaceState();
      const ipcStarted = performance.now();
      const resource = await monitor.resourceSample();
      if (stopped) return;
      const log = {
        version: 1, time: new Date().toISOString(), monotonicMs: Math.round(performance.now()),
        session: String(process.pid) + '-' + String(Math.round(performance.timeOrigin)), cores, surfaces,
        electron: metrics, heapUsedBytes: heap.heapUsed, externalBytes: heap.external,
        eventLoopActivePercent: round(loop.utilization * 100), ...resource,
        localCollectMs: round(ipcStarted - start), nativeWaitMs: round(performance.now() - ipcStarted),
        previousLogWriteMs: lastWriteMs,
      };
      const writeStart = performance.now();
      const fileStat = await stat(file).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (fileStat && fileStat.size > logCap) await rename(file, file + '.1');
      await appendFile(file, JSON.stringify(log) + '\n', 'utf8');
      lastWriteMs = round(performance.now() - writeStart);
      warned = false;
    } catch (error) {
      if (!warned) monitor.log('性能日志写入失败 ' + String(error));
      warned = true;
    } finally { active = false; }
  }
  const initial = setTimeout(() => { void sample(); }, 2500);
  const timer = setInterval(() => { void sample(); }, frequency);
  initial.unref();
  timer.unref();
  return () => {
    stopped = true;
    clearTimeout(initial);
    clearInterval(timer);
  };
}
