import { describe, expect, it } from 'vitest'
import { normalizeRemoteEndpoint } from './endpoint'

describe('normalizeRemoteEndpoint', () => {
  it('keeps HTTP(S) MCP addresses intact', () => {
    expect(
      normalizeRemoteEndpoint('  http://127.0.0.1:9000/mcp  ', 'browseros'),
    ).toBe('http://127.0.0.1:9000/mcp')
    expect(
      normalizeRemoteEndpoint('https://example.test/mcp', 'browseros'),
    ).toBe('https://example.test/mcp')
  })

  it('rejects WebSocket addresses for the MCP transport', () => {
    expect(() =>
      normalizeRemoteEndpoint('ws://127.0.0.1:9222/devtools/browser/x', 'browseros'),
    ).toThrow(/只支持 HTTP 或 HTTPS/)
  })

  it('accepts WebSocket and HTTP addresses for CDP', () => {
    expect(
      normalizeRemoteEndpoint(
        'ws://127.0.0.1:9222/devtools/browser/abc?token=1',
        'cdp',
      ),
    ).toBe('ws://127.0.0.1:9222/devtools/browser/abc?token=1')
    expect(
      normalizeRemoteEndpoint('wss://debug.example.test/devtools/browser', 'cdp'),
    ).toBe('wss://debug.example.test/devtools/browser')
    expect(normalizeRemoteEndpoint('http://127.0.0.1:9222', 'cdp')).toBe(
      'http://127.0.0.1:9222/',
    )
  })

  it('rejects other protocols and malformed input', () => {
    expect(() => normalizeRemoteEndpoint('ftp://example.test', 'cdp')).toThrow(
      /只支持 ws:\/\/、wss:\/\/、http:\/\/ 或 https:\/\//,
    )
    expect(() => normalizeRemoteEndpoint('not a url', 'cdp')).toThrow(
      /请输入完整的 CDP 地址/,
    )
    expect(() => normalizeRemoteEndpoint('not a url', 'browseros')).toThrow(
      /请输入完整的 HTTP\(S\) MCP 地址/,
    )
  })

  it('blocks insecure addresses on HTTPS pages', () => {
    expect(() =>
      normalizeRemoteEndpoint('http://127.0.0.1:9000/mcp', 'browseros', 'https:'),
    ).toThrow(/不能连接 HTTP MCP/)
    expect(() =>
      normalizeRemoteEndpoint('ws://127.0.0.1:9222/devtools/browser/x', 'cdp', 'https:'),
    ).toThrow(/不能连接非加密的 CDP 地址/)
    expect(() =>
      normalizeRemoteEndpoint('http://127.0.0.1:9222', 'cdp', 'https:'),
    ).toThrow(/不能连接非加密的 CDP 地址/)
    expect(
      normalizeRemoteEndpoint('wss://debug.example.test/x', 'cdp', 'https:'),
    ).toBe('wss://debug.example.test/x')
  })
})
