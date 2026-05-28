/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const REMOTE_PUBLIC_URL = process.env.BOS_REMOTE_PUBLIC_URL || 'https://leangcosmetics.dpdns.org/public'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_DIR = path.join(ROOT_DIR, 'ops/runtime/reports', `phase84-public-portal-cloudflare-check-${TIMESTAMP}`)
const REPORT_PATH = path.join(REPORT_DIR, 'report.json')
const SCREENSHOT_PATH = path.join(REPORT_DIR, 'public.png')

type ConsoleEntry = {
  type: string
  text: string
}

type ObservedRequest = {
  status: number
  url: string
}

type PortalChecks = {
  title: string
  portalVisible: boolean
  internalServerErrorVisible: boolean
  renderedProductCount: number
  configStatus: number | null
  metaStatus: number | null
  searchStatus: number | null
  aiStatus: number | null
  enforcedCspPresent: boolean
  reportOnlyCspPresent: boolean
  toleratedCloudflareScriptMonitorReportOnlyCsp: boolean
  failedResponseCount: number
  relevantConsoleMessages: number
  pageErrors: number
}

type PortalReport = {
  url: string
  checks: PortalChecks
  observedRequests: ObservedRequest[]
  mainResponseHeaders: {
    'content-security-policy': string
    'content-security-policy-report-only': string
  }
  consoleMessages: ConsoleEntry[]
  relevantConsole: ConsoleEntry[]
  pageErrors: string[]
  screenshots: {
    public: string
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function isRelevantConsole(message: string): boolean {
  return !/favicon\.ico|ResizeObserver loop|Search endpoint requested|violates the following Content Security Policy directive:.*policy is report-only/i.test(message)
}

function isCloudflareScriptMonitorReportOnlyCsp(header: string): boolean {
  return /csp-reporting\.cloudflare\.com\/cdn-cgi\/script_monitor\/report/i.test(header)
    || /report-to\s+cf-csp-endpoint/i.test(header)
}

function endpointStatus(observedRequests: ObservedRequest[], pattern: RegExp): number | null {
  return [...observedRequests].reverse().find((request) => pattern.test(request.url))?.status ?? null
}

async function main(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const publicOrigin = new URL(REMOTE_PUBLIC_URL).origin
  const browser = await chromium.launch({ headless: true })

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      ignoreHTTPSErrors: true,
    })
    const page = await context.newPage()
    const consoleMessages: ConsoleEntry[] = []
    const pageErrors: string[] = []
    const observedRequests: ObservedRequest[] = []

    page.on('console', (message) => {
      consoleMessages.push({ type: message.type(), text: message.text() })
    })
    page.on('pageerror', (error) => {
      pageErrors.push(String(error?.stack || error?.message || error))
    })
    page.on('response', (response) => {
      const url = response.url()
      if (url.startsWith(publicOrigin) || url.includes('/api/portal/')) {
        observedRequests.push({ status: response.status(), url })
      }
    })

    console.log(`[phase84-public] opening ${REMOTE_PUBLIC_URL}`)
    const mainResponse = await page.goto(REMOTE_PUBLIC_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
    await page.waitForTimeout(2_000)

    const mainResponseHeaders = mainResponse?.headers?.() || {}
    const enforcedCsp = mainResponseHeaders['content-security-policy'] || ''
    const reportOnlyCsp = mainResponseHeaders['content-security-policy-report-only'] || ''
    const title = await page.title()
    const bodyText = await page.locator('body').innerText({ timeout: 15_000 })
    const portalVisible = /Leang Cosmetic/i.test(bodyText) && /Products/i.test(bodyText)
    const internalServerErrorVisible = /"success"\s*:\s*false|Internal server error/i.test(bodyText)
    const renderedProductCount = await page.locator('article, [data-product-card], .product-card').count().catch(() => 0)
    const relevantConsole = consoleMessages.filter((message) => isRelevantConsole(message.text))
    const failedResponses = observedRequests.filter((request) => request.status >= 500)

    const checks: PortalChecks = {
      title,
      portalVisible,
      internalServerErrorVisible,
      renderedProductCount,
      configStatus: endpointStatus(observedRequests, /\/api\/portal\/config/i),
      metaStatus: endpointStatus(observedRequests, /\/api\/portal\/catalog\/meta/i),
      searchStatus: endpointStatus(observedRequests, /\/api\/portal\/catalog\/products\/search/i),
      aiStatus: endpointStatus(observedRequests, /\/api\/portal\/ai\/status/i),
      enforcedCspPresent: /script-src\s+'self'/i.test(enforcedCsp) && /connect-src\s+'self'/i.test(enforcedCsp),
      reportOnlyCspPresent: Boolean(reportOnlyCsp),
      toleratedCloudflareScriptMonitorReportOnlyCsp: isCloudflareScriptMonitorReportOnlyCsp(reportOnlyCsp),
      failedResponseCount: failedResponses.length,
      relevantConsoleMessages: relevantConsole.length,
      pageErrors: pageErrors.length,
    }

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true })
    const report: PortalReport = {
      url: page.url(),
      checks,
      observedRequests,
      mainResponseHeaders: {
        'content-security-policy': enforcedCsp,
        'content-security-policy-report-only': reportOnlyCsp,
      },
      consoleMessages,
      relevantConsole,
      pageErrors,
      screenshots: {
        public: SCREENSHOT_PATH,
      },
    }
    await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2))

    assert(checks.portalVisible, 'Remote public portal did not render expected customer content')
    assert(!checks.internalServerErrorVisible, 'Remote public portal rendered an internal server error JSON/message')
    assert(checks.renderedProductCount > 0, 'Remote public portal rendered without visible product cards')
    assert(checks.configStatus === 200, `Remote portal config returned HTTP ${checks.configStatus}`)
    assert(checks.metaStatus === 200, `Remote portal metadata returned HTTP ${checks.metaStatus}`)
    assert(checks.searchStatus === 200, `Remote portal product search returned HTTP ${checks.searchStatus}`)
    assert(checks.aiStatus === 200, `Remote portal AI status returned HTTP ${checks.aiStatus}`)
    assert(checks.enforcedCspPresent, 'Remote public portal response did not expose the expected enforced CSP')
    assert(!checks.reportOnlyCspPresent || checks.toleratedCloudflareScriptMonitorReportOnlyCsp, 'Remote public portal response still exposes an app-origin report-only CSP header')
    assert(failedResponses.length === 0, `Remote public portal had ${failedResponses.length} HTTP 5xx response(s)`)
    assert(pageErrors.length === 0, `Remote public portal had ${pageErrors.length} page error(s)`)
    assert(relevantConsole.length === 0, `Remote public portal had ${relevantConsole.length} relevant console message(s)`)

    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
