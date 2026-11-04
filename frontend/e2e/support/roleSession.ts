import type { APIResponse, Browser, BrowserContext, Page, Route } from '@playwright/test'
import { PROJECT_CONTEXT_USE } from '../../playwright.config'
import { ADMIN_ORIGIN, collectPageHealth, type PageHealth } from './harness'
import { E2E_ACCOUNTS, signIn } from './session'
import { accessFor, roleUser, workerUser, type RoleAccess, type RoleDef } from './roleMatrix'
import { projectAcquisitionCosts } from './costRedaction'

/**
 * e2e/support/roleSession.ts -- sign a fixture account in and make the app believe it holds `role`.
 *
 * The fixture server knows a handful of accounts and none of them is a restricted role the way the Worker would build one
 * (cashier_a inherits the administrator role -- see E2E-COVERAGE finding 2). So, exactly as
 * bootstrap-settings-visibility.spec.ts does, the REAL login form signs `cashier_a` in and the three responses that carry the
 * account (POST /api/auth/login, GET /api/auth/bootstrap, GET /api/auth/me) are rewritten to hand the app the role's
 * `role_code`, `role_permissions` and an empty per-user override map. Identity (id, username, name) is left alone so the
 * session cookie, /api/sync/owner and the actor-scope fences all keep agreeing with each other.
 */

/**
 * 1280 px for the desktop project, 390 px for the phone projects (the owner's two widths). The device descriptor behind each
 * project (touch, pixel ratio, user agent) is kept; only the layout width changes, so Pixel 7's 412 px becomes the 390 px
 * iPhone-class width the owner named.
 */
export const VIEWPORT_BY_PROJECT: Record<string, { width: number; height: number }> = {
  'desktop-chromium': { width: 1280, height: 800 },
  'android-chromium': { width: 390, height: 844 },
  'ios-webkit': { width: 390, height: 844 },
}

export const isPhoneProject = (projectName: string): boolean => (VIEWPORT_BY_PROJECT[projectName]?.width ?? 1280) < 768

export type CapturedBody = { url: string; method: string; status: number; text: string }

export type RoleSession = {
  page: Page
  context: BrowserContext
  access: RoleAccess
  health: PageHealth
  /** Every /api/ response the page received, captured with page.on('response'). */
  bodies: CapturedBody[]
  close(): Promise<void>
}

export type RoleSessionOptions = {
  /**
   * Put the Worker's cost redaction over the fixture's JSON GET bodies for this role (default true). false serves the raw
   * admin-shaped bodies to everybody, which is the "the server leaked" case the DOM must still withhold from.
   */
  redact?: boolean
}

/**
 * route.fetch() with a bounded retry. The fixture server is a plain node:http server whose idle keep-alive sockets close under it; a request
 * that reuses one throws "read ECONNRESET" before any byte of the answer. Retrying the same request is what a browser does, and without it a
 * test marked `test.fail` could go red for this reason and be counted as its documented defect.
 */
async function fetchWithRetry(route: Route): Promise<APIResponse> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await route.fetch() } catch (error) {
      lastError = error
      if (!/ECONNRESET|socket hang up|EPIPE/i.test(String((error as Error)?.message ?? error))) throw error
    }
  }
  throw lastError
}

export async function openAsRole(browser: Browser, projectName: string, role: RoleDef, options: RoleSessionOptions = {}): Promise<RoleSession> {
  const device = PROJECT_CONTEXT_USE[projectName as keyof typeof PROJECT_CONTEXT_USE]
  const viewport = VIEWPORT_BY_PROJECT[projectName]
  if (!device || !viewport) throw new Error(`role-matrix has no viewport for project "${projectName}"`)
  const context = await browser.newContext({ ...device, viewport, serviceWorkers: 'block' })
  const page = await context.newPage()
  const health = collectPageHealth(page)
  const access = accessFor(role)
  const bodies: CapturedBody[] = []

  page.on('response', async (response) => {
    if (!response.url().includes('/api/')) return
    try {
      bodies.push({ url: response.url(), method: response.request().method(), status: response.status(), text: await response.text() })
    } catch { /* a navigation aborted the body; nothing to inspect */ }
  })

  // Registered first so the three account routes below, registered later, run before it.
  if (options.redact !== false) {
    await page.route('**/api/**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const response = await fetchWithRetry(route)
      if (!(response.headers()['content-type'] || '').includes('json')) return route.fulfill({ response })
      let body: unknown
      try { body = await response.json() } catch { return route.fulfill({ response }) }
      return route.fulfill({ response, json: projectAcquisitionCosts(body, workerUser(role)) })
    })
  }
  const withRole = async (route: Route) => {
    const response = await fetchWithRetry(route)
    const body = await response.json() as Record<string, unknown> & { user?: { id: number; username: string; name: string } }
    if (!body.user) return route.fulfill({ response })
    return route.fulfill({ response, json: { ...body, user: roleUser(role, body.user) } })
  }
  // The login response also carries the session cookie. Playwright is not documented to apply a fulfilled response's Set-Cookie,
  // so the cookie the real response names is set on the context explicitly; if the browser applied it too, it is the same value.
  await page.route('**/api/auth/login', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const response = await fetchWithRetry(route)
    const [pair] = (response.headersArray().find((header) => header.name.toLowerCase() === 'set-cookie')?.value || '').split(';')
    const eq = pair.indexOf('=')
    if (response.ok() && eq > 0) {
      await context.addCookies([{ name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), url: ADMIN_ORIGIN, httpOnly: true, sameSite: 'Lax' }])
    }
    const body = await response.json() as Record<string, unknown> & { user?: { id: number; username: string; name: string } }
    if (!body.user) return route.fulfill({ response })
    return route.fulfill({ response, json: { ...body, user: roleUser(role, body.user) } })
  })
  await page.route('**/api/auth/bootstrap', withRole)
  await page.route('**/api/auth/me', withRole)

  await signIn(page, E2E_ACCOUNTS.cashierA)
  return { page, context, access, health, bodies, close: () => context.close() }
}
