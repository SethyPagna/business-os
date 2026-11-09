import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { ADMIN_ORIGIN } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

test.use({ serviceWorkers: 'block' })
for (const language of ['en', 'km']) test(`Products retains sole active branch details in ${language}`, async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const original = JSON.parse(readFileSync(new URL('./fixtures/admin-products.json', import.meta.url), 'utf8'))
  const branchName = language === 'km' ? 'Current Shop សាខាលក់ថ្មីជិតផ្សារទីក្រុង' : 'Current Shop'
  const branchSummary = `${branchName}: 12`
  const branches = [{ id: 1, name: branchName, is_active: 1, is_default: 1 }, { id: 2, name: 'Old Shop', is_active: 0 }]
  const product = { ...original.items[0], stock_quantity: 12, branch_stock: [
    { branch_id: 1, branch_name: branchName, branch_active: 1, quantity: 12 },
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
  if ((page.viewportSize()?.width || 0) < 768) {
    // Phone card: one "Name: qty" pill.
    const visibleBranch = page.locator('[data-product-branch-summary]')
    await expect(visibleBranch).toBeVisible()
    await expect(visibleBranch).toContainText(branchSummary)
  } else {
    // Desktop table. The "Name: qty" text exists only in the phone card, which stays in the DOM but is hidden at md+,
    // so getByText(branchSummary).first() resolved to that hidden node and this case failed on desktop only.
    // Since 6.0.873 (20 Oct 2026, Products Excel-style table) the Stock cell prints the total, then ONE chip naming
    // the sole active branch (ProductStockCell, [data-stock-branch-chip]); several branches become [data-stock-branch-line] rows.
    const chip = page.locator('[data-stock-branch-chip]').first()
    await expect(chip).toBeVisible()
    await expect(chip).toContainText(branchName)
    // The chip sits in the same cell as the branch quantity: the sole branch's 12, not Old Shop's 0.
    await expect(chip.locator('xpath=..')).toContainText('12')
    await expect(page.locator('[data-stock-branch-line]'), 'a sole active branch is a chip, never a per-branch list').toHaveCount(0)
  }
  await expect(page.getByText('Old Shop: 0', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Old Shop', { exact: false }).filter({ visible: true }), 'the retired branch is not shown beside stock it does not hold').toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath(`single-branch-${language}.png`), fullPage: true })
  expect(pageErrors).toEqual([])
})
