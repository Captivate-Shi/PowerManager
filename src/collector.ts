import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export class Collector {
  private child?: ChildProcessWithoutNullStreams;
  private next = 0;
  private pending = new Map<number, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private handshake?: Promise<unknown>;
  doubleClickMs = 500;
  get pid() { return this.child?.pid; }
  get pendingCount() { return this.pending.size; }

  constructor(private executable: string, private ended: (occupied: boolean, detail?: string) => void) {}

  async start() {
    if (this.handshake) return this.handshake;
    const child = spawn(this.executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', line => {
      if (this.child !== child) return;
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
      this.ended(code === 73, failure);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(code === 73 ? '旧版 PowerManager 正在使用采集设备' : '电量采集程序已断开'));
      }
      this.pending.clear();
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
    await this.start();
    return this.send<T>(action, fields);
  }

  private send<T>(action: string, fields: Record<string, unknown> = {}): Promise<T> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('电量采集程序未启动'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('电量查询超时，正在重新连接'));
        child.kill();
      }, 30_000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      child.stdin.write(JSON.stringify({ id, action, ...fields }) + '\n');
    });
  }

  close() {
    this.child?.stdin.end();
    this.child?.kill();
  }
}
