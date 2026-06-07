/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page, type Response } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { attachConsoleCollector, isIgnoredConsole } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-settings-save-rollback-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const LATEST_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/phase84-settings-save-rollback-check-latest.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'settings-save-rollback.png')

type SettingsSnapshot = Record<string, unknown> & { updatedAt?: string }
type ConsoleEntry = { type: string; text: string }
type Report = {
  generatedAt: string
  baseUrl: string
  ok: boolean
  key: string
  originalValue: string
  changedValue: string
  observedValue: string
  saveStatus: number | null
  restored: boolean
  restoreStatus: number | null
  consoleMessages: ConsoleEntry[]
  screenshots: string[]
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function headers(cookieHeader: string): Record<string, string> {
  return {
    cookie: cookieHeader,
    'content-type': 'application/json',
  }
}

async function apiJson<T>(
  method: 'GET' | 'POST',
  pathName: string,
  cookieHeader: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${BASE_URL}${pathName}`, {
    method,
    headers: headers(cookieHeader),
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
  })
  const payload = await response.json().catch(() => ({})) as T
  return { status: response.status, payload }
}

async function getSettings(cookieHeader: string): Promise<SettingsSnapshot> {
  const { status, payload } = await apiJson<SettingsSnapshot>('GET', '/api/settings', cookieHeader)
  assert(status === 200, `GET /api/settings returned HTTP ${status}`)
  return payload
}

async function saveSettings(cookieHeader: string, updates: Record<string, unknown>): Promise<number> {
  const { status } = await apiJson<Record<string, unknown>>('POST', '/api/settings', cookieHeader, updates)
  assert(status === 200, `POST /api/settings returned HTTP ${status}`)
  return status
}

async function waitForSettingsPost(page: Page): Promise<Response | null> {
  return page.waitForResponse(
    (response) => response.url().includes('/api/settings') && response.request().method() === 'POST',
    { timeout: 8_000 },
  ).catch(() => null)
}

async function clickSave(page: Page): Promise<number | null> {
  const pendingSave = waitForSettingsPost(page)
  await page.getByRole('button', { name: /^Save$/i }).first().click({ timeout: 5_000 })
  const response = await pendingSave
  await page.waitForTimeout(400)
  return response?.status?.() || null
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const originalSettings = await getSettings(session.cookieHeader)
  const key = 'business_name'
  const originalValue = String(originalSettings[key] || '')
  const baseValue = originalValue.trim() || 'Business OS'
  const changedValue = `${baseValue} QA Save Rollback`

  const report: Report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    ok: false,
    key,
    originalValue,
    changedValue,
    observedValue: '',
    saveStatus: null,
    restored: false,
    restoreStatus: null,
    consoleMessages: [],
    screenshots: [],
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    attachConsoleCollector(page, report.consoleMessages, {
      ignoreConsole: (message) => isIgnoredConsole(message) || /api\/settings.*409|status of 409|favicon\.ico|ResizeObserver loop/i.test(String(message || '')),
    })

    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Settings', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('#settings-business_name').waitFor({ state: 'visible', timeout: 20_000 })
    await page.locator('#settings-business_name').fill(changedValue, { timeout: 5_000 })
    report.saveStatus = await clickSave(page)
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    report.screenshots.push(SCREENSHOT_PATH)

    const afterSave = await getSettings(session.cookieHeader)
    report.observedValue = String(afterSave[key] || '')
    assert(report.saveStatus === 200, `Settings save returned HTTP ${report.saveStatus}`)
    assert(report.observedValue === changedValue, `${key} expected ${changedValue}, observed ${report.observedValue}`)
    report.ok = true
  } finally {
    await browser.close().catch(() => {})
    report.restoreStatus = await saveSettings(session.cookieHeader, { [key]: originalValue }).catch((error) => {
      console.error('[settings-save-rollback] restore failed', error)
      return null
    })
    const restoredSettings = await getSettings(session.cookieHeader).catch(() => ({} as SettingsSnapshot))
    report.restored = String(restoredSettings[key] || '') === originalValue
    report.ok = report.ok && report.restored
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(LATEST_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  assert(report.restored, 'Original settings value was not restored')
  assert(report.consoleMessages.length === 0, `Console issues found: ${JSON.stringify(report.consoleMessages)}`)
  console.log(JSON.stringify({
    ok: report.ok,
    key: report.key,
    saveStatus: report.saveStatus,
    observedValue: report.observedValue,
    restored: report.restored,
    reportPath: REPORT_PATH,
    screenshot: SCREENSHOT_PATH,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
