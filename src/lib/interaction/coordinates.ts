export interface Point {
  x: number
  y: number
}
export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

export type RemotePoint = Point
export type CoordinateRounding = 'round' | 'floor' | 'ceil'

export interface CoordinateMappingOptions {
  /** Clamp points outside the rendered image to the remote viewport edge. */
  clamp?: boolean
  /** BrowserOS accepts integer coordinates; nearest-integer is the default. */
  rounding?: CoordinateRounding
}

const rounders: Record<CoordinateRounding, (value: number) => number> = {
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
}

const clampValue = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const areFinite = (...values: number[]): boolean => values.every(Number.isFinite)

/**
 * Maps a client-space pointer to BrowserOS viewport coordinates.
 *
 * Returns null for invalid geometry, and (when clamp=false) for points outside
 * the displayed image. The maximum result is width - 1 / height - 1 so a
 * point on the DOMRect's far edge never becomes an invalid remote coordinate.
 */
export function mapClientPointToRemote(
  point: Point,
  imageRect: RectLike,
  remoteViewport: ViewportSize,
  options: CoordinateMappingOptions = {},
): RemotePoint | null {
  const { clamp = true, rounding = 'round' } = options

  if (
    !areFinite(
      point.x,
      point.y,
      imageRect.left,
      imageRect.top,
      imageRect.width,
      imageRect.height,
      remoteViewport.width,
      remoteViewport.height,
    ) ||
    imageRect.width <= 0 ||
    imageRect.height <= 0 ||
    remoteViewport.width <= 0 ||
    remoteViewport.height <= 0
  ) {
    return null
  }

  let normalizedX = (point.x - imageRect.left) / imageRect.width
  let normalizedY = (point.y - imageRect.top) / imageRect.height

  const outside =
    normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1
  if (outside && !clamp) {
    return null
  }

  if (clamp) {
    normalizedX = clampValue(normalizedX, 0, 1)
    normalizedY = clampValue(normalizedY, 0, 1)
  }

  const applyRounding = rounders[rounding]
  const maxX = Math.max(0, Math.floor(remoteViewport.width) - 1)
  const maxY = Math.max(0, Math.floor(remoteViewport.height) - 1)

  return {
    x: clampValue(applyRounding(normalizedX * remoteViewport.width), 0, maxX),
    y: clampValue(applyRounding(normalizedY * remoteViewport.height), 0, maxY),
  }
}
