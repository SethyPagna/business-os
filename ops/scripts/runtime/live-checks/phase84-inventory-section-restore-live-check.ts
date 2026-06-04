/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loginWithFetch, applySessionToPlaywrightContext, hydratePlaywrightPage } from '../audits/audit-auth.ts'
import { readJson, isIgnoredConsole, attachConsoleCollector } from './live-check-utils.ts'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-inventory-section-restore-live-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'inventory-section-restore.png')

type ConsoleEntry = { type: string; text: string }
type ObservedRequest = { status: number; url: string }
type RuntimeHealth = {
  status?: string
  runtime?: {
    frontend?: { hash?: string }
    sourceHash?: string
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function matchingRequests(requests: ObservedRequest[], pattern: RegExp): ObservedRequest[] {
  return requests.filter((request) => pattern.test(request.url))
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const health = await readJson(`${BASE_URL}/health`) as RuntimeHealth
  const build = await readJson(`${BASE_URL}/business-os-build.json`)
  assert(health.status === 'ok', 'Runtime health is not ok')

  const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 820 } })
    const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('business-os:inventory:section:v2', 'all')
      } catch (_) {}
    })

    const page = await context.newPage()
    const consoleMessages: ConsoleEntry[] = []
    const observedRequests: ObservedRequest[] = []
    attachConsoleCollector(page, consoleMessages)
    page.on('response', (response) => {
      const url = response.url()
      if (/\/api\/(inventory|dashboard|returns)/i.test(url)) {
        observedRequests.push({ status: response.status(), url })
      }
    })

    await page.goto('/inventory', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await hydratePlaywrightPage(page, storageState)
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await page.getByText('Inventory', { exact: true }).first().waitFor({ state: 'visible', timeout: 20_000 })

    const activeSectionText = (await page.locator('button[aria-pressed="true"]').first().innerText()).trim()
    assert(/^Products$/i.test(activeSectionText), `Expected Products section to stay active, got "${activeSectionText}"`)
    const productSearchInputVisible = await page.locator('#inventory-search').isVisible()
    assert(productSearchInputVisible, 'Inventory products search input did not render')
    await page.locator('tbody tr.table-row').first().waitFor({ state: 'visible', timeout: 20_000 })

    await page.waitForTimeout(1200)
    const statsRequests = matchingRequests(observedRequests, /\/api\/inventory\/stats/i)
    const movementsRequests = matchingRequests(observedRequests, /\/api\/inventory\/movements/i)
    const rfidRequests = matchingRequests(observedRequests, /\/api\/inventory\/rfid\//i)
    const dashboardRequests = matchingRequests(observedRequests, /\/api\/dashboard/i)
    const returnsRequests = matchingRequests(observedRequests, /\/api\/returns/i)
    const productsRequests = matchingRequests(observedRequests, /\/api\/inventory\/products\/search/i)
    const bootstrapRequests = matchingRequests(observedRequests, /\/api\/inventory\/bootstrap/i)
    const productStartupReads = [...productsRequests, ...bootstrapRequests]
    assert(productStartupReads.some((request) => request.status === 200), 'Inventory product startup read did not complete successfully')
    assert(statsRequests.length === 0, `Stats endpoint should not load on products-first startup: ${statsRequests.map((item) => item.url).join(', ')}`)
    assert(movementsRequests.length === 0, `Movements endpoint should not load on products-first startup: ${movementsRequests.map((item) => item.url).join(', ')}`)
    assert(rfidRequests.length === 0, `RFID endpoint should not load on products-first startup: ${rfidRequests.map((item) => item.url).join(', ')}`)
    assert(dashboardRequests.length === 0, `Dashboard endpoint should not load on products-first startup: ${dashboardRequests.map((item) => item.url).join(', ')}`)
    assert(returnsRequests.length === 0, `Returns endpoint should not load on products-first startup: ${returnsRequests.map((item) => item.url).join(', ')}`)

    const frameworkOverlayVisible = await page.locator('#vite-error-overlay, [data-nextjs-dialog-overlay]').count()
    assert(frameworkOverlayVisible === 0, 'A framework error overlay is visible')
    const relevantConsole = consoleMessages.filter((entry) => !isIgnoredConsole(entry.text))
    assert(relevantConsole.length === 0, `Relevant console errors/warnings found: ${JSON.stringify(relevantConsole, null, 2)}`)

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })
    const report = {
      baseUrl: BASE_URL,
      build,
      health: {
        status: health.status,
        frontendHash: health?.runtime?.frontend?.hash || null,
        sourceHash: health?.runtime?.sourceHash || null,
      },
      seededStorage: {
        key: 'business-os:inventory:section:v2',
        value: 'all',
      },
      checks: {
        activeSectionText,
        productSearchInputVisible,
        productStartupStatusCount: productStartupReads.filter((request) => request.status === 200).length,
        productSearchStatusCount: productsRequests.filter((request) => request.status === 200).length,
        bootstrapStatusCount: bootstrapRequests.filter((request) => request.status === 200).length,
        statsRequestCount: statsRequests.length,
        movementsRequestCount: movementsRequests.length,
        rfidRequestCount: rfidRequests.length,
        dashboardRequestCount: dashboardRequests.length,
        returnsRequestCount: returnsRequests.length,
        frameworkOverlayVisible: false,
        relevantConsoleMessages: relevantConsole.length,
      },
      observedRequests,
      screenshots: {
        inventory: SCREENSHOT_PATH,
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
