import { describe, expect, it } from 'vitest'
import { BrowserOsClient } from './client'

const endpoint = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
).process?.env?.BROWSEROS_MCP_URL

describe.runIf(Boolean(endpoint))('BrowserOS MCP real integration', () => {
  it('connects, reads tabs and captures the active viewport', async () => {
    const client = new BrowserOsClient({ requestTimeoutMs: 20_000 })

    try {
      const server = await client.connect(endpoint!)
      expect(server.name).toBeTruthy()

      const tabs = await client.listTabs()
      expect(tabs.length).toBeGreaterThan(0)
      const page = tabs.find((tab) => tab.isActive) ?? tabs[0]!
      expect(page.pageState.viewport?.width).toBeGreaterThan(0)

      const frame = await client.captureFrame(page.pageId, {
        format: 'webp',
        quality: 50,
        width: 320,
        height: 240,
      })
      expect(frame.mimeType).toBe('image/webp')
      expect(frame.data.length).toBeGreaterThan(100)
    } finally {
      client.disconnect()
    }
  }, 120_000)
})
