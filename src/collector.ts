import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export class Collector {
  private child?: ChildProcessWithoutNullStreams;
  private next = 0;
  private pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private handshake?: Promise<unknown>;
  private closing = false;
  private recycling?: Promise<void>;
  private expectedExit?: ChildProcessWithoutNullStreams;
  doubleClickMs = 500;
  get pid() { return this.child?.pid; }
  get pendingCount() { return this.pending.size; }

  constructor(private executable: string, private ended: (occupied: boolean, detail?: string) => void) {}

  async start() {
    if (this.recycling) await this.recycling;
    if (this.closing) throw new Error('电量采集程序正在关闭');
    if (this.handshake) return this.handshake;
    const child = spawn(this.executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      if (this.child !== child || this.expectedExit === child) return;
      try {
        const reply = JSON.parse(line);
        const request = this.pending.get(reply.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(reply.id);
        if (reply.error) request.reject(new Error(reply.error));
        else request.resolve(reply.result);
      } catch {
        child.kill();
      }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    let failure: string | undefined;
    child.once('error', error => { failure = error.message; });
    child.once('close', code => {
      lines.close();
      if (this.child !== child) return;
      this.child = undefined;
      this.handshake = undefined;
      const expected = this.expectedExit === child;
      if (expected) this.expectedExit = undefined;
      else this.ended(code === 73, failure);
      this.rejectPending(code === 73 ? '旧版 PowerManager 正在使用采集设备' : '电量采集程序已断开');
    });
    this.handshake = this.send<{ protocol: number; doubleClickMs?: number }>('hello').then(({ protocol, doubleClickMs }) => {
      if (typeof doubleClickMs === 'number') this.doubleClickMs = doubleClickMs;
      if (protocol !== 1) {
        child.kill();
        throw new Error('采集程序协议不匹配');
      }
    });
    return this.handshake;
  }

  async request<T>(action: string, fields: Record<string, unknown> = {}): Promise<T> {
    if (this.closing) throw new Error('电量采集程序正在关闭');
    await this.start();
    if (this.closing) throw new Error('电量采集程序正在关闭');
    return this.send<T>(action, fields);
  }

  private send<T>(action: string, fields: Record<string, unknown> = {}): Promise<T> {
    const child = this.child;
    if (!child || this.expectedExit === child) return Promise.reject(new Error('电量采集程序未启动'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('电量查询超时，正在重新连接'));
        void this.restart();
      }, action === 'poll' ? 60_000 : 30_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      child.stdin.write(JSON.stringify({ id, action, ...fields }) + '\n');
    });
  }

  restart(): Promise<void> {
    // Native drivers do not all honor CancelIoEx promptly. Recycle the
    // isolated process and wait for its close before opening any endpoint again.
    if (this.recycling) return this.recycling;
    const child = this.child;
    if (!child || this.closing) return Promise.resolve();
    this.expectedExit = child;
    const stopped = new Promise<void>(resolve => { child.once('close', () => resolve()); });
    this.recycling = stopped.finally(() => { this.recycling = undefined; });
    this.rejectPending('电量采集程序已断开');
    child.kill();
    return this.recycling;
  }

  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  close() {
    this.child?.stdin.end();
    this.child?.kill();
  }

  closeGracefully(timeoutMs = 10_000): Promise<boolean> {
    this.closing = true;
    const child = this.child;
    if (!child) return Promise.resolve(true);
    return new Promise(resolve => {
      const finish = (closed: boolean) => {
        clearTimeout(timeout);
        child.removeListener('close', onClose);
        resolve(closed);
      };
      const onClose = () => finish(true);
      const timeout = setTimeout(() => finish(false), timeoutMs);
      child.once('close', onClose);
      child.stdin.end();
    });
  }

  allowRestartAfterClose() {
    const child = this.child;
    if (child) child.once('close', () => { this.closing = false; });
    else this.closing = false;
  }
}
