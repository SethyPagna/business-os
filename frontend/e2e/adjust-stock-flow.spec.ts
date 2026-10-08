import { expect, test } from '@playwright/test'
import { ADMIN_ORIGIN } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'
import { readFileSync } from 'node:fs'

test.use({ serviceWorkers: 'block' })
for (const language of ['en', 'km'] as const) {
  const labels = JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8'))
  test(`Adjust Stock ${language} exposes mixed-year dates newest first and preserves Remove default`, async ({ page }, testInfo) => {
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    const catalog = JSON.parse(readFileSync(new URL('./fixtures/admin-products.json', import.meta.url), 'utf8'))
    await page.route(/\/api\/inventory\/(?:bootstrap|products\/search)(?:\?|$)/, async route => route.fulfill({ json: {
      products: catalog, ...catalog, total: catalog.items.length, page: 1, pageSize: 20,
      movements: [], brands: [], categories: [], stats: {},
    } }))
    await page.route(/\/api\/auth\/(?:bootstrap|me|login)(?:\?|$)/, async route => {
      const response = await route.fetch()
      const json = await response.json()
      if (json.user) json.user.username = 'admin'
      await route.fulfill({ response, json })
    })
    await page.route('**/api/batches?**', async route => route.fulfill({ json: { batches: [
      { id: 101, product_id: 1000, quantity: 5, received_at: '2025-01-02', lot_code: '20250102', supplier_name: '' },
      { id: 102, product_id: 1000, quantity: 6, received_at: '2026-10-07', lot_code: '20261007', supplier_name: '' },
    ] } }))
    await signIn(page, E2E_ACCOUNTS.admin)
    if (language === 'km') await page.getByRole('button', { name: 'Switch to Khmer' }).click()
    await page.goto(`${ADMIN_ORIGIN}/inventory`)
    if ((page.viewportSize()?.width || 0) >= 768) await expect.poll(async () => {
      const menu = page.locator('[data-inventory-product-menu]').first()
      if (await menu.getAttribute('open') === null) await menu.locator('summary').click()
      return await menu.getByRole('button', { name: labels.adjust_stock }).isVisible()
    }).toBe(true)
    await page.getByRole('button', { name: labels.adjust_stock }).first().click()
    const dialog = page.getByRole('dialog').last()
    await expect(dialog).toBeVisible()
    const receivedDate = dialog.getByRole('button', { name: labels.received_date, exact: true })
    await receivedDate.click()
    const choices = page.locator('[data-app-select-menu] [role="option"]')
    await expect(choices).toHaveCount(3)
    await expect(choices.nth(1)).toContainText('07/10/2026')
    await expect(choices.nth(2)).toContainText('02/01/2025')
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-app-select-menu]')).toHaveCount(0)
    await dialog.getByRole('textbox', { name: labels.received_date, exact: true }).fill('9032026')
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('textbox', { name: labels.received_date, exact: true })).toHaveValue('09/03/2026')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await dialog.getByRole('radio', { name: labels.adjust_remove, exact: true }).click()
    await expect(receivedDate).toContainText('02/01/2025')
    await receivedDate.click()
    await expect(choices.nth(0)).toContainText('07/10/2026')
    await expect(choices.nth(1)).toContainText('02/01/2025')
    await page.keyboard.press('Escape')
    await dialog.getByRole('radio', { name: labels.adjust_set, exact: true }).click()
    await expect(receivedDate).toContainText('07/10/2026')
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => 420 })
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--kb-inset'))).not.toBe('')
    await receivedDate.click()
    await expect.poll(async () => {
      const box = await page.locator('[data-app-select-menu]').boundingBox()
      return !!box && box.y >= 0 && box.y + box.height <= 420
    }).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('adjust-stock-keyboard.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await dialog.getByRole('spinbutton', { name: labels.set_to, exact: true }).fill('7')
    await dialog.getByRole('button', { name: labels.add, exact: true }).click()
    const items = dialog.locator('section').filter({ has: page.locator('ul') })
    const itemDate = items.locator('span').filter({ hasText: /^= 7 . 07\/10\/2026$/ })
    await expect(itemDate).toBeVisible()
    expect(await itemDate.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    const itemDateBox = await itemDate.boundingBox()
    expect(itemDateBox && itemDateBox.x >= 0 && itemDateBox.x + itemDateBox.width <= (page.viewportSize()?.width || 0)).toBeTruthy()
    await dialog.getByRole('button', { name: labels.next, exact: true }).click()
    const reviewDate = dialog.locator('[data-stock-session-review] li span').filter({ hasText: /^07\/10\/2026\s*$/ })
    await expect(reviewDate).toBeVisible()
    const reviewDateBox = await reviewDate.boundingBox()
    expect(reviewDateBox && reviewDateBox.x >= 0 && reviewDateBox.x + reviewDateBox.width <= (page.viewportSize()?.width || 0)).toBeTruthy()
    const save = dialog.getByRole('button', { name: labels.complete_session, exact: true })
    await expect(save).toBeEnabled()
    const saveBox = await save.boundingBox()
    expect(saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= 420).toBeTruthy()
    await page.screenshot({ path: testInfo.outputPath('adjust-stock-review.png'), fullPage: true })
    const close = dialog.getByRole('button', { name: labels.close, exact: true })
    for (const control of [save, close]) {
      const box = await control.boundingBox()
      expect(box && box.y >= 0 && box.y + box.height <= 420).toBeTruthy()
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog').last()).toContainText(labels.unsaved_changes_title)
    await page.getByRole('dialog').last().getByRole('button', { name: labels.back, exact: true }).click()
    if (testInfo.project.use.isMobile) await close.tap()
    else await close.click()
    await expect(page.getByRole('dialog').last()).toContainText(labels.unsaved_changes_title)
    expect(pageErrors).toEqual([])
  })

}
