import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  BrowserOsClient,
  McpCallError,
  type ConnectionState,
  type McpServerInfo,
  type MouseButton,
  type NavigationAction,
  type RemoteFrame,
  type RemotePoint,
  type RemoteTab,
  type ScrollDirection,
} from '../lib/browseros'
import {
  base64ToBlob,
  waitForImageDecode,
  type CaptureSize,
} from '../lib/frame'

export type ViewportPhase =
  | 'empty'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'error'
  | 'disconnected'

export interface DisplayFrame {
  pageId: number
  objectUrl: string
  naturalWidth: number
  naturalHeight: number
  capturedAt: number
  mimeType: string
}

interface RemoteBrowserState {
  connectionState: ConnectionState
  endpoint: string
  serverInfo: McpServerInfo | null
  connectionError: string | null
  tabs: RemoteTab[]
  activePageId: number | null
  syncingTabs: boolean
  navigating: boolean
  closingPageIds: number[]
  frame: DisplayFrame | null
  viewportPhase: ViewportPhase
  viewportError: string | null
}

type StateAction =
  | { type: 'connecting'; endpoint: string }
  | {
      type: 'connected'
      endpoint: string
      serverInfo: McpServerInfo
      tabs: RemoteTab[]
      activePageId: number | null
    }
  | { type: 'connectionError'; endpoint: string; error: string }
  | { type: 'disconnected' }
  | { type: 'syncingTabs'; value: boolean }
  | { type: 'tabs'; tabs: RemoteTab[] }
  | { type: 'activePage'; pageId: number | null }
  | { type: 'navigating'; value: boolean }
  | { type: 'closing'; pageId: number; value: boolean }
  | { type: 'frameLoading' }
  | { type: 'frameReady'; frame: DisplayFrame }
  | { type: 'frameFailed'; error: string }

const initialState: RemoteBrowserState = {
  connectionState: 'disconnected',
  endpoint: '',
  serverInfo: null,
  connectionError: null,
  tabs: [],
  activePageId: null,
  syncingTabs: false,
  navigating: false,
  closingPageIds: [],
  frame: null,
  viewportPhase: 'disconnected',
  viewportError: null,
}

function reducer(
  state: RemoteBrowserState,
  action: StateAction,
): RemoteBrowserState {
  switch (action.type) {
    case 'connecting':
      return {
        ...initialState,
        connectionState: 'connecting',
        endpoint: action.endpoint,
        viewportPhase: 'loading',
      }
    case 'connected':
      return {
        ...state,
        connectionState: 'connected',
        endpoint: action.endpoint,
        serverInfo: action.serverInfo,
        connectionError: null,
        tabs: action.tabs,
        activePageId: action.activePageId,
        viewportPhase: action.activePageId === null ? 'empty' : 'loading',
      }
    case 'connectionError':
      return {
        ...initialState,
        connectionState: 'error',
        endpoint: action.endpoint,
        connectionError: action.error,
        viewportPhase: 'disconnected',
      }
    case 'disconnected':
      return initialState
    case 'syncingTabs':
      return { ...state, syncingTabs: action.value }
    case 'tabs':
      return { ...state, tabs: action.tabs }
    case 'activePage':
      return {
        ...state,
        activePageId: action.pageId,
        frame: null,
        viewportPhase: action.pageId === null ? 'empty' : 'loading',
        viewportError: null,
      }
    case 'navigating':
      return { ...state, navigating: action.value }
    case 'closing': {
      const closing = new Set(state.closingPageIds)
      if (action.value) closing.add(action.pageId)
      else closing.delete(action.pageId)
      return { ...state, closingPageIds: [...closing] }
    }
    case 'frameLoading':
      return state.frame
        ? state
        : { ...state, viewportPhase: 'loading', viewportError: null }
    case 'frameReady':
      return {
        ...state,
        frame: action.frame,
        viewportPhase: 'ready',
        viewportError: null,
      }
    case 'frameFailed':
      return {
        ...state,
        viewportPhase: state.frame ? 'stale' : 'error',
        viewportError: action.error,
      }
  }
}

export interface RemoteBrowserController extends RemoteBrowserState {
  activeTab: RemoteTab | null
  connect: (endpoint: string) => Promise<boolean>
  disconnect: () => void
  refreshTabs: () => Promise<RemoteTab[]>
  selectTab: (pageId: number) => Promise<void>
  createTab: () => Promise<void>
  closeTab: (pageId: number) => Promise<void>
  navigate: (action: NavigationAction, url?: string) => Promise<void>
  refreshFrame: () => void
  setCaptureSize: (size: CaptureSize) => void
  click: (
    point: RemotePoint,
    options?: { button?: MouseButton; clickCount?: number },
  ) => void
  hover: (point: RemotePoint) => void
  scroll: (direction: ScrollDirection, amount: number) => void
  drag: (start: RemotePoint, end: RemotePoint) => void
  typeText: (text: string) => void
  pressKey: (key: string) => void
}

function describeError(error: unknown, endpoint?: string): string {
  if (error instanceof McpCallError) {
    const body = typeof error.data === 'string' ? error.data : ''
    if (
      error.status === 403 ||
      body.includes('FORBIDDEN_ORIGIN') ||
      body.includes('Origin not allowed')
    ) {
      return `BrowserOS 拒绝了当前页面来源。请用 BROWSEROS_TRUSTED_ORIGINS=${window.location.origin} 启动 BrowserOS 后重试。`
    }
    if (error.code === 'MISSING_TOOLS') return error.message
    if (error.kind === 'timeout') return '连接 BrowserOS 超时，请检查 MCP 地址和网络。'
    if (error.kind === 'transport') {
      return `无法访问 ${endpoint ?? 'BrowserOS MCP'}。请确认服务可达，并已将 ${window.location.origin} 加入 BROWSEROS_TRUSTED_ORIGINS。`
    }
    if (error.kind === 'aborted') return 'BrowserOS 请求已取消。'
    return error.message
  }
  return error instanceof Error ? error.message : 'BrowserOS 操作失败'
}

function normalizedEndpoint(input: string): string {
  const value = input.trim()
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error('请输入完整的 HTTP(S) MCP 地址。')
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('MCP 地址只支持 HTTP 或 HTTPS。')
  }
  if (window.location.protocol === 'https:' && endpoint.protocol === 'http:') {
    throw new Error('HTTPS 页面不能连接 HTTP MCP，请为 BrowserOS MCP 配置 HTTPS。')
  }
  return endpoint.href
}

function choosePageId(tabs: RemoteTab[], preferred?: number | null): number | null {
  if (preferred && tabs.some((tab) => tab.pageId === preferred)) return preferred
  return tabs.find((tab) => tab.isActive)?.pageId ?? tabs[0]?.pageId ?? null
}

export function useRemoteBrowser(): RemoteBrowserController {
  const [state, reactDispatch] = useReducer(reducer, initialState)
  const stateRef = useRef(state)
  const clientRef = useRef<BrowserOsClient | null>(null)
  const lifecycleRef = useRef(0)
  const frameGenerationRef = useRef(0)
  const frameRequestRef = useRef(0)
  const captureSizeRef = useRef<CaptureSize>({ width: 1024, height: 768 })
  const captureTimerRef = useRef<number | null>(null)
  const captureInFlightRef = useRef(false)
  const captureRequestedRef = useRef(false)
  const lastCaptureStartRef = useRef(0)
  const captureRunnerRef = useRef<() => Promise<void>>(async () => undefined)
  const tabPollTimerRef = useRef<number | null>(null)
  const tabSyncPromiseRef = useRef<Promise<RemoteTab[]> | null>(null)
  const pageQueuesRef = useRef(new Map<number, Promise<void>>())
  const pendingHoverRef = useRef(new Map<number, RemotePoint>())
  const hoverScheduledRef = useRef(new Set<number>())

  const send = useCallback((action: StateAction) => {
    stateRef.current = reducer(stateRef.current, action)
    reactDispatch(action)
  }, [])

  const revokeFrame = useCallback(() => {
    const frame = stateRef.current.frame
    if (frame) URL.revokeObjectURL(frame.objectUrl)
  }, [])

  const clearTimers = useCallback(() => {
    if (captureTimerRef.current !== null) {
      window.clearTimeout(captureTimerRef.current)
      captureTimerRef.current = null
    }
    if (tabPollTimerRef.current !== null) {
      window.clearTimeout(tabPollTimerRef.current)
      tabPollTimerRef.current = null
    }
  }, [])

  const invalidateFrame = useCallback(
    (pageId: number | null) => {
      frameGenerationRef.current += 1
      captureRequestedRef.current = false
      revokeFrame()
      send({ type: 'activePage', pageId })
    },
    [revokeFrame, send],
  )

  const scheduleCapture = useCallback((immediate = false) => {
    const current = stateRef.current
    if (
      current.connectionState !== 'connected' ||
      current.activePageId === null ||
      document.visibilityState === 'hidden'
    ) {
      return
    }

    if (captureInFlightRef.current) {
      captureRequestedRef.current = true
      return
    }

    const elapsed = Date.now() - lastCaptureStartRef.current
    const delay = immediate ? 0 : Math.max(0, 1000 - elapsed)
    if (captureTimerRef.current !== null) {
      if (!immediate) return
      window.clearTimeout(captureTimerRef.current)
    }
    captureTimerRef.current = window.setTimeout(() => {
      captureTimerRef.current = null
      void captureRunnerRef.current()
    }, delay)
  }, [])

  const loadTabs = useCallback(
    async (preferredPageId?: number | null): Promise<RemoteTab[]> => {
      const client = clientRef.current
      if (!client || client.state !== 'connected') return []

      const tabs = await client.listTabs()
      const currentPageId = stateRef.current.activePageId
      const nextPageId = choosePageId(
        tabs,
        preferredPageId === undefined ? currentPageId : preferredPageId,
      )
      send({ type: 'tabs', tabs })

      if (nextPageId !== currentPageId) {
        invalidateFrame(nextPageId)
        scheduleCapture(true)
      }
      return tabs
    },
    [invalidateFrame, scheduleCapture, send],
  )

  const refreshTabs = useCallback(async (): Promise<RemoteTab[]> => {
    if (tabSyncPromiseRef.current) return tabSyncPromiseRef.current
    send({ type: 'syncingTabs', value: true })
    const request = (async () => {
      try {
        let tabs = await loadTabs()
        const client = clientRef.current
        if (tabs.length === 0 && client?.state === 'connected') {
          await client.createTab('about:blank')
          tabs = await loadTabs()
        }
        return tabs
      } catch (error) {
        if (!(error instanceof McpCallError && error.kind === 'aborted')) {
          send({ type: 'frameFailed', error: describeError(error) })
        }
        return stateRef.current.tabs
      } finally {
        tabSyncPromiseRef.current = null
        send({ type: 'syncingTabs', value: false })
      }
    })()
    tabSyncPromiseRef.current = request
    return request
  }, [loadTabs, send])

  const captureEncodedFrame = useCallback(
    async (client: BrowserOsClient, pageId: number): Promise<RemoteFrame> => {
      const size = captureSizeRef.current
      try {
        return await client.captureFrame(pageId, {
          ...size,
          format: 'webp',
          quality: 70,
          timeoutMs: 20_000,
        })
      } catch (firstError) {
        if (firstError instanceof McpCallError && firstError.kind === 'aborted') {
          throw firstError
        }
        return client.captureFrame(pageId, {
          ...size,
          format: 'jpeg',
          quality: 75,
          timeoutMs: 20_000,
        })
      }
    },
    [],
  )

  const runCapture = useCallback(async () => {
    const client = clientRef.current
    const current = stateRef.current
    const pageId = current.activePageId
    if (!client || client.state !== 'connected' || pageId === null) return

    captureInFlightRef.current = true
    captureRequestedRef.current = false
    lastCaptureStartRef.current = Date.now()
    const generation = frameGenerationRef.current
    const lifecycle = lifecycleRef.current
    const sequence = ++frameRequestRef.current
    send({ type: 'frameLoading' })

    let candidateUrl: string | null = null
    try {
      const encoded = await captureEncodedFrame(client, pageId)
      const blob = base64ToBlob(encoded)
      candidateUrl = URL.createObjectURL(blob)
      const decoded = await waitForImageDecode(candidateUrl)
      const latest = stateRef.current
      const isCurrent =
        lifecycle === lifecycleRef.current &&
        generation === frameGenerationRef.current &&
        sequence === frameRequestRef.current &&
        latest.activePageId === pageId

      if (!isCurrent) {
        URL.revokeObjectURL(candidateUrl)
        candidateUrl = null
        return
      }

      const previousFrame = latest.frame
      const frame: DisplayFrame = {
        pageId,
        objectUrl: candidateUrl,
        naturalWidth: decoded.width || encoded.width,
        naturalHeight: decoded.height || encoded.height,
        capturedAt: encoded.capturedAt,
        mimeType: encoded.mimeType,
      }
      candidateUrl = null
      send({ type: 'frameReady', frame })
      if (previousFrame) URL.revokeObjectURL(previousFrame.objectUrl)
    } catch (error) {
      if (candidateUrl) URL.revokeObjectURL(candidateUrl)
      if (
        lifecycle === lifecycleRef.current &&
        generation === frameGenerationRef.current &&
        stateRef.current.activePageId === pageId &&
        !(error instanceof McpCallError && error.kind === 'aborted')
      ) {
        send({ type: 'frameFailed', error: describeError(error) })
      }
    } finally {
      captureInFlightRef.current = false
      if (captureRequestedRef.current) scheduleCapture(true)
      else scheduleCapture(false)
    }
  }, [captureEncodedFrame, scheduleCapture, send])

  captureRunnerRef.current = runCapture

  const disconnect = useCallback(() => {
    lifecycleRef.current += 1
    frameGenerationRef.current += 1
    clearTimers()
    clientRef.current?.disconnect()
    clientRef.current = null
    tabSyncPromiseRef.current = null
    captureInFlightRef.current = false
    captureRequestedRef.current = false
    pageQueuesRef.current.clear()
    pendingHoverRef.current.clear()
    hoverScheduledRef.current.clear()
    revokeFrame()
    send({ type: 'disconnected' })
  }, [clearTimers, revokeFrame, send])

  const connect = useCallback(
    async (input: string): Promise<boolean> => {
      let endpoint: string
      try {
        endpoint = normalizedEndpoint(input)
      } catch (error) {
        send({
          type: 'connectionError',
          endpoint: input.trim(),
          error: describeError(error),
        })
        return false
      }

      lifecycleRef.current += 1
      const lifecycle = lifecycleRef.current
      clearTimers()
      clientRef.current?.disconnect()
      revokeFrame()
      frameGenerationRef.current += 1
      send({ type: 'connecting', endpoint })

      const client = new BrowserOsClient()
      clientRef.current = client
      try {
        const serverInfo = await client.connect(endpoint)
        let tabs = await client.listTabs()
        if (tabs.length === 0) {
          await client.createTab('about:blank')
          tabs = await client.listTabs()
        }
        if (lifecycle !== lifecycleRef.current) {
          client.disconnect()
          return false
        }
        const activePageId = choosePageId(tabs)
        send({
          type: 'connected',
          endpoint,
          serverInfo,
          tabs,
          activePageId,
        })
        scheduleCapture(true)
        return true
      } catch (error) {
        if (lifecycle !== lifecycleRef.current) return false
        client.disconnect()
        clientRef.current = null
        send({
          type: 'connectionError',
          endpoint,
          error: describeError(error, endpoint),
        })
        return false
      }
    },
    [clearTimers, revokeFrame, scheduleCapture, send],
  )

  const enqueuePageAction = useCallback(
    (pageId: number, action: (client: BrowserOsClient) => Promise<void>) => {
      const previous = pageQueuesRef.current.get(pageId) ?? Promise.resolve()
      const next = previous.catch(() => undefined).then(async () => {
        const client = clientRef.current
        if (!client || client.state !== 'connected') {
          throw new McpCallError('BrowserOS MCP is not connected', {
            kind: 'connection',
          })
        }
        await action(client)
      })
      pageQueuesRef.current.set(pageId, next)
      void next.then(
        () => {
          if (pageQueuesRef.current.get(pageId) === next) {
            pageQueuesRef.current.delete(pageId)
          }
        },
        () => {
          if (pageQueuesRef.current.get(pageId) === next) {
            pageQueuesRef.current.delete(pageId)
          }
        },
      )
      return next
    },
    [],
  )

  const selectTab = useCallback(
    async (pageId: number) => {
      if (pageId === stateRef.current.activePageId) return
      if (!stateRef.current.tabs.some((tab) => tab.pageId === pageId)) return
      invalidateFrame(pageId)
      try {
        await enqueuePageAction(pageId, (client) => client.activateTab(pageId))
        await loadTabs(pageId)
        scheduleCapture(true)
      } catch (error) {
        send({ type: 'frameFailed', error: describeError(error) })
      }
    },
    [enqueuePageAction, invalidateFrame, loadTabs, scheduleCapture, send],
  )

  const createTab = useCallback(async () => {
    const client = clientRef.current
    if (!client || client.state !== 'connected') return
    const previousIds = new Set(stateRef.current.tabs.map((tab) => tab.pageId))
    try {
      await client.createTab('about:blank')
      const tabs = await client.listTabs()
      const created = tabs.find((tab) => !previousIds.has(tab.pageId))
      send({ type: 'tabs', tabs })
      invalidateFrame(created?.pageId ?? choosePageId(tabs))
      scheduleCapture(true)
    } catch (error) {
      send({ type: 'frameFailed', error: describeError(error) })
    }
  }, [invalidateFrame, scheduleCapture, send])

  const closeTab = useCallback(
    async (pageId: number) => {
      const client = clientRef.current
      if (!client || client.state !== 'connected') return
      const oldTabs = stateRef.current.tabs
      const oldIndex = oldTabs.findIndex((tab) => tab.pageId === pageId)
      const wasActive = stateRef.current.activePageId === pageId
      send({ type: 'closing', pageId, value: true })
      try {
        await client.closeTab(pageId)
        let tabs = await client.listTabs()
        if (tabs.length === 0) {
          await client.createTab('about:blank')
          tabs = await client.listTabs()
        }
        const neighbor = tabs[Math.min(Math.max(oldIndex, 0), tabs.length - 1)]
        const preferred = wasActive
          ? neighbor?.pageId
          : stateRef.current.activePageId
        send({ type: 'tabs', tabs })
        if (wasActive || !tabs.some((tab) => tab.pageId === preferred)) {
          invalidateFrame(choosePageId(tabs, preferred))
        }
        scheduleCapture(true)
      } catch (error) {
        send({ type: 'frameFailed', error: describeError(error) })
      } finally {
        send({ type: 'closing', pageId, value: false })
      }
    },
    [invalidateFrame, scheduleCapture, send],
  )

  const navigate = useCallback(
    async (action: NavigationAction, url?: string) => {
      const pageId = stateRef.current.activePageId
      if (pageId === null) return
      frameGenerationRef.current += 1
      send({ type: 'navigating', value: true })
      try {
        await enqueuePageAction(pageId, (client) =>
          client.navigate(pageId, action === 'url' ? { action, url } : { action }),
        )
        await loadTabs(pageId)
        scheduleCapture(true)
      } catch (error) {
        send({ type: 'frameFailed', error: describeError(error) })
        throw error
      } finally {
        send({ type: 'navigating', value: false })
      }
    },
    [enqueuePageAction, loadTabs, scheduleCapture, send],
  )

  const runViewportAction = useCallback(
    (
      action: (client: BrowserOsClient, pageId: number) => Promise<void>,
      immediate = true,
    ) => {
      const pageId = stateRef.current.activePageId
      if (pageId === null) return
      void enqueuePageAction(pageId, (client) => action(client, pageId)).then(
        () => scheduleCapture(immediate),
        (error) => send({ type: 'frameFailed', error: describeError(error) }),
      )
    },
    [enqueuePageAction, scheduleCapture, send],
  )

  const click = useCallback<RemoteBrowserController['click']>(
    (point, options) => {
      runViewportAction((client, pageId) => client.click(pageId, point, options))
    },
    [runViewportAction],
  )

  const hover = useCallback(
    (point: RemotePoint) => {
      const pageId = stateRef.current.activePageId
      if (pageId === null) return
      pendingHoverRef.current.set(pageId, point)
      if (hoverScheduledRef.current.has(pageId)) return
      hoverScheduledRef.current.add(pageId)

      const flush = async () => {
        const nextPoint = pendingHoverRef.current.get(pageId)
        pendingHoverRef.current.delete(pageId)
        if (!nextPoint) return
        await enqueuePageAction(pageId, (client) => client.hover(pageId, nextPoint))
        if (pendingHoverRef.current.has(pageId)) await flush()
      }

      void flush().then(
        () => scheduleCapture(false),
        (error) => send({ type: 'frameFailed', error: describeError(error) }),
      ).finally(() => hoverScheduledRef.current.delete(pageId))
    },
    [enqueuePageAction, scheduleCapture, send],
  )

  const scroll = useCallback(
    (direction: ScrollDirection, amount: number) => {
      runViewportAction((client, pageId) =>
        client.scroll(pageId, { direction, amount }),
      )
    },
    [runViewportAction],
  )

  const drag = useCallback(
    (start: RemotePoint, end: RemotePoint) => {
      runViewportAction((client, pageId) => client.drag(pageId, start, end))
    },
    [runViewportAction],
  )

  const typeText = useCallback(
    (text: string) => {
      if (!text) return
      runViewportAction((client, pageId) => client.type(pageId, text))
    },
    [runViewportAction],
  )

  const pressKey = useCallback(
    (key: string) => {
      if (!key) return
      runViewportAction((client, pageId) => client.press(pageId, key))
    },
    [runViewportAction],
  )

  const setCaptureSize = useCallback(
    (size: CaptureSize) => {
      if (
        size.width === captureSizeRef.current.width &&
        size.height === captureSizeRef.current.height
      ) {
        return
      }
      captureSizeRef.current = size
      scheduleCapture(true)
    },
    [scheduleCapture],
  )

  useEffect(() => {
    if (state.connectionState !== 'connected') return
    let cancelled = false

    const poll = async () => {
      await refreshTabs()
      if (!cancelled) {
        tabPollTimerRef.current = window.setTimeout(() => void poll(), 2000)
      }
    }
    tabPollTimerRef.current = window.setTimeout(() => void poll(), 2000)
    return () => {
      cancelled = true
      if (tabPollTimerRef.current !== null) {
        window.clearTimeout(tabPollTimerRef.current)
        tabPollTimerRef.current = null
      }
    }
  }, [refreshTabs, state.connectionState])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (captureTimerRef.current !== null) {
          window.clearTimeout(captureTimerRef.current)
          captureTimerRef.current = null
        }
      } else {
        scheduleCapture(true)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [scheduleCapture])

  useEffect(
    () => () => {
      lifecycleRef.current += 1
      clearTimers()
      clientRef.current?.disconnect()
      const frame = stateRef.current.frame
      if (frame) URL.revokeObjectURL(frame.objectUrl)
    },
    [clearTimers],
  )

  const activeTab =
    state.tabs.find((tab) => tab.pageId === state.activePageId) ?? null

  return {
    ...state,
    activeTab,
    connect,
    disconnect,
    refreshTabs,
    selectTab,
    createTab,
    closeTab,
    navigate,
    refreshFrame: () => scheduleCapture(true),
    setCaptureSize,
    click,
    hover,
    scroll,
    drag,
    typeText,
    pressKey,
  }
}
