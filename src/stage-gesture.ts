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
  const projected = dx + Math.max(-width * .22, Math.min(width * .22, velocity * .15));
  const threshold = Math.max(44, Math.min(88, width * .16));
  return Math.abs(projected) >= threshold ? (projected < 0 ? 1 : -1) : 0;
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
