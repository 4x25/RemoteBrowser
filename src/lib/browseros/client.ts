import { McpCallError, validationError } from './errors'
import {
  assertToolResult,
  isRecordValue,
  parseMcpResponse,
  unwrapJsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type McpImageContent,
  type McpToolResult,
} from './protocol'
import { activatePageScript, LIST_TABS_SCRIPT } from './scripts'
import type {
  BrowserOsClientOptions,
  CaptureFrameOptions,
  ClickOptions,
  ConnectionState,
  McpServerInfo,
  NavigateRequest,
  NavigationEntry,
  PageState,
  RemoteFrame,
  RemotePoint,
  RemoteTab,
  RequestOptions,
  ScrollOptions,
  ViewportMetrics,
} from './types'

const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_CAPTURE_WIDTH = 1024
const DEFAULT_CAPTURE_HEIGHT = 768
const MAX_CAPTURE_WIDTH = 1440
const MAX_CAPTURE_HEIGHT = 900
const REQUIRED_TOOLS = ['tabs', 'navigate', 'screenshot', 'act', 'run'] as const

interface InitializeResult {
  protocolVersion?: unknown
  serverInfo?: unknown
}

interface ToolsListResult {
  tools?: unknown
}

interface RunStructuredContent {
  ok?: unknown
  value?: unknown
  error?: unknown
}

interface RawPage {
  pageId?: unknown
  tabId?: unknown
  targetId?: unknown
  windowId?: unknown
  index?: unknown
  url?: unknown
  title?: unknown
  isActive?: unknown
  isLoading?: unknown
  loadProgress?: unknown
  isPinned?: unknown
  isHidden?: unknown
  browserContextId?: unknown
  metrics?: unknown
  history?: unknown
}

interface InternalRequestContext {
  signal: AbortSignal
  timedOut: () => boolean
  cleanup: () => void
}

function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw validationError(`${name} must be a finite number`)
  }
}

function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw validationError(`${name} must be a positive integer`)
  }
}

function assertPoint(point: RemotePoint, name: string): void {
  if (!isRecordValue(point)) throw validationError(`${name} must be a coordinate`)
  assertFiniteNumber(point.x, `${name}.x`)
  assertFiniteNumber(point.y, `${name}.y`)
  if (point.x < 0 || point.y < 0) {
    throw validationError(`${name} coordinates cannot be negative`)
  }
}

function assertTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw validationError('timeoutMs must be an integer between 1 and 120000')
  }
}

function normalizeEndpoint(endpoint: string): string {
  if (typeof endpoint !== 'string' || endpoint.trim() !== endpoint || !endpoint) {
    throw validationError('MCP endpoint must be a non-empty URL without surrounding whitespace')
  }

  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch (cause) {
    throw new McpCallError('MCP endpoint must be an absolute HTTP(S) URL', {
      kind: 'validation',
      cause,
    })
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw validationError('MCP endpoint must use http: or https:')
  }
  if (parsed.username || parsed.password) {
    throw validationError('MCP endpoint must not contain embedded credentials')
  }
  if (parsed.hash) throw validationError('MCP endpoint must not contain a URL fragment')
  return parsed.href
}

function normalizePageUrl(url: string, allowBlank = false): string {
  if (typeof url !== 'string' || url.trim() !== url || !url) {
    throw validationError('URL must be a non-empty string without surrounding whitespace')
  }
  if (allowBlank && url === 'about:blank') return url

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (cause) {
    throw new McpCallError('URL must be an absolute HTTP(S) URL', {
      kind: 'validation',
      cause,
    })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw validationError('URL must use http: or https:')
  }
  if (parsed.username || parsed.password) {
    throw validationError('URL must not contain embedded credentials')
  }
  return parsed.href
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringOr(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function booleanOr(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function parseViewport(rawMetrics: unknown): ViewportMetrics | null {
  if (!isRecordValue(rawMetrics)) return null
  const viewport = isRecordValue(rawMetrics.cssVisualViewport)
    ? rawMetrics.cssVisualViewport
    : null
  if (!viewport) return null

  const width = numberOr(viewport.clientWidth, 0)
  const height = numberOr(viewport.clientHeight, 0)
  if (width <= 0 || height <= 0) return null
  const content = isRecordValue(rawMetrics.cssContentSize)
    ? rawMetrics.cssContentSize
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

function parseHistory(rawHistory: unknown): {
  currentIndex: number
  entries: NavigationEntry[]
} {
  if (!isRecordValue(rawHistory)) return { currentIndex: -1, entries: [] }
  const rawEntries = Array.isArray(rawHistory.entries) ? rawHistory.entries : []
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

  const candidate = optionalNumber(rawHistory.currentIndex)
  const currentIndex = candidate === undefined ? -1 : Math.trunc(candidate)
  return { currentIndex, entries }
}

function parseRemoteTab(raw: unknown): RemoteTab {
  if (!isRecordValue(raw)) {
    throw new McpCallError('BrowserOS returned malformed tab metadata', {
      kind: 'protocol',
      data: raw,
    })
  }
  const page = raw as RawPage
  const pageId = optionalNumber(page.pageId)
  if (pageId === undefined || !Number.isInteger(pageId) || pageId <= 0) {
    throw new McpCallError('BrowserOS tab metadata is missing a valid pageId', {
      kind: 'protocol',
      data: raw,
    })
  }

  const url = stringOr(page.url, 'about:blank')
  const title = stringOr(page.title, url)
  const isActive = booleanOr(page.isActive)
  const isLoading = booleanOr(page.isLoading)
  const loadProgress = numberOr(page.loadProgress, isLoading ? 0 : 1)
  const history = parseHistory(page.history)
  const pageState: PageState = {
    pageId,
    url,
    title,
    isActive,
    isLoading,
    loadProgress,
    viewport: parseViewport(page.metrics),
    historyIndex: history.currentIndex,
    historyLength: history.entries.length,
    history: history.entries,
    canGoBack: history.currentIndex > 0,
    canGoForward:
      history.currentIndex >= 0 && history.currentIndex < history.entries.length - 1,
  }

  return {
    pageId,
    tabId: optionalNumber(page.tabId),
    targetId: optionalString(page.targetId),
    windowId: optionalNumber(page.windowId),
    index: Math.max(0, Math.trunc(numberOr(page.index, 0))),
    url,
    title,
    isActive,
    isLoading,
    loadProgress,
    isPinned: booleanOr(page.isPinned),
    isHidden: booleanOr(page.isHidden),
    browserContextId: optionalString(page.browserContextId),
    pageState,
  }
}

function ensureRunValue(result: McpToolResult, operation: string): unknown {
  const structured = result.structuredContent
  if (isRecordValue(structured)) {
    const runResult = structured as RunStructuredContent
    if (runResult.ok === false) {
      throw new McpCallError(stringOr(runResult.error, `${operation} failed`), {
        kind: 'tool',
        code: 'run',
        data: structured,
      })
    }
    if (runResult.ok === true && Object.prototype.hasOwnProperty.call(runResult, 'value')) {
      return runResult.value
    }
  }

  throw new McpCallError(`${operation} did not return structured BrowserOS data`, {
    kind: 'protocol',
    data: result,
  })
}

function validateCaptureDimension(
  value: number,
  name: string,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw validationError(`${name} must be an integer between 1 and ${maximum}`)
  }
}

function findImage(result: McpToolResult): McpImageContent | undefined {
  if (!Array.isArray(result.content)) return undefined
  return result.content.find(
    (item): item is McpImageContent =>
      isRecordValue(item) &&
      item.type === 'image' &&
      typeof item.data === 'string' &&
      typeof item.mimeType === 'string',
  )
}

export class BrowserOsClient {
  private readonly fetchImpl: typeof fetch
  private readonly defaultTimeoutMs: number
  private readonly protocolVersion: string
  private readonly clientName: string
  private readonly clientVersion: string
  private nextRequestId = 1
  private endpointValue: string | null = null
  private lifecycleController = new AbortController()
  private stateValue: ConnectionState = 'disconnected'
  private serverInfoValue: McpServerInfo | null = null
  private tools = new Set<string>()

  constructor(options: BrowserOsClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.defaultTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
    assertTimeout(this.defaultTimeoutMs)
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION
    this.clientName = options.clientName ?? 'remote-browser-os'
    this.clientVersion = options.clientVersion ?? '0.1.0'
  }

  get state(): ConnectionState {
    return this.stateValue
  }

  get endpoint(): string | null {
    return this.endpointValue
  }

  get serverInfo(): McpServerInfo | null {
    return this.serverInfoValue
  }

  async connect(endpoint: string, options: RequestOptions = {}): Promise<McpServerInfo> {
    const normalizedEndpoint = normalizeEndpoint(endpoint)
    this.lifecycleController.abort()
    this.lifecycleController = new AbortController()
    this.endpointValue = normalizedEndpoint
    this.serverInfoValue = null
    this.tools.clear()
    this.stateValue = 'connecting'
    const connectionLifecycle = this.lifecycleController

    try {
      const initialize = (await this.request(
        'initialize',
        {
          protocolVersion: this.protocolVersion,
          capabilities: {},
          clientInfo: { name: this.clientName, version: this.clientVersion },
        },
        options,
        true,
      )) as InitializeResult

      await this.notify('notifications/initialized', {}, options)

      const listed = (await this.request('tools/list', {}, options, true)) as ToolsListResult
      const listedTools = Array.isArray(listed?.tools) ? listed.tools : []
      for (const item of listedTools) {
        if (isRecordValue(item) && typeof item.name === 'string') this.tools.add(item.name)
      }

      const missing = REQUIRED_TOOLS.filter((name) => !this.tools.has(name))
      if (missing.length > 0) {
        throw new McpCallError(`BrowserOS is missing required tools: ${missing.join(', ')}`, {
          kind: 'connection',
          code: 'MISSING_TOOLS',
          data: { available: [...this.tools], missing },
        })
      }

      if (this.lifecycleController !== connectionLifecycle) {
        throw new McpCallError('BrowserOS connection attempt was superseded', {
          kind: 'aborted',
          code: 'ABORTED',
        })
      }

      const server = isRecordValue(initialize?.serverInfo)
        ? initialize.serverInfo
        : undefined
      this.serverInfoValue = {
        name: optionalString(server?.name),
        version: optionalString(server?.version),
        protocolVersion: optionalString(initialize?.protocolVersion),
      }
      this.stateValue = 'connected'
      return this.serverInfoValue
    } catch (error) {
      if (this.lifecycleController === connectionLifecycle) {
        this.stateValue = 'error'
        this.tools.clear()
      }
      if (error instanceof McpCallError) throw error
      throw new McpCallError('Failed to connect to BrowserOS', {
        kind: 'connection',
        cause: error,
      })
    }
  }

  disconnect(): void {
    this.lifecycleController.abort()
    this.lifecycleController = new AbortController()
    this.endpointValue = null
    this.serverInfoValue = null
    this.tools.clear()
    this.stateValue = 'disconnected'
  }

  async listTabs(options: RequestOptions = {}): Promise<RemoteTab[]> {
    this.assertConnected()
    const result = await this.callTool('run', { code: LIST_TABS_SCRIPT }, options)
    const value = ensureRunValue(result, 'Listing BrowserOS tabs')
    if (!Array.isArray(value)) {
      throw new McpCallError('BrowserOS returned an invalid tab list', {
        kind: 'protocol',
        data: value,
      })
    }
    return value.map(parseRemoteTab).sort((left, right) => {
      const windowDelta = (left.windowId ?? 0) - (right.windowId ?? 0)
      return windowDelta || left.index - right.index
    })
  }

  async getPageState(pageId: number, options: RequestOptions = {}): Promise<PageState> {
    assertPositiveInteger(pageId, 'pageId')
    const tabs = await this.listTabs(options)
    const tab = tabs.find((candidate) => candidate.pageId === pageId)
    if (!tab) {
      throw new McpCallError(`BrowserOS page ${pageId} is not available`, {
        kind: 'tool',
        code: 'PAGE_NOT_FOUND',
      })
    }
    return tab.pageState
  }

  async createTab(url = 'about:blank', options: RequestOptions = {}): Promise<void> {
    this.assertConnected()
    const normalizedUrl = normalizePageUrl(url, true)
    await this.callTool('tabs', { action: 'new', url: normalizedUrl }, options)
  }

  async closeTab(pageId: number, options: RequestOptions = {}): Promise<void> {
    this.assertPage(pageId)
    await this.callTool('tabs', { action: 'close', page: pageId }, options)
  }

  async activateTab(pageId: number, options: RequestOptions = {}): Promise<void> {
    this.assertPage(pageId)
    const result = await this.callTool(
      'run',
      { code: activatePageScript(pageId) },
      options,
    )
    ensureRunValue(result, `Activating BrowserOS page ${pageId}`)
  }

  async navigate(
    pageId: number,
    request: NavigateRequest,
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    if (!isRecordValue(request)) throw validationError('navigate request is required')
    if (!['url', 'back', 'forward', 'reload'].includes(request.action)) {
      throw validationError('navigate action must be url, back, forward, or reload')
    }

    if (request.action === 'url') {
      if (typeof request.url !== 'string') {
        throw validationError('navigate url action requires a URL')
      }
      const url = normalizePageUrl(request.url)
      await this.callTool(
        'navigate',
        { action: 'url', page: pageId, url },
        options,
      )
      return
    }

    if (request.url !== undefined) {
      throw validationError('navigate URL is only valid for the url action')
    }
    await this.callTool('navigate', { action: request.action, page: pageId }, options)
  }

  async captureFrame(
    pageId: number,
    options: CaptureFrameOptions = {},
  ): Promise<RemoteFrame> {
    this.assertPage(pageId)
    const width = options.width ?? DEFAULT_CAPTURE_WIDTH
    const height = options.height ?? DEFAULT_CAPTURE_HEIGHT
    const format = options.format ?? 'webp'
    const quality = options.quality ?? (format === 'webp' ? 70 : 75)
    validateCaptureDimension(width, 'width', MAX_CAPTURE_WIDTH)
    validateCaptureDimension(height, 'height', MAX_CAPTURE_HEIGHT)
    if (format !== 'webp' && format !== 'jpeg') {
      throw validationError('format must be webp or jpeg')
    }
    if (!Number.isInteger(quality) || quality < 0 || quality > 100) {
      throw validationError('quality must be an integer between 0 and 100')
    }

    const result = await this.callTool(
      'screenshot',
      {
        page: pageId,
        format,
        quality,
        fullPage: false,
        annotate: false,
        size: { width, height },
      },
      options,
    )
    const image = findImage(result)
    const expectedMimeType = format === 'webp' ? 'image/webp' : 'image/jpeg'
    if (!image || image.data.length === 0) {
      throw new McpCallError('BrowserOS screenshot did not contain image data', {
        kind: 'protocol',
        data: result,
      })
    }
    if (image.mimeType !== expectedMimeType) {
      throw new McpCallError(
        `BrowserOS returned ${image.mimeType || 'an unknown image type'} instead of ${expectedMimeType}`,
        { kind: 'protocol', data: result },
      )
    }

    return {
      pageId,
      data: image.data,
      mimeType: expectedMimeType,
      format,
      width,
      height,
      capturedAt: Date.now(),
    }
  }

  async click(
    pageId: number,
    point: RemotePoint,
    options: ClickOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    assertPoint(point, 'point')
    const button = options.button ?? 'left'
    const clickCount = options.clickCount ?? 1
    if (!['left', 'middle', 'right'].includes(button)) {
      throw validationError('button must be left, middle, or right')
    }
    if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > 3) {
      throw validationError('clickCount must be an integer between 1 and 3')
    }
    await this.callTool(
      'act',
      {
        kind: 'click_at',
        page: pageId,
        x: point.x,
        y: point.y,
        button,
        clickCount,
      },
      options,
    )
  }

  async hover(
    pageId: number,
    point: RemotePoint,
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    assertPoint(point, 'point')
    await this.callTool(
      'act',
      { kind: 'hover_at', page: pageId, x: point.x, y: point.y },
      options,
    )
  }

  async scroll(pageId: number, options: ScrollOptions): Promise<void> {
    this.assertPage(pageId)
    if (!isRecordValue(options)) throw validationError('scroll options are required')
    if (!['up', 'down', 'left', 'right'].includes(options.direction)) {
      throw validationError('scroll direction must be up, down, left, or right')
    }
    const amount = options.amount ?? 3
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      throw validationError('scroll amount must be an integer between 1 and 100')
    }
    await this.callTool(
      'act',
      {
        kind: 'scroll',
        page: pageId,
        direction: options.direction,
        amount,
      },
      options,
    )
  }

  async drag(
    pageId: number,
    start: RemotePoint,
    end: RemotePoint,
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    assertPoint(start, 'start')
    assertPoint(end, 'end')
    await this.callTool(
      'act',
      {
        kind: 'drag_at',
        page: pageId,
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
      },
      options,
    )
  }

  async type(
    pageId: number,
    text: string,
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    if (typeof text !== 'string' || text.length === 0) {
      throw validationError('text must be a non-empty string')
    }
    if (text.length > 100_000) throw validationError('text is too long')
    await this.callTool('act', { kind: 'type', page: pageId, text }, options)
  }

  async press(
    pageId: number,
    key: string,
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    if (typeof key !== 'string' || key.length === 0 || key.trim() !== key) {
      throw validationError('key must be a non-empty key name without surrounding whitespace')
    }
    if (key.length > 100) throw validationError('key name is too long')
    await this.callTool('act', { kind: 'press', page: pageId, key }, options)
  }

  private assertConnected(): void {
    if (this.stateValue !== 'connected' || !this.endpointValue) {
      throw new McpCallError('BrowserOS MCP is not connected', {
        kind: 'connection',
        code: 'NOT_CONNECTED',
      })
    }
  }

  private assertPage(pageId: number): void {
    this.assertConnected()
    assertPositiveInteger(pageId, 'pageId')
  }

  private async callTool(
    name: (typeof REQUIRED_TOOLS)[number],
    args: Record<string, unknown>,
    options: RequestOptions,
  ): Promise<McpToolResult> {
    this.assertConnected()
    if (!this.tools.has(name)) {
      throw new McpCallError(`BrowserOS tool "${name}" is unavailable`, {
        kind: 'connection',
        code: 'MISSING_TOOL',
      })
    }
    const value = await this.request(
      'tools/call',
      { name, arguments: args },
      options,
      true,
    )
    return assertToolResult(value, name)
  }

  private createRequestContext(options: RequestOptions): InternalRequestContext {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    assertTimeout(timeoutMs)
    const controller = new AbortController()
    const lifecycleSignal = this.lifecycleController.signal
    let timedOut = false
    const abort = () => controller.abort()

    if (options.signal?.aborted || lifecycleSignal.aborted) {
      controller.abort()
    } else {
      options.signal?.addEventListener('abort', abort, { once: true })
      lifecycleSignal.addEventListener('abort', abort, { once: true })
    }

    const timer = globalThis.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    return {
      signal: controller.signal,
      timedOut: () => timedOut,
      cleanup: () => {
        globalThis.clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
        lifecycleSignal.removeEventListener('abort', abort)
      },
    }
  }

  private async request(
    method: string,
    params: unknown,
    options: RequestOptions,
    allowConnecting: boolean,
  ): Promise<unknown> {
    const endpoint = this.endpointValue
    if (!endpoint || (!allowConnecting && this.stateValue !== 'connected')) {
      throw new McpCallError('BrowserOS MCP is not connected', {
        kind: 'connection',
        code: 'NOT_CONNECTED',
      })
    }

    const id = this.nextRequestId++
    const body: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    const context = this.createRequestContext(options)
    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: context.signal,
      })
      const responseBody = await response.text()
      if (!response.ok) {
        throw new McpCallError(
          `BrowserOS HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
          {
            kind: 'http',
            status: response.status,
            data: responseBody.slice(0, 1000),
          },
        )
      }
      const values = parseMcpResponse(
        responseBody,
        response.headers.get('content-type') ?? '',
      )
      return unwrapJsonRpcResponse(values, id)
    } catch (error) {
      throw this.normalizeRequestError(error, context, options)
    } finally {
      context.cleanup()
    }
  }

  private async notify(
    method: string,
    params: unknown,
    options: RequestOptions,
  ): Promise<void> {
    const endpoint = this.endpointValue
    if (!endpoint) {
      throw new McpCallError('BrowserOS MCP is not connected', {
        kind: 'connection',
        code: 'NOT_CONNECTED',
      })
    }
    const body: JsonRpcNotification = { jsonrpc: '2.0', method, params }
    const context = this.createRequestContext(options)
    try {
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: context.signal,
      })
      if (!response.ok) {
        const responseBody = await response.text()
        throw new McpCallError(
          `BrowserOS HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
          {
            kind: 'http',
            status: response.status,
            data: responseBody.slice(0, 1000),
          },
        )
      }
    } catch (error) {
      throw this.normalizeRequestError(error, context, options)
    } finally {
      context.cleanup()
    }
  }

  private normalizeRequestError(
    error: unknown,
    context: InternalRequestContext,
    options: RequestOptions,
  ): McpCallError {
    if (error instanceof McpCallError) return error
    if (context.timedOut()) {
      return new McpCallError('BrowserOS request timed out', {
        kind: 'timeout',
        code: 'TIMEOUT',
        cause: error,
      })
    }
    if (
      context.signal.aborted ||
      options.signal?.aborted ||
      this.lifecycleController.signal.aborted
    ) {
      return new McpCallError('BrowserOS request was aborted', {
        kind: 'aborted',
        code: 'ABORTED',
        cause: error,
      })
    }
    return new McpCallError(
      error instanceof Error && error.message
        ? `BrowserOS transport failed: ${error.message}`
        : 'BrowserOS transport failed',
      { kind: 'transport', cause: error },
    )
  }
}
