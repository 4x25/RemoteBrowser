import { BrowserOsClient } from '../browseros'
import { CdpClient } from '../cdp'
import type { RemoteBrowserClient, RemoteBrowserTransport } from './types'

export const TRANSPORT_LABELS: Readonly<Record<RemoteBrowserTransport, string>> = {
  browseros: 'BrowserOS MCP',
  cdp: 'CDP',
}

export function createRemoteBrowserClient(
  transport: RemoteBrowserTransport,
): RemoteBrowserClient {
  return transport === 'cdp' ? new CdpClient() : new BrowserOsClient()
}

export function transportLabel(transport?: RemoteBrowserTransport | null): string {
  return transport === 'cdp' ? TRANSPORT_LABELS.cdp : TRANSPORT_LABELS.browseros
}
