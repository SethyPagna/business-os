import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * mobile-row-actions.spec.ts -- a button inside a tappable row or card does its own action and nothing else.
 *
 * Owner report (10 Nov 2026): on a phone, the print icon on a sale opened the sale details instead of printing.
 * Root cause: utils/longPress.ts resolved the row's tap on touchend/mouseup and called the row's onClick for ANY
 * target, so a press that began on a button inside the row ran the row's "open details" before the button's own click.
 * stopPropagation on the button's click cannot reach a handler that already ran on touchend.
 *
 * Every tap on the touch projects is a real touchscreen tap at the control's centre (touchstart, touchend, then the click
 * hit-tested after the touchend handlers ran, which is how a sheet opened by touchend swallows the click) and a real
 * mouse click on desktop, so both gesture paths are exercised. Positive controls: tapping empty card space DOES open the
 * details, so "no dialog" cannot pass because the row is dead.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test mobile-row-actions
 * MOBILE_ROW_SHOTS=<dir> writes screenshots of each state.
 */

test.use({ serviceWorkers: 'block' })

const PHONE_SIZES = [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }] as const

async function press(locator: Locator, isMobile: boolean): Promise<void> {
  await locator.scrollIntoViewIfNeeded()
  if (!isMobile) {
    await locator.click()
    return
  }
  const box = await locator.boundingBox()
  if (!box) throw new Error('nothing to tap')
  await locator.page().touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

async function shot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  const dir = process.env.MOBILE_ROW_SHOTS
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, `${name}-${testInfo.project.name}.png`) })
}

async function openSales(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size)
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await gotoAdminPage(page, '/sales')
  await expect(page.getByRole('button', { name: 'Print', exact: true }).first()).toBeVisible({ timeout: 30_000 })
}

const visiblePrint = (page: Page): Locator => page.getByRole('button', { name: 'Print', exact: true }).locator('visible=true').first()
// The mobile header has its own Back (.bos-nav-back, which opens the section menu); the receipt's Back is the other one.
const receiptBack = (page: Page): Locator => page.locator('button[aria-label="Back"]:not(.bos-nav-back)')

async function expectPrintShowsOnlyTheReceipt(page: Page, print: Locator, isMobile: boolean): Promise<void> {
  await expect(print).toBeVisible()
  await press(print, isMobile)
  await expect(receiptBack(page).first(), 'the receipt is shown').toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Thank you for your patronage', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('dialog'), 'the details must not open on the print tap').toHaveCount(0)
}

async function closeReceipt(page: Page): Promise<void> {
  await receiptBack(page).first().click()
  await expect(receiptBack(page)).toHaveCount(0, { timeout: 15_000 })
  await expect(visiblePrint(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('dialog'), 'the details must not be waiting behind the receipt').toHaveCount(0)
}

test.describe('row action buttons do only their own action', () => {
  test.describe.configure({ timeout: 150_000 })

  for (const size of PHONE_SIZES) {
    test(`sales: print opens the receipt, not the details (${size.width}px)`, async ({ page, isMobile }, testInfo) => {
      await openSales(page, size)
      await shot(page, `sales-list-${size.width}`, testInfo)
      const print = visiblePrint(page)
      const box = await print.boundingBox()
      expect(Math.min(box!.width, box!.height), 'print tap target').toBeGreaterThanOrEqual(isMobile ? 36 : 24)
      await expectPrintShowsOnlyTheReceipt(page, print, isMobile)
      await shot(page, `sales-print-receipt-${size.width}`, testInfo)
      await closeReceipt(page)
    })

    test(`sales: print after the details were opened and closed once still shows the receipt (${size.width}px)`, async ({ page, isMobile }, testInfo) => {
      await openSales(page, size)
      await press(page.getByText('Completed', { exact: true }).locator('visible=true').first(), isMobile)
      await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15_000 })
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expectPrintShowsOnlyTheReceipt(page, visiblePrint(page), isMobile)
      await shot(page, `sales-print-after-details-${size.width}`, testInfo)
      await closeReceipt(page)
    })

    test(`sales: the receipt number is plain text, so tapping it still opens the details (${size.width}px)`, async ({ page, isMobile }) => {
      test.skip(!isMobile, 'a mouse click on an id is the copy affordance on desktop; the touch contract is what is pinned here')
      await openSales(page, size)
      await press(page.getByText('20260914-101500', { exact: true }).locator('visible=true').first(), isMobile)
      await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15_000 })
    })

    test(`sales: tapping the row itself opens the details (positive control, ${size.width}px)`, async ({ page, isMobile }, testInfo) => {
      await openSales(page, size)
      const target = page.getByText('Completed', { exact: true }).locator('visible=true').first()
      await press(target, isMobile)
      await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15_000 })
      await shot(page, `sales-details-${size.width}`, testInfo)
    })
  }
})
