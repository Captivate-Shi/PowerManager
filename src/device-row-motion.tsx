import { Component, createRef, type ReactNode } from 'react';

type Props = { ids: readonly string[]; scope: string; children: ReactNode };
type Positions = Map<string, number>;

export class DeviceRowMotion extends Component<Props, object, Positions | null> {
  private body = createRef<HTMLTableSectionElement>();
  private preference?: MediaQueryList;
  private motions = new Map<HTMLTableRowElement, Animation>();

  private rows() { return Array.from(this.body.current?.rows ?? []); }

  private stop() {
    for (const animation of this.motions.values()) animation.cancel();
    this.motions.clear();
  }

  // Capture the actual on-screen positions just before React moves the rows,
  // including any unfinished glide. A telemetry-only update has no layout work.
  getSnapshotBeforeUpdate(previous: Props): Positions | null {
    const { ids, scope } = this.props;
    if (scope !== previous.scope || this.preference?.matches) {
      this.stop();
      return null;
    }
    if (ids.length === previous.ids.length && ids.every((id, i) => id === previous.ids[i])) return null;
    return new Map(this.rows().map(row => [row.dataset.deviceRow!, row.getBoundingClientRect().top]));
  }

  componentDidUpdate(_previous: Props, _state: object, before: Positions | null) {
    if (!before) return;
    this.stop();
    // Read all final positions before starting the first animation.
    const moving = this.rows().flatMap(row => {
      const top = before.get(row.dataset.deviceRow!);
      if (top === undefined) return [];
      const delta = top - row.getBoundingClientRect().top;
      return Math.abs(delta) > 1 ? [{ row, delta }] : [];
    });
    moving.forEach(({ row, delta }, i) => {
      const animation = row.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration: Math.min(295, 220 + Math.abs(delta) * .14), delay: Math.min(24, i * 6),
          easing: 'cubic-bezier(.22,.82,.28,1)', fill: 'backwards' },
      );
      this.motions.set(row, animation);
      const forget = () => { if (this.motions.get(row) === animation) this.motions.delete(row); };
      animation.onfinish = animation.oncancel = forget;
    });
  }

  componentDidMount() {
    this.preference = matchMedia('(prefers-reduced-motion: reduce)');
    this.preference.addEventListener('change', this.stopMotion);
  }
  componentWillUnmount() {
    this.preference?.removeEventListener('change', this.stopMotion);
    this.stop();
  }

  private stopMotion = (event: MediaQueryListEvent) => { if (event.matches) this.stop(); };

  render() { return <tbody ref={this.body}>{this.props.children}</tbody>; }
}
