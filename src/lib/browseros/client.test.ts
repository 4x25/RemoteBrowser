import { describe, expect, it, vi } from 'vitest'
import { BrowserOsClient } from './client'

const REQUIRED_TOOLS = ['tabs', 'navigate', 'screenshot', 'act', 'run']

type RpcBody = {
  id?: number
  method: string
  params?: Record<string, unknown>
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function makeFetch(
  handler?: (body: RpcBody, init: RequestInit) => unknown,
): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as RpcBody
    if (body.method === 'notifications/initialized') {
      return new Response(null, { status: 202 })
    }
    if (body.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-06-18',
          serverInfo: { name: 'BrowserOS MCP', version: '0.0.127' },
        },
      })
    }
    if (body.method === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools: REQUIRED_TOOLS.map((name) => ({ name })) },
      })
    }

    const result = handler?.(body, init ?? {})
    return jsonResponse({ jsonrpc: '2.0', id: body.id, result })
  }) as typeof fetch
}

async function connectedClient(
  handler?: (body: RpcBody, init: RequestInit) => unknown,
): Promise<{ client: BrowserOsClient; fetchMock: ReturnType<typeof vi.fn> }> {
  const fetchImpl = makeFetch(handler)
  const client = new BrowserOsClient({ fetch: fetchImpl })
  await client.connect('http://127.0.0.1:9000/mcp')
  return { client, fetchMock: fetchImpl as ReturnType<typeof vi.fn> }
}

describe('BrowserOsClient connection', () => {
  it('initializes without custom MCP headers and validates tools', async () => {
    const { client, fetchMock } = await connectedClient()

    expect(client.state).toBe('connected')
    expect(client.serverInfo).toEqual({
      name: 'BrowserOS MCP',
      version: '0.0.127',
      protocolVersion: '2025-06-18',
    })
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers).toEqual({
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    })
    expect(headers).not.toHaveProperty('MCP-Protocol-Version')
  })

  it('rejects a server missing a required tool', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as RpcBody
      if (body.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result:
          body.method === 'initialize'
            ? { protocolVersion: '2025-06-18' }
            : { tools: REQUIRED_TOOLS.filter((name) => name !== 'run').map((name) => ({ name })) },
      })
    }) as typeof fetch
    const client = new BrowserOsClient({ fetch: fetchImpl })

    await expect(client.connect('http://localhost:9000/mcp')).rejects.toEqual(
      expect.objectContaining({ kind: 'connection', code: 'MISSING_TOOLS' }),
    )
    expect(client.state).toBe('error')
  })

  it('normalizes timeout and caller abort errors', async () => {
    const stalledFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    ) as typeof fetch
    const timeoutClient = new BrowserOsClient({ fetch: stalledFetch, requestTimeoutMs: 5 })
    await expect(timeoutClient.connect('http://localhost:9000/mcp')).rejects.toEqual(
      expect.objectContaining({ kind: 'timeout' }),
    )

    const controller = new AbortController()
    const abortClient = new BrowserOsClient({ fetch: stalledFetch })
    const pending = abortClient.connect('http://localhost:9000/mcp', {
      signal: controller.signal,
    })
    controller.abort()
    await expect(pending).rejects.toEqual(expect.objectContaining({ kind: 'aborted' }))
  })
})

describe('BrowserOsClient tools', () => {
  it('maps structured tab metadata and page state', async () => {
    const { client } = await connectedClient((body) => {
      if (body.method !== 'tools/call') return undefined
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: {
          ok: true,
          logs: [],
          value: [
            {
              pageId: 12,
              tabId: 44,
              url: 'https://example.com/',
              title: 'Example Domain',
              isActive: true,
              isLoading: false,
              loadProgress: 1,
              index: 0,
              metrics: {
                cssVisualViewport: {
                  clientWidth: 1280,
                  clientHeight: 720,
                  pageX: 0,
                  pageY: 120,
                  offsetX: 0,
                  offsetY: 0,
                  scale: 1,
                  zoom: 1,
                },
                cssContentSize: { width: 1280, height: 2400 },
              },
              history: {
                currentIndex: 1,
                entries: [
                  { id: 1, url: 'https://example.com/a', userTypedURL: '', title: 'A' },
                  { id: 2, url: 'https://example.com/', userTypedURL: '', title: 'B' },
                  { id: 3, url: 'https://example.com/c', userTypedURL: '', title: 'C' },
                ],
              },
            },
          ],
        },
      }
    })

    const [tab] = await client.listTabs()
    expect(tab).toEqual(
      expect.objectContaining({ pageId: 12, title: 'Example Domain', isActive: true }),
    )
    expect(tab?.pageState).toEqual(
      expect.objectContaining({
        pageId: 12,
        historyIndex: 1,
        historyLength: 3,
        canGoBack: true,
        canGoForward: true,
        viewport: expect.objectContaining({
          width: 1280,
          height: 720,
          pageY: 120,
          contentHeight: 2400,
        }),
      }),
    )
  })

  it('maps navigation, pointer, scroll, drag, typing, and key calls', async () => {
    const calls: Array<{ name?: unknown; arguments?: unknown }> = []
    const { client } = await connectedClient((body) => {
      if (body.method === 'tools/call') {
        calls.push((body.params ?? {}) as { name?: unknown; arguments?: unknown })
      }
      if ((body.params as { name?: string } | undefined)?.name === 'run') {
        return { structuredContent: { ok: true, value: { pageId: 4 }, logs: [] } }
      }
      return { content: [{ type: 'text', text: 'ok' }] }
    })

    await client.activateTab(4)
    await client.navigate(4, { action: 'url', url: 'https://example.com/path' })
    await client.click(4, { x: 20, y: 30 }, { button: 'right', clickCount: 2 })
    await client.hover(4, { x: 22, y: 33 })
    await client.scroll(4, { direction: 'down', amount: 5 })
    await client.drag(4, { x: 1, y: 2 }, { x: 11, y: 12 })
    await client.type(4, 'hello')
    await client.press(4, 'Control+a')

    expect(calls.map((call) => call.name)).toEqual([
      'run',
      'navigate',
      'act',
      'act',
      'act',
      'act',
      'act',
      'act',
    ])
    expect(calls[1]?.arguments).toEqual({
      action: 'url',
      page: 4,
      url: 'https://example.com/path',
    })
    expect(calls[2]?.arguments).toEqual(
      expect.objectContaining({
        kind: 'click_at',
        page: 4,
        x: 20,
        y: 30,
        button: 'right',
        clickCount: 2,
      }),
    )
  })

  it('returns base64 screenshot data without creating a Blob URL', async () => {
    const { client } = await connectedClient((body) => {
      if ((body.params as { name?: string } | undefined)?.name === 'screenshot') {
        return {
          content: [{ type: 'image', data: 'UklGRg==', mimeType: 'image/webp' }],
        }
      }
      return { content: [] }
    })

    const frame = await client.captureFrame(8, { width: 800, height: 600 })
    expect(frame).toEqual(
      expect.objectContaining({
        pageId: 8,
        data: 'UklGRg==',
        mimeType: 'image/webp',
        width: 800,
        height: 600,
      }),
    )
  })

  it('validates values before dispatching them', async () => {
    const { client, fetchMock } = await connectedClient()
    const callCount = fetchMock.mock.calls.length

    await expect(client.navigate(1, { action: 'url', url: 'javascript:alert(1)' }))
      .rejects.toEqual(expect.objectContaining({ kind: 'validation' }))
    await expect(client.click(1, { x: -1, y: 0 })).rejects.toEqual(
      expect.objectContaining({ kind: 'validation' }),
    )
    await expect(client.captureFrame(1, { width: 1441 })).rejects.toEqual(
      expect.objectContaining({ kind: 'validation' }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(callCount)
  })
})
