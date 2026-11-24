import { area, curveMonotoneX, curveStepAfter, line } from 'd3-shape';

export type CurvePoint = readonly [x: number, y: number];
export type IntervalPoint = readonly [x: number, upper: number, lower: number];

function removePlateauInterior<T>(points: T[], sameLevel: (a: T, b: T) => boolean) {
  return points.filter((point, index) => index === 0 || index === points.length - 1 ||
    !sameLevel(point, points[index - 1]) || !sameLevel(point, points[index + 1]));
}

const exactLine = line<CurvePoint>().curve(curveMonotoneX);
const band = area<IntervalPoint>().x(point => point[0]).y0(point => point[2]).y1(point => point[1]).curve(curveStepAfter);
const upper = band.lineY1();
const lower = band.lineY0();

export function exactCurve(points: CurvePoint[]) {
  // Equal readings in the middle of a plateau lie on the same horizontal span.
  // Keep both ends of the plateau and every observed change.
  return exactLine(removePlateauInterior(points, (a, b) => a[1] === b[1])) ?? '';
}

export function trendCurve(points: CurvePoint[], onePercent: number) {
  const anchors: CurvePoint[] = [];
  for (let first = 0; first < points.length;) {
    const level = points[first][1];
    let last = first;
    while (points[last + 1]?.[1] === level) last++;
    const before = points[first - 1]?.[1];
    const after = points[last + 1]?.[1];
    // Soften quantization only within uninterrupted monotone one-percent changes.
    const advancing = before !== undefined && after !== undefined &&
      (level - before) * (after - level) > 0 &&
      Math.max(Math.abs(level - before), Math.abs(after - level)) <= onePercent * 1.001;
    if (advancing) anchors.push(points[Math.floor((first + last) / 2)]);
    else {
      anchors.push(points[first]);
      if (last !== first) anchors.push(points[last]);
    }
    first = last + 1;
  }
  return exactLine(anchors) ?? '';
}

export function intervalRibbon(points: IntervalPoint[]) {
  const commands: string[] = [];
  for (let first = 0; first < points.length - 1;) {
    const [left, top, bottom] = points[first];
    let next = first + 1;
    while (next < points.length - 1 && points[next][1] === top && points[next][2] === bottom) next++;
    const right = points[next][0];
    const radius = Math.min(4, (right - left) / 2, (bottom - top) / 2);
    commands.push(`M${left + radius},${top}H${right - radius}Q${right},${top} ${right},${top + radius}` +
      `V${bottom - radius}Q${right},${bottom} ${right - radius},${bottom}` +
      `H${left + radius}Q${left},${bottom} ${left},${bottom - radius}` +
      `V${top + radius}Q${left},${top} ${left + radius},${top}Z`);
    first = next;
  }
  return commands.join('');
}

export function intervalPaths(points: IntervalPoint[]) {
  const edges = removePlateauInterior(points, (a, b) => a[1] === b[1] && a[2] === b[2]);
  return { fill: band(edges) ?? '', upper: upper(edges) ?? '', lower: lower(edges) ?? '' };
}
