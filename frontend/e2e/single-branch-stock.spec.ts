import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ADMIN_ORIGIN } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

test.use({ serviceWorkers: 'block' })
for (const language of ['en', 'km']) test(`Products retains sole active branch details in ${language}`, async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const original = JSON.parse(readFileSync(new URL('./fixtures/admin-products.json', import.meta.url), 'utf8'))
  const branches = [{ id: 1, name: 'Current Shop', is_active: 1, is_default: 1 }, { id: 2, name: 'Old Shop', is_active: 0 }]
  const product = { ...original.items[0], stock_quantity: 12, branch_stock: [
    { branch_id: 1, branch_name: 'Current Shop', branch_active: 1, quantity: 12 },
    { branch_id: 2, branch_name: 'Old Shop', branch_active: 0, quantity: 0 },
  ] }
  await page.route(/\/api\/auth\/(?:bootstrap|me|login)(?:\?|$)/, async route => {
    const response = await route.fetch()
    const json = await response.json()
    if (json.user) json.user.username = 'admin'
    await route.fulfill({ response, json })
  })
  await page.route(/\/api\/products\/(?:bootstrap|search)(?:\?|$)/, route => route.fulfill({ json: {
    ...original, items: [product], branches, total: 1, page: 1, pageSize: 20,
  } }))
  await page.route(/\/api\/branches(?:\?|$)/, route => route.fulfill({ json: branches }))
  await signIn(page, E2E_ACCOUNTS.admin)
  if (language === 'km') await page.getByRole('button', { name: 'Switch to Khmer' }).click()
  await page.goto(`${ADMIN_ORIGIN}/products`)
  const visibleBranch = (page.viewportSize()?.width || 0) < 768
    ? page.locator('[data-product-branch-summary]')
    : page.getByText('Current Shop: 12', { exact: true }).first()
  await expect(visibleBranch).toBeVisible()
  await expect(visibleBranch).toContainText('Current Shop: 12')
  await expect(page.getByText('Old Shop: 0', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`single-branch-${language}.png`), fullPage: true })
  expect(pageErrors).toEqual([])
})
