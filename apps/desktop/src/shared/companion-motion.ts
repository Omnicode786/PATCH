export type DragBand = "slow" | "medium" | "fast";
export type CompanionPoint = Readonly<{ x: number; y: number }>;
export type CompanionSize = Readonly<{ width: number; height: number }>;
export type CompanionBounds = CompanionPoint & CompanionSize;

export const DRAG_CLICK_THRESHOLD = 7;
export const MAX_RELEASE_SPEED = 420;
export const MAX_SETTLE_DISTANCE = 12;

export function classifyDragSpeed(speed: number): DragBand {
  if (!Number.isFinite(speed) || speed < 250) return "slow";
  if (speed < 650) return "medium";
  return "fast";
}

export function clampCompanionPosition(point: CompanionPoint, workArea: CompanionBounds, size: CompanionSize, margin = 6): CompanionPoint {
  const minX = workArea.x + margin;
  const minY = workArea.y + margin;
  const maxX = Math.max(minX, workArea.x + workArea.width - size.width - margin);
  const maxY = Math.max(minY, workArea.y + workArea.height - size.height - margin);
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, point.x))),
    y: Math.round(Math.min(maxY, Math.max(minY, point.y)))
  };
}

export function fixedCompanionBounds(point: CompanionPoint, size: CompanionSize): CompanionBounds {
  return { x: Math.round(point.x), y: Math.round(point.y), width: size.width, height: size.height };
}

export function clampReleaseVelocity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MAX_RELEASE_SPEED, Math.min(MAX_RELEASE_SPEED, value));
}

/**
 * PATCH is a desktop companion, not a physics toy. Release momentum is mapped to
 * a single tiny settle displacement; no timer, bounce, ricochet, or growing bounds.
 */
export function releaseSettleOffset(vx: number, vy: number, reducedMotion: boolean): CompanionPoint {
  if (reducedMotion) return { x: 0, y: 0 };
  const x = clampReleaseVelocity(vx);
  const y = clampReleaseVelocity(vy);
  const speed = Math.hypot(x, y);
  if (speed < 80) return { x: 0, y: 0 };
  const distance = Math.min(MAX_SETTLE_DISTANCE, (speed - 80) / 36);
  if (distance <= 0 || speed <= 0) return { x: 0, y: 0 };
  return { x: x / speed * distance, y: y / speed * distance };
}

export function isDragGesture(start: CompanionPoint, current: CompanionPoint, threshold = DRAG_CLICK_THRESHOLD): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
