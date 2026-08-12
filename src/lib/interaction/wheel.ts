export type ScrollDirection = 'up' | 'down' | 'left' | 'right'
export type WheelDeltaMode = 0 | 1 | 2

export interface WheelDelta {
  x: number
  y: number
}
export interface WheelEventLike {
  deltaX: number
  deltaY: number
  /** 0=pixels, 1=lines, 2=pages, matching WheelEvent.deltaMode. */
  deltaMode?: number
}

export interface WheelNormalizationOptions {
  pixelsPerLine?: number
  pixelsPerPage?: number
}

export interface ScrollConversionOptions {
  pixelsPerNotch?: number
  maxAmount?: number
  minDelta?: number
}

export interface ScrollAction {
  direction: ScrollDirection
  amount: number
}

export const EMPTY_WHEEL_DELTA: Readonly<WheelDelta> = Object.freeze({
  x: 0,
  y: 0,
})

export function normalizeWheelDelta(
  event: WheelEventLike,
  options: WheelNormalizationOptions = {},
): WheelDelta {
  const { pixelsPerLine = 40, pixelsPerPage = 800 } = options
  const multiplier =
    event.deltaMode === 1 ? pixelsPerLine : event.deltaMode === 2 ? pixelsPerPage : 1

  return {
    x: Number.isFinite(event.deltaX) ? event.deltaX * multiplier : 0,
    y: Number.isFinite(event.deltaY) ? event.deltaY * multiplier : 0,
  }
}

/** Pure accumulation helper for a UI's 50 ms wheel batching window. */
export function accumulateWheelDelta(
  accumulated: WheelDelta,
  event: WheelEventLike,
  options?: WheelNormalizationOptions,
): WheelDelta {
  const next = normalizeWheelDelta(event, options)
  return {
    x: accumulated.x + next.x,
    y: accumulated.y + next.y,
  }
}

export function aggregateWheelDeltas(
  events: readonly WheelEventLike[],
  options?: WheelNormalizationOptions,
): WheelDelta {
  return events.reduce<WheelDelta>(
    (sum, event) => accumulateWheelDelta(sum, event, options),
    { ...EMPTY_WHEEL_DELTA },
  )
}

/** Converts a batch to BrowserOS's dominant-axis direction + wheel notches. */
export function wheelDeltaToScrollAction(
  delta: WheelDelta,
  options: ScrollConversionOptions = {},
): ScrollAction | null {
  const { pixelsPerNotch = 100, maxAmount = 10, minDelta = 1 } = options
  if (
    !Number.isFinite(delta.x) ||
    !Number.isFinite(delta.y) ||
    !Number.isFinite(pixelsPerNotch) ||
    pixelsPerNotch <= 0 ||
    !Number.isFinite(maxAmount) ||
    maxAmount < 1
  ) {
    return null
  }

  const useVertical = Math.abs(delta.y) >= Math.abs(delta.x)
  const dominant = useVertical ? delta.y : delta.x
  if (Math.abs(dominant) < Math.max(0, minDelta)) return null

  const rawAmount = Math.max(1, Math.round(Math.abs(dominant) / pixelsPerNotch))
  const amount = Math.min(Math.floor(maxAmount), rawAmount)
  const direction: ScrollDirection = useVertical
    ? dominant > 0
      ? 'down'
      : 'up'
    : dominant > 0
      ? 'right'
      : 'left'

  return { direction, amount }
}
