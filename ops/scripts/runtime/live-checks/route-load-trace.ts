/* eslint-disable no-console */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium, type BrowserContext, type Page, type Response } from 'playwright'
import { resolveAuditRoutes, type AuditRoute } from '../audits/audit-manifest.ts'
import { applySessionToPlaywrightContext, hydratePlaywrightPage, loginWithFetch, type BrowserStorageState } from '../audits/audit-auth.ts'

type RequestRecord = {
  method: string
  ms: number
  resourceType: string
  status: number
  url: string
}

type RouteTraceResult = {
  apiCount: number
  bodyTextSample: string
  domMs: number
  errors: string[]
  failed: RequestRecord[]
  path: string
  readyTextMs: number
  requestCount: number
  responses: RequestRecord[]
  route: string
  scriptCount: number
}

type TraceReport = {
  baseUrl: string
  generatedAt: string
  routes: string[]
  results: RouteTraceResult[]
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports', `route-load-trace-${TIMESTAMP}.json`)
const LATEST_REPORT_PATH = path.join(ROOT_DIR, 'ops/runtime/reports/route-load-trace-latest.json')
const TRACE_WINDOW_MS = Number(process.env.BOS_ROUTE_LOAD_TRACE_WINDOW_MS || 600)
const READY_TIMEOUT_MS = Number(process.env.BOS_ROUTE_LOAD_READY_TIMEOUT_MS || 20_000)
const DEFAULT_ROUTES = ['dashboard', 'sales', 'audit_log', 'inventory']
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

async function waitForRouteReady(page: Page, route: AuditRoute): Promise<void> {
  await page.waitForFunction(
    ({ pathName, readyText }) => {
      const root = document.querySelector('#root')
      const loginVisible = !!document.querySelector('#login-username, #login-password')
      const currentPath = window.location.pathname
      const expectedPath = pathName === '/' ? ['/', '/dashboard'].includes(currentPath) : currentPath === pathName
      const bodyText = document.body?.innerText || ''
      const hasReadyText = readyText.some((text) => bodyText.includes(text))
      return !!root && !loginVisible && expectedPath && hasReadyText
    },
    { pathName: route.path, readyText: route.ready || [] },
    { timeout: READY_TIMEOUT_MS },
  )
}

function recordResponse(startedAt: number, response: Response): RequestRecord {
  const request = response.request()
  return {
    method: request.method(),
    ms: Math.round(performance.now() - startedAt),
    resourceType: request.resourceType(),
    status: response.status(),
    url: response.url(),
  }
}

async function traceRoute(route: AuditRoute, storageState: BrowserStorageState, context: BrowserContext): Promise<RouteTraceResult> {
  const page = await context.newPage()
  const responses: RequestRecord[] = []
  const errors: string[] = []
  const startedAt = performance.now()
  page.on('response', (response) => {
    responses.push(recordResponse(startedAt, response))
  })
  page.on('requestfailed', (request) => {
    responses.push({
      method: request.method(),
      ms: Math.round(performance.now() - startedAt),
      resourceType: request.resourceType(),
      status: 0,
      url: request.url(),
    })
  })
  page.on('console', (message) => {
    const text = message.text()
    if (['error', 'warning', 'warn'].includes(message.type()) && !isExternalNoise(text)) {
      errors.push(`${message.type()}: ${text}`)
    }
  })
  page.on('pageerror', (error) => {
    errors.push(error?.message || String(error))
  })

  await hydratePlaywrightPage(page, storageState)
  const domStartedAt = performance.now()
  await page.goto(absoluteUrl(route.path), { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const domMs = Math.round(performance.now() - domStartedAt)
  await waitForRouteReady(page, route)
  const readyTextMs = Math.round(performance.now() - domStartedAt)
  await page.waitForTimeout(TRACE_WINDOW_MS)
  const bodyTextSample = (await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')).slice(0, 2500)
  await page.close()

  const failed = responses.filter((item) => item.status >= 400 || item.status === 0)
  return {
    apiCount: responses.filter((item) => /\/api\/|\/health|\/business-os-build\.json/i.test(item.url)).length,
    bodyTextSample,
    domMs,
    errors,
    failed,
    path: route.path,
    readyTextMs,
    requestCount: responses.length,
    responses,
    route: route.name,
    scriptCount: responses.filter((item) => item.resourceType === 'script').length,
  }
}

async function main(): Promise<void> {
  const routeNames = normalizeRouteNames()
  const selected = resolveAuditRoutes(routeNames)
  if (selected.unknownRoutes.length) {
    throw new Error(`Unknown route(s): ${selected.unknownRoutes.join(', ')}`)
  }
  const routes = [...selected.adminRoutes, ...selected.publicRoutes]
  if (!routes.length) throw new Error('No routes selected for route-load trace')

  const browser = await chromium.launch()
  try {
    const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
    const results: RouteTraceResult[] = []
    for (const route of routes) {
      const context = await browser.newContext({ viewport: { width: 1365, height: 900 } })
      const storageState = await applySessionToPlaywrightContext(context, session, BASE_URL)
      try {
        const result = await traceRoute(route, storageState, context)
        results.push(result)
        console.log(`[route-load-trace] ${route.name}: ready=${result.readyTextMs}ms requests=${result.requestCount} api=${result.apiCount} scripts=${result.scriptCount} failed=${result.failed.length} errors=${result.errors.length}`)
      } finally {
        await context.close()
      }
    }

    const report: TraceReport = {
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
