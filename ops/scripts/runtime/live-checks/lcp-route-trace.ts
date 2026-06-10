/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium, type BrowserContext, type Page, type Request, type Response } from 'playwright'
import { resolveAuditRoutes, type AuditRoute } from '../audits/audit-manifest.ts'
import { applySessionToPlaywrightContext, hydratePlaywrightPage, loginWithFetch, type BrowserStorageState, type LoginSession } from '../audits/audit-auth.ts'

type RequestRecord = {
  completedMs: number
  method: string
  ms: number
  requestMs: number
  resourceType: string
  status: number
  url: string
}

type PaintMetric = {
  name: string
  startTime: number
}

type LcpMetric = {
  element: string
  loadTime: number
  renderTime: number
  size: number
  startTime: number
  text: string
  url: string
} | null

type RouteLcpResult = {
  apiCount: number
  consoleErrors: string[]
  domContentLoadedMs: number
  failed: RequestRecord[]
  firstContentfulPaintMs: number | null
  firstPaintMs: number | null
  lcp: LcpMetric
  lcpMs: number | null
  path: string
  readyTextMs: number
  requestCount: number
  route: string
  scriptCount: number
  slowestRequests: RequestRecord[]
}

type LcpReport = {
  baseUrl: string
  generatedAt: string
  routes: string[]
  results: RouteLcpResult[]
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports', `lcp-route-trace-${TIMESTAMP}.json`)
const LATEST_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/lcp-route-trace-latest.json')
const READY_TIMEOUT_MS = Number(process.env.BOS_ROUTE_LOAD_READY_TIMEOUT_MS || 20_000)
const LCP_SETTLE_MS = Number(process.env.BOS_LCP_SETTLE_MS || 1_500)
const DEFAULT_ROUTES = ['dashboard', 'products', 'inventory', 'pos', 'files', 'branches', 'audit_log', 'settings', 'public_catalog']
const EXTERNAL_NOISE_RE = /chrome-extension:|No Listener: tabs:outgoing|Grammarly|Statsig|ERR_BLOCKED_BY_CLIENT|webextension\.js|unsafe-eval.*content\.js/i

function readArgs(name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index]
    if (arg === name) {
      values.push(process.argv[index + 1] || '')
      index += 1
      continue
    }
    if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1))
    }
  }
  return values
}

function normalizeRouteNames(): string[] {
  const requested = readArgs('--route')
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean)
  return requested.length ? [...new Set(requested)] : DEFAULT_ROUTES
}

function absoluteUrl(routePath: string): string {
  return new URL(routePath, BASE_URL).toString()
}

function isExternalNoise(message: unknown): boolean {
  return EXTERNAL_NOISE_RE.test(String(message || ''))
}

function recordResponse(startedAt: number, requestStartedAt: number, response: Response): RequestRecord {
  const request = response.request()
  const now = performance.now()
  const completedMs = Math.round(now - startedAt)
  return {
    completedMs,
    method: request.method(),
    ms: completedMs,
    requestMs: Math.max(0, Math.round(now - requestStartedAt)),
    resourceType: request.resourceType(),
    status: response.status(),
    url: response.url(),
  }
}

async function waitForRouteReady(page: Page, route: AuditRoute): Promise<void> {
  await page.waitForFunction(
    ({ pathName, readyText }) => {
      const root = document.querySelector('#root')
      const currentPath = window.location.pathname
      const expectedPath = pathName === '/' ? ['/', '/dashboard'].includes(currentPath) : currentPath === pathName
      const loginVisible = !!document.querySelector('#login-username, #login-password')
      const bodyText = document.body?.innerText || ''
      const hasReadyText = readyText.some((text) => bodyText.includes(text))
      return !!root && !loginVisible && expectedPath && hasReadyText
    },
    { pathName: route.path, readyText: route.ready || [] },
    { timeout: READY_TIMEOUT_MS },
  )
}

async function installPerfObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as typeof window & {
      __bosPerfTrace?: {
        lcp: LcpMetric
        paints: PaintMetric[]
      }
    }
    win.__bosPerfTrace = { lcp: null, paints: [] }
    try {
      const paintObserver = new PerformanceObserver((list) => {
        win.__bosPerfTrace!.paints = list.getEntries().map((entry) => ({
          name: entry.name,
          startTime: Math.round(entry.startTime),
        }))
      })
      paintObserver.observe({ type: 'paint', buffered: true })
    } catch (_) {}
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        const entry = entries[entries.length - 1] as PerformanceEntry & {
          element?: Element
          loadTime?: number
          renderTime?: number
          size?: number
          url?: string
        }
        const element = entry?.element
        win.__bosPerfTrace!.lcp = {
          element: element?.tagName?.toLowerCase() || '',
          loadTime: Math.round(entry?.loadTime || 0),
          renderTime: Math.round(entry?.renderTime || 0),
          size: Math.round(entry?.size || 0),
          startTime: Math.round(entry?.startTime || 0),
          text: (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
          url: entry?.url || '',
        }
      })
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
    } catch (_) {}
  })
}

async function readPerfMetrics(page: Page): Promise<{
  firstContentfulPaintMs: number | null
  firstPaintMs: number | null
  lcp: LcpMetric
  lcpMs: number | null
}> {
  return page.evaluate(() => {
    const win = window as typeof window & {
      __bosPerfTrace?: {
        lcp: LcpMetric
        paints: PaintMetric[]
      }
    }
    const paints = win.__bosPerfTrace?.paints || performance.getEntriesByType('paint').map((entry) => ({
      name: entry.name,
      startTime: Math.round(entry.startTime),
    }))
    const firstPaint = paints.find((entry) => entry.name === 'first-paint')?.startTime ?? null
    const firstContentfulPaint = paints.find((entry) => entry.name === 'first-contentful-paint')?.startTime ?? null
    const lcp = win.__bosPerfTrace?.lcp || null
    return {
      firstContentfulPaintMs: firstContentfulPaint,
      firstPaintMs: firstPaint,
      lcp,
      lcpMs: lcp?.startTime ?? null,
    }
  })
}

async function traceRoute(route: AuditRoute, context: BrowserContext, storageState: BrowserStorageState | null): Promise<RouteLcpResult> {
  const page = await context.newPage()
  await installPerfObservers(page)
  const responses: RequestRecord[] = []
  const consoleErrors: string[] = []
  const startedAt = performance.now()
  const requestStarts = new WeakMap<Request, number>()
  page.on('request', (request) => {
    requestStarts.set(request, performance.now())
  })
  page.on('response', (response) => {
    const request = response.request()
    responses.push(recordResponse(startedAt, requestStarts.get(request) || startedAt, response))
  })
  page.on('requestfailed', (request) => {
    const now = performance.now()
    const completedMs = Math.round(now - startedAt)
    const requestStartedAt = requestStarts.get(request) || startedAt
    responses.push({
      completedMs,
      method: request.method(),
      ms: completedMs,
      requestMs: Math.max(0, Math.round(now - requestStartedAt)),
      resourceType: request.resourceType(),
      status: 0,
      url: request.url(),
    })
  })
  page.on('console', (message) => {
    const text = message.text()
    if (['error', 'warning', 'warn'].includes(message.type()) && !isExternalNoise(text)) {
      consoleErrors.push(`${message.type()}: ${text}`)
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(error?.message || String(error))
  })

  if (storageState) {
    await hydratePlaywrightPage(page, storageState)
  }
  const domStartedAt = performance.now()
  await page.goto(absoluteUrl(route.path), { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const domContentLoadedMs = Math.round(performance.now() - domStartedAt)
  await waitForRouteReady(page, route)
  const readyTextMs = Math.round(performance.now() - domStartedAt)
  await page.waitForTimeout(LCP_SETTLE_MS)
  const perf = await readPerfMetrics(page)
  await page.close()

  const failed = responses.filter((item) => item.status >= 400 || item.status === 0)
  const slowestRequests = responses
    .slice()
    .sort((a, b) => b.requestMs - a.requestMs)
    .slice(0, 8)
  return {
    apiCount: responses.filter((item) => /\/api\/|\/health|\/business-os-build\.json/i.test(item.url)).length,
    consoleErrors,
    domContentLoadedMs,
    failed,
    ...perf,
    path: route.path,
    readyTextMs,
    requestCount: responses.length,
    route: route.name,
    scriptCount: responses.filter((item) => item.resourceType === 'script').length,
    slowestRequests,
  }
}

async function maybeLogin(routes: AuditRoute[]): Promise<LoginSession | null> {
  return routes.some((route) => route.authRequired !== false)
    ? loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
    : null
}

async function main(): Promise<void> {
  const selected = resolveAuditRoutes(normalizeRouteNames())
  if (selected.unknownRoutes.length) {
    throw new Error(`Unknown route(s): ${selected.unknownRoutes.join(', ')}`)
  }
  const routes = [...selected.adminRoutes, ...selected.publicRoutes]
  if (!routes.length) throw new Error('No routes selected for LCP route trace')

  const browser = await chromium.launch()
  try {
    const session = await maybeLogin(routes)
    const results: RouteLcpResult[] = []
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width: 1365, height: 900 } })
      const storageState = session && route.authRequired !== false
        ? await applySessionToPlaywrightContext(context, session, BASE_URL)
        : null
      try {
        const result = await traceRoute(route, context, storageState)
        results.push(result)
        console.log(`[lcp-route-trace] ${route.name}: lcp=${result.lcpMs ?? 'n/a'}ms fcp=${result.firstContentfulPaintMs ?? 'n/a'}ms ready=${result.readyTextMs}ms requests=${result.requestCount} failed=${result.failed.length} errors=${result.consoleErrors.length}`)
      } finally {
        await context.close()
      }
    }

    const report: LcpReport = {
      baseUrl: BASE_URL,
      generatedAt: new Date().toISOString(),
      routes: routes.map((route) => route.name),
      results,
    }
    await fs.mkdir(path.dirname(REPORT_PATH), { recursive: true })
    await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    await fs.writeFile(LATEST_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify({ report: REPORT_PATH, latest: LATEST_REPORT_PATH, routes: routes.length }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
