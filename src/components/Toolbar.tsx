import { useId, type FormEvent } from 'react'
import { StatusBadge, type ConnectionStatus } from './StatusBadge'

export interface ToolbarProps {
  address: string
  connectionStatus: ConnectionStatus
  endpoint?: string
  addressError?: string | null
  canGoBack?: boolean
  canGoForward?: boolean
  navigating?: boolean
  disabled?: boolean
  onAddressChange: (address: string) => void
  onNavigate: (address: string) => void
  onBack: () => void
  onForward: () => void
  onRefresh: () => void
  onConnectionClick: () => void
}

export function Toolbar({
  address,
  connectionStatus,
  endpoint,
  addressError,
  canGoBack = false,
  canGoForward = false,
  navigating = false,
  disabled = false,
  onAddressChange,
  onNavigate,
  onBack,
  onForward,
  onRefresh,
  onConnectionClick,
}: ToolbarProps) {
  const errorId = useId()
  const pageActionsDisabled = disabled || connectionStatus !== 'connected'
  const connectionLabel = connectionStatus === 'connected' ? '切换连接' : '连接'
  const endpointLabel = endpoint ? displayEndpoint(endpoint) : null

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextAddress = address.trim()
    if (nextAddress) onNavigate(nextAddress)
  }

  return (
    <div className="rb-browser-toolbar">
      <nav className="rb-browser-toolbar__navigation" aria-label="页面导航">
        <IconButton
          label="后退"
          disabled={pageActionsDisabled || !canGoBack}
          onClick={onBack}
          icon={<BackIcon />}
        />
        <IconButton
          label="前进"
          disabled={pageActionsDisabled || !canGoForward}
          onClick={onForward}
          icon={<ForwardIcon />}
        />
        <IconButton
          label={navigating ? "页面加载中" : "刷新"}
          disabled={pageActionsDisabled || navigating}
          onClick={onRefresh}
          busy={navigating}
          icon={<RefreshIcon />}
        />
      </nav>

      <form className="rb-address-bar" role="search" onSubmit={handleSubmit}>
        <span className="rb-address-bar__security" aria-hidden="true">
          <GlobeIcon />
        </span>
        <label className="rb-sr-only" htmlFor={`${errorId}-address`}>
          网页地址
        </label>
        <input
          id={`${errorId}-address`}
          className="rb-address-bar__input"
          type="text"
          inputMode="url"
          value={address}
          placeholder="输入网址"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          disabled={pageActionsDisabled}
          aria-invalid={Boolean(addressError)}
          aria-describedby={addressError ? errorId : undefined}
          onChange={(event) => onAddressChange(event.currentTarget.value)}
        />
        {navigating ? (
          <span className="rb-address-bar__progress" aria-hidden="true" />
        ) : null}
        {addressError ? (
          <span id={errorId} className="rb-address-bar__error" role="alert">
            {addressError}
          </span>
        ) : null}
      </form>

      <div className="rb-browser-toolbar__connection">
        <StatusBadge status={connectionStatus} />
        <button
          className="rb-browser-toolbar__connection-button"
          type="button"
          aria-label={connectionLabel}
          disabled={connectionStatus === 'connecting'}
          title={endpointLabel ? `${connectionLabel}：${endpointLabel}` : connectionLabel}
          onClick={onConnectionClick}
        >
          <span className="rb-browser-toolbar__connection-label">
            {connectionLabel}
          </span>
          <span
            className="rb-browser-toolbar__connection-menu"
            aria-hidden="true"
          >
            ⋮
          </span>
        </button>
      </div>
    </div>
  )
}

/** Hides query strings so debugger bearer tokens never reach the DOM. */
function displayEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint)
    const suffix = url.search || url.hash ? '…' : ''
    return `${url.origin}${url.pathname}${suffix}`
  } catch {
    return endpoint
  }
}

interface IconButtonProps {
  label: string
  icon: React.ReactNode
  disabled: boolean
  busy?: boolean
  onClick: () => void
}

function IconButton({
  label,
  icon,
  disabled,
  busy = false,
  onClick,
}: IconButtonProps) {
  return (
    <button
      className="rb-browser-toolbar__icon-button"
      type="button"
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? <span className="rb-spinner rb-spinner--small" aria-hidden="true" /> : icon}
    </button>
  )
}

function BackIcon() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="m12.5 4.5-5 5.5 5 5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="m7.5 4.5 5 5.5-5 5.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <path d="M15.8 8A6.2 6.2 0 1 0 16 11" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="m12.5 7.7 3.5.5.4-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 10h13M10 3c2 2 2.5 4.3 2.5 7S12 15 10 17c-2-2-2.5-4.3-2.5-7S8 5 10 3Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
