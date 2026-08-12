import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type InputEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import { ViewportStatus } from '../../components'
import {
  EMPTY_WHEEL_DELTA,
  accumulateWheelDelta,
  classifyPointerGesture,
  isDoubleClickCandidate,
  mapClientPointToRemote,
  toBrowserOsKeyCombo,
  wheelDeltaToScrollAction,
  type Point,
  type PointerSample,
  type WheelDelta,
} from '../../lib/interaction'
import { computeCaptureSize, type CaptureSize } from '../../lib/frame'
import type {
  MouseButton,
  RemotePoint,
  ScrollDirection,
  ViewportMetrics,
} from '../../lib/browseros'
import type { DisplayFrame, ViewportPhase } from '../../hooks/useRemoteBrowser'

interface RemoteViewportProps {
  frame: DisplayFrame | null
  phase: ViewportPhase
  error: string | null
  viewport: ViewportMetrics | null
  title?: string
  onCaptureSizeChange: (size: CaptureSize) => void
  onRetry: () => void
  onClick: (
    point: RemotePoint,
    options?: { button?: MouseButton; clickCount?: number },
  ) => void
  onHover: (point: RemotePoint) => void
  onScroll: (direction: ScrollDirection, amount: number) => void
  onDrag: (start: RemotePoint, end: RemotePoint) => void
  onType: (text: string) => void
  onPress: (key: string) => void
}

interface PointerStart {
  local: Point
  remote: RemotePoint
  pointerId: number
}

export function RemoteViewport({
  frame,
  phase,
  error,
  viewport,
  title,
  onCaptureSizeChange,
  onRetry,
  onClick,
  onHover,
  onScroll,
  onDrag,
  onType,
  onPress,
}: RemoteViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const keyboardRef = useRef<HTMLTextAreaElement>(null)
  const pointerStartRef = useRef<PointerStart | null>(null)
  const previousClickRef = useRef<PointerSample | null>(null)
  const pendingClickRef = useRef<RemotePoint | null>(null)
  const clickTimerRef = useRef<number | null>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const pendingHoverRef = useRef<RemotePoint | null>(null)
  const lastHoverAtRef = useRef(0)
  const wheelTimerRef = useRef<number | null>(null)
  const wheelDeltaRef = useRef<WheelDelta>({ ...EMPTY_WHEEL_DELTA })
  const composingRef = useRef(false)
  const pendingCompositionRef = useRef<string | null>(null)
  const compositionTimerRef = useRef<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [cursor, setCursor] = useState<Point | null>(null)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const update = (width: number, height: number) => {
      if (width > 0 && height > 0) {
        onCaptureSizeChange(
          computeCaptureSize(width, height, window.devicePixelRatio),
        )
      }
    }

    const updateFromElement = () => {
      const rect = element.getBoundingClientRect()
      update(rect.width, rect.height)
    }

    updateFromElement()
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(element)
    window.addEventListener('resize', updateFromElement)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateFromElement)
    }
  }, [onCaptureSizeChange])

  const mapPoint = useCallback(
    (clientX: number, clientY: number) => {
      const stage = stageRef.current
      if (!stage) return null
      const capturedViewport =
        frame &&
        Number.isFinite(frame.viewportWidth) &&
        frame.viewportWidth > 0 &&
        Number.isFinite(frame.viewportHeight) &&
        frame.viewportHeight > 0
          ? { width: frame.viewportWidth, height: frame.viewportHeight }
          : viewport
      if (!capturedViewport) return null
      return mapClientPointToRemote(
        { x: clientX, y: clientY },
        stage.getBoundingClientRect(),
        capturedViewport,
      )
    },
    [frame, viewport],
  )

  const focusKeyboard = () => {
    keyboardRef.current?.focus({ preventScroll: true })
  }

  const clearClickTimer = () => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
  }

  const flushPendingClick = () => {
    const point = pendingClickRef.current
    if (!point) return
    clearClickTimer()
    pendingClickRef.current = null
    previousClickRef.current = null
    onClick(point, { button: 'left', clickCount: 1 })
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const remote = mapPoint(event.clientX, event.clientY)
    if (!remote) return
    focusKeyboard()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerStartRef.current = {
      local: { x: event.clientX, y: event.clientY },
      remote,
      pointerId: event.pointerId,
    }
    setDragging(false)
  }

  const flushHover = useCallback(() => {
    hoverTimerRef.current = null
    const point = pendingHoverRef.current
    pendingHoverRef.current = null
    if (!point) return
    lastHoverAtRef.current = performance.now()
    onHover(point)
  }, [onHover])

  const queueHover = (point: RemotePoint) => {
    pendingHoverRef.current = point
    if (hoverTimerRef.current !== null) return
    const delay = Math.max(0, 100 - (performance.now() - lastHoverAtRef.current))
    hoverTimerRef.current = window.setTimeout(flushHover, delay)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const stageRect = stageRef.current?.getBoundingClientRect()
    if (stageRect) {
      setCursor({
        x: event.clientX - stageRect.left,
        y: event.clientY - stageRect.top,
      })
    }

    const start = pointerStartRef.current
    if (start && start.pointerId === event.pointerId) {
      const gesture = classifyPointerGesture(start.local, {
        x: event.clientX,
        y: event.clientY,
      })
      if (gesture === 'drag') setDragging(true)
      return
    }

    const remote = mapPoint(event.clientX, event.clientY)
    if (remote) queueHover(remote)
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    pointerStartRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const endLocal = { x: event.clientX, y: event.clientY }
    const endRemote = mapPoint(event.clientX, event.clientY)
    if (!endRemote) return

    if (classifyPointerGesture(start.local, endLocal) === 'drag') {
      flushPendingClick()
      onDrag(start.remote, endRemote)
      return
    }

    const sample: PointerSample = {
      ...endLocal,
      time: performance.now(),
      button: 0,
    }
    if (isDoubleClickCandidate(previousClickRef.current, sample)) {
      clearClickTimer()
      pendingClickRef.current = null
      previousClickRef.current = null
      onClick(endRemote, { button: 'left', clickCount: 2 })
      return
    }

    previousClickRef.current = sample
    pendingClickRef.current = endRemote
    clickTimerRef.current = window.setTimeout(() => {
      pendingClickRef.current = null
      previousClickRef.current = null
      clickTimerRef.current = null
      onClick(endRemote, { button: 'left', clickCount: 1 })
    }, 250)
  }

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerStartRef.current?.pointerId === event.pointerId) {
      pointerStartRef.current = null
      setDragging(false)
    }
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    flushPendingClick()
    focusKeyboard()
    const remote = mapPoint(event.clientX, event.clientY)
    if (remote) onClick(remote, { button: 'right', clickCount: 1 })
  }

  const handleAuxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1) return
    event.preventDefault()
    const remote = mapPoint(event.clientX, event.clientY)
    if (remote) onClick(remote, { button: 'middle', clickCount: 1 })
  }

  const flushWheel = useCallback(() => {
    wheelTimerRef.current = null
    const action = wheelDeltaToScrollAction(wheelDeltaRef.current, {
      pixelsPerNotch: 100,
      maxAmount: 6,
    })
    wheelDeltaRef.current = { ...EMPTY_WHEEL_DELTA }
    if (action) onScroll(action.direction, action.amount)
  }, [onScroll])

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    flushPendingClick()
    focusKeyboard()
    wheelDeltaRef.current = accumulateWheelDelta(wheelDeltaRef.current, event)
    if (wheelTimerRef.current !== null) return
    wheelTimerRef.current = window.setTimeout(flushWheel, 50)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'v'
    ) {
      return
    }
    const combo = toBrowserOsKeyCombo(event)
    if (!combo) return
    event.preventDefault()
    flushPendingClick()
    onPress(combo)
  }

  const handleInput = (event: InputEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return
    const input = event.currentTarget
    const value = input.value
    input.value = ''
    pendingCompositionRef.current = null
    if (compositionTimerRef.current !== null) {
      window.clearTimeout(compositionTimerRef.current)
      compositionTimerRef.current = null
    }
    if (value) {
      flushPendingClick()
      onType(value)
    }
  }

  const handleCompositionStart = () => {
    composingRef.current = true
    pendingCompositionRef.current = null
    if (compositionTimerRef.current !== null) {
      window.clearTimeout(compositionTimerRef.current)
      compositionTimerRef.current = null
    }
  }

  const handleCompositionEnd = (
    event: CompositionEvent<HTMLTextAreaElement>,
  ) => {
    composingRef.current = false
    pendingCompositionRef.current = event.data || event.currentTarget.value
    const input = event.currentTarget
    compositionTimerRef.current = window.setTimeout(() => {
      compositionTimerRef.current = null
      const text = pendingCompositionRef.current
      pendingCompositionRef.current = null
      input.value = ''
      if (text) {
        flushPendingClick()
        onType(text)
      }
    }, 0)
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    event.currentTarget.value = ''
    if (text) {
      flushPendingClick()
      onType(text)
    }
  }

  useEffect(() => {
    clearClickTimer()
    pendingClickRef.current = null
    previousClickRef.current = null
    pointerStartRef.current = null
    return () => {
      clearClickTimer()
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current)
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current)
      if (compositionTimerRef.current !== null) {
        window.clearTimeout(compositionTimerRef.current)
      }
    }
  }, [frame?.pageId])

  const showStage = frame
  const statusState =
    frame ? (phase === 'loading' ? 'ready' : phase) : phase

  return (
    <main
      id="remote-browser-viewport"
      ref={containerRef}
      className="rb-viewport"
      aria-label="远程浏览器视口"
    >
      {showStage ? (
        <div
          ref={stageRef}
          className="rb-viewport__stage"
        >
          <img
            className="rb-viewport__image"
            src={frame.objectUrl}
            alt={title ? `${title} 的远程页面画面` : '远程页面画面'}
            draggable={false}
          />
          <div
            className={`rb-viewport__interaction${dragging ? ' rb-viewport__interaction--dragging' : ''}`}
            role="application"
            aria-label="远程网页交互区域；点击后可输入键盘"
            tabIndex={0}
            onFocus={focusKeyboard}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={() => setCursor(null)}
            onContextMenu={handleContextMenu}
            onAuxClick={handleAuxClick}
            onWheel={handleWheel}
          />
          {cursor ? (
            <span
              className="rb-viewport__cursor"
              style={{ left: cursor.x, top: cursor.y }}
              aria-hidden="true"
            />
          ) : null}
          <textarea
            ref={keyboardRef}
            className="rb-viewport__keyboard-sink"
            aria-label="远程页面键盘输入"
            tabIndex={-1}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onPaste={handlePaste}
          />
        </div>
      ) : null}

      <ViewportStatus
        state={statusState}
        hasFrame={Boolean(frame)}
        detail={error ?? undefined}
        onRetry={
          phase === 'error' || phase === 'stale' ? onRetry : undefined
        }
      />
    </main>
  )
}
