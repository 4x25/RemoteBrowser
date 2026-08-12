export { BrowserOsClient } from './client'
export { McpCallError } from './errors'
export type { McpCallErrorOptions, McpErrorKind } from './errors'
export { parseMcpResponse, unwrapJsonRpcResponse } from './protocol'
export { LIST_TABS_SCRIPT } from './scripts'
export type {
  BrowserOsClientOptions,
  CaptureFrameOptions,
  ClickOptions,
  ConnectionState,
  McpServerInfo,
  MouseButton,
  NavigateRequest,
  NavigationAction,
  NavigationEntry,
  PageState,
  RemoteFrame,
  RemotePoint,
  RemoteTab,
  RequestOptions,
  ScreenshotFormat,
  ScrollDirection,
  ScrollOptions,
  SetViewportRequest,
  ViewportMetrics,
} from './types'
