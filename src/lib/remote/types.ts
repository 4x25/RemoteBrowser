import type {
  CaptureFrameOptions,
  ClickOptions,
  ClientEnvironmentRequest,
  ConnectionState,
  McpServerInfo,
  NavigateRequest,
  PageState,
  RemoteFrame,
  RemotePoint,
  RemoteTab,
  RequestOptions,
  ScrollOptions,
  SetViewportRequest,
  ViewportMetrics,
} from '../browseros/types'

export type RemoteBrowserTransport = 'browseros' | 'cdp'

/**
 * Transport-neutral contract implemented by every remote browser client.
 *
 * `BrowserOsClient` (MCP) and `CdpClient` both satisfy this surface, so the
 * orchestration hook never depends on a concrete transport.
 */
export interface RemoteBrowserClient {
  readonly state: ConnectionState
  readonly endpoint: string | null
  readonly serverInfo: McpServerInfo | null
  connect(endpoint: string, options?: RequestOptions): Promise<McpServerInfo>
  disconnect(): void
  listTabs(options?: RequestOptions): Promise<RemoteTab[]>
  getPageState(pageId: number, options?: RequestOptions): Promise<PageState>
  createTab(url?: string, options?: RequestOptions): Promise<void>
  closeTab(pageId: number, options?: RequestOptions): Promise<void>
  activateTab(pageId: number, options?: RequestOptions): Promise<void>
  navigate(
    pageId: number,
    request: NavigateRequest,
    options?: RequestOptions,
  ): Promise<void>
  setViewport(
    pageId: number,
    request: SetViewportRequest,
    options?: RequestOptions,
  ): Promise<ViewportMetrics>
  applyClientEnvironment(
    pageId: number,
    request: ClientEnvironmentRequest,
    options?: RequestOptions,
  ): Promise<void>
  captureFrame(
    pageId: number,
    options?: CaptureFrameOptions,
  ): Promise<RemoteFrame>
  click(
    pageId: number,
    point: RemotePoint,
    options?: ClickOptions,
  ): Promise<void>
  hover(
    pageId: number,
    point: RemotePoint,
    options?: RequestOptions,
  ): Promise<void>
  scroll(pageId: number, options: ScrollOptions): Promise<void>
  drag(
    pageId: number,
    start: RemotePoint,
    end: RemotePoint,
    options?: RequestOptions,
  ): Promise<void>
  type(pageId: number, text: string, options?: RequestOptions): Promise<void>
  press(pageId: number, key: string, options?: RequestOptions): Promise<void>
}
