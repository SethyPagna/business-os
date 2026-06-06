/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Locator, Page } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { attachConsoleCollector, isIgnoredConsole, readJson, readJsonStatus, waitForRead } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-settings-select-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'settings-selects.png')

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

function getSessionUserId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null
  const value = (user as { id?: unknown; user_id?: unknown }).id ?? (user as { id?: unknown; user_id?: unknown }).user_id
  return value === null || value === undefined || value === '' ? null : String(value)
}

async function openSectionForControl(page: Page, sectionName: RegExp, selector: string): Promise<Locator> {
  const control = page.locator(selector)
  if (await control.isVisible().catch(() => false)) return control
  const sectionButton = page.locator('section > button').filter({ hasText: sectionName }).first()
  await sectionButton.waitFor({ state: 'visible', timeout: 15_000 })
  await sectionButton.click()
  await control.waitFor({ state: 'visible', timeout: 15_000 })
  return control
}

async function openSharedSelect(control: Locator, id: string, minimumOptions = 1): Promise<SelectCheck> {
  const selectedText = (await control.innerText()).trim()
  await control.click()
  const page = control.page()
  const listbox = page.getByRole('listbox').last()
  await listbox.waitFor({ state: 'visible', timeout: 10_000 })
  const optionCount = await listbox.getByRole('option').count()
  assert(optionCount >= minimumOptions, `${id} expected at least ${minimumOptions} options, got ${optionCount}`)
  const menuClass = await listbox.getAttribute('class')
  assert(/\brounded-2xl\b/.test(menuClass || ''), `${id} did not render the shared rounded AppSelect menu`)
  await page.keyboard.press('Escape')
  await listbox.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  return { id, optionCount, selectedText }
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`) as RuntimeHealth
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const authedRequest = { headers: { cookie: session.cookieHeader } }
  const settingsStatus = await readJsonStatus(`${BASE_URL}/api/settings`, authedRequest)
  const settingsMetaStatus = await readJsonStatus(`${BASE_URL}/api/settings/meta`, authedRequest)
  const sessionUserId = getSessionUserId(session.payload.user)
  assert(sessionUserId, 'Audit login did not return a user id for OTP status check')
  const otpStatus = await readJsonStatus(`${BASE_URL}/api/auth/otp/status/${encodeURIComponent(sessionUserId)}`, authedRequest)
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
      if (/\/api\/(auth\/bootstrap|settings|auth\/otp\/status)/i.test(url)) {
        observedRequests.push({ method: response.request().method(), status: response.status(), url })
      }
    })

    const bootstrapRead = waitForRead(page, observedRequests, /\/api\/auth\/bootstrap(?:\?|$)/i, 'Auth bootstrap read')
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByText('Settings', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })
    const bootstrapStatus = await bootstrapRead

    const displayCurrency = await openSharedSelect(
      await openSectionForControl(page, /Currency|Currencies/i, '#settings-display-currency'),
      'display-currency',
      3,
    )
    const displayTimezone = await openSharedSelect(
      await openSectionForControl(page, /Timezone|Time zone/i, '#settings-display-timezone'),
      'display-timezone',
      10,
    )
    const sessionDuration = await openSharedSelect(
      await openSectionForControl(page, /Session duration/i, '#login_session_duration'),
      'session-duration',
      6,
    )
    const notificationRealert = await openSharedSelect(
      await openSectionForControl(page, /Notifications/i, '#settings-notifications-realert'),
      'notification-realert',
      5,
    )
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })

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
        settingsStatus,
        settingsMetaStatus,
        otpStatus,
        bootstrapStatus,
        displayCurrency,
        displayTimezone,
        sessionDuration,
        notificationRealert,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        settings: SCREENSHOT_PATH,
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
