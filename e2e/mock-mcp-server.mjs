import { createServer } from 'node:http'

const PORT = 4174
const WEBP_1X1 =
  'UklGRkoAAABXRUJQVlA4ID4AAADQAwCdASoBAAEAAUAmJZQCdAEO/gHCAPpE7w1qj8H/C5vW7aXZgr7MtxdXHT/4yP+fyG/uvbQAAAA='

let nextPageId = 102
let events = []
let pages = [createPage(101, 'https://example.com/', 'Example Domain', true)]

function createPage(pageId, url, title, active = false) {
  return {
    pageId,
    tabId: 1000 + pageId,
    targetId: `target-${pageId}`,
    url,
    title,
    isActive: active,
    isLoading: false,
    loadProgress: 1,
    isPinned: false,
    isHidden: false,
    windowId: 1,
    index: pageId,
    browserContextId: 'Default',
    metrics: {
      cssVisualViewport: {
        pageX: 0,
        pageY: 0,
        offsetX: 0,
        offsetY: 0,
        clientWidth: 1280,
        clientHeight: 720,
        scale: 1,
        zoom: 1,
      },
      cssContentSize: { width: 1280, height: 1600 },
    },
    history: {
      currentIndex: 0,
      entries: [historyEntry(pageId * 10, url, title)],
    },
  }
}

function historyEntry(id, url, title) {
  return { id, url, userTypedURL: url, title, transitionType: 'typed' }
}

function corsHeaders(origin) {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Accept,Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}

function json(response, status, value, origin) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    ...corsHeaders(origin),
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function activate(pageId) {
  pages = pages.map((page) => ({ ...page, isActive: page.pageId === pageId }))
}

function toolCall(name, args) {
  if (name === 'run') {
    if (String(args.code).includes('Page.bringToFront')) {
      const pageId = Number(String(args.code).match(/cdpJsonForPage\((\d+)/)?.[1])
      activate(pageId)
      return {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: { ok: true, value: { pageId }, logs: [] },
      }
    }
    return {
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { ok: true, value: pages, logs: [] },
    }
  }

  if (name === 'tabs') {
    if (args.action === 'new') {
      const pageId = nextPageId++
      activate(-1)
      pages.push(createPage(pageId, args.url || 'about:blank', '新标签页', true))
      return { content: [{ type: 'text', text: `opened page ${pageId}` }] }
    }
    if (args.action === 'close') {
      const wasActive = pages.find((page) => page.pageId === args.page)?.isActive
      pages = pages.filter((page) => page.pageId !== args.page)
      if (wasActive && pages[0]) activate(pages[0].pageId)
      return { content: [{ type: 'text', text: `closed page ${args.page}` }] }
    }
  }

  if (name === 'navigate') {
    const page = pages.find((candidate) => candidate.pageId === args.page)
    if (page && args.action === 'url') {
      const url = new URL(args.url)
      const title = url.hostname || args.url
      page.url = args.url
      page.title = title
      page.history.entries = page.history.entries.slice(0, page.history.currentIndex + 1)
      page.history.entries.push(historyEntry(Date.now(), args.url, title))
      page.history.currentIndex += 1
    } else if (page && args.action === 'back' && page.history.currentIndex > 0) {
      page.history.currentIndex -= 1
      const entry = page.history.entries[page.history.currentIndex]
      page.url = entry.url
      page.title = entry.title
    } else if (
      page &&
      args.action === 'forward' &&
      page.history.currentIndex < page.history.entries.length - 1
    ) {
      page.history.currentIndex += 1
      const entry = page.history.entries[page.history.currentIndex]
      page.url = entry.url
      page.title = entry.title
    }
    return { content: [{ type: 'text', text: 'navigation complete' }] }
  }

  if (name === 'screenshot') {
    return {
      content: [{ type: 'image', mimeType: 'image/webp', data: WEBP_1X1 }],
    }
  }

  if (name === 'act') {
    events.push({ ...args, receivedAt: Date.now() })
    return { content: [{ type: 'text', text: 'ok' }] }
  }

  return { isError: true, content: [{ type: 'text', text: `unsupported ${name}` }] }
}

const server = createServer((request, response) => {
  const origin = request.headers.origin
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(origin))
    response.end()
    return
  }
  if (request.url === '/health') {
    json(response, 200, { status: 'ok' }, origin)
    return
  }
  if (request.url === '/events') {
    json(response, 200, events, origin)
    return
  }
  if (request.url !== '/mcp' || request.method !== 'POST') {
    json(response, 404, { error: 'not found' }, origin)
    return
  }

  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
  })
  request.on('end', () => {
    const message = JSON.parse(body)
    if (message.method === 'notifications/initialized') {
      response.writeHead(202, corsHeaders(origin))
      response.end()
      return
    }
    if (message.method === 'initialize') {
      json(
        response,
        200,
        rpcResult(message.id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'browseros_mcp_mock', version: '0.0.127-test' },
        }),
        origin,
      )
      return
    }
    if (message.method === 'tools/list') {
      json(
        response,
        200,
        rpcResult(message.id, {
          tools: ['tabs', 'navigate', 'screenshot', 'act', 'run'].map((name) => ({
            name,
            inputSchema: { type: 'object' },
          })),
        }),
        origin,
      )
      return
    }
    if (message.method === 'tools/call') {
      json(
        response,
        200,
        rpcResult(
          message.id,
          toolCall(message.params.name, message.params.arguments || {}),
        ),
        origin,
      )
      return
    }
    json(response, 400, { error: 'unknown method' }, origin)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock BrowserOS MCP listening on http://127.0.0.1:${PORT}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
