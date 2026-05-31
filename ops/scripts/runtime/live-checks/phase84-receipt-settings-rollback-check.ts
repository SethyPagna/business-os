/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Page, type Response } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { parseReceiptTemplate, serializeReceiptTemplate } from '../../../../frontend/src/components/receipt-settings/template.ts'
import { attachConsoleCollector } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-receipt-settings-rollback-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const LATEST_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/phase84-receipt-settings-rollback-check-latest.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'receipt-settings-language-rollback.png')

type SettingsSnapshot = Record<string, unknown> & {
  updatedAt?: string
  receipt_template?: unknown
}

type StepRecord = {
  label: string
  expectedLanguage: string
  observedLanguage: string
  saveStatus: number | null
  ok: boolean
}

type Report = {
  generatedAt: string
  baseUrl: string
  ok: boolean
  steps: StepRecord[]
  consoleMessages: Array<{ type: string; text: string }>
  screenshots: string[]
  restored: boolean
  restoreStatus: number | null
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

async function saveSettings(
  cookieHeader: string,
  updates: Record<string, unknown>,
): Promise<{ status: number; updatedAt: string | null }> {
  const result = await apiJson<Record<string, unknown>>('POST', '/api/settings', cookieHeader, updates)
  assert(result.status === 200, `POST /api/settings returned HTTP ${result.status}`)
  return {
    status: result.status,
    updatedAt: String(result.payload?.updatedAt || '') || null,
  }
}

async function waitForSettingsPost(page: Page): Promise<Response | null> {
  return page.waitForResponse(
    (response) => response.url().includes('/api/settings') && response.request().method() === 'POST',
    { timeout: 8_000 },
  ).catch(() => null)
}

async function waitForReceiptLanguage(cookieHeader: string, expectedLanguage: string): Promise<string> {
  let observedLanguage = ''
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const settings = await getSettings(cookieHeader)
    observedLanguage = parseReceiptTemplate(settings.receipt_template).receipt_language
    if (observedLanguage === expectedLanguage) return observedLanguage
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return observedLanguage
}

async function dismissRuntimeVersionMismatchToast(page: Page): Promise<void> {
  await page
    .getByText('Business OS server and browser app versions do not match', { exact: false })
    .evaluateAll((elements) => {
      for (const element of elements) element.remove()
    })
    .catch(() => {})
}

async function clickLanguage(page: Page, label: string): Promise<number | null> {
  await dismissRuntimeVersionMismatchToast(page)
  const pendingSave = waitForSettingsPost(page)
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first().click({ timeout: 5_000 })
  const response = await pendingSave
  await page.waitForTimeout(350)
  await dismissRuntimeVersionMismatchToast(page)
  return response?.status?.() || null
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const initialSettings = await getSettings(session.cookieHeader)
  const originalTemplate = String(initialSettings.receipt_template || '')
  const originalSerializedTemplate = serializeReceiptTemplate(originalTemplate)
  const seededTemplate = serializeReceiptTemplate({
    ...parseReceiptTemplate(originalTemplate),
    receipt_language: 'en',
  })
  await saveSettings(session.cookieHeader, { receipt_template: seededTemplate })

  const report: Report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    ok: false,
    steps: [],
    consoleMessages: [],
    screenshots: [],
    restored: false,
    restoreStatus: null,
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    attachConsoleCollector(page, report.consoleMessages, {
      ignoreConsole: (message) => /api\/settings.*409|status of 409|favicon\.ico|ResizeObserver loop/i.test(String(message || '')),
    })

    await page.goto('/receipt-settings', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
    await page.getByText('Receipt Settings', { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await dismissRuntimeVersionMismatchToast(page)
    await page.waitForTimeout(1_000)

    for (const [label, expectedLanguage] of [['KH', 'km'], ['Both', 'both'], ['EN', 'en']] as const) {
      const saveStatus = await clickLanguage(page, label)
      const observedLanguage = await waitForReceiptLanguage(session.cookieHeader, expectedLanguage)
      const ok = (saveStatus === 200 || saveStatus === 409) && observedLanguage === expectedLanguage
      report.steps.push({ label, expectedLanguage, observedLanguage, saveStatus, ok })
      assert(ok, `Receipt language ${label} expected ${expectedLanguage}, observed ${observedLanguage}, save HTTP ${saveStatus}`)
    }

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    report.screenshots.push(SCREENSHOT_PATH)
    report.ok = report.steps.every((step) => step.ok)
  } finally {
    await browser.close().catch(() => {})
    const restore = await saveSettings(session.cookieHeader, { receipt_template: originalSerializedTemplate }).catch((error) => {
      console.error('[receipt-settings-rollback] restore failed', error)
      return { status: null, updatedAt: null }
    })
    report.restoreStatus = restore.status
    const restoredSettings = await getSettings(session.cookieHeader).catch(() => ({} as SettingsSnapshot))
    report.restored = String(restoredSettings.receipt_template || '') === originalSerializedTemplate
    report.ok = report.ok && report.restored
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(LATEST_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  assert(report.restored, 'Original receipt template was not restored')
  assert(report.consoleMessages.length === 0, `Console issues found: ${JSON.stringify(report.consoleMessages)}`)
  console.log(JSON.stringify({
    ok: report.ok,
    steps: report.steps,
    restored: report.restored,
    reportPath: REPORT_PATH,
    screenshot: SCREENSHOT_PATH,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
