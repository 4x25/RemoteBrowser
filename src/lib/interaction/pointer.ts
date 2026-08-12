import type { Point } from './coordinates'

export const DEFAULT_DRAG_THRESHOLD_PX = 5
export const DEFAULT_DOUBLE_CLICK_DELAY_MS = 250

export interface PointerSample extends Point {
  time: number
  button?: number
}
export function squaredDistance(start: Point, end: Point): number {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  return deltaX * deltaX + deltaY * deltaY
}

export function hasExceededDragThreshold(
  start: Point,
  current: Point,
  threshold = DEFAULT_DRAG_THRESHOLD_PX,
): boolean {
  if (threshold < 0 || !Number.isFinite(threshold)) return false
  return squaredDistance(start, current) >= threshold * threshold
}

export function classifyPointerGesture(
  start: Point,
  end: Point,
  threshold = DEFAULT_DRAG_THRESHOLD_PX,
): 'click' | 'drag' {
  return hasExceededDragThreshold(start, end, threshold) ? 'drag' : 'click'
}

export function isDoubleClickCandidate(
  previous: PointerSample | null,
  current: PointerSample,
  maxDelayMs = DEFAULT_DOUBLE_CLICK_DELAY_MS,
  maxDistancePx = DEFAULT_DRAG_THRESHOLD_PX,
): boolean {
  if (!previous || current.time < previous.time) return false
  if ((previous.button ?? 0) !== (current.button ?? 0)) return false
  if (current.time - previous.time > maxDelayMs) return false
  return squaredDistance(previous, current) <= maxDistancePx * maxDistancePx
}
