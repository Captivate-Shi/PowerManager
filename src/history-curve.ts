export type CurvePoint = readonly [x: number, y: number];
const commandPoint = ([x, y]: CurvePoint) => x.toFixed(2) + ',' + y.toFixed(2);

function curveTangents(points: CurvePoint[]) {
  const rates = points.slice(1).map(([x, y], i) => (y - points[i][1]) / (x - points[i][0]));
  return (index: number) => {
    const prior = rates[index - 1] ?? rates[index] ?? 0;
    const next = rates[index] ?? prior;
    return prior * next > 0 ? Math.sign(prior) * Math.min(Math.abs(prior), Math.abs(next)) : 0;
  };
}

// Exact observations stay on the trace. Shared tangents smooth adjacent
// spans, while bounded control points prevent invented extrema or overshoot.
export function exactCurve(points: CurvePoint[]): string {
  if (!points.length) return '';
  const tangent = curveTangents(points);
  let path = 'M' + commandPoint(points[0]);
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i - 1];
    const end = points[i];
    const dx = (end[0] - x) / 3;
    path += 'C' + commandPoint([x + dx, y + dx * tangent(i - 1)]) + ' ' +
      commandPoint([end[0] - dx, end[1] - dx * tangent(i)]) + ' ' + commandPoint(end);
  }
  return path;
}

// Reduce one-percentage-point display quantization within each already separated run.
// The raw observations remain available to inspection, summary and event logic.
export function reduceCurve(points: CurvePoint[], tolerance: number, required: ReadonlySet<number>): CurvePoint[] {
  if (points.length < 3) return points;
  let low = 0;
  let high = 0;
  points.forEach((point, i) => {
    if (point[1] < points[low][1]) low = i;
    if (point[1] > points[high][1]) high = i;
  });
  const keep = new Set([0, low, high, points.length - 1]);
  points.forEach((point, i) => { if (required.has(point[0])) keep.add(i); });
  const indices = [...keep].sort((a, b) => a - b);
  const pending = indices.slice(1).map((last, i) => [indices[i], last]);
  while (pending.length) {
    const [first, last] = pending.pop()!;
    const [x, y] = points[first];
    const [endX, endY] = points[last];
    let missing = -1;
    let largest = tolerance;
    for (let i = first + 1; i < last; i++) {
      const [at, sampled] = points[i];
      const error = Math.abs(sampled - (y + (endY - y) * (at - x) / (endX - x)));
      if (error > largest) {
        missing = i;
        largest = error;
      }
    }
    if (missing !== -1) {
      keep.add(missing);
      pending.push([first, missing], [missing, last]);
    }
  }
  // A straight-line fitting pass is insufficient by itself: smoothing a
  // long slope into an extremum can bow away from the raw samples.
  // Refine against the actual cubic; its equally spaced X controls make
  // the parameter proportional to wall time within each span.
  for (let pass = 0; pass < 12; pass++) {
    const chosen = [...keep].sort((a, b) => a - b);
    const knots = chosen.map(i => points[i]);
    const tangent = curveTangents(knots);
    let changed = false;
    for (let j = 0; j < chosen.length - 1; j++) {
      const [x, y] = knots[j];
      const [endX, endY] = knots[j + 1];
      const width = endX - x;
      const a = y + width / 3 * tangent(j);
      const b = endY - width / 3 * tangent(j + 1);
      let largest = tolerance;
      let missing = -1;
      for (let i = chosen[j] + 1; i < chosen[j + 1]; i++) {
        const [at, sampled] = points[i];
        const t = (at - x) / width;
        const u = 1 - t;
        const fitted = u ** 3 * y + 3 * u ** 2 * t * a + 3 * u * t ** 2 * b + t ** 3 * endY;
        const error = Math.abs(sampled - fitted);
        if (error > largest) {
          missing = i;
          largest = error;
        }
      }
      if (missing !== -1) {
        keep.add(missing);
        changed = true;
      }
    }
    if (!changed) return knots;
  }
  return points;
}
