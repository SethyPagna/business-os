/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Page } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { attachConsoleCollector, isIgnoredConsole, readJson, waitForRead } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-shared-select-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const NOTIFICATION_SCREENSHOT_PATH = path.join(REPORT_DIR, 'notification-page-size-select.png')
const PROVIDER_SCREENSHOT_PATH = path.join(REPORT_DIR, 'library-provider-selects.png')

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { method: string; status: number; url: string }
type RuntimeHealth = {
  status?: string
  runtime?: {
    frontend?: { hash?: string }
    sourceHash?: string
  }
}

type SelectCheck = {
  id: string
  optionCount: number
  selectedText: string
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function openAppSelect(page: Page, selector: string, id: string): Promise<SelectCheck> {
  const button = page.locator(selector)
  await button.waitFor({ state: 'visible', timeout: 10_000 })
  const selectedText = (await button.innerText()).trim()
  await button.click()
  const listbox = page.getByRole('listbox').last()
  await listbox.waitFor({ state: 'visible', timeout: 10_000 })
  const optionCount = await listbox.getByRole('option').count()
  assert(optionCount > 0, `${id} opened with no options`)
  await page.keyboard.press('Escape')
  await listbox.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  return { id, optionCount, selectedText }
}

async function openNotificationPageSizeSelect(page: Page): Promise<SelectCheck> {
  const candidates = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /^(10|20|50|100)$/ })
  const count = await candidates.count()
  assert(count > 0, 'Notification page-size AppSelect trigger was not visible')
  const button = candidates.nth(count - 1)
  await button.waitFor({ state: 'visible', timeout: 10_000 })
  const selectedText = (await button.innerText()).trim()
  await button.click()
  const listbox = page.getByRole('listbox').last()
  await listbox.waitFor({ state: 'visible', timeout: 10_000 })
  const optionCount = await listbox.getByRole('option').count()
  assert(optionCount === 4, `Notification page-size select expected 4 options, got ${optionCount}`)
  await page.keyboard.press('Escape')
  await listbox.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  return { id: 'notification-page-size', optionCount, selectedText }
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`) as RuntimeHealth
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    const consoleMessages: ConsoleEntry[] = []
    const observedRequests: ObservedRequest[] = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(notifications|files|ai\/providers|auth\/bootstrap)/i.test(url)) {
        observedRequests.push({ method: response.request().method(), status: response.status(), url })
      }
    })

    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByRole('button', { name: /Notifications/i }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.getByRole('button', { name: /Notifications/i }).first().click()
    await page.getByText('Notifications', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
    const notificationPageSize = await openNotificationPageSizeSelect(page)
    await page.screenshot({ path: NOTIFICATION_SCREENSHOT_PATH, fullPage: false })
    await page.keyboard.press('Escape')

    const filesRead = waitForRead(page, observedRequests, /\/api\/files/i, 'Files read')
    await page.goto('/files', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Library', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const filesStatus = await filesRead
    const providersRead = waitForRead(page, observedRequests, /\/api\/ai\/providers/i, 'AI providers read')
    await page.getByRole('button', { name: /Providers|AI Providers/i }).first().click()
    await page.getByRole('heading', { name: /AI Providers/i }).waitFor({ state: 'visible', timeout: 20_000 })
    const providersStatus = await providersRead
    const providerSelect = await openAppSelect(page, '#provider-form-provider', 'provider')
    const providerTypeSelect = await openAppSelect(page, '#provider-form-type', 'provider-type')
    await page.screenshot({ path: PROVIDER_SCREENSHOT_PATH, fullPage: false })

    const frameworkOverlayVisible = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count()
    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
    assert(frameworkOverlayVisible === 0, 'A framework error overlay is visible')
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole, null, 2)}`)

    const report = {
      baseUrl: BASE_URL,
      build,
      health: {
        status: health.status,
        frontendHash: health?.runtime?.frontend?.hash || null,
        sourceHash: health?.runtime?.sourceHash || null,
      },
      checks: {
        notificationPageSize,
        filesStatus,
        providersStatus,
        providerSelect,
        providerTypeSelect,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        notification: NOTIFICATION_SCREENSHOT_PATH,
        provider: PROVIDER_SCREENSHOT_PATH,
      },
    }
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
