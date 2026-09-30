import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth, expectNoRuntimeErrors } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * draft-chip.spec.ts -- a minimized draft must stay visible and restorable on a phone.
 *
 * WHAT THIS PROVES, against the built app and the fixture server:
 *  - at 360x800 a draft parked from the Add products session (the existing
 *    Minimize control) shows one count chip in BOTH navigation modes -- the
 *    default "pages" mode used to show no chip at all -- and the chip stays on
 *    screen when the header scrolls away;
 *  - the chip opens a list; its row restores the flow with the typed value
 *    intact; dismissing asks "Discard unsaved changes?" (Back keeps the draft,
 *    Discard removes it);
 *  - at 1280x800 there is no floating chip and the sidebar pill restores the
 *    same draft.
 *
 * ERROR CLASS GUARDED: parked work that looks lost. The owner reported it on
 * 27 Sep (U2) and again on 30 Sep (S7); the unit test drives the component in
 * a bare page, this one drives the real Sidebar and the real navigation modes.
 *
 * Sign-in uses the fixture server's any-non-empty-password rule; nothing here
 * can reach a real account.
 */
test.use({ serviceWorkers: 'block' })

const TYPED = 'Typed reason 123'
const REASON_FIELD = /Physical count/

async function parkDraft(page: Page): Promise<void> {
  await signIn(page, E2E_ACCOUNTS.cashierA, 'admin123')
  await gotoAdminPage(page, '/products')
  await page.getByRole('button', { name: 'Add products', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByPlaceholder(REASON_FIELD).fill(TYPED)
  // The draft is written on a debounce; minimize flushes it, so no wait is needed beyond the click.
  await dialog.getByRole('button', { name: 'Minimize', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

// mouse.wheel does not exist in mobile WebKit, so scroll the scrollers themselves.
async function scrollEverythingDown(page: Page): Promise<void> {
  for (let step = 0; step < 6; step += 1) {
    await page.evaluate(() => {
      for (const node of Array.from(document.querySelectorAll('*'))) {
        if (node.scrollHeight > node.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(node).overflowY)) node.scrollTop += 500
      }
      window.scrollBy(0, 500)
    })
    await page.waitForTimeout(120)
  }
}

async function inViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  const size = page.viewportSize()
  expect(box, 'the element must be rendered').not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(size!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(size!.height)
}

async function intersectsNothing(chip: Locator, others: Locator): Promise<void> {
  const a = await chip.boundingBox()
  expect(a).not.toBeNull()
  for (const other of await others.all()) {
    const b = await other.boundingBox()
    if (!b) continue
    const overlap = a!.x < b.x + b.width && b.x < a!.x + a!.width && a!.y < b.y + b.height && b.y < a!.y + a!.height
    expect(overlap, `the chip must not cover ${await other.evaluate((node) => node.outerHTML.slice(0, 80))}`).toBe(false)
  }
}

for (const mode of ['pages', 'sections'] as const) {
  test.describe(`phone 360x800, ${mode} navigation`, () => {
    test.use({ viewport: { width: 360, height: 800 } })

    test('the parked draft shows as a chip, survives the header scrolling away, and restores its typed value', async ({ page, context }) => {
      const health = collectPageHealth(page)
      await context.addCookies([{ name: 'e2e_mobile_section_nav', value: mode, url: ADMIN_ORIGIN }])
      await parkDraft(page)

      const bottomNav = page.locator('nav.safe-area-inset-bottom')
      await expect(bottomNav).toHaveCount(mode === 'sections' ? 1 : 0)

      const chip = page.locator('[data-draft-chip]')
      await expect(chip).toBeVisible()
      await expect(chip).toHaveAttribute('aria-label', 'Draft 1')
      await expect(chip).toHaveAttribute('title', 'Draft 1')
      await inViewport(page, chip)
      const header = page.locator('[data-bos-mobile-header]')
      const headerBox = await header.boundingBox()
      const chipBox = await chip.boundingBox()
      expect(chipBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height)
      expect(chipBox!.height).toBeGreaterThanOrEqual(44)
      if (mode === 'sections') {
        const navBox = await bottomNav.boundingBox()
        expect(chipBox!.y + chipBox!.height).toBeLessThanOrEqual(navBox!.y)
      }

      // Scroll the page until the header auto-hides: the chip is fixed to the viewport, not to the header.
      await scrollEverythingDown(page)
      await expect(header).toHaveClass(/-translate-y-full/)
      await expect(chip).toBeVisible()
      await inViewport(page, chip)
      await intersectsNothing(chip, page.getByRole('button', { name: /^Scroll to (top|bottom)$/ }))

      // The chip opens the list; the row restores the flow with what was typed.
      await chip.click()
      const list = page.locator('[data-draft-chip-popover]')
      await expect(list).toBeVisible()
      await inViewport(page, list)
      await list.locator('button[title^="Restore"]').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByPlaceholder(REASON_FIELD)).toHaveValue(TYPED)
      await expect(chip).toHaveCount(0)
      expectNoRuntimeErrors(health)
    })

    test('dismissing the draft asks "Discard unsaved changes?" first', async ({ page, context }) => {
      await context.addCookies([{ name: 'e2e_mobile_section_nav', value: mode, url: ADMIN_ORIGIN }])
      await parkDraft(page)
      const chip = page.locator('[data-draft-chip]')
      await chip.click()
      await page.locator('[data-draft-chip-popover]').getByRole('button', { name: 'Dismiss and discard this draft' }).click()

      const prompt = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Discard unsaved changes?' }) })
      await expect(prompt).toBeVisible()
      await expect(prompt.locator('p')).toHaveCount(0)
      await expect(prompt.getByRole('button')).toHaveText(['Discard', 'Back'])
      await prompt.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(prompt).toHaveCount(0)
      await expect(chip).toBeVisible()
      await expect(page.locator('[data-draft-chip-popover]'), 'Back leaves the list open').toBeVisible()

      await page.locator('[data-draft-chip-popover]').getByRole('button', { name: 'Dismiss and discard this draft' }).click()
      await prompt.getByRole('button', { name: 'Discard', exact: true }).click()
      await expect(chip).toHaveCount(0)
    })
  })
}

test.describe('desktop 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('there is no floating chip; the sidebar pill restores the same draft and its X asks first', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'the wide contract is checked once, on the desktop project')
    const health = collectPageHealth(page)
    await parkDraft(page)
    await expect(page.locator('[data-draft-chip-float]')).toHaveCount(0)

    const pill = page.locator('aside button[title^="Restore"]')
    await expect(pill).toBeVisible()
    await page.locator('aside').getByRole('button', { name: 'Dismiss and discard this draft' }).click()
    await expect(page.getByRole('heading', { name: 'Discard unsaved changes?' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click()
    await expect(pill).toBeVisible()

    await pill.click()
    await expect(page.getByRole('dialog').getByPlaceholder(REASON_FIELD)).toHaveValue(TYPED)
    await expect(pill).toHaveCount(0)
    expectNoRuntimeErrors(health)
  })
})
