export type StageSample = { x: number; at: number };

export function stageTravel(dx: number, width: number) {
  const edge = Math.max(100, width * .30);
  const excess = Math.max(0, Math.abs(dx) - edge);
  return Math.sign(dx) * (Math.min(edge, Math.abs(dx)) + 52 * excess / (52 + excess));
}

export function stageVelocity(samples: StageSample[]) {
  const end = samples.at(-1);
  const start = end && samples.find(point => end.at - point.at <= 100 && end.at - point.at >= 10);
  return end && start ? (end.x - start.x) / (end.at - start.at) * 1000 : 0;
}

export function stageLanding(dx: number, width: number, velocity: number) {
  const direction = Math.sign(dx);
  if (!direction) return 0;
  const threshold = Math.max(44, Math.min(88, width * .16));
  // Release momentum can complete a short flick, but must never reverse its side.
  const boost = Math.max(0, Math.min(width * .22, direction * velocity * .15));
  return Math.abs(dx) + boost >= threshold ? (direction < 0 ? 1 : -1) : 0;
}

export function stageReleaseLead(velocity: number, direction: 1 | -1) {
  return -direction * Math.max(0, Math.min(34, -direction * velocity * .024));
}

export function canReuseStageEntry(x: number, direction: 1 | -1) {
  return x * direction > 0;
}

export type StagePose = { transform: string; opacity: number };
export const stageRest: StagePose = { transform: 'none', opacity: 1 };
export const shifted = (pose: StagePose, x: number): StagePose => ({
  opacity: pose.opacity,
  transform: x ? `translateX(${x}px)${pose.transform === 'none' ? '' : ' ' + pose.transform}` : pose.transform,
});

export function stagePose(node: HTMLElement): StagePose {
  const style = getComputedStyle(node);
  return { transform: style.transform, opacity: Number(style.opacity) };
}

export function paintStage(node: HTMLElement, pose: StagePose) {
  node.style.transform = pose.transform;
  node.style.opacity = String(pose.opacity);
}
