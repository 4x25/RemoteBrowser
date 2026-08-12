import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test'

const endpoint = 'http://127.0.0.1:4174/mcp'
const mockOrigin = 'http://127.0.0.1:4174'

interface MockEvent {
  kind?: string
  page?: number
  width?: number
  height?: number
  deviceScaleFactor?: number
  args?: { size?: { width?: number; height?: number } }
  userAgent?: {
    userAgent?: string
    acceptLanguage?: string
    platform?: string
    userAgentMetadata?: {
      platform?: string
    }
  }
  media?: {
    media?: string
    features?: Array<{ name?: string; value?: string }>
  }
}

async function mockEvents(request: APIRequestContext): Promise<MockEvent[]> {
  const response = await request.get(`${mockOrigin}/events`)
  expect(response.ok()).toBe(true)
  return response.json() as Promise<MockEvent[]>
}

function mediaFeature(event: MockEvent, name: string): string | undefined {
  return event.media?.features?.find((feature) => feature.name === name)?.value
}

async function connectCustomBrowserEnvironment(
  browser: Browser,
  userAgent: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    userAgent,
    locale: 'zh-CN',
    colorScheme: 'dark',
  })
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'languages', {
      configurable: true,
      get: () => ['zh-CN', 'en-US', 'en'],
    })
  })
  const page = await context.newPage()
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: '连接 BrowserOS' })
  await dialog.getByLabel('MCP 地址').fill(endpoint)
  await dialog.getByRole('button', { name: '连接浏览器' }).click()
  await expect(dialog).toBeHidden()

  return { page, close: () => context.close() }
}

async function expectRemoteViewportToMatch(
  page: Page,
  request: APIRequestContext,
  eventOffset = 0,
): Promise<number> {
  await expect
    .poll(async () => {
      const [viewportBox, stageBox, events] = await Promise.all([
        page.locator('.rb-viewport').boundingBox(),
        page.locator('.rb-viewport__stage').boundingBox(),
        mockEvents(request),
      ])
      if (!viewportBox || !stageBox) return false

      const recentEvents = events.slice(eventOffset)
      const viewportEventIndex = recentEvents.findIndex(
        (event) =>
          event.kind === 'set_viewport' &&
          Math.abs((event.width ?? 0) - viewportBox.width) <= 1 &&
          Math.abs((event.height ?? 0) - viewportBox.height) <= 1,
      )
      if (viewportEventIndex < 0) return false

      const viewportEvent = recentEvents[viewportEventIndex]
      const screenshotEvent = recentEvents
        .slice(viewportEventIndex + 1)
        .find(
          (event) =>
            event.kind === 'screenshot' && event.page === viewportEvent?.page,
        )
      const scale = viewportEvent?.deviceScaleFactor
      if (
        !viewportEvent ||
        !screenshotEvent?.args?.size ||
        typeof scale !== 'number'
      ) {
        return false
      }

      return (
        Math.abs(stageBox.width - viewportBox.width) <= 1 &&
        Math.abs(stageBox.height - viewportBox.height) <= 1 &&
        screenshotEvent.args.size.width ===
          Math.round((viewportEvent.width ?? 0) * scale) &&
        screenshotEvent.args.size.height ===
          Math.round((viewportEvent.height ?? 0) * scale) &&
        screenshotEvent.args.size.width <= 1440 &&
        screenshotEvent.args.size.height <= 900
      )
    }, { message: 'remote viewport and screenshot should follow the preview container' })
    .toBe(true)

  return (await mockEvents(request)).length
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${mockOrigin}/reset`)
  expect(response.ok()).toBe(true)
})

test('connects and drives BrowserOS tabs, navigation and viewport input', async ({
  page,
  request,
}) => {
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: '连接 BrowserOS' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('MCP 地址').fill(endpoint)
  await dialog.getByRole('button', { name: '连接浏览器' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('tab', { name: /Example Domain/ })).toBeVisible()
  await expect(page.getByAltText(/Example Domain 的远程页面画面/)).toBeVisible()
  await expect(page.getByText('已连接')).toBeVisible()

  const address = page.getByLabel('网页地址')
  await address.fill('example.org/path')
  await expect(address).toHaveCSS('outline-style', 'none')
  await address.press('Enter')
  await expect(address).toHaveValue('https://example.org/path')
  await expect(page.getByRole('tab', { name: /example.org/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '后退' })).toBeEnabled()

  await expect
    .poll(async () => {
      const events = await mockEvents(request)
      const navigationIndex = events.findIndex(
        (event) => event.kind === 'navigate' && event.page === 101,
      )
      const environmentIndex = events.findIndex(
        (event) => event.kind === 'apply_environment' && event.page === 101,
      )
      return navigationIndex > environmentIndex && environmentIndex >= 0
    }, { message: 'the client environment should be applied before navigation' })
    .toBe(true)

  const newTabButton = page.getByRole('button', { name: '新建标签页' })
  const existingTab = page.getByRole('tab', { name: /example.org/ })
  const [tabBox, newButtonBox, stripBox] = await Promise.all([
    existingTab.boundingBox(),
    newTabButton.boundingBox(),
    page.locator('.rb-tab-strip').boundingBox(),
  ])
  expect(tabBox).not.toBeNull()
  expect(newButtonBox).not.toBeNull()
  expect(stripBox).not.toBeNull()
  expect(newButtonBox!.x - (tabBox!.x + tabBox!.width)).toBeLessThan(12)
  expect(stripBox!.x + stripBox!.width - newButtonBox!.x).toBeGreaterThan(100)

  await newTabButton.click()
  await expect(newTabButton).toBeDisabled()
  await expect(newTabButton).toHaveAttribute('aria-busy', 'true')
  await expect(newTabButton.locator('.rb-spinner--small')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(newTabButton).toBeEnabled()
  await expect(page.getByRole('tab', { name: /新标签页/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect
    .poll(async () => {
      const events = await mockEvents(request)
      const environmentIndex = events.findIndex(
        (event) => event.kind === 'apply_environment' && event.page !== 101,
      )
      if (environmentIndex < 0) return false
      const environment = events[environmentIndex]
      return events.some(
        (event, index) =>
          index > environmentIndex &&
          event.kind === 'screenshot' &&
          event.page === environment?.page,
      )
    }, { message: 'a new tab should receive the environment before its first frame' })
    .toBe(true)

  await page.setViewportSize({ width: 650, height: 500 })
  const connectionButton = page.getByRole('button', { name: '切换连接' })
  await connectionButton.hover()
  const [connectionBox, toolbarBox] = await Promise.all([
    connectionButton.boundingBox(),
    page.locator('.rb-browser-toolbar').boundingBox(),
  ])
  expect(connectionBox?.width).toBe(32)
  expect(connectionBox?.height).toBe(32)
  expect(toolbarBox?.height).toBeLessThanOrEqual(54)
  await connectionButton.click()
  await expect(page.getByRole('dialog', { name: '切换 BrowserOS 连接' })).toBeVisible()
  await page.getByRole('button', { name: '取消' }).click()

  await page.getByRole('tab', { name: /example.org/ }).click()
  await expect(page.getByAltText(/example.org 的远程页面画面/), {
    timeout: 150,
  }).toBeVisible()
  await page.getByRole('tab', { name: /新标签页/ }).click()
  await expect(page.getByAltText(/新标签页 的远程页面画面/), {
    timeout: 150,
  }).toBeVisible()
  await page.getByRole('tab', { name: /example.org/ }).click()
  await expect(page.getByAltText(/example.org 的远程页面画面/), {
    timeout: 150,
  }).toBeVisible()
  const viewport = page.getByRole('application', {
    name: /远程网页交互区域/,
  })
  await expect(viewport).toBeVisible()
  const box = await viewport.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.keyboard.type('hi')
  await page.mouse.wheel(0, 240)

  await expect
    .poll(async () => {
      const response = await request.get('http://127.0.0.1:4174/events')
      const received = (await response.json()) as Array<{ kind?: string }>
      return received.map((event) => event.kind).filter(Boolean).sort()
    })
    .toEqual(expect.arrayContaining(['click_at', 'scroll', 'type']))

  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }))
  expect(storage).toEqual({ local: 0, session: 0 })
})

test('resumes screenshot polling when reconnecting during an in-flight frame', async ({
  page,
}) => {
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: '连接 BrowserOS' })
  await dialog.getByLabel('MCP 地址').fill(endpoint)
  await dialog.getByRole('button', { name: '连接浏览器' }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: '切换连接' }).click()
  const reconnectDialog = page.getByRole('dialog', {
    name: '切换 BrowserOS 连接',
  })
  await reconnectDialog.getByRole('button', { name: '重新连接' }).click()

  await expect(reconnectDialog).toBeHidden()
  await expect(page.getByAltText(/Example Domain 的远程页面画面/)).toBeVisible()
})

test('keeps the preview and remote viewport aligned with its container', async ({
  page,
  request,
}) => {
  await page.goto('/')

  const dialog = page.getByRole('dialog', { name: '连接 BrowserOS' })
  await dialog.getByLabel('MCP 地址').fill(endpoint)
  await dialog.getByRole('button', { name: '连接浏览器' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByAltText(/Example Domain 的远程页面画面/)).toBeVisible()

  const eventOffset = await expectRemoteViewportToMatch(page, request)

  await page.setViewportSize({ width: 1600, height: 900 })
  await expectRemoteViewportToMatch(page, request, eventOffset)

  const viewportBox = await page.locator('.rb-viewport').boundingBox()
  const events = (await mockEvents(request)).slice(eventOffset)
  const resizedViewport = events.find(
    (event) =>
      event.kind === 'set_viewport' &&
      viewportBox &&
      Math.abs((event.width ?? 0) - viewportBox.width) <= 1 &&
      Math.abs((event.height ?? 0) - viewportBox.height) <= 1,
  )
  expect(resizedViewport?.deviceScaleFactor).toBeLessThanOrEqual(1)
})

test('forwards the local browser environment before capture and reapplies theme changes', async ({
  browser,
  request,
}) => {
  const userAgent = 'RemoteBrowserOS-E2E/1.0'
  const remote = await connectCustomBrowserEnvironment(browser, userAgent)

  try {
    const localEnvironment = await remote.page.evaluate(() => ({
      platform: navigator.platform,
      userAgentDataPlatform: (
        navigator as Navigator & {
          userAgentData?: { platform?: string }
        }
      ).userAgentData?.platform,
    }))
    await expect
      .poll(async () => {
        const events = await mockEvents(request)
        const environmentIndex = events.findIndex(
          (event) => event.kind === 'apply_environment',
        )
        if (environmentIndex < 0) return false

        const environment = events[environmentIndex]
        const firstScreenshotIndex = events.findIndex(
          (event) =>
            event.kind === 'screenshot' && event.page === environment?.page,
        )

        return (
          environment.userAgent?.userAgent === userAgent &&
          environment.userAgent.acceptLanguage === 'zh-CN,en-US,en' &&
          environment.userAgent.platform === localEnvironment.platform &&
          (!localEnvironment.userAgentDataPlatform ||
            environment.userAgent.userAgentMetadata?.platform ===
              localEnvironment.userAgentDataPlatform) &&
          mediaFeature(environment, 'prefers-color-scheme') === 'dark' &&
          firstScreenshotIndex > environmentIndex
        )
      }, { message: 'local UA, language and dark theme should precede the first screenshot' })
      .toBe(true)

    const eventOffset = (await mockEvents(request)).length
    await remote.page.emulateMedia({ colorScheme: 'light' })

    await expect
      .poll(async () => {
        const events = (await mockEvents(request)).slice(eventOffset)
        const environmentIndex = events.findIndex(
          (event) =>
            event.kind === 'apply_environment' &&
            event.userAgent?.userAgent === userAgent &&
            event.userAgent.acceptLanguage === 'zh-CN,en-US,en' &&
            mediaFeature(event, 'prefers-color-scheme') === 'light',
        )
        if (environmentIndex < 0) return false

        return events.some(
          (event, index) =>
            index > environmentIndex &&
            event.kind === 'screenshot' &&
            event.page === events[environmentIndex]?.page,
        )
      }, { message: 'a light-theme override and refreshed frame should follow the media change' })
      .toBe(true)
  } finally {
    await remote.close()
  }
})
