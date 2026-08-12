import { expect, test } from '@playwright/test'

const endpoint = 'http://127.0.0.1:4174/mcp'

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
  await address.press('Enter')
  await expect(address).toHaveValue('https://example.org/path')
  await expect(page.getByRole('tab', { name: /example.org/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '后退' })).toBeEnabled()

  await page.getByRole('button', { name: '新建标签页' }).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByRole('tab', { name: /新标签页/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  await page.getByRole('tab', { name: /example.org/ }).click()
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
