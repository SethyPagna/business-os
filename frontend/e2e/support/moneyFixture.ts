import { expect, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

/**
 * e2e/support/moneyFixture.ts -- the client half of cloudflare/scripts/e2e-money-fixture.cjs.
 *
 * That script boots a disposable native Worker + D1 on 127.0.0.1:4351 and seeds an administrator, a NON-admin
 * cashier (approved device, shift policy enforced), two branches with lots, one customer with a membership, one
 * courier and a known exchange rate. This file is what a system spec imports to talk to it: the seed manifest, the
 * database snapshot, a read-only SELECT, a real administrator request, and the cashier's real sign-in.
 *
 * Nothing here knows an expected number. A spec derives those from the seed prices and the owner's money rules and
 * compares them with what the DATABASE holds; reading an expectation back from the app would be asking the code
 * under test to grade itself.
 */

export const MONEY_ORIGIN = process.env.E2E_MONEY_ORIGIN || 'http://127.0.0.1:4351'

export type Row = Record<string, any>
export type SeedLot = { id: number; branchId: number; code: string; receivedAt: string; quantity: number }
export type SeedProduct = { id: number; name: string; barcode: string; priceUsd: number; costUsd: number; lots: SeedLot[] }
export type SeedActor = { id: number; username: string; name: string; roleCode: string; permissions: Record<string, unknown>; deviceId?: string }
export type Seed = {
  password: string
  organizationName: string
  exchangeRate: number
  branches: Array<{ id: number; name: string; isDefault: number }>
  actors: { admin: SeedActor; cashier: SeedActor }
  products: SeedProduct[]
  customer: { id: number; name: string; phone: string; membershipNumber: string; points: number }
  courier: { id: number; name: string; phone: string; area: string }
  settings: Record<string, string>
}
export type Ready = { ready: true; sourceHead: string; trackedChanges: string; frontendBuild: { revision?: string }; migrations: number; organizationId: number; seed: Seed }
export type MoneyState = {
  saleIds: number[]
  sales: Row[]
  lines: Row[]
  allocations: Row[]
  stock: Row[]
  lots: Row[]
  movements: Row[]
  shifts: Row[]
  settings: Row[]
  audits: Row[]
  foreignKeyCheck: Row[]
  outboundRefusals: Array<{ method: string; url: string }>
}

/** A system spec must be unable to reach production even by a mistyped override. */
export function assertLoopback(origin = MONEY_ORIGIN): void {
  const host = new URL(origin).hostname
  expect(host === '127.0.0.1' || host === 'localhost' || host === '::1', `E2E_MONEY_ORIGIN must be loopback, got ${origin}`).toBe(true)
}

/** The seed manifest and the provenance of the build under test. */
export async function loadReady(request: APIRequestContext): Promise<Ready> {
  const response = await request.get(`${MONEY_ORIGIN}/__fixture/ready`)
  expect(response.status(), 'the money fixture must be running: node cloudflare/scripts/e2e-money-fixture.cjs').toBe(200)
  const ready = await response.json() as Ready
  if (process.env.E2E_EXPECTED_BUILD_SHA) {
    expect(ready.sourceHead, 'the fixture serves another commit than the one under test').toBe(process.env.E2E_EXPECTED_BUILD_SHA)
    expect(ready.frontendBuild.revision, 'frontend/dist was built from another commit than the fixture serves').toBe(ready.sourceHead.slice(0, 12))
  }
  return ready
}

/** The fixture's own reads run on the laptop that is also running the browser; Playwright's 30 s default has been outrun under load. */
const READ_TIMEOUT_MS = 120_000

/**
 * A read that is safe to repeat (GET state, a read-only SELECT) is repeated once if the socket it reused was closed under it:
 * that is a stale keep-alive connection, not an answer. Anything that changes data is never retried this way.
 */
async function repeatableRead(send: () => Promise<APIResponse>): Promise<APIResponse> {
  try { return await send() } catch (error) {
    if (!/ECONNRESET|socket hang up|EPIPE/i.test(String((error as Error)?.message))) throw error
    return await send()
  }
}

/** Raw database rows. `saleId` restricts sales, lines and allocations to one sale; omit it for all of them. */
export async function readState(request: APIRequestContext, saleId?: number): Promise<MoneyState> {
  const response = await repeatableRead(() => request.get(`${MONEY_ORIGIN}/__fixture/state${saleId ? `?sale=${saleId}` : ''}`, { timeout: READ_TIMEOUT_MS }))
  expect(response.status()).toBe(200)
  return await response.json() as MoneyState
}

/** One read-only SELECT, for the table the snapshot does not carry. */
export async function selectRows(request: APIRequestContext, sql: string, params: unknown[] = []): Promise<Row[]> {
  const response = await repeatableRead(() => request.post(`${MONEY_ORIGIN}/__fixture/select`, { data: { sql, params }, timeout: READ_TIMEOUT_MS }))
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json() as { rows: Row[] }).rows
}

/** A real /api/* request as the administrator, through the real route (settings, reports, role edits). */
export async function adminCall(request: APIRequestContext, path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<{ status: number; body: any }> {
  const response = await request.post(`${MONEY_ORIGIN}/__fixture/admin-call`, { data: { path, method, body } })
  expect(response.status()).toBe(200)
  return await response.json() as { status: number; body: any }
}

/** Write only the settings that differ from what the database holds, through the real Settings route. */
export async function ensureSettings(request: APIRequestContext, wanted: Record<string, string>): Promise<void> {
  const stored = new Map((await readState(request)).settings.map(row => [String(row.key), String(row.value)]))
  const changed = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => stored.get(key) !== value))
  if (!Object.keys(changed).length) return
  const result = await adminCall(request, '/api/settings', 'POST', changed)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  const after = new Map((await readState(request)).settings.map(row => [String(row.key), String(row.value)]))
  for (const [key, value] of Object.entries(changed)) expect(after.get(key), `setting ${key} must be stored`).toBe(value)
}

/** branch_stock quantity of a seed product in a branch. */
export function stockQty(state: MoneyState, productId: number, branchId: number): number {
  const row = state.stock.find(r => r.product_id === productId && r.branch_id === branchId)
  if (!row) throw new Error(`no branch_stock row for product ${productId} at branch ${branchId}`)
  return Number(row.quantity)
}

/** branch_batch_stock quantity of a seed lot. */
export function lotQty(state: MoneyState, lotId: number): number {
  const row = state.lots.find(r => r.batch_id === lotId)
  if (!row) throw new Error(`no branch_batch_stock row for lot ${lotId}`)
  return Number(row.quantity)
}

/**
 * Sign in through the REAL login form and the REAL POST /api/auth/login, as a seeded actor, on a page that can
 * reach nothing but the fixture. The cashier presents its approved device id exactly as a browser that was
 * approved earlier would; without it the Worker answers deviceApprovalRequired, which is the gate working.
 */
export async function signInAs(page: Page, who: 'cashier' | 'admin', seed: Seed): Promise<void> {
  const actor = seed.actors[who]
  await page.route('**/*', route => new URL(route.request().url()).origin === MONEY_ORIGIN ? route.continue() : route.abort())
  if (actor.deviceId) await page.addInitScript(deviceId => { localStorage.setItem('businessos_device_id', deviceId) }, actor.deviceId)
  await page.goto(MONEY_ORIGIN)
  await expect(page.locator('#login-username')).toBeVisible()
  // The form learns its organisation from an asynchronous bootstrap request. Pressing Login before it lands is answered by the form
  // itself ("Please choose your organization first."), with no request sent -- so wait for the organisation the form shows.
  await expect(page.getByText(seed.organizationName, { exact: true }).first(), 'the login form must have resolved its organisation').toBeVisible({ timeout: 30_000 })
  await page.locator('#login-username').fill(actor.username)
  await page.locator('#login-password').fill(seed.password)
  await expect(page.locator('#login-username')).toHaveValue(actor.username)
  await expect(page.locator('#login-password')).toHaveValue(seed.password)
  const login = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  const answered = await login
  expect(answered.status(), await answered.text().catch(() => '')).toBe(200)
  await expect(page.locator('#app-root')).toBeVisible({ timeout: 60_000 })
  // Who the Worker thinks this is: the cashier must be a non-administrator, or the device and shift gates the
  // fixture exists to exercise would be exempt and the test would prove nothing about them.
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${localStorage.getItem('businessos_sync_token') || ''}` } })
    return { status: response.status, body: await response.json() }
  })
  expect(me.status).toBe(200)
  const user = me.body.user || me.body
  expect(Number(user.id)).toBe(actor.id)
  expect(user.role_code).toBe(actor.roleCode)
}
