import { describe, expect, it, vi } from 'vitest'
import { CdpClient, type CdpSocket, type CdpSocketEvent } from './client'

interface SentCommand {
  id: number
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

interface FakeHistory {
  currentIndex: number
  entries: Array<Record<string, unknown>>
}

interface FakeTarget {
  targetId: string
  title: string
  url: string
  visibility: 'visible' | 'hidden'
  readyState?: string
  history?: FakeHistory
  metrics?: Record<string, unknown>
  browserContextId?: string
}

const DEFAULT_METRICS = {
  cssVisualViewport: {
    clientWidth: 785,
    clientHeight: 600,
    pageX: 0,
    pageY: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    zoom: 1,
  },
  cssContentSize: { x: 0, y: 0, width: 785, height: 1500 },
}

class FakeSocket implements CdpSocket {
  readonly sent: SentCommand[] = []
  closed = false
  private readonly handlers = new Map<
    string,
    Set<(event: CdpSocketEvent) => void>
  >()

  constructor(
    readonly url: string,
    private readonly browser: FakeBrowser,
  ) {}

  addEventListener(
    type: string,
    listener: (event: CdpSocketEvent) => void,
  ): void {
    const listeners = this.handlers.get(type) ?? new Set()
    listeners.add(listener)
    this.handlers.set(type, listeners)
  }

  removeEventListener(
    type: string,
    listener: (event: CdpSocketEvent) => void,
  ): void {
    this.handlers.get(type)?.delete(listener)
  }

  send(data: string): void {
    const command = JSON.parse(data) as SentCommand
    this.sent.push(command)
    let result: unknown
    try {
      result = this.browser.handle(command)
    } catch (error) {
      this.fail(command.id, error instanceof Error ? error.message : 'fake error')
      return
    }
    if (result === undefined) return
    if (result instanceof Error) {
      this.fail(command.id, result.message)
      return
    }
    this.respond(command.id, result)
  }

  close(): void {
    this.closed = true
    this.emit('close')
  }

  emit(type: string, event: CdpSocketEvent = {}): void {
    for (const listener of this.handlers.get(type) ?? []) listener(event)
  }

  respond(id: number, result: unknown): void {
    this.emit('message', { data: JSON.stringify({ id, result }) })
  }

  fail(id: number, message: string, code = -32000): void {
    this.emit('message', {
      data: JSON.stringify({ id, error: { code, message } }),
    })
  }

  cdpEvent(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): void {
    this.emit('message', {
      data: JSON.stringify({
        method,
        params,
        ...(sessionId === undefined ? {} : { sessionId }),
      }),
    })
  }
}

class FakeBrowser {
  targets: FakeTarget[] = []
  readonly stalled = new Set<string>()
  readonly commands: SentCommand[] = []
  private readonly sessions = new Map<string, string>()

  handle(command: SentCommand): unknown {
    this.commands.push(command)
    const target = command.sessionId === undefined
      ? undefined
      : this.targetFor(command.sessionId)
    if (this.stalled.has(command.method)) return undefined

    switch (command.method) {
      case 'Browser.getVersion':
        return { product: 'Chrome/154.0.0.0', protocolVersion: '1.3' }
      case 'Target.getTargets':
        return {
          targetInfos: [
            { targetId: 'ignored', type: 'browser_ui', title: '', url: '' },
            ...this.targets.map((candidate) => ({
              targetId: candidate.targetId,
              type: 'page',
              title: candidate.title,
              url: candidate.url,
              attached: false,
              ...(candidate.browserContextId === undefined
                ? {}
                : { browserContextId: candidate.browserContextId }),
            })),
          ],
        }
      case 'Target.attachToTarget': {
        const targetId = String(command.params.targetId)
        const sessionId = `session-${targetId}`
        this.sessions.set(sessionId, targetId)
        return { sessionId }
      }
      case 'Target.activateTarget': {
        const targetId = String(command.params.targetId)
        for (const candidate of this.targets) {
          candidate.visibility =
            candidate.targetId === targetId ? 'visible' : 'hidden'
        }
        return {}
      }
      case 'Target.createTarget': {
        const url = String(command.params.url ?? 'about:blank')
        const count = this.targets.length + 1
        const created: FakeTarget = {
          targetId: `target-${count}`,
          title: url,
          url,
          visibility: 'visible',
        }
        for (const candidate of this.targets) candidate.visibility = 'hidden'
        this.targets.push(created)
        return { targetId: created.targetId }
      }
      case 'Target.closeTarget': {
        const targetId = String(command.params.targetId)
        this.targets = this.targets.filter(
          (candidate) => candidate.targetId !== targetId,
        )
        return { success: true }
      }
      case 'Page.getNavigationHistory':
        return target?.history ?? { currentIndex: 0, entries: [] }
      case 'Page.getLayoutMetrics':
        return target?.metrics ?? DEFAULT_METRICS
      case 'Page.captureScreenshot':
        return { data: 'c2NyZWVuc2hvdA==' }
      case 'Runtime.evaluate':
        if (!target) throw new Error('Runtime.evaluate without session')
        return {
          result: {
            type: 'object',
            value: {
              title: target.title,
              url: target.url,
              readyState: target.readyState ?? 'complete',
              visibilityState: target.visibility,
            },
          },
        }
      default:
        return {}
    }
  }

  private targetFor(sessionId: string): FakeTarget {
    const targetId = this.sessions.get(sessionId)
    const target = this.targets.find(
      (candidate) => candidate.targetId === targetId,
    )
    if (!target) throw new Error(`unknown session ${sessionId}`)
    return target
  }
}

async function connectClient(options: {
  browser?: FakeBrowser
  fetchImpl?: typeof fetch
  requestTimeoutMs?: number
} = {}) {
  const browser = options.browser ?? new FakeBrowser()
  const sockets: FakeSocket[] = []
  const client = new CdpClient({
    requestTimeoutMs: options.requestTimeoutMs ?? 500,
    ...(options.fetchImpl === undefined ? {} : { fetch: options.fetchImpl }),
    webSocketFactory: (url) => {
      const socket = new FakeSocket(url, browser)
      sockets.push(socket)
      return socket
    },
  })

  const connecting = client.connect(
    'ws://127.0.0.1:9222/devtools/browser/fake',
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  const socket = sockets[0]
  if (!socket) throw new Error('the client never opened a socket')
  socket.emit('open')
  const serverInfo = await connecting
  return { client, socket, browser, sockets, serverInfo }
}

function pageTarget(overrides: Partial<FakeTarget> = {}): FakeTarget {
  return {
    targetId: 'target-1',
    title: 'Example Domain',
    url: 'https://example.test/',
    visibility: 'visible',
    ...overrides,
  }
}

function commandsFor(socket: FakeSocket, method: string): SentCommand[] {
  return socket.sent.filter((command) => command.method === method)
}

describe('CdpClient connection', () => {
  it('connects over WebSocket and reports the browser version', async () => {
    const { client, serverInfo, socket } = await connectClient()
    expect(socket.url).toBe('ws://127.0.0.1:9222/devtools/browser/fake')
    expect(client.state).toBe('connected')
    expect(client.endpoint).toBe('ws://127.0.0.1:9222/devtools/browser/fake')
    expect(serverInfo.name).toBe('Chrome/154.0.0.0')
    expect(serverInfo.protocolVersion).toBe('1.3')
  })

  it('fails when the WebSocket reports an error', async () => {
    const browser = new FakeBrowser()
    const sockets: FakeSocket[] = []
    const client = new CdpClient({
      requestTimeoutMs: 500,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url, browser)
        sockets.push(socket)
        return socket
      },
    })
    const connecting = client.connect(
      'ws://127.0.0.1:9222/devtools/browser/fake',
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    sockets[0]?.emit('error')
    await expect(connecting).rejects.toMatchObject({ kind: 'transport' })
    expect(client.state).toBe('error')
  })

  it('discovers a WebSocket URL from an HTTP debug port', async () => {
    const requests: string[] = []
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          webSocketDebuggerUrl:
            'ws://127.0.0.1:9333/devtools/browser/discovered',
        }),
      } as Response
    }) as unknown as typeof fetch
    const browser = new FakeBrowser()
    const sockets: FakeSocket[] = []
    const client = new CdpClient({
      fetch: fetchImpl,
      requestTimeoutMs: 500,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url, browser)
        sockets.push(socket)
        return socket
      },
    })

    const connecting = client.connect('http://127.0.0.1:9333')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const socket = sockets[0]
    expect(socket).toBeDefined()
    socket?.emit('open')
    await connecting
    expect(requests).toEqual(['http://127.0.0.1:9333/json/version'])
    expect(client.endpoint).toBe(
      'ws://127.0.0.1:9333/devtools/browser/discovered',
    )
  })

  it('explains CORS failures when /json/version is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const client = new CdpClient({
      fetch: fetchImpl,
      requestTimeoutMs: 500,
      webSocketFactory: () => {
        throw new Error('must not open a socket')
      },
    })
    await expect(client.connect('http://127.0.0.1:9333')).rejects.toMatchObject({
      kind: 'transport',
      message: expect.stringContaining('直接填写 WebSocket 调试地址'),
    })
  })
})

describe('CdpClient tabs', () => {
  it('lists page targets with stable synthetic page ids', async () => {
    const browser = new FakeBrowser()
    browser.targets = [
      pageTarget({ targetId: 'a', title: 'First', history: { currentIndex: 1, entries: [{ id: 1, url: 'https://one.test/' }, { id: 2, url: 'https://example.test/' }] }, browserContextId: 'ctx-1' }),
      pageTarget({ targetId: 'b', title: 'Second', url: 'about:blank', visibility: 'hidden' }),
    ]
    const { client } = await connectClient({ browser })

    const tabs = await client.listTabs()
    expect(tabs.map((tab) => tab.pageId)).toEqual([1, 2])
    expect(tabs.map((tab) => tab.targetId)).toEqual(['a', 'b'])
    expect(tabs[0]).toMatchObject({
      title: 'First',
      url: 'https://example.test/',
      isActive: true,
      isHidden: false,
      browserContextId: 'ctx-1',
      pageState: {
        canGoBack: true,
        canGoForward: false,
        historyIndex: 1,
        historyLength: 2,
      },
    })
    expect(tabs[1]).toMatchObject({
      title: 'Second',
      isActive: false,
      isHidden: true,
      pageState: { canGoBack: false, canGoForward: false },
    })

    const again = await client.listTabs()
    expect(again.map((tab) => tab.pageId)).toEqual([1, 2])
  })

  it('marks loading tabs from the rendered document state', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget({ readyState: 'loading' })]
    const { client } = await connectClient({ browser })
    const [tab] = await client.listTabs()
    expect(tab?.isLoading).toBe(true)
    expect(tab?.loadProgress).toBe(0)
  })

  it('attaches each target once and reattaches after detach', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const { client, socket } = await connectClient({ browser })

    await client.listTabs()
    expect(commandsFor(socket, 'Target.attachToTarget')).toHaveLength(1)

    await client.listTabs()
    expect(commandsFor(socket, 'Target.attachToTarget')).toHaveLength(1)

    socket.cdpEvent('Target.detachedFromTarget', {
      sessionId: 'session-target-1',
      targetId: 'target-1',
    })
    await client.listTabs()
    expect(commandsFor(socket, 'Target.attachToTarget')).toHaveLength(2)
  })

  it('deduplicates concurrent attach requests for the same target', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const { client, socket } = await connectClient({ browser })

    await Promise.all([client.listTabs(), client.listTabs()])
    expect(commandsFor(socket, 'Target.attachToTarget')).toHaveLength(1)
  })

  it('creates, activates and closes tabs', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const { client, socket } = await connectClient({ browser })

    await client.createTab('https://new.test/')
    const created = commandsFor(socket, 'Target.createTarget')[0]
    expect(created?.params).toMatchObject({
      url: 'https://new.test/',
      background: false,
    })
    expect(browser.targets).toHaveLength(2)

    const tabs = await client.listTabs()
    const createdTab = tabs.find((tab) => tab.url === 'https://new.test/')
    expect(createdTab).toBeDefined()

    await client.activateTab(createdTab?.pageId ?? 0)
    expect(commandsFor(socket, 'Target.activateTarget')[0]?.params).toMatchObject({
      targetId: createdTab?.targetId,
    })

    await client.closeTab(createdTab?.pageId ?? 0)
    expect(browser.targets).toHaveLength(1)
    const remaining = await client.listTabs()
    expect(remaining.map((tab) => tab.targetId)).toEqual(['target-1'])
  })

  it('drops destroyed targets', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget({ targetId: 'a' }), pageTarget({ targetId: 'b', visibility: 'hidden' })]
    const { client, socket } = await connectClient({ browser })
    const before = await client.listTabs()
    expect(before).toHaveLength(2)

    browser.targets = browser.targets.filter((tab) => tab.targetId !== 'a')
    socket.cdpEvent('Target.targetDestroyed', { targetId: 'a' })
    const after = await client.listTabs()
    expect(after.map((tab) => tab.targetId)).toEqual(['b'])
    expect(after[0]?.isActive).toBe(true)
  })
})

describe('CdpClient navigation and viewport', () => {
  it('navigates URLs and follows history for back and forward', async () => {
    const browser = new FakeBrowser()
    browser.targets = [
      pageTarget({
        history: {
          currentIndex: 1,
          entries: [
            { id: 11, url: 'https://one.test/', title: 'One' },
            { id: 12, url: 'https://example.test/', title: 'Example' },
            { id: 13, url: 'https://three.test/', title: 'Three' },
          ],
        },
      }),
    ]
    const { client, socket } = await connectClient({ browser })
    const [tab] = await client.listTabs()
    const pageId = tab?.pageId ?? 0

    await client.navigate(pageId, { action: 'url', url: 'https://example.org/path' })
    expect(commandsFor(socket, 'Page.navigate')[0]?.params).toMatchObject({
      url: 'https://example.org/path',
      transitionType: 'typed',
    })

    await client.navigate(pageId, { action: 'back' })
    expect(commandsFor(socket, 'Page.navigateToHistoryEntry')[0]?.params).toMatchObject({
      entryId: 11,
    })

    await client.navigate(pageId, { action: 'forward' })
    expect(commandsFor(socket, 'Page.navigateToHistoryEntry')[1]?.params).toMatchObject({
      entryId: 13,
    })

    await client.navigate(pageId, { action: 'reload' })
    expect(commandsFor(socket, 'Page.reload')).toHaveLength(1)
  })

  it('applies device metrics and parses layout metrics', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const { client, socket } = await connectClient({ browser })
    const [tab] = await client.listTabs()

    const viewport = await client.setViewport(tab?.pageId ?? 0, {
      width: 900,
      height: 700,
      deviceScaleFactor: 1.5,
    })
    expect(commandsFor(socket, 'Emulation.setDeviceMetricsOverride')[0]?.params).toMatchObject({
      width: 900,
      height: 700,
      deviceScaleFactor: 1.5,
      mobile: false,
    })
    expect(viewport).toMatchObject({
      width: 785,
      height: 600,
      contentWidth: 785,
      contentHeight: 1500,
    })
  })

  it('forwards the client environment and retries without metadata', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const { client, socket } = await connectClient({ browser })
    const [tab] = await client.listTabs()
    const pageId = tab?.pageId ?? 0

    await client.applyClientEnvironment(pageId, {
      userAgent: 'RemoteBrowser/1.0',
      platform: 'Linux x86_64',
      acceptLanguage: 'zh-CN,en-US',
      colorScheme: 'dark',
      userAgentMetadata: {
        brands: [{ brand: 'Chromium', version: '154' }],
        mobile: false,
        platform: 'Linux',
        platformVersion: '6.0.0',
        architecture: 'x86',
        model: '',
      },
    })
    expect(commandsFor(socket, 'Emulation.setUserAgentOverride')[0]?.params).toMatchObject({
      userAgent: 'RemoteBrowser/1.0',
      acceptLanguage: 'zh-CN,en-US',
      platform: 'Linux x86_64',
      userAgentMetadata: { platform: 'Linux' },
    })
    expect(commandsFor(socket, 'Emulation.setEmulatedMedia')[0]?.params).toMatchObject({
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    })

    // The retry path without UA client hints when the full override fails.
    const attempts: number[] = []
    const originalHandle = browser.handle.bind(browser)
    browser.handle = (command: SentCommand): unknown => {
      if (command.method === 'Emulation.setUserAgentOverride') {
        attempts.push(command.id)
        if (attempts.length === 1) throw new Error('metadata rejected')
      }
      return originalHandle(command)
    }
    await client.applyClientEnvironment(pageId, {
      userAgent: 'RemoteBrowser/1.0',
      platform: 'Linux x86_64',
      acceptLanguage: 'zh-CN,en-US',
      colorScheme: 'light',
      userAgentMetadata: {
        brands: [],
        mobile: false,
        platform: 'Linux',
        platformVersion: '',
        architecture: '',
        model: '',
      },
    })
    const overrideCommands = commandsFor(socket, 'Emulation.setUserAgentOverride')
    expect(overrideCommands).toHaveLength(3)
    expect(overrideCommands[1]?.params.userAgentMetadata).toBeDefined()
    expect(overrideCommands[2]?.params.userAgentMetadata).toBeUndefined()
  })

  it('rejects invalid viewport and navigation requests', async () => {
    const { client } = await connectClient()
    await expect(
      client.setViewport(1, { width: 0, height: 100, deviceScaleFactor: 1 }),
    ).rejects.toMatchObject({ kind: 'validation' })
    await expect(
      client.navigate(1, { action: 'url' }),
    ).rejects.toMatchObject({ kind: 'validation' })
    await expect(
      client.navigate(1, { action: 'back', url: 'https://example.test/' }),
    ).rejects.toMatchObject({ kind: 'validation' })
  })
})

describe('CdpClient capture and input', () => {
  it('captures frames and activates hidden targets first', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget({ visibility: 'hidden' })]
    const { client, socket } = await connectClient({ browser })
    const [tab] = await client.listTabs()
    const pageId = tab?.pageId ?? 0

    const frame = await client.captureFrame(pageId, {
      width: 800,
      height: 600,
      format: 'webp',
      quality: 70,
    })
    expect(frame).toMatchObject({
      pageId,
      mimeType: 'image/webp',
      format: 'webp',
      width: 800,
      height: 600,
      data: 'c2NyZWVuc2hvdA==',
    })

    const methods = socket.sent.map((command) => command.method)
    expect(methods.indexOf('Target.activateTarget')).toBeGreaterThan(-1)
    expect(methods.indexOf('Target.activateTarget')).toBeLessThan(
      methods.indexOf('Page.captureScreenshot'),
    )
    expect(commandsFor(socket, 'Page.captureScreenshot')[0]?.params).toMatchObject({
      format: 'webp',
      quality: 70,
      fromSurface: true,
      captureBeyondViewport: false,
    })
  })

  it('sends pointer, wheel, text and key events', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const { client, socket } = await connectClient({ browser })
    const [tab] = await client.listTabs()
    const pageId = tab?.pageId ?? 0

    await client.click(pageId, { x: 10, y: 20 })
    await client.click(pageId, { x: 10, y: 20 }, { button: 'right', clickCount: 2 })
    await client.hover(pageId, { x: 30, y: 40 })
    await client.scroll(pageId, { direction: 'down', amount: 3 })
    await client.drag(pageId, { x: 5, y: 6 }, { x: 50, y: 60 })
    await client.type(pageId, 'hello')
    await client.press(pageId, 'Control+Shift+p')

    const mouse = commandsFor(socket, 'Input.dispatchMouseEvent')
    expect(mouse[0]?.params).toMatchObject({ type: 'mouseMoved', x: 10, y: 20 })
    expect(mouse[1]?.params).toMatchObject({
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
    })
    expect(mouse[2]?.params).toMatchObject({ type: 'mouseReleased' })
    const rightClick = mouse.filter(
      (command) =>
        command.params.button === 'right' &&
        command.params.type === 'mousePressed',
    )
    expect(rightClick.map((command) => command.params.clickCount)).toEqual([1, 2])

    const wheel = mouse.find((command) => command.params.type === 'mouseWheel')
    expect(wheel?.params).toMatchObject({
      x: 785 / 2,
      y: 600 / 2,
      deltaX: 0,
      deltaY: 300,
    })

    const dragMoves = mouse.filter(
      (command) =>
        command.params.type === 'mouseMoved' && command.params.buttons === 1,
    )
    expect(dragMoves.length).toBeGreaterThan(1)

    expect(commandsFor(socket, 'Input.insertText')[0]?.params).toMatchObject({
      text: 'hello',
    })

    const keys = commandsFor(socket, 'Input.dispatchKeyEvent')
    expect(keys.map((command) => command.params.type)).toEqual([
      'keyDown',
      'keyDown',
      'keyDown',
      'keyUp',
      'keyUp',
      'keyUp',
    ])
    expect(keys[2]?.params).toMatchObject({
      key: 'P',
      code: 'KeyP',
      modifiers: 10,
    })
  })

  it('rejects malformed input', async () => {
    const { client } = await connectClient()
    await expect(client.press(1, 'Banana+p')).rejects.toMatchObject({
      kind: 'validation',
    })
    await expect(client.type(1, '')).rejects.toMatchObject({
      kind: 'validation',
    })
    await expect(client.click(1, { x: -1, y: 0 })).rejects.toMatchObject({
      kind: 'validation',
    })
  })
})

describe('CdpClient lifecycle', () => {
  it('times out unanswered commands', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    browser.stalled.add('Page.captureScreenshot')
    const { client } = await connectClient({ browser, requestTimeoutMs: 30 })
    const [tab] = await client.listTabs()

    await expect(
      client.captureFrame(tab?.pageId ?? 0, { timeoutMs: 30 }),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('rejects aborted requests', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    browser.stalled.add('Page.captureScreenshot')
    const { client } = await connectClient({ browser, requestTimeoutMs: 5_000 })
    const [tab] = await client.listTabs()

    const controller = new AbortController()
    const request = client.captureFrame(tab?.pageId ?? 0, {
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await expect(request).rejects.toMatchObject({ kind: 'aborted' })
  })

  it('rejects commands after disconnect and marks the state', async () => {
    const { client } = await connectClient()
    client.disconnect()
    expect(client.state).toBe('disconnected')
    await expect(client.listTabs()).rejects.toMatchObject({
      kind: 'connection',
    })
  })

  it('rejects in-flight commands when the transport closes', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    browser.stalled.add('Page.captureScreenshot')
    const { client, socket } = await connectClient({
      browser,
      requestTimeoutMs: 5_000,
    })
    const [tab] = await client.listTabs()

    const request = client.captureFrame(tab?.pageId ?? 0)
    await new Promise((resolve) => setTimeout(resolve, 0))
    socket.emit('close')
    await expect(request).rejects.toMatchObject({
      kind: 'transport',
      code: 'CLOSED',
    })
    await expect(client.listTabs()).rejects.toMatchObject({
      kind: 'connection',
    })
  })

  it('reconnects on the same client without stale socket interference', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const sockets: FakeSocket[] = []
    const client = new CdpClient({
      requestTimeoutMs: 500,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url, browser)
        sockets.push(socket)
        return socket
      },
    })

    const first = client.connect('ws://127.0.0.1:9222/devtools/browser/one')
    await new Promise((resolve) => setTimeout(resolve, 0))
    sockets[0]?.emit('open')
    await first

    const second = client.connect('ws://127.0.0.1:9222/devtools/browser/two')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sockets[0]?.closed).toBe(true)
    sockets[1]?.emit('open')
    await second
    expect(client.endpoint).toBe('ws://127.0.0.1:9222/devtools/browser/two')

    // A late close from the replaced socket must not clear the live session.
    sockets[0]?.emit('close')
    await expect(client.listTabs()).resolves.toHaveLength(1)
  })

  it('keeps the newest connection when an older attempt resolves late', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const sockets: FakeSocket[] = []
    const client = new CdpClient({
      requestTimeoutMs: 500,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url, browser)
        sockets.push(socket)
        return socket
      },
    })

    const first = client.connect('ws://127.0.0.1:9222/devtools/browser/one')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const second = client.connect('ws://127.0.0.1:9222/devtools/browser/two')
    await new Promise((resolve) => setTimeout(resolve, 0))

    sockets[1]?.emit('open')
    await second
    expect(client.state).toBe('connected')

    sockets[0]?.emit('open')
    await expect(first).rejects.toMatchObject({ kind: 'aborted' })
    expect(client.state).toBe('connected')
    expect(client.endpoint).toBe('ws://127.0.0.1:9222/devtools/browser/two')
    await expect(client.listTabs()).resolves.toHaveLength(1)
  })

  it('retries a failed screenshot once after reactivating the target', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    const { client, socket } = await connectClient({ browser })
    const [tab] = await client.listTabs()
    let attempts = 0
    const original = browser.handle.bind(browser)
    browser.handle = (command: SentCommand): unknown => {
      if (command.method === 'Page.captureScreenshot') {
        attempts += 1
        if (attempts === 1) throw new Error('flaky screenshot')
      }
      return original(command)
    }

    const frame = await client.captureFrame(tab?.pageId ?? 0, { format: 'jpeg' })
    expect(frame.mimeType).toBe('image/jpeg')
    expect(commandsFor(socket, 'Page.captureScreenshot')).toHaveLength(2)
  })

  it('surfaces command failures as rpc errors', async () => {
    const browser = new FakeBrowser()
    browser.targets = [pageTarget()]
    browser.stalled.add('Target.getTargets')
    const { client, socket } = await connectClient({ browser })
    const request = client.listTabs()
    const getTargets = commandsFor(socket, 'Target.getTargets')[0]
    expect(getTargets).toBeDefined()
    socket.fail(getTargets?.id ?? 0, 'No target with given id found')
    await expect(request).rejects.toMatchObject({
      kind: 'rpc',
      code: -32000,
    })
  })
})
