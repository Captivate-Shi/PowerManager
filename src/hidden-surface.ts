/** Keep recently hidden windows warm, but release their renderer after genuine idle. */
export class HiddenSurface {
  private hidden = false;
  private switching = false;
  private held = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly delay: number, private readonly canRetire: (switching: boolean) => boolean,
    private readonly retire: () => void) {}

  hide() {
    this.hidden = true;
    this.schedule();
  }

  /** An explicit surface switch may release sooner, but still waits for its IPC. */
  switchAway() {
    if (this.switching) { this.schedule(); return; }
    this.hidden = this.switching = true;
    this.cancel();
    this.schedule();
  }

  shown() {
    this.hidden = this.switching = false;
    this.cancel();
  }

  hold() {
    this.held++;
    this.cancel();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held--;
      // Defer even a requested switch to a timer so this IPC handler can resolve first.
      this.schedule();
    };
  }

  private cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule() {
    if (!this.hidden || this.held || this.timer) return;
    const timer = setTimeout(() => {
      if (this.timer !== timer) return;
      this.timer = undefined;
      if (!this.hidden || this.held || !this.canRetire(this.switching)) return;
      this.hidden = this.switching = false;
      this.retire();
    }, this.switching ? 0 : this.delay);
    this.timer = timer;
    timer.unref();
  }
}
