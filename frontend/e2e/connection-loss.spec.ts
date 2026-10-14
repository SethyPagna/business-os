import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

// Owner rule (offline mode cancelled, 26 Sep 2026): no connection = a global banner + blocked saving, no queue, and every
// blocking state has a way through. This drives the REAL built app against the fixture server:
//   - a plain connection drop shows "No connection — saving is blocked" within a few seconds and clears when it returns;
//   - when the browser's navigator.onLine is wrong but /health answers, the gate clears (Check connection, or by itself);
//   - a failing /health probe blocks even though the browser says online, and the cart is never lost.
test.use({ serviceWorkers: 'block' })
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop-chromium', 'connection state is browser-independent; one Chromium run is the evidence') })

const products = JSON.parse(fs.readFileSync(new URL('./fixtures/admin-products.json', import.meta.url), 'utf8')).items
const ACCOUNT = E2E_ACCOUNTS.cashierA
const product = products[0]
const line = { ...product, cart_line_id: `${product.id}:selling:2:0:D0:1:abcde`, quantity: 1, price_mode: 'selling', branch_id: 2 }
const BANNER = 'No connection — saving is blocked'

async function openPosWithCart(page: Page): Promise<void> {
  await signIn(page, ACCOUNT)
  await page.evaluate(({ cartLine, userId }) => {
    localStorage.setItem(`businessos_pos_orders_${userId}`, JSON.stringify([{ id: 'order-1', name: 'Order 1', cart: [cartLine], money_precision_version: 1 }]))
  }, { cartLine: line, userId: ACCOUNT.id })
  await gotoAdminPage(page, '/pos')
  await expect(complete(page)).toBeVisible({ timeout: 30_000 })
  await expect(complete(page)).toBeEnabled()
}

const complete = (page: Page) => page.getByRole('button', { name: /^Complete Sale$/ })
const banner = (page: Page) => page.getByText(BANNER, { exact: true })
const checkConnection = (page: Page) => page.getByRole('button', { name: 'Check connection' })

test('a plain connection drop shows the banner within seconds and blocks saving; it clears when the connection returns', async ({ page, context }) => {
  await openPosWithCart(page)
  await expect(banner(page)).toHaveCount(0)
  await context.setOffline(true)
  await expect(banner(page)).toBeVisible({ timeout: 5_000 })
  await expect(complete(page)).toBeDisabled()
  await expect(page.locator('body')).toContainText(product.name)
  await context.setOffline(false)
  await expect(banner(page)).toHaveCount(0, { timeout: 15_000 })
  await expect(complete(page)).toBeEnabled()
})

test('navigator.onLine stuck false while /health answers: Check connection clears the block and the cart survives', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __fakeOnline: boolean }).__fakeOnline = true
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get() { return (window as unknown as { __fakeOnline: boolean }).__fakeOnline !== false } })
  })
  await openPosWithCart(page)
  await page.evaluate(() => {
    ;(window as unknown as { __fakeOnline: boolean }).__fakeOnline = false
    window.dispatchEvent(new Event('offline'))
  })
  await expect(banner(page)).toBeVisible({ timeout: 5_000 })
  await expect(complete(page)).toBeDisabled()
  const button = checkConnection(page).first()
  await expect(button).toHaveAttribute('title', 'Check connection')
  await button.click()
  await expect(complete(page)).toBeEnabled({ timeout: 10_000 })
  await expect(banner(page)).toHaveCount(0)
  await expect(page.locator('body')).toContainText(product.name)
})

test('a page that loads with navigator.onLine false while the server answers opens unblocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get() { return false } })
  })
  await signIn(page, ACCOUNT)
  await page.evaluate(({ cartLine, userId }) => {
    localStorage.setItem(`businessos_pos_orders_${userId}`, JSON.stringify([{ id: 'order-1', name: 'Order 1', cart: [cartLine], money_precision_version: 1 }]))
  }, { cartLine: line, userId: ACCOUNT.id })
  await gotoAdminPage(page, '/pos')
  await expect(complete(page)).toBeVisible({ timeout: 30_000 })
  await expect(complete(page)).toBeEnabled({ timeout: 10_000 })
  await expect(banner(page)).toHaveCount(0)
})

test('a failing /health probe blocks saving although the browser says online, and it clears when /health answers again', async ({ page, context }) => {
  await openPosWithCart(page)
  await context.route('**/health', (route) => route.abort('connectionfailed'))
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(banner(page)).toBeVisible({ timeout: 8_000 })
  await expect(complete(page)).toBeDisabled()
  await expect(page.locator('body')).toContainText(product.name)
  await context.unroute('**/health')
  await checkConnection(page).first().click()
  await expect(complete(page)).toBeEnabled({ timeout: 10_000 })
  await expect(banner(page)).toHaveCount(0)
})
