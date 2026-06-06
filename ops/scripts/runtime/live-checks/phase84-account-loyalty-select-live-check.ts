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
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-account-loyalty-select-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')

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

async function openSharedSelect(page: Page, selector: string, id: string, minimumOptions = 1): Promise<SelectCheck> {
  const button = page.locator(selector)
  await button.waitFor({ state: 'visible', timeout: 20_000 })
  const selectedText = (await button.innerText()).trim()
  await button.click()
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

  const browser = await chromium.launch({ headless: true })
  try {
    const consoleMessages: ConsoleEntry[] = []
    const observedRequests: ObservedRequest[] = []

    const loginContext = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 430, height: 860 } })
    const loginPage = await loginContext.newPage()
    attachConsoleCollector(loginPage, consoleMessages, {
      ignoreConsole: (message) => isIgnoredConsole(message) || /401\s+\(Unauthorized\)/i.test(String(message || '')),
    })
    await loginPage.goto('/login', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await loginPage.locator('#login-username').waitFor({ state: 'visible', timeout: 20_000 })
    const loginDuration = await openSharedSelect(loginPage, '#session-duration', 'login-session-duration', 6)
    await loginPage.screenshot({ path: path.join(REPORT_DIR, 'login-session-duration.png'), fullPage: false })
    await loginContext.close()

    const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1366, height: 900 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    const page = await context.newPage()
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(auth\/bootstrap|customers|portal\/membership|users|roles|auth\/otp\/status|auth\/verification-capabilities)/i.test(url)) {
        observedRequests.push({ method: response.request().method(), status: response.status(), url })
      }
    })

    const loyaltyCustomersRead = waitForRead(page, observedRequests, /\/api\/customers(?:\?|$)/i, 'Loyalty customers read')
    await page.goto('/loyalty-points', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.locator('#points-basis').waitFor({ state: 'visible', timeout: 20_000 })
    const loyaltyCustomersStatus = await loyaltyCustomersRead
    const loyaltyBasis = await openSharedSelect(page, '#points-basis', 'loyalty-points-basis', 2)
    await page.screenshot({ path: path.join(REPORT_DIR, 'loyalty-points-basis.png'), fullPage: false })

    const usersRead = waitForRead(page, observedRequests, /\/api\/users(?:\?|$)/i, 'Users read')
    const rolesRead = waitForRead(page, observedRequests, /\/api\/roles(?:\?|$)/i, 'Roles read')
    await page.goto('/users', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.getByRole('button', { name: /Add user/i }).waitFor({ state: 'visible', timeout: 20_000 })
    const usersStatus = await usersRead
    const rolesStatus = await rolesRead
    await page.getByRole('button', { name: /Add user/i }).click()
    const userRole = await openSharedSelect(page, '#user-role', 'user-role', 1)
    const userStatus = await openSharedSelect(page, '#user-status', 'user-status', 2)
    await page.screenshot({ path: path.join(REPORT_DIR, 'users-form-selects.png'), fullPage: false })
    await page.getByRole('button', { name: /Cancel/i }).last().click()
    await page.locator('#user-role').waitFor({ state: 'hidden', timeout: 10_000 })

    const profileDetailsRead = waitForRead(page, observedRequests, /\/api\/users\/\d+\/profile/i, 'Profile details read')
    const profileOtpRead = waitForRead(page, observedRequests, /\/api\/auth\/otp\/status\//i, 'Profile OTP read')
    await page.getByRole('button', { name: /Profile/i }).first().waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('button', { name: /Profile/i }).first().click()
    await page.getByRole('button', { name: /Security/i }).click()
    await page.locator('#session-duration-profile').waitFor({ state: 'visible', timeout: 20_000 })
    const profileDetailsStatus = await profileDetailsRead
    const profileOtpStatus = await profileOtpRead
    const profileDuration = await openSharedSelect(page, '#session-duration-profile', 'profile-session-duration', 6)
    await page.screenshot({ path: path.join(REPORT_DIR, 'profile-session-duration.png'), fullPage: false })

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
        loginDuration,
        loyaltyCustomersStatus,
        loyaltyBasis,
        usersStatus,
        rolesStatus,
        userRole,
        userStatus,
        profileDetailsStatus,
        profileOtpStatus,
        profileDuration,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        login: path.join(REPORT_DIR, 'login-session-duration.png'),
        loyalty: path.join(REPORT_DIR, 'loyalty-points-basis.png'),
        users: path.join(REPORT_DIR, 'users-form-selects.png'),
        profile: path.join(REPORT_DIR, 'profile-session-duration.png'),
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
