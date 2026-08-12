export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

export type NavigationAction = 'url' | 'back' | 'forward' | 'reload'

export type MouseButton = 'left' | 'middle' | 'right'

export type ScrollDirection = 'up' | 'down' | 'left' | 'right'

export type ScreenshotFormat = 'webp' | 'jpeg'

export type ClientColorScheme = 'light' | 'dark'

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface BrowserOsClientOptions {
  fetch?: typeof fetch
  requestTimeoutMs?: number
  protocolVersion?: string
  clientName?: string
  clientVersion?: string
}

export interface RemotePoint {
  x: number
  y: number
}

export interface ViewportMetrics {
  width: number
  height: number
  pageX: number
  pageY: number
  offsetX: number
  offsetY: number
  scale: number
  zoom: number
  contentWidth: number
  contentHeight: number
}

export interface NavigationEntry {
  id: number
  url: string
  userTypedUrl: string
  title: string
  transitionType?: string
}

export interface PageState {
  pageId: number
  url: string
  title: string
  isActive: boolean
  isLoading: boolean
  loadProgress: number
  viewport: ViewportMetrics | null
  historyIndex: number
  historyLength: number
  history: NavigationEntry[]
  canGoBack: boolean
  canGoForward: boolean
}

export interface RemoteTab {
  pageId: number
  tabId?: number
  targetId?: string
  windowId?: number
  index: number
  url: string
  title: string
  isActive: boolean
  isLoading: boolean
  loadProgress: number
  isPinned: boolean
  isHidden: boolean
  browserContextId?: string
  pageState: PageState
}

export interface RemoteFrame {
  pageId: number
  data: string
  mimeType: 'image/webp' | 'image/jpeg'
  format: ScreenshotFormat
  width: number
  height: number
  capturedAt: number
}

export interface NavigateRequest {
  action: NavigationAction
  url?: string
}

export interface SetViewportRequest {
  width: number
  height: number
  deviceScaleFactor: number
}

export interface UserAgentBrandVersion {
  brand: string
  version: string
}

/** Chrome DevTools Protocol user-agent client hint metadata. */
export interface UserAgentMetadata {
  brands?: UserAgentBrandVersion[]
  fullVersionList?: UserAgentBrandVersion[]
  platform: string
  platformVersion: string
  architecture: string
  model: string
  mobile: boolean
  bitness?: string
  wow64?: boolean
}

export interface ClientEnvironmentRequest {
  userAgent: string
  platform: string
  acceptLanguage: string
  colorScheme: ClientColorScheme
  userAgentMetadata?: UserAgentMetadata
}

export interface CaptureFrameOptions extends RequestOptions {
  width?: number
  height?: number
  format?: ScreenshotFormat
  quality?: number
}

export interface ClickOptions extends RequestOptions {
  button?: MouseButton
  clickCount?: number
}

export interface ScrollOptions extends RequestOptions {
  direction: ScrollDirection
  amount?: number
}

export interface McpServerInfo {
  name?: string
  version?: string
  protocolVersion?: string
}
