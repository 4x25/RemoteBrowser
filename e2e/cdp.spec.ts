import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect, test } from '@playwright/test'

const targetUrl = 'http://127.0.0.1:4174/page'
const appOrigin = 'http://127.0.0.1:4173'

let remoteProcess: ChildProcess | undefined
let remoteWsUrl = ''
let userDataDir = ''

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'remote-browser-cdp-'))
  const executable = chromium.executablePath()
  const args = [
    ...(executable.includes('headless_shell') ? [] : ['--headless=new']),
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=0',
    `--remote-allow-origins=${appOrigin}`,
    `--user-data-dir=${userDataDir}`,
    targetUrl,
  ]
  const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  remoteProcess = child

  remoteWsUrl = await new Promise<string>((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(
      () => reject(new Error('the CDP endpoint was not announced in time')),
      30_000,
    )
    child.stderr?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
      if (match?.[1]) {
        clearTimeout(timer)
        resolve(match[1])
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`the remote Chromium exited early: ${code}`))
    })
  })
})

test.afterAll(async () => {
  remoteProcess?.kill('SIGKILL')
  remoteProcess = undefined
  if (userDataDir) {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('connects over CDP and drives tabs, navigation and viewport input', async ({
  page,
}) => {
  await page.goto('/')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: 'CDP' }).click()
  await dialog.getByLabel('CDP 地址').fill(remoteWsUrl)
  await dialog.getByRole('button', { name: '连接浏览器' }).click()
  await expect(dialog).toBeHidden()

  await expect(page.getByRole('tab', { name: /CDP Target/ })).toBeVisible()
  await expect(page.getByAltText(/CDP Target 的远程页面画面/)).toBeVisible()

  const remoteBrowser = await chromium.connectOverCDP(remoteWsUrl)
  try {
    const remotePage = remoteBrowser.contexts()[0]?.pages()[0]
    expect(remotePage).toBeDefined()
    if (!remotePage) return

    const stage = page.locator('.rb-viewport__stage')
    const stageBox = await stage.boundingBox()
    expect(stageBox).not.toBeNull()
    if (!stageBox) return

    const remoteSize = await remotePage.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    const toClientPoint = (x: number, y: number) => ({
      x: stageBox.x + (x / remoteSize.width) * stageBox.width,
      y: stageBox.y + (y / remoteSize.height) * stageBox.height,
    })

    // Click: the fixture button turns the remote document title into a tab title.
    const buttonPoint = toClientPoint(110, 55)
    await page.mouse.click(buttonPoint.x, buttonPoint.y)
    await expect(page.getByRole('tab', { name: /CDP Clicked/ })).toBeVisible({
      timeout: 10_000,
    })

    // Typing: the input receives the forwarded text.
    const fieldPoint = toClientPoint(120, 162)
    await page.mouse.click(fieldPoint.x, fieldPoint.y)
    await page.keyboard.type('hi')
    await expect
      .poll(() => remotePage.inputValue('#field'), { timeout: 5_000 })
      .toBe('hi')

    // Wheel: the remote document scrolls.
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2)
    await page.mouse.wheel(0, 400)
    await expect
      .poll(() => remotePage.evaluate(() => window.scrollY), { timeout: 5_000 })
      .toBeGreaterThan(0)

    // Address bar: navigation and history work over the CDP session.
    const address = page.getByLabel('网页地址')
    await address.fill('http://127.0.0.1:4174/page?two')
    await address.press('Enter')
    await expect
      .poll(() => remotePage.url(), { timeout: 10_000 })
      .toContain('?two')

    const backButton = page.getByRole('button', { name: '后退' })
    await expect(backButton).toBeEnabled({ timeout: 10_000 })
    await backButton.click()
    await expect
      .poll(() => remotePage.url(), { timeout: 10_000 })
      .not.toContain('?two')
  } finally {
    await remoteBrowser.close()
  }

  const storage = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }))
  expect(storage).toEqual({ local: 0, session: 0 })
})

test('reports CDP connection failures in the dialog', async ({ page }) => {
  await page.goto('/')

  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'CDP' }).click()
  await dialog.getByLabel('CDP 地址').fill('ws://127.0.0.1:1/devtools/browser/missing')
  await dialog.getByRole('button', { name: '连接浏览器' }).click()

  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 15_000 })
})
