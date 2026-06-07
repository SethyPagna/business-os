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
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-loyalty-points-rollback-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const LATEST_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/phase84-loyalty-points-rollback-check-latest.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'loyalty-points-save-rollback.png')

const LOYALTY_KEYS = [
  'customer_portal_points_basis',
  'customer_portal_points_per_usd',
  'customer_portal_points_per_khr',
  'customer_portal_redeem_points',
  'customer_portal_redeem_value_usd',
  'customer_portal_redeem_value_khr',
  'customer_portal_show_point_value',
  'customer_portal_membership_info_text',
  'customer_portal_submission_reward_points',
] as const

type LoyaltyKey = typeof LOYALTY_KEYS[number]
type SettingsSnapshot = Record<string, unknown> & { updatedAt?: string }
type ConsoleEntry = { type: string; text: string }
type Report = {
  generatedAt: string
  baseUrl: string
  ok: boolean
  targetBasis: 'usd' | 'khr'
  saveStatus: number | null
  changed: Record<string, unknown>
  observed: Record<string, unknown>
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

function loyaltySnapshot(settings: SettingsSnapshot): Record<LoyaltyKey, unknown> {
  return Object.fromEntries(LOYALTY_KEYS.map((key) => [key, settings[key] ?? ''])) as Record<LoyaltyKey, unknown>
}

async function waitForSettingsPost(page: Page): Promise<Response | null> {
  return page.waitForResponse(
    (response) => response.url().includes('/api/settings') && response.request().method() === 'POST',
    { timeout: 8_000 },
  ).catch(() => null)
}

async function chooseBasis(page: Page, targetBasis: 'usd' | 'khr'): Promise<void> {
  await page.locator('#points-basis').waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('#points-basis').click({ timeout: 5_000 })
  const label = targetBasis === 'usd' ? /Based on USD sales/i : /Based on KHR sales/i
  await page.getByRole('option', { name: label }).click({ timeout: 5_000 })
}

async function clickSave(page: Page): Promise<number | null> {
  const pendingSave = waitForSettingsPost(page)
  await page.getByRole('button', { name: /Save point rules|Save/i }).first().click({ timeout: 5_000 })
  const response = await pendingSave
  await page.waitForTimeout(400)
  return response?.status?.() || null
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const originalSettings = await getSettings(session.cookieHeader)
  const originalSnapshot = loyaltySnapshot(originalSettings)
  const originalBasis = originalSnapshot.customer_portal_points_basis === 'khr' ? 'khr' : 'usd'
  const targetBasis: 'usd' | 'khr' = originalBasis === 'usd' ? 'khr' : 'usd'
  const changed = targetBasis === 'usd'
    ? {
        customer_portal_points_basis: 'usd',
        customer_portal_points_per_usd: '3',
        customer_portal_points_per_khr: '0',
      }
    : {
        customer_portal_points_basis: 'khr',
        customer_portal_points_per_usd: '0',
        customer_portal_points_per_khr: '2',
      }

  const report: Report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    ok: false,
    targetBasis,
    saveStatus: null,
    changed,
    observed: {},
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

    await page.goto('/loyalty-points', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Loyalty Points', { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 })
    await chooseBasis(page, targetBasis)
    if (targetBasis === 'usd') {
      await page.locator('#points-per-usd').fill(String(changed.customer_portal_points_per_usd), { timeout: 5_000 })
    } else {
      await page.locator('#points-per-khr').fill(String(changed.customer_portal_points_per_khr), { timeout: 5_000 })
    }
    report.saveStatus = await clickSave(page)
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    report.screenshots.push(SCREENSHOT_PATH)

    const afterSave = await getSettings(session.cookieHeader)
    report.observed = Object.fromEntries(Object.keys(changed).map((key) => [key, afterSave[key]]))
    for (const [key, value] of Object.entries(changed)) {
      assert(String(afterSave[key] ?? '') === String(value), `${key} expected ${value}, observed ${afterSave[key]}`)
    }
    assert(report.saveStatus === 200, `Loyalty save returned HTTP ${report.saveStatus}`)
    report.ok = true
  } finally {
    await browser.close().catch(() => {})
    report.restoreStatus = await saveSettings(session.cookieHeader, originalSnapshot).catch((error) => {
      console.error('[loyalty-points-rollback] restore failed', error)
      return null
    })
    const restoredSettings = await getSettings(session.cookieHeader).catch(() => ({} as SettingsSnapshot))
    report.restored = LOYALTY_KEYS.every((key) => String(restoredSettings[key] ?? '') === String(originalSnapshot[key] ?? ''))
    report.ok = report.ok && report.restored
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await fs.writeFile(LATEST_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  assert(report.restored, 'Original loyalty settings were not restored')
  assert(report.consoleMessages.length === 0, `Console issues found: ${JSON.stringify(report.consoleMessages)}`)
  console.log(JSON.stringify({
    ok: report.ok,
    targetBasis: report.targetBasis,
    saveStatus: report.saveStatus,
    changed: report.changed,
    observed: report.observed,
    restored: report.restored,
    reportPath: REPORT_PATH,
    screenshot: SCREENSHOT_PATH,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
