import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import path from 'node:path'
import { ADMIN_ORIGIN } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, signIn } from './support/session'

// Branch cutover lane LR (owner ruling 6 Oct 2026): a change addressed to a DISABLED branch is never silent.
// The Worker refuses it with 409 branch_redirect_required; apiFetch hands that to the one registered host, which
// shows "<Old Shop> is disabled" / "Redirect to <LC Store>?" with an active-branch picker and Back / Redirect, then
// the shared confirm "Confirm redirect to <LC Store>?", and sends the SAME request again with X-Branch-Redirect.
// The fixture sale 9001 was recorded at branch 1; the scenario retires that branch (successor 2) and answers the
// status PATCH the way the Worker does. Set LR_SHOTS to a directory to keep screenshots; assertions run either way.
test.use({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop-chromium', 'one browser is enough for the float flow') })

const SHOTS = process.env.LR_SHOTS || ''
const AFTER = [
  { id: 2, name: 'LC Store', role: 'shop', is_active: 1, is_default: 1, successor_branch_id: null },
  { id: 1, name: 'Old Shop', role: 'shop', is_active: 0, is_default: 0, successor_branch_id: 2 },
  { id: 3, name: 'Back Shop', role: 'shop', is_active: 1, is_default: 0, successor_branch_id: null },
]
const REDIRECT_BODY = {
  error: 'This change is addressed to a disabled branch. Choose the active branch it should go to. Nothing was changed.',
  code: 'branch_redirect_required',
  redirect: {
    addressed_branch_id: 1, addressed_branch_name: 'Old Shop', successor_branch_id: 2, successor_branch_name: 'LC Store',
    targets: [{ id: 2, name: 'LC Store' }, { id: 3, name: 'Back Shop' }], requested_target_id: null,
  },
}

async function arrange(context: BrowserContext, seen: Array<string | undefined>, writes: { count: number }) {
  await context.route('**/api/branches', (route) => (route.request().method() !== 'GET'
    ? route.continue()
    : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AFTER.map((row) => ({ ...row, edit_etag: `e${row.id}` }))) })))
  await context.route(/\/api\/sales\/9001\/status/, (route) => {
    if (route.request().method() === 'GET') return route.continue()
    writes.count += 1
    const target = route.request().headers()['x-branch-redirect']
    seen.push(target)
    if (!target) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify(REDIRECT_BODY) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 9001, sale_status: 'cancelled', updated_at: new Date().toISOString() }) })
  })
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

// Apply opens the Cancel sale dialog: a reason, then its own Confirm (the redirect confirm comes later, after the 409).
async function submitCancellation(page: Page) {
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.getByText('Mistake', { exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
}

async function openOldShopSale(page: Page) {
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await page.goto(`${ADMIN_ORIGIN}/sales`)
  await expect(page.locator(APP_ROOT)).toBeVisible()
  await page.getByText('20260914-101500').first().click()
  await expect(page.getByRole('button', { name: 'Cancelled', exact: true })).toBeVisible()
}

test('a write addressed to a disabled branch asks, confirms, then sends the confirmed branch', async ({ page, context }) => {
  const seen: Array<string | undefined> = []
  const writes = { count: 0 }
  await arrange(context, seen, writes)
  await openOldShopSale(page)
  await page.getByRole('button', { name: 'Cancelled', exact: true }).click()
  await shot(page, '1-before-write')
  await submitCancellation(page)
  const float = page.locator('[data-branch-redirect-float]')
  await expect(float).toBeVisible()
  await expect(page.getByText('Old Shop is disabled')).toBeVisible()
  await expect(page.getByText('Redirect to LC Store?')).toBeVisible()
  expect(writes.count).toBe(1)
  await shot(page, '2-float')
  // Back writes nothing.
  await float.locator('[data-branch-redirect-back]').click()
  await expect(float).toHaveCount(0)
  expect(seen).toEqual([undefined])
})

test('Redirect then Confirm retries the same request with X-Branch-Redirect', async ({ page, context }) => {
  const seen: Array<string | undefined> = []
  const writes = { count: 0 }
  await arrange(context, seen, writes)
  await openOldShopSale(page)
  await page.getByRole('button', { name: 'Cancelled', exact: true }).click()
  await submitCancellation(page)
  const float = page.locator('[data-branch-redirect-float]')
  await expect(float).toBeVisible()
  await float.locator('[data-branch-redirect-go]').click()
  await expect(page.getByText('Confirm redirect to LC Store?')).toBeVisible()
  await shot(page, '3-confirm')
  // The Cancel sale dialog is still open underneath while its request waits, so the redirect's Confirm is the topmost.
  await page.getByRole('button', { name: 'Confirm', exact: true }).last().click()
  await expect.poll(() => seen.length).toBe(2)
  expect(seen).toEqual([undefined, '2'])
  await expect(float).toHaveCount(0)
  await shot(page, '4-after-redirect')
})
