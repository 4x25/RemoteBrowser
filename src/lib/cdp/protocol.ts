import type { NavigationEntry, ViewportMetrics } from '../browseros/types'

export interface CdpRawMessage {
  id?: unknown
  method?: unknown
  params?: unknown
  sessionId?: unknown
  result?: unknown
  error?: unknown
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function booleanOr(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function targetInfosFrom(result: unknown): Record<string, unknown>[] {
  if (!isRecordValue(result)) return []
  const infos = result.targetInfos
  if (!Array.isArray(infos)) return []
  return infos.filter(isRecordValue)
}

/**
 * Maps Page.getLayoutMetrics output to the shared viewport shape. Prefers the
 * CSS coordinates (`cssVisualViewport`/`cssContentSize`) the same way the
 * BrowserOS bridge does.
 */
export function parseViewportMetrics(raw: unknown): ViewportMetrics | null {
  if (!isRecordValue(raw)) return null
  const viewport = isRecordValue(raw.cssVisualViewport)
    ? raw.cssVisualViewport
    : isRecordValue(raw.visualViewport)
      ? raw.visualViewport
      : null
  if (!viewport) return null

  const width = numberOr(viewport.clientWidth, 0)
  const height = numberOr(viewport.clientHeight, 0)
  if (width <= 0 || height <= 0) return null
  const content = isRecordValue(raw.cssContentSize)
    ? raw.cssContentSize
    : isRecordValue(raw.contentSize)
      ? raw.contentSize
      : null

  return {
    width,
    height,
    pageX: numberOr(viewport.pageX, 0),
    pageY: numberOr(viewport.pageY, 0),
    offsetX: numberOr(viewport.offsetX, 0),
    offsetY: numberOr(viewport.offsetY, 0),
    scale: numberOr(viewport.scale, 1),
    zoom: numberOr(viewport.zoom, 1),
    contentWidth: numberOr(content?.width, width),
    contentHeight: numberOr(content?.height, height),
  }
}

export function parseNavigationHistory(raw: unknown): {
  currentIndex: number
  entries: NavigationEntry[]
} {
  if (!isRecordValue(raw)) return { currentIndex: -1, entries: [] }
  const rawEntries = Array.isArray(raw.entries) ? raw.entries : []
  const entries: NavigationEntry[] = []

  for (const rawEntry of rawEntries) {
    if (!isRecordValue(rawEntry)) continue
    const id = optionalNumber(rawEntry.id)
    const url = optionalString(rawEntry.url)
    if (id === undefined || url === undefined) continue
    entries.push({
      id,
      url,
      userTypedUrl: stringOr(rawEntry.userTypedURL, url),
      title: stringOr(rawEntry.title),
      transitionType: optionalString(rawEntry.transitionType),
    })
  }

  const candidate = optionalNumber(raw.currentIndex)
  const currentIndex = candidate === undefined ? -1 : Math.trunc(candidate)
  return { currentIndex, entries }
}
