import { expect, test, type Route } from '@playwright/test'
import { collectPageHealth } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

// KHQR security review F3, the second flow: a refund on a sale that took online money goes back through ABA, not out of the drawer. Real built app, mocked API: Returns -> New Return on
// the fixture's sale 9001 (made to carry a KHQR payment row) -> Review -> "Send the refund" offers Cash or Through ABA with its effect and cap -> the return is posted with refund_channel
// 'aba' only when ABA was chosen, and a refusal from the Worker reads as a sentence. UI/transport contract only; the Worker's rules are pinned by its own tests.
test.use({ serviceWorkers: 'block' })

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
const SALE_ID = 9001
const RECEIPT = '20260914-101500'

type ReturnBody = { refund_channel?: string; sale_id?: number; expected_quote?: { total_refund_usd: number } }

async function openReview(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext, paymentDetails: unknown): Promise<ReturnBody[]> {
  const posted: ReturnBody[] = []
  // The sale carries its payment rows (the fixture's does not); settings (the online method name) and the user shape ride in the auth answers.
  await context.route(/\/api\/sales(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const rows = await response.json() as Array<Record<string, unknown>>
    await route.fulfill({ response, json: rows.map((row) => (Number(row.id) === SALE_ID ? { ...row, payment_details: paymentDetails } : row)) })
  })
  await context.route(/\/api\/auth\/(bootstrap|login|me)(\?|$)/, async (route) => {
    const response = await route.fetch()
    const body = await response.json().catch(() => null) as { user?: Record<string, unknown> } | null
    if (body?.user && body.user.organization_id === undefined) body.user.organization_id = body.user.organizationId ?? null
    await route.fulfill({ response, json: body })
  })
  await context.route('**/api/returns/receipt-lookup**', (route) => json(route, [{ id: SALE_ID, receipt_number: RECEIPT, created_at: '2026-09-14T03:15:00.000Z', customer_name: null, branch_name: 'Shop', total_usd: 24.5, sale_status: 'completed' }]))
  await context.route('**/api/returns/capabilities', (route) => json(route, { customer_return_create_version: 1, customer_return_edit_version: 1 }))
  await context.route('**/api/returns/quote', (route) => json(route, {
    customer_return_create_version: 1, customer_return_edit_version: 1,
    money_precision_version: 1, sale_id: SALE_ID, sale_revision: 0, calculated_refund_usd: 24.5, rounding_adjustment_usd: 0, total_refund_usd: 24.5, total_refund_khr: 100450,
    items: [{ sale_item_id: 70001, quantity: 1, total_usd: 24.5, total_khr: 100450, applied_price_usd: 24.5, applied_price_khr: 100450 }],
  }))
  await context.route('**/api/returns', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    posted.push(route.request().postDataJSON() as ReturnBody)
    return json(route, { error: 'Only 10.00 USD of what the customer paid online is left to refund through ABA.', code: 'aba_refund_over_online' }, 409)
  })
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await gotoAdminPage(page, '/returns')
  await page.getByRole('button', { name: 'Add Return', exact: true }).first().click()
  const dialog = page.getByRole('dialog').last()
  await dialog.getByPlaceholder('Search by receipt number or sale ID').fill(RECEIPT)
  await dialog.getByRole('listbox').getByRole('button').first().click()
  // the sale's one line: take one back, Restock (the product has no received dates, so no date to pick), the default reason, then Review
  await expect(dialog.getByText('E2E Product 001 Aurelia')).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Increase quantity' }).click()
  await dialog.getByRole('button', { name: 'Review' }).click()
  return posted
}

const confirmButton = (dialog: import('@playwright/test').Locator) => dialog.getByRole('button', { name: 'Confirm', exact: true })

test('a sale that took online money offers Through ABA with its effect and cap, and the return carries the channel when ABA is chosen', async ({ page, context }) => {
  const health = collectPageHealth(page)
  const posted = await openReview(page, context, [{ method: 'ABA KHQR', amount_usd: 24.5 }])
  const dialog = page.getByRole('dialog').last()
  const choice = dialog.locator('[data-section="aba-refund"]')
  await expect(choice).toBeVisible({ timeout: 30_000 })
  await expect(choice).toContainText('Send the refund')
  // cash is the default and says what it does to the drawer
  await expect(choice.getByRole('radio', { name: 'Cash from the till' })).toHaveAttribute('aria-checked', 'true')
  await expect(choice).toContainText('$24.50 is paid out of the till drawer.')
  await expect(choice).toContainText('Up to $24.50 was paid online for this sale.')

  // Through ABA: the effect is stated before anything is sent
  await choice.getByRole('radio', { name: 'Through ABA' }).click()
  await expect(choice).toContainText('$24.50 goes back through ABA. The till drawer is not touched; send the money from the ABA app after confirming.')
  await confirmButton(dialog).click()
  await expect.poll(() => posted.length, { message: 'the return is posted' }).toBe(1)
  expect(posted[0].refund_channel).toBe('aba')
  expect(posted[0].sale_id).toBe(SALE_ID)
  // the Worker's refusal reads as a sentence in the staff language, not as a code or the Worker's English
  await expect(page.getByText('That is more than the customer paid online and has not been refunded yet. Lower the amount, or refund the rest in cash.')).toBeVisible()
  expect(health.pageErrors).toEqual([])
})

test('the default choice, cash, sends no channel at all', async ({ page, context }) => {
  const posted = await openReview(page, context, [{ method: 'ABA KHQR', amount_usd: 24.5 }])
  const dialog = page.getByRole('dialog').last()
  await expect(dialog.locator('[data-section="aba-refund"]')).toBeVisible({ timeout: 30_000 })
  await confirmButton(dialog).click()
  await expect.poll(() => posted.length).toBe(1)
  expect(Object.hasOwn(posted[0], 'refund_channel'), 'the body has no refund_channel').toBe(false)
})

test('a sale paid only in cash is never offered Through ABA', async ({ page, context }) => {
  await openReview(page, context, [{ method: 'Cash', amount_usd: 24.5 }])
  const dialog = page.getByRole('dialog').last()
  await expect(confirmButton(dialog)).toBeVisible({ timeout: 30_000 })
  await expect(dialog.locator('[data-section="aba-refund"]')).toHaveCount(0)
})
