// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CdpClient } from './client'

const environment = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
).process?.env
// Opt-in only: never poke a shared browser just because an ambient env var
// exists. Use `CDP_ENDPOINT=$AGENT_BROWSER_CDP` for manual runs.
const endpoint = environment?.CDP_ENDPOINT

describe.runIf(Boolean(endpoint))('CDP real integration', () => {
  it('connects, lists tabs and captures a frame', async () => {
    const client = new CdpClient({ requestTimeoutMs: 20_000 })
    try {
      const serverInfo = await client.connect(endpoint as string)
      expect(client.state).toBe('connected')
      expect(serverInfo.name).toBeTruthy()

      let tabs = await client.listTabs()
      if (tabs.length === 0) {
        await client.createTab('about:blank')
        tabs = await client.listTabs()
      }
      expect(tabs.length).toBeGreaterThan(0)

      const pageId = tabs[0]?.pageId
      expect(pageId).toBeDefined()
      const frame = await client.captureFrame(pageId as number, {
        width: 400,
        height: 300,
        format: 'jpeg',
        quality: 50,
      })
      expect(frame.data.length).toBeGreaterThan(100)
      expect(frame.mimeType).toBe('image/jpeg')
    } finally {
      client.disconnect()
    }
  }, 60_000)
})
