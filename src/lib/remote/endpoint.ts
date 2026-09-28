import type { RemoteBrowserTransport } from './types'

const INSECURE_PROTOCOLS = new Set(['http:', 'ws:'])

/**
 * Validates and normalizes a user-entered connection address for the chosen
 * transport. CDP also accepts WebSocket debugger URLs; HTTP(S) addresses are
 * resolved to a WebSocket URL during connect.
 */
export function normalizeRemoteEndpoint(
  input: string,
  transport: RemoteBrowserTransport,
  pageProtocol: string = typeof window === 'undefined'
    ? 'http:'
    : window.location.protocol,
): string {
  const value = input.trim()
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error(
      transport === 'cdp'
        ? '请输入完整的 CDP 地址，例如 ws://127.0.0.1:9222/devtools/browser/…。'
        : '请输入完整的 HTTP(S) MCP 地址。',
    )
  }

  const allowed =
    transport === 'cdp'
      ? ['http:', 'https:', 'ws:', 'wss:']
      : ['http:', 'https:']
  if (!allowed.includes(endpoint.protocol)) {
    throw new Error(
      transport === 'cdp'
        ? 'CDP 地址只支持 ws://、wss://、http:// 或 https://。'
        : 'MCP 地址只支持 HTTP 或 HTTPS。',
    )
  }

  if (
    pageProtocol === 'https:' &&
    INSECURE_PROTOCOLS.has(endpoint.protocol)
  ) {
    throw new Error(
      transport === 'cdp'
        ? 'HTTPS 页面不能连接非加密的 CDP 地址，请使用 wss:// 或 https://。'
        : 'HTTPS 页面不能连接 HTTP MCP，请为 BrowserOS MCP 配置 HTTPS。',
    )
  }

  return endpoint.href
}
