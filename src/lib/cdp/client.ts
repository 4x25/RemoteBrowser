import { McpCallError, validationError } from '../browseros/errors'
import type {
  CaptureFrameOptions,
  ClickOptions,
  ClientEnvironmentRequest,
  ConnectionState,
  McpServerInfo,
  MouseButton,
  NavigateRequest,
  NavigationEntry,
  PageState,
  RemoteFrame,
  RemotePoint,
  RemoteTab,
  RequestOptions,
  ScreenshotFormat,
  ScrollOptions,
  SetViewportRequest,
  UserAgentBrandVersion,
  UserAgentMetadata,
  ViewportMetrics,
} from '../browseros/types'
import type { RemoteBrowserClient } from '../remote/types'
import { comboToKeySequence } from './keys'
import {
  isRecordValue,
  optionalNumber,
  optionalString,
  parseNavigationHistory,
  parseViewportMetrics,
  stringOr,
  targetInfosFrom,
} from './protocol'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_CAPTURE_WIDTH = 1024
const DEFAULT_CAPTURE_HEIGHT = 768
const MAX_CAPTURE_WIDTH = 1440
const MAX_CAPTURE_HEIGHT = 900
const MAX_VIEWPORT_DIMENSION = 10_000_000
const MAX_DEVICE_SCALE_FACTOR = 10
const MAX_TEXT_LENGTH = 100_000
const MAX_KEY_LENGTH = 100
const MAX_USER_AGENT_LENGTH = 4096
const MAX_PLATFORM_LENGTH = 256
const MAX_ACCEPT_LANGUAGE_LENGTH = 1024
const MAX_METADATA_STRING_LENGTH = 1024
const MAX_BRAND_LIST_LENGTH = 32
const WHEEL_PIXELS_PER_NOTCH = 100

const BUTTON_MASKS: Readonly<Record<MouseButton, number>> = {
  left: 1,
  middle: 4,
  right: 2,
}

export interface CdpSocketEvent {
  data?: unknown
}

/** Minimal WebSocket surface so tests can inject a scripted transport. */
export interface CdpSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: string, listener: (event: CdpSocketEvent) => void): void
  removeEventListener?(type: string, listener: (event: CdpSocketEvent) => void): void
}

export interface CdpClientOptions {
  fetch?: typeof fetch
  webSocketFactory?: (url: string) => CdpSocket
  requestTimeoutMs?: number
}

interface InternalRequestContext {
  signal: AbortSignal
  timedOut: () => boolean
  cleanup: () => void
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (error: McpCallError) => void
}

type SessionVisibility = 'visible' | 'hidden' | 'unknown'

interface CdpSession {
  targetId: string
  sessionId: string
  visibility: SessionVisibility
  loading: boolean
}

interface TargetInfoSnapshot {
  url: string
  title: string
  browserContextId?: string
}

interface TargetSnapshot {
  targetId: string
  pageId: number
  index: number
  url: string
  title: string
  isLoading: boolean
  visibility: SessionVisibility
  viewport: ViewportMetrics | null
  history: { currentIndex: number; entries: NavigationEntry[] }
  browserContextId?: string
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

function validateCaptureDimension(
  value: number,
  name: string,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw validationError(`${name} must be an integer between 1 and ${maximum}`)
  }
}

function validateViewportDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_VIEWPORT_DIMENSION) {
    throw validationError(
      `${name} must be an integer between 1 and ${MAX_VIEWPORT_DIMENSION}`,
    )
  }
}

function validateEnvironmentString(
  value: unknown,
  name: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.trim() !== value
  ) {
    throw validationError(
      `${name} must be a non-empty string without surrounding whitespace`,
    )
  }
  if (value.length > maximum) {
    throw validationError(`${name} must be at most ${maximum} characters`)
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw validationError(`${name} must not contain control characters`)
  }
  return value
}

function normalizeBrandList(
  value: unknown,
  name: string,
): UserAgentBrandVersion[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_BRAND_LIST_LENGTH) {
    throw validationError(
      `${name} must be an array with at most ${MAX_BRAND_LIST_LENGTH} entries`,
    )
  }

  return value.map((entry, index) => {
    if (!isRecordValue(entry)) {
      throw validationError(`${name}[${index}] must be a brand/version object`)
    }
    return {
      brand: validateEnvironmentString(
        entry.brand,
        `${name}[${index}].brand`,
        MAX_METADATA_STRING_LENGTH,
      ),
      version: validateEnvironmentString(
        entry.version,
        `${name}[${index}].version`,
        MAX_METADATA_STRING_LENGTH,
      ),
    }
  })
}

function normalizeUserAgentMetadata(value: unknown): UserAgentMetadata | undefined {
  if (value === undefined) return undefined
  if (!isRecordValue(value)) {
    throw validationError('userAgentMetadata must be an object')
  }
  if (typeof value.mobile !== 'boolean') {
    throw validationError('userAgentMetadata.mobile must be a boolean')
  }
  if (value.wow64 !== undefined && typeof value.wow64 !== 'boolean') {
    throw validationError('userAgentMetadata.wow64 must be a boolean')
  }

  const brands = normalizeBrandList(value.brands, 'userAgentMetadata.brands')
  const fullVersionList = normalizeBrandList(
    value.fullVersionList,
    'userAgentMetadata.fullVersionList',
  )

  return {
    ...(brands === undefined ? {} : { brands }),
    ...(fullVersionList === undefined ? {} : { fullVersionList }),
    platform: validateEnvironmentString(
      value.platform,
      'userAgentMetadata.platform',
      MAX_METADATA_STRING_LENGTH,
    ),
    platformVersion: validateEnvironmentString(
      value.platformVersion,
      'userAgentMetadata.platformVersion',
      MAX_METADATA_STRING_LENGTH,
      true,
    ),
    architecture: validateEnvironmentString(
      value.architecture,
      'userAgentMetadata.architecture',
      MAX_METADATA_STRING_LENGTH,
      true,
    ),
    model: validateEnvironmentString(
      value.model,
      'userAgentMetadata.model',
      MAX_METADATA_STRING_LENGTH,
      true,
    ),
    mobile: value.mobile,
    ...(value.bitness === undefined
      ? {}
      : {
          bitness: validateEnvironmentString(
            value.bitness,
            'userAgentMetadata.bitness',
            MAX_METADATA_STRING_LENGTH,
            true,
          ),
        }),
    ...(value.wow64 === undefined ? {} : { wow64: value.wow64 }),
  }
}

function normalizeClientEnvironment(
  request: ClientEnvironmentRequest,
): ClientEnvironmentRequest {
  if (!isRecordValue(request)) {
    throw validationError('client environment request is required')
  }
  if (request.colorScheme !== 'light' && request.colorScheme !== 'dark') {
    throw validationError('colorScheme must be light or dark')
  }

  const userAgentMetadata = normalizeUserAgentMetadata(request.userAgentMetadata)
  return {
    userAgent: validateEnvironmentString(
      request.userAgent,
      'userAgent',
      MAX_USER_AGENT_LENGTH,
    ),
    platform: validateEnvironmentString(
      request.platform,
      'platform',
      MAX_PLATFORM_LENGTH,
    ),
    acceptLanguage: validateEnvironmentString(
      request.acceptLanguage,
      'acceptLanguage',
      MAX_ACCEPT_LANGUAGE_LENGTH,
    ),
    colorScheme: request.colorScheme,
    ...(userAgentMetadata === undefined ? {} : { userAgentMetadata }),
  }
}

function getPageProtocol(): string {
  return typeof window === 'undefined' ? 'http:' : window.location.protocol
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

function openSocket(socket: CdpSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: McpCallError) => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      socket.removeEventListener?.('open', onOpen)
      socket.removeEventListener?.('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onOpen = () => finish()
    const onError = () => finish(
      new McpCallError(
        'CDP WebSocket 连接失败。请确认调试地址可达，且浏览器已用 --remote-allow-origins 允许当前页面来源。',
        { kind: 'transport', code: 'HANDSHAKE' },
      ),
    )
    const timer = globalThis.setTimeout(
      () => finish(
        new McpCallError('连接 CDP 超时，请检查调试地址和网络。', {
          kind: 'timeout',
          code: 'TIMEOUT',
        }),
      ),
      timeoutMs,
    )
    socket.addEventListener('open', onOpen)
    socket.addEventListener('error', onError)
  })
}

/**
 * Chrome DevTools Protocol client that talks to a browser-level WebSocket
 * endpoint and implements the same surface as the BrowserOS MCP client.
 */
export class CdpClient implements RemoteBrowserClient {
  private readonly fetchImpl: typeof fetch
  private readonly webSocketFactory: (url: string) => CdpSocket
  private readonly defaultTimeoutMs: number
  private nextRequestId = 1
  private endpointValue: string | null = null
  private lifecycleController = new AbortController()
  private stateValue: ConnectionState = 'disconnected'
  private serverInfoValue: McpServerInfo | null = null
  private socket: CdpSocket | null = null
  private pending = new Map<number, PendingCommand>()
  private sessionsByTarget = new Map<string, CdpSession>()
  private sessionsById = new Map<string, CdpSession>()
  private pageIdByTarget = new Map<string, number>()
  private targetByPageId = new Map<number, string>()
  private targetInfoCache = new Map<string, TargetInfoSnapshot>()
  private targetOrder: string[] = []
  private nextPageId = 1
  private lastActivatedTargetId: string | null = null
  private viewportByPage = new Map<number, ViewportMetrics>()

  constructor(options: CdpClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.webSocketFactory = options.webSocketFactory
      ?? ((url) => new WebSocket(url) as unknown as CdpSocket)
    this.defaultTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
    assertTimeout(this.defaultTimeoutMs)
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

  async connect(
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<McpServerInfo> {
    let webSocketUrl: string
    try {
      webSocketUrl = await this.resolveWebSocketUrl(endpoint, options)
    } catch (error) {
      this.stateValue = 'error'
      this.endpointValue = null
      throw error
    }

    this.lifecycleController.abort()
    this.lifecycleController = new AbortController()
    this.rejectAllPending(
      new McpCallError('CDP connection attempt was superseded', {
        kind: 'aborted',
        code: 'ABORTED',
      }),
    )
    this.resetState()
    this.endpointValue = webSocketUrl
    this.stateValue = 'connecting'
    const lifecycle = this.lifecycleController

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    let socket: CdpSocket | null = null
    try {
      socket = this.webSocketFactory(webSocketUrl)
      await openSocket(socket, timeoutMs)
      if (lifecycle !== this.lifecycleController) {
        throw new McpCallError('CDP connection attempt was superseded', {
          kind: 'aborted',
          code: 'ABORTED',
        })
      }
      this.socket = socket
      socket.addEventListener('message', this.handleMessage)
      socket.addEventListener('close', this.handleClose)

      const info = await this.callCommand(
        'Browser.getVersion',
        {},
        options,
        undefined,
        true,
      )
      if (lifecycle !== this.lifecycleController) {
        throw new McpCallError('CDP connection attempt was superseded', {
          kind: 'aborted',
          code: 'ABORTED',
        })
      }

      const product = isRecordValue(info) ? optionalString(info.product) : undefined
      const protocolVersion = isRecordValue(info)
        ? optionalString(info.protocolVersion)
        : undefined
      this.serverInfoValue = {
        name: product ?? 'Chrome DevTools Protocol',
        version: protocolVersion,
        protocolVersion,
      }
      this.stateValue = 'connected'
      return this.serverInfoValue
    } catch (error) {
      if (socket) {
        try {
          socket.close()
        } catch {
          // The socket may already be closed.
        }
      }
      if (this.socket === socket) this.socket = null
      if (lifecycle === this.lifecycleController) {
        this.stateValue = 'error'
        this.endpointValue = null
      }
      if (error instanceof McpCallError) throw error
      throw new McpCallError('Failed to connect to CDP', {
        kind: 'connection',
        cause: error,
      })
    }
  }

  disconnect(): void {
    this.lifecycleController.abort()
    this.lifecycleController = new AbortController()
    this.rejectAllPending(
      new McpCallError('CDP client was disconnected', {
        kind: 'aborted',
        code: 'ABORTED',
      }),
    )
    try {
      this.socket?.close()
    } catch {
      // Ignore sockets that already closed themselves.
    }
    this.socket = null
    this.endpointValue = null
    this.serverInfoValue = null
    this.resetState()
    this.stateValue = 'disconnected'
  }

  async listTabs(options: RequestOptions = {}): Promise<RemoteTab[]> {
    this.assertConnected()
    const result = await this.callCommand('Target.getTargets', {}, options)
    const pageTargets: Array<{ targetId: string; info: Record<string, unknown> }> = []

    for (const info of targetInfosFrom(result)) {
      if (info.type !== 'page') continue
      const targetId = optionalString(info.targetId)
      if (!targetId) continue
      pageTargets.push({ targetId, info })
    }

    const seen = new Set(pageTargets.map((target) => target.targetId))
    for (const { targetId, info } of pageTargets) {
      this.ensurePageId(targetId)
      this.cacheTargetInfo(targetId, info)
      if (!this.targetOrder.includes(targetId)) this.targetOrder.push(targetId)
    }
    for (const targetId of [...this.targetOrder]) {
      if (!seen.has(targetId)) this.dropTarget(targetId)
    }

    const snapshots = await Promise.all(
      pageTargets.map(({ targetId }) => this.readTarget(targetId, options)),
    )
    snapshots.sort((left, right) => left.index - right.index)

    const visible = snapshots.filter(
      (snapshot) => snapshot.visibility === 'visible',
    )
    const activeTargetId =
      (this.lastActivatedTargetId !== null &&
      visible.some((snapshot) => snapshot.targetId === this.lastActivatedTargetId)
        ? this.lastActivatedTargetId
        : undefined)
      ?? visible[0]?.targetId
      ?? (this.lastActivatedTargetId !== null && seen.has(this.lastActivatedTargetId)
        ? this.lastActivatedTargetId
        : undefined)
      ?? snapshots[0]?.targetId

    return snapshots.map((snapshot) => {
      const isActive = snapshot.targetId === activeTargetId
      const isLoading = snapshot.isLoading
      const pageState: PageState = {
        pageId: snapshot.pageId,
        url: snapshot.url,
        title: snapshot.title,
        isActive,
        isLoading,
        loadProgress: isLoading ? 0 : 1,
        viewport: snapshot.viewport,
        historyIndex: snapshot.history.currentIndex,
        historyLength: snapshot.history.entries.length,
        history: snapshot.history.entries,
        canGoBack: snapshot.history.currentIndex > 0,
        canGoForward:
          snapshot.history.currentIndex >= 0 &&
          snapshot.history.currentIndex < snapshot.history.entries.length - 1,
      }

      return {
        pageId: snapshot.pageId,
        targetId: snapshot.targetId,
        index: snapshot.index,
        url: snapshot.url,
        title: snapshot.title,
        isActive,
        isLoading,
        loadProgress: pageState.loadProgress,
        isPinned: false,
        isHidden: snapshot.visibility === 'hidden',
        ...(snapshot.browserContextId === undefined
          ? {}
          : { browserContextId: snapshot.browserContextId }),
        pageState,
      } satisfies RemoteTab
    })
  }

  async getPageState(
    pageId: number,
    options: RequestOptions = {},
  ): Promise<PageState> {
    assertPositiveInteger(pageId, 'pageId')
    const tabs = await this.listTabs(options)
    const tab = tabs.find((candidate) => candidate.pageId === pageId)
    if (!tab) {
      throw new McpCallError(`CDP page ${pageId} is not available`, {
        kind: 'tool',
        code: 'PAGE_NOT_FOUND',
      })
    }
    return tab.pageState
  }

  async createTab(
    url = 'about:blank',
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertConnected()
    const normalizedUrl = normalizePageUrl(url, true)
    const result = await this.callCommand(
      'Target.createTarget',
      { url: normalizedUrl, background: false },
      options,
    )
    const targetId = isRecordValue(result)
      ? optionalString(result.targetId)
      : undefined
    if (!targetId) {
      throw new McpCallError('CDP 未返回新标签页的 targetId', {
        kind: 'protocol',
        data: result,
      })
    }
    this.ensurePageId(targetId)
    if (!this.targetOrder.includes(targetId)) this.targetOrder.push(targetId)
    this.lastActivatedTargetId = targetId
    const session = await this.ensureSession(targetId, options)
    session.visibility = 'visible'
    await this.callCommand(
      'Page.bringToFront',
      {},
      options,
      session.sessionId,
    ).catch(() => undefined)
  }

  async closeTab(pageId: number, options: RequestOptions = {}): Promise<void> {
    const targetId = this.requireTarget(pageId)
    try {
      await this.callCommand('Target.closeTarget', { targetId }, options)
    } catch (error) {
      if (!(error instanceof McpCallError && isMissingTargetError(error))) throw error
    }
    this.dropTarget(targetId)
  }

  async activateTab(pageId: number, options: RequestOptions = {}): Promise<void> {
    const targetId = this.requireTarget(pageId)
    await this.callCommand('Target.activateTarget', { targetId }, options)
    this.lastActivatedTargetId = targetId
    const session = await this.ensureSession(targetId, options)
    session.visibility = 'visible'
    await this.callCommand(
      'Page.bringToFront',
      {},
      options,
      session.sessionId,
    ).catch(() => undefined)
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
    } else if (request.url !== undefined) {
      throw validationError('navigate URL is only valid for the url action')
    }

    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)

    if (request.action === 'url') {
      const url = normalizePageUrl(request.url as string)
      await this.callCommand(
        'Page.navigate',
        { url, transitionType: 'typed' },
        options,
        session.sessionId,
      )
      return
    }

    if (request.action === 'reload') {
      await this.callCommand('Page.reload', {}, options, session.sessionId)
      return
    }

    const rawHistory = await this.callCommand(
      'Page.getNavigationHistory',
      {},
      options,
      session.sessionId,
    )
    const { currentIndex, entries } = parseNavigationHistory(rawHistory)
    if (currentIndex < 0) return
    const offset = request.action === 'back' ? -1 : 1
    const entry = entries[currentIndex + offset]
    if (!entry) return
    await this.callCommand(
      'Page.navigateToHistoryEntry',
      { entryId: entry.id },
      options,
      session.sessionId,
    )
  }

  async setViewport(
    pageId: number,
    request: SetViewportRequest,
    options: RequestOptions = {},
  ): Promise<ViewportMetrics> {
    this.assertPage(pageId)
    if (!isRecordValue(request)) {
      throw validationError('set viewport request is required')
    }
    validateViewportDimension(request.width, 'width')
    validateViewportDimension(request.height, 'height')
    assertFiniteNumber(request.deviceScaleFactor, 'deviceScaleFactor')
    if (
      request.deviceScaleFactor <= 0 ||
      request.deviceScaleFactor > MAX_DEVICE_SCALE_FACTOR
    ) {
      throw validationError(
        `deviceScaleFactor must be greater than 0 and at most ${MAX_DEVICE_SCALE_FACTOR}`,
      )
    }

    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)
    await this.callCommand(
      'Emulation.setDeviceMetricsOverride',
      {
        width: request.width,
        height: request.height,
        deviceScaleFactor: request.deviceScaleFactor,
        mobile: false,
        screenWidth: request.width,
        screenHeight: request.height,
      },
      options,
      session.sessionId,
    )
    const rawMetrics = await this.callCommand(
      'Page.getLayoutMetrics',
      {},
      options,
      session.sessionId,
    )
    const viewport = parseViewportMetrics(rawMetrics)
    if (!viewport) {
      throw new McpCallError(
        `CDP 返回了无效的视口数据 page ${pageId}`,
        { kind: 'protocol', data: rawMetrics },
      )
    }
    this.viewportByPage.set(pageId, viewport)
    return viewport
  }

  async applyClientEnvironment(
    pageId: number,
    request: ClientEnvironmentRequest,
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    const environment = normalizeClientEnvironment(request)
    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)

    const baseOverride: Record<string, unknown> = {
      userAgent: environment.userAgent,
      acceptLanguage: environment.acceptLanguage,
      platform: environment.platform,
    }
    const fullOverride: Record<string, unknown> = {
      ...baseOverride,
      ...(environment.userAgentMetadata === undefined
        ? {}
        : { userAgentMetadata: environment.userAgentMetadata }),
    }

    try {
      await this.callCommand(
        'Emulation.setUserAgentOverride',
        fullOverride,
        options,
        session.sessionId,
      )
    } catch (error) {
      if (environment.userAgentMetadata === undefined) throw error
      if (error instanceof McpCallError && error.kind === 'aborted') throw error
      await this.callCommand(
        'Emulation.setUserAgentOverride',
        baseOverride,
        options,
        session.sessionId,
      )
    }

    await this.callCommand(
      'Emulation.setEmulatedMedia',
      {
        media: 'screen',
        features: [
          { name: 'prefers-color-scheme', value: environment.colorScheme },
        ],
      },
      options,
      session.sessionId,
    )
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

    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)
    if (session.visibility !== 'visible') {
      await this.activateTab(pageId, options)
    }

    const expectedMimeType = format === 'webp' ? 'image/webp' : 'image/jpeg'
    let data: string
    try {
      data = await this.captureScreenshot(session, format, quality, options)
    } catch (error) {
      if (error instanceof McpCallError && error.kind === 'aborted') throw error
      // Hidden or throttled pages refuse to produce a frame; bring the target
      // forward and retry once before surfacing the failure.
      await this.activateTab(pageId, options)
      data = await this.captureScreenshot(session, format, quality, options)
    }

    return {
      pageId,
      data,
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

    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)
    const mask = BUTTON_MASKS[button]
    await this.dispatchMouse(
      session,
      options,
      { type: 'mouseMoved', x: point.x, y: point.y, buttons: 0 },
    )
    for (let count = 1; count <= clickCount; count += 1) {
      await this.dispatchMouse(session, options, {
        type: 'mousePressed',
        x: point.x,
        y: point.y,
        button,
        buttons: mask,
        clickCount: count,
      })
      await this.dispatchMouse(session, options, {
        type: 'mouseReleased',
        x: point.x,
        y: point.y,
        button,
        buttons: 0,
        clickCount: count,
      })
    }
  }

  async hover(
    pageId: number,
    point: RemotePoint,
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    assertPoint(point, 'point')
    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)
    await this.dispatchMouse(
      session,
      options,
      { type: 'mouseMoved', x: point.x, y: point.y, buttons: 0 },
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

    const targetId = this.requireTarget(pageId)
    const viewport = await this.readViewport(pageId, targetId, options)
    const x = viewport ? viewport.width / 2 : 512
    const y = viewport ? viewport.height / 2 : 384
    const distance = amount * WHEEL_PIXELS_PER_NOTCH
    const deltaX = options.direction === 'left'
      ? -distance
      : options.direction === 'right'
        ? distance
        : 0
    const deltaY = options.direction === 'up'
      ? -distance
      : options.direction === 'down'
        ? distance
        : 0

    const session = await this.ensureSession(targetId, options)
    await this.callCommand(
      'Input.dispatchMouseEvent',
      { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: 0 },
      options,
      session.sessionId,
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
    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)

    await this.dispatchMouse(session, options, {
      type: 'mouseMoved',
      x: start.x,
      y: start.y,
      buttons: 0,
    })
    await this.dispatchMouse(session, options, {
      type: 'mousePressed',
      x: start.x,
      y: start.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    const steps = 8
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps
      await this.dispatchMouse(session, options, {
        type: 'mouseMoved',
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        button: 'left',
        buttons: 1,
      })
    }
    await this.dispatchMouse(session, options, {
      type: 'mouseReleased',
      x: end.x,
      y: end.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
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
    if (text.length > MAX_TEXT_LENGTH) throw validationError('text is too long')
    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)
    await this.callCommand('Input.insertText', { text }, options, session.sessionId)
  }

  async press(
    pageId: number,
    key: string,
    options: RequestOptions = {},
  ): Promise<void> {
    this.assertPage(pageId)
    if (typeof key !== 'string' || key.length === 0 || key.trim() !== key) {
      throw validationError(
        'key must be a non-empty key name without surrounding whitespace',
      )
    }
    if (key.length > MAX_KEY_LENGTH) throw validationError('key name is too long')
    const sequence = comboToKeySequence(key)
    if (!sequence) throw validationError(`无法识别的按键组合：${key}`)

    const targetId = this.requireTarget(pageId)
    const session = await this.ensureSession(targetId, options)
    for (const event of sequence) {
      await this.callCommand(
        'Input.dispatchKeyEvent',
        {
          type: event.type,
          key: event.key,
          ...(event.code === undefined ? {} : { code: event.code }),
          windowsVirtualKeyCode: event.windowsVirtualKeyCode,
          nativeVirtualKeyCode: event.windowsVirtualKeyCode,
          modifiers: event.modifiers,
          ...(event.text === undefined ? {} : { text: event.text }),
        },
        options,
        session.sessionId,
      )
    }
  }

  private assertConnected(): void {
    if (this.stateValue !== 'connected') {
      throw new McpCallError('CDP client is not connected', {
        kind: 'connection',
        code: 'NOT_CONNECTED',
      })
    }
  }

  private assertPage(pageId: number): void {
    this.assertConnected()
    assertPositiveInteger(pageId, 'pageId')
  }

  private requireTarget(pageId: number): string {
    this.assertPage(pageId)
    const targetId = this.targetByPageId.get(pageId)
    if (!targetId) {
      throw new McpCallError(`CDP page ${pageId} is not available`, {
        kind: 'tool',
        code: 'PAGE_NOT_FOUND',
      })
    }
    return targetId
  }

  private ensurePageId(targetId: string): number {
    const existing = this.pageIdByTarget.get(targetId)
    if (existing !== undefined) return existing
    const pageId = this.nextPageId
    this.nextPageId += 1
    this.pageIdByTarget.set(targetId, pageId)
    this.targetByPageId.set(pageId, targetId)
    return pageId
  }

  private cacheTargetInfo(targetId: string, info: Record<string, unknown>): void {
    const url = optionalString(info.url)
    const title = optionalString(info.title)
    const browserContextId = optionalString(info.browserContextId)
    const previous = this.targetInfoCache.get(targetId)
    this.targetInfoCache.set(targetId, {
      url: url ?? previous?.url ?? 'about:blank',
      title: title ?? previous?.title ?? url ?? previous?.url ?? '',
      ...(browserContextId === undefined
        ? previous?.browserContextId === undefined
          ? {}
          : { browserContextId: previous.browserContextId }
        : { browserContextId }),
    })
  }

  private dropTarget(targetId: string): void {
    const pageId = this.pageIdByTarget.get(targetId)
    if (pageId !== undefined) {
      this.targetByPageId.delete(pageId)
      this.pageIdByTarget.delete(targetId)
      this.viewportByPage.delete(pageId)
    }
    const session = this.sessionsByTarget.get(targetId)
    if (session) this.dropSession(session.sessionId)
    this.targetInfoCache.delete(targetId)
    this.targetOrder = this.targetOrder.filter((candidate) => candidate !== targetId)
    if (this.lastActivatedTargetId === targetId) this.lastActivatedTargetId = null
  }

  private dropSession(sessionId: string): void {
    const session = this.sessionsById.get(sessionId)
    if (!session) return
    this.sessionsById.delete(sessionId)
    this.sessionsByTarget.delete(session.targetId)
  }

  private async ensureSession(
    targetId: string,
    options: RequestOptions,
  ): Promise<CdpSession> {
    const existing = this.sessionsByTarget.get(targetId)
    if (existing) return existing

    const result = await this.callCommand(
      'Target.attachToTarget',
      { targetId, flatten: true },
      options,
    )
    const sessionId = isRecordValue(result)
      ? optionalString(result.sessionId)
      : undefined
    if (!sessionId) {
      throw new McpCallError('CDP 未返回调试会话 sessionId', {
        kind: 'protocol',
        data: result,
      })
    }

    const session: CdpSession = {
      targetId,
      sessionId,
      visibility: 'unknown',
      loading: false,
    }
    this.sessionsByTarget.set(targetId, session)
    this.sessionsById.set(sessionId, session)
    await this.callCommand('Page.enable', {}, options, sessionId).catch(
      () => undefined,
    )
    return session
  }

  private async readTarget(
    targetId: string,
    options: RequestOptions,
  ): Promise<TargetSnapshot> {
    const pageId = this.ensurePageId(targetId)
    const cached = this.targetInfoCache.get(targetId)
    const index = Math.max(0, this.targetOrder.indexOf(targetId))
    let url = cached?.url ?? 'about:blank'
    let title = cached?.title ?? url
    let isLoading = false
    let visibility: SessionVisibility = 'unknown'
    let viewport = this.viewportByPage.get(pageId) ?? null
    let history: { currentIndex: number; entries: NavigationEntry[] } = {
      currentIndex: -1,
      entries: [],
    }

    try {
      const session = await this.ensureSession(targetId, options)
      const evaluated = await this.evaluateSession(
        session.sessionId,
        '({ title: document.title, url: location.href, readyState: document.readyState, visibilityState: document.visibilityState })',
        options,
      )
      if (isRecordValue(evaluated)) {
        title = stringOr(evaluated.title, title)
        url = stringOr(evaluated.url, url)
        visibility = evaluated.visibilityState === 'visible'
          ? 'visible'
          : evaluated.visibilityState === 'hidden'
            ? 'hidden'
            : 'unknown'
        isLoading = typeof evaluated.readyState === 'string'
          && evaluated.readyState !== 'complete'
        session.visibility = visibility
        session.loading = isLoading
      } else {
        visibility = session.visibility
        isLoading = session.loading
      }

      try {
        const rawHistory = await this.callCommand(
          'Page.getNavigationHistory',
          {},
          options,
          session.sessionId,
        )
        const parsed = parseNavigationHistory(rawHistory)
        if (parsed.entries.length > 0 || parsed.currentIndex >= 0) history = parsed
      } catch (error) {
        if (error instanceof McpCallError && error.kind === 'aborted') throw error
      }

      try {
        const rawMetrics = await this.callCommand(
          'Page.getLayoutMetrics',
          {},
          options,
          session.sessionId,
        )
        const metrics = parseViewportMetrics(rawMetrics)
        if (metrics) {
          viewport = metrics
          this.viewportByPage.set(pageId, metrics)
        }
      } catch (error) {
        if (error instanceof McpCallError && error.kind === 'aborted') throw error
      }
    } catch (error) {
      if (error instanceof McpCallError && error.kind === 'aborted') throw error
      const session = this.sessionsByTarget.get(targetId)
      if (session) {
        visibility = session.visibility
        isLoading = session.loading
      }
    }

    return {
      targetId,
      pageId,
      index,
      url,
      title,
      isLoading,
      visibility,
      viewport,
      history,
      ...(cached?.browserContextId === undefined
        ? {}
        : { browserContextId: cached.browserContextId }),
    }
  }

  private async evaluateSession(
    sessionId: string,
    expression: string,
    options: RequestOptions,
  ): Promise<unknown> {
    const raw = await this.callCommand(
      'Runtime.evaluate',
      { expression, returnByValue: true },
      options,
      sessionId,
    )
    if (!isRecordValue(raw) || isRecordValue(raw.exceptionDetails)) return null
    const result = isRecordValue(raw.result) ? raw.result : null
    return result === null ? null : result.value
  }

  private async readViewport(
    pageId: number,
    targetId: string,
    options: RequestOptions,
  ): Promise<ViewportMetrics | null> {
    const cached = this.viewportByPage.get(pageId)
    if (cached) return cached
    try {
      const session = await this.ensureSession(targetId, options)
      const raw = await this.callCommand(
        'Page.getLayoutMetrics',
        {},
        options,
        session.sessionId,
      )
      const metrics = parseViewportMetrics(raw)
      if (metrics) this.viewportByPage.set(pageId, metrics)
      return metrics
    } catch {
      return null
    }
  }

  private async captureScreenshot(
    session: CdpSession,
    format: ScreenshotFormat,
    quality: number,
    options: RequestOptions,
  ): Promise<string> {
    const raw = await this.callCommand(
      'Page.captureScreenshot',
      {
        format,
        quality,
        fromSurface: true,
        captureBeyondViewport: false,
      },
      options,
      session.sessionId,
    )
    const data = isRecordValue(raw) ? optionalString(raw.data) : undefined
    if (!data) {
      throw new McpCallError('CDP 截图没有返回图像数据', {
        kind: 'protocol',
        data: raw,
      })
    }
    return data
  }

  private dispatchMouse(
    session: CdpSession,
    options: RequestOptions,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    return this.callCommand(
      'Input.dispatchMouseEvent',
      params,
      options,
      session.sessionId,
    )
  }

  private async resolveWebSocketUrl(
    endpoint: string,
    options: RequestOptions,
  ): Promise<string> {
    let parsed: URL
    try {
      parsed = new URL(endpoint)
    } catch (cause) {
      throw new McpCallError('CDP 地址不是有效的 URL', {
        kind: 'validation',
        cause,
      })
    }

    if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
      if (getPageProtocol() === 'https:' && parsed.protocol === 'ws:') {
        throw new McpCallError(
          'HTTPS 页面不能连接非加密的 CDP WebSocket 地址。',
          { kind: 'validation', data: endpoint },
        )
      }
      return parsed.href
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw validationError(
        'CDP endpoint must use ws:, wss:, http:, or https:',
      )
    }

    const basePath = parsed.pathname.replace(/\/+$/, '')
    const discoveryUrl = basePath.endsWith('/json/version')
      ? parsed
      : new URL(`${basePath}/json/version`, parsed.origin)
    const context = this.createRequestContext(options)
    let payload: unknown
    try {
      const response = await this.fetchImpl(discoveryUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: context.signal,
      })
      if (!response.ok) {
        throw new McpCallError(
          `CDP 调试端口返回 HTTP ${response.status}`,
          { kind: 'http', status: response.status },
        )
      }
      payload = await response.json()
    } catch (error) {
      if (error instanceof McpCallError) throw error
      if (context.timedOut()) {
        throw new McpCallError('读取 CDP 调试信息超时', {
          kind: 'timeout',
          code: 'TIMEOUT',
        })
      }
      if (context.signal.aborted) {
        throw new McpCallError('CDP 请求已取消', {
          kind: 'aborted',
          code: 'ABORTED',
        })
      }
      throw new McpCallError(
        '无法读取 /json/version。浏览器可能因 CORS 拒绝了请求，请直接填写 WebSocket 调试地址（ws:// 或 wss://）。',
        { kind: 'transport', cause: error },
      )
    } finally {
      context.cleanup()
    }

    const webSocketDebuggerUrl = isRecordValue(payload)
      ? optionalString(payload.webSocketDebuggerUrl)
      : undefined
    if (!webSocketDebuggerUrl) {
      throw new McpCallError(
        '调试端口没有返回 webSocketDebuggerUrl，请直接填写 WebSocket 调试地址。',
        { kind: 'protocol', data: payload },
      )
    }

    let webSocketUrl: URL
    try {
      webSocketUrl = new URL(webSocketDebuggerUrl)
    } catch (cause) {
      throw new McpCallError('调试端口返回了无效的 WebSocket 地址', {
        kind: 'protocol',
        cause,
        data: payload,
      })
    }
    if (webSocketUrl.protocol !== 'ws:' && webSocketUrl.protocol !== 'wss:') {
      throw new McpCallError(
        '调试端口返回的 webSocketDebuggerUrl 不是 WebSocket 地址',
        { kind: 'protocol', data: payload },
      )
    }
    if (
      getPageProtocol() === 'https:' &&
      webSocketUrl.protocol === 'ws:'
    ) {
      throw new McpCallError(
        'HTTPS 页面不能连接非加密的 CDP WebSocket 地址。',
        { kind: 'validation', data: webSocketDebuggerUrl },
      )
    }
    return webSocketUrl.href
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

  private callCommand(
    method: string,
    params: Record<string, unknown>,
    options: RequestOptions = {},
    sessionId?: string,
    allowConnecting = false,
  ): Promise<unknown> {
    if (!allowConnecting) this.assertConnected()
    const socket = this.socket
    if (!socket) {
      throw new McpCallError('CDP 连接不可用，请重新连接。', {
        kind: 'connection',
        code: 'NOT_CONNECTED',
      })
    }

    const id = this.nextRequestId
    this.nextRequestId += 1
    const context = this.createRequestContext(options)

    return new Promise<unknown>((resolve, reject) => {
      let settled = false
      let pending: PendingCommand | null = null

      const finalize = () => {
        if (settled) return
        settled = true
        context.signal.removeEventListener('abort', abortHandler)
        context.cleanup()
        if (pending && this.pending.get(id) === pending) this.pending.delete(id)
      }
      const abortHandler = () => {
        finalize()
        reject(this.normalizeRequestError(context, options))
      }

      if (context.signal.aborted) {
        abortHandler()
        return
      }

      pending = {
        resolve: (value) => {
          finalize()
          resolve(value)
        },
        reject: (error) => {
          finalize()
          reject(error)
        },
      }
      context.signal.addEventListener('abort', abortHandler, { once: true })
      this.pending.set(id, pending)

      try {
        socket.send(JSON.stringify({
          id,
          method,
          params,
          ...(sessionId === undefined ? {} : { sessionId }),
        }))
      } catch (cause) {
        pending.reject(new McpCallError(`CDP ${method} 发送失败`, {
          kind: 'transport',
          cause,
        }))
      }
    })
  }

  private normalizeRequestError(
    context: InternalRequestContext,
    options: RequestOptions,
  ): McpCallError {
    if (context.timedOut()) {
      return new McpCallError('CDP 请求超时', {
        kind: 'timeout',
        code: 'TIMEOUT',
      })
    }
    if (
      context.signal.aborted ||
      options.signal?.aborted ||
      this.lifecycleController.signal.aborted
    ) {
      return new McpCallError('CDP 请求已取消', {
        kind: 'aborted',
        code: 'ABORTED',
      })
    }
    return new McpCallError('CDP 请求失败', { kind: 'transport' })
  }

  private rejectAllPending(error: McpCallError): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const command of pending) command.reject(error)
  }

  private resetState(): void {
    this.sessionsByTarget.clear()
    this.sessionsById.clear()
    this.pageIdByTarget.clear()
    this.targetByPageId.clear()
    this.targetInfoCache.clear()
    this.viewportByPage.clear()
    this.targetOrder = []
    this.nextPageId = 1
    this.lastActivatedTargetId = null
  }

  private handleMessage = (event: CdpSocketEvent): void => {
    if (typeof event.data !== 'string') return
    let message: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(event.data)
      if (!isRecordValue(parsed)) return
      message = parsed
    } catch {
      return
    }

    const id = optionalNumber(message.id)
    if (id !== undefined && this.pending.has(id)) {
      const command = this.pending.get(id)
      this.pending.delete(id)
      if (!command) return
      const error = message.error
      if (isRecordValue(error)) {
        command.reject(new McpCallError(
          stringOr(error.message, 'CDP command failed'),
          {
            kind: 'rpc',
            code: optionalNumber(error.code),
            data: error.data,
          },
        ))
      } else {
        command.resolve(message.result)
      }
      return
    }

    if (typeof message.method === 'string') this.handleEvent(message)
  }

  private handleEvent(message: Record<string, unknown>): void {
    const method = stringOr(message.method)
    const params = isRecordValue(message.params) ? message.params : {}
    const sessionId = optionalString(message.sessionId)

    switch (method) {
      case 'Target.detachedFromTarget': {
        const detached = optionalString(params.sessionId)
        if (detached) this.dropSession(detached)
        break
      }
      case 'Target.targetDestroyed': {
        const targetId = optionalString(params.targetId)
        if (targetId) this.dropTarget(targetId)
        break
      }
      case 'Target.targetInfoChanged': {
        const info = params.targetInfo
        if (!isRecordValue(info)) break
        const targetId = optionalString(info.targetId)
        if (targetId) this.cacheTargetInfo(targetId, info)
        break
      }
      case 'Inspector.detached': {
        if (sessionId) this.dropSession(sessionId)
        break
      }
      case 'Page.frameStartedLoading': {
        const session = sessionId ? this.sessionsById.get(sessionId) : undefined
        if (session) session.loading = true
        break
      }
      case 'Page.loadEventFired':
      case 'Page.frameStoppedLoading': {
        const session = sessionId ? this.sessionsById.get(sessionId) : undefined
        if (session) session.loading = false
        break
      }
      default:
        break
    }
  }

  private handleClose = (): void => {
    if (!this.socket) return
    this.socket = null
    this.rejectAllPending(new McpCallError('CDP 连接已断开，请重新连接。', {
      kind: 'transport',
      code: 'CLOSED',
    }))
  }
}

function isMissingTargetError(error: McpCallError): boolean {
  return error.code === -32602 || /no target|not found/i.test(error.message)
}
