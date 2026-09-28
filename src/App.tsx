import { useEffect, useRef, useState } from 'react'
import {
  ConnectionDialog,
  TabStrip,
  Toolbar,
  type ConnectionStatus,
} from './components'
import { RemoteViewport } from './features/viewport/RemoteViewport'
import { useRemoteBrowser } from './hooks/useRemoteBrowser'
import { tryNormalizeBrowserUrl } from './lib/interaction'
import type { RemoteBrowserTransport } from './lib/remote'

const createEmptyEndpoints = (): Record<RemoteBrowserTransport, string> => ({
  browseros: '',
  cdp: '',
})

export function App() {
  const browser = useRemoteBrowser()
  const [dialogOpen, setDialogOpen] = useState(true)
  const [dialogMode, setDialogMode] = useState<'initial' | 'reconnect'>('initial')
  const [transportInput, setTransportInput] = useState<RemoteBrowserTransport>(
    'browseros',
  )
  const [endpointInputs, setEndpointInputs] =
    useState<Record<RemoteBrowserTransport, string>>(createEmptyEndpoints)
  const [address, setAddress] = useState('')
  const [addressDirty, setAddressDirty] = useState(false)
  const [addressError, setAddressError] = useState<string | null>(null)
  const hasConnectedRef = useRef(false)
  const previousPageIdRef = useRef<number | null>(null)

  useEffect(() => {
    const pageId = browser.activePageId
    const nextAddress = browser.activeTab?.url ?? ''
    if (pageId !== previousPageIdRef.current) {
      previousPageIdRef.current = pageId
      setAddress(nextAddress)
      setAddressDirty(false)
      setAddressError(null)
      return
    }
    if (!addressDirty && nextAddress !== address) setAddress(nextAddress)
  }, [
    address,
    addressDirty,
    browser.activePageId,
    browser.activeTab?.url,
  ])

  const handleConnect = async (endpoint: string) => {
    const connected = await browser.connect(transportInput, endpoint)
    if (connected) {
      hasConnectedRef.current = true
      setEndpointInputs((current) => ({
        ...current,
        [transportInput]: endpoint.trim(),
      }))
      setDialogOpen(false)
      setDialogMode('reconnect')
    }
  }

  const handleConnectionClick = () => {
    const nextTransport = browser.transport ?? transportInput
    setTransportInput(nextTransport)
    if (browser.endpoint) {
      setEndpointInputs((current) => ({
        ...current,
        [nextTransport]: browser.endpoint,
      }))
    }
    setDialogMode(hasConnectedRef.current ? 'reconnect' : 'initial')
    setDialogOpen(true)
  }

  const handleEndpointChange = (endpoint: string) => {
    setEndpointInputs((current) => ({ ...current, [transportInput]: endpoint }))
  }

  const handleNavigate = async (input: string) => {
    const result = tryNormalizeBrowserUrl(input)
    if (!result.ok) {
      setAddressError(result.error.message)
      return
    }
    setAddress(result.url)
    setAddressDirty(false)
    setAddressError(null)
    try {
      await browser.navigate('url', result.url)
    } catch (error) {
      setAddressError(
        error instanceof Error ? error.message : '无法打开这个地址',
      )
    }
  }

  const runNavigation = (action: 'back' | 'forward' | 'reload') => {
    setAddressError(null)
    void browser.navigate(action).catch(() => undefined)
  }

  const connectionStatus: ConnectionStatus = browser.connectionState
  const disabled = connectionStatus !== 'connected' || !browser.activeTab

  return (
    <div
      className={`rb-app${connectionStatus === 'connected' ? '' : ' rb-app--disconnected'}`}
    >
      <TabStrip
        tabs={browser.tabs.map((tab) => ({
          id: tab.pageId,
          title: tab.title || '新标签页',
          url: tab.url,
          loading: tab.isLoading,
          closing: browser.closingPageIds.includes(tab.pageId),
        }))}
        activeTabId={browser.activePageId}
        busy={browser.syncingTabs}
        creating={browser.creatingTab}
        disabled={connectionStatus !== 'connected'}
        onSelect={(tabId) => void browser.selectTab(Number(tabId))}
        onClose={(tabId) => void browser.closeTab(Number(tabId))}
        onNew={() => void browser.createTab()}
      />

      <Toolbar
        address={address}
        connectionStatus={connectionStatus}
        endpoint={browser.endpoint}
        addressError={addressError}
        canGoBack={browser.activeTab?.pageState.canGoBack ?? false}
        canGoForward={browser.activeTab?.pageState.canGoForward ?? false}
        navigating={browser.navigating || browser.activeTab?.isLoading}
        disabled={disabled}
        onAddressChange={(next) => {
          setAddress(next)
          setAddressDirty(true)
          setAddressError(null)
        }}
        onNavigate={(next) => void handleNavigate(next)}
        onBack={() => runNavigation('back')}
        onForward={() => runNavigation('forward')}
        onRefresh={() => runNavigation('reload')}
        onConnectionClick={handleConnectionClick}
      />

      <RemoteViewport
        frame={browser.frame}
        phase={browser.viewportPhase}
        error={browser.viewportError}
        viewport={browser.activeTab?.pageState.viewport ?? null}
        title={browser.activeTab?.title}
        onCaptureSizeChange={browser.setCaptureSize}
        onRetry={browser.refreshFrame}
        onClick={browser.click}
        onHover={browser.hover}
        onScroll={browser.scroll}
        onDrag={browser.drag}
        onType={browser.typeText}
        onPress={browser.pressKey}
      />

      <ConnectionDialog
        open={dialogOpen}
        transport={transportInput}
        endpoint={endpointInputs[transportInput]}
        connecting={browser.connectionState === 'connecting'}
        error={
          browser.transport === transportInput ? browser.connectionError : null
        }
        mode={dialogMode}
        onTransportChange={setTransportInput}
        onEndpointChange={handleEndpointChange}
        onConnect={(endpoint) => void handleConnect(endpoint)}
        onCancel={
          dialogMode === 'reconnect' && browser.connectionState === 'connected'
            ? () => setDialogOpen(false)
            : undefined
        }
      />
    </div>
  )
}
