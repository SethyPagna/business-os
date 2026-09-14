import { expect, test, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth, expectNoRuntimeErrors } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * ios-layout.spec.ts -- the phone at the counter.
 *
 * WHAT THIS PROVES, at the three widths that cover every iPhone in use
 * (375 = SE/mini, 390 = 12/13/14, 430 = Pro Max):
 *  - No horizontal overflow. Nothing sticks out past the viewport, so no page
 *    can be side-scrolled by accident while a cashier is trying to scroll down.
 *  - Every text field is at least 16px. Safari ZOOMS the page when a smaller
 *    field takes focus, and the zoom does not come back on blur: the whole
 *    till ends up magnified mid-sale.
 *  - The fixed bottom navigation sits ON the viewport bottom, carries the
 *    safe-area padding, and does not cover the content above it.
 *  - An open modal does not let the page behind it scroll away under the
 *    finger.
 *
 * ERROR CLASS GUARDED: the "it works on my laptop" family -- layout defects
 * that literally cannot appear at 1280px, which is where every manual check
 * happens. Same root cause as a1d55f12 (a glitch only a particular visitor
 * ever saw) applied to viewport instead of storage.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test ios-layout
 *
 * Skipped on desktop-chromium ON PURPOSE: these are phone contracts, and a
 * 1280px pass would be a false green rather than extra coverage.
 */

/** SE/mini, 12/13/14, Pro Max. Heights are the real ones, not round numbers. */
const IPHONE_WIDTHS = [
  { label: 'iPhone SE / mini', width: 375, height: 667 },
  { label: 'iPhone 13 / 14', width: 390, height: 664 },
  { label: 'iPhone Pro Max', width: 430, height: 739 },
] as const

/** frontend/src/components/navigation/Sidebar.tsx:634 */
const FIXED_BOTTOM_NAV = 'nav.safe-area-inset-bottom'

/**
 * Ask the fixture server for the org that HAS a fixed bottom bar.
 *
 * settings.ui_mobile_section_nav defaults to 'pages' (App.tsx:1812), which
 * renders inline navigation and no fixed bar at all -- so a spec that asserts
 * on the bar without this is asserting on an element the default configuration
 * never creates. Measured: `[data-bos-nav-id="pos"]` is simply absent on a
 * Pixel 7 in the default mode.
 */
async function useSectionNavigation(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'e2e_mobile_section_nav', value: 'sections', url: ADMIN_ORIGIN }])
}

/**
 * Elements that stick out past the right edge, worst first.
 *
 * Only ever used to EXPLAIN a failure. The assertion itself is
 * documentElement.scrollWidth, which is the browser's own answer to "can this
 * page be scrolled sideways" and cannot be argued with. This list is a
 * heuristic and was measurably wrong on its first version: it reported the
 * dashboard's date-preset chips ("This Week", "This Month", "This Year") as
 * overflow when they live in a deliberately horizontal scroller, because it
 * only checked the element's OWN overflow-x and not its ancestors'.
 */
async function overflowingElements(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth
    const offenders: { tag: string; text: string; right: number; width: number }[] = []
    const clipped = (element: Element): boolean => {
      let node: Element | null = element.parentElement
      while (node && node !== document.documentElement) {
        const overflowX = window.getComputedStyle(node).overflowX
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden' || overflowX === 'clip') return true
        node = node.parentElement
      }
      return false
    }
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const style = window.getComputedStyle(element)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'hidden') continue
      if (clipped(element)) continue
      if (rect.right > limit + 1) {
        offenders.push({
          tag: `${element.tagName.toLowerCase()}.${String(element.className || '').split(/\s+/).slice(0, 3).join('.')}`,
          text: String((element as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 40),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        })
      }
    }
    return offenders.sort((a, b) => b.right - a.right).slice(0, 6)
  })
}

test.describe('iPhone layout', () => {
  test.skip(({ browserName, isMobile }) => !isMobile && browserName === 'chromium', 'phone contracts; see the file header')

  for (const size of IPHONE_WIDTHS) {
    test(`${size.label} (${size.width}px): nothing overflows sideways`, async ({ page }) => {
      // CATCHES: a fixed-width panel, a long unbroken product name, a toolbar
      // that does not wrap -- anything that turns the page into a horizontal
      // scroller. Discriminating because it NAMES the widest offender, so a
      // failure is a fix instruction rather than a number.
      const health = collectPageHealth(page)
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, E2E_ACCOUNTS.cashierA)

      for (const path of ['/', '/pos', '/products', '/sales']) {
        await gotoAdminPage(page, path)
        await page.waitForTimeout(1_500)
        const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        if (documentWidth > size.width + 1) {
          // Only now is the heuristic worth running, and its whole job is to
          // turn "384 > 375" into a list of elements someone can go and fix.
          const offenders = await overflowingElements(page)
          expect(offenders, `${path} at ${size.width}px: elements past the right edge`).toEqual([])
        }
        expect(documentWidth, `${path} at ${size.width}px: document scrollWidth`).toBeLessThanOrEqual(size.width + 1)
      }

      expectNoRuntimeErrors(health)
    })
  }

  test.fixme('every text field is at least 16px, so Safari never zooms the till', async ({ page }) => {
    // EXPECTED RED ON THIS SOURCE, and it is a shared component, so it is the
    // same defect on every paginated surface at once.
    //
    // MEASURED on /pos at 390px: two `input[type=text]` with aria-label "Page"
    // computing to 12px.
    //
    //   frontend/src/components/shared/PaginationControls.tsx:264
    //       className={`h-10 min-w-10 border-0 bg-transparent px-0 text-center
    //                   text-xs ...`}            <- text-xs = 12px
    //   PaginationControls.tsx:352   `... ${compactCentered
    //       ? 'min-w-7 shrink-0 text-[10px]' : 'w-8 text-xs'}`  <- 10px / 12px
    //   PaginationControls.tsx:419   the compact variant, same story
    //
    // WHY IT MATTERS: Safari on iOS zooms the whole page when a field with a
    // font-size below 16px receives focus, and it does NOT zoom back out on
    // blur. A cashier who taps the page number to jump ahead is left with a
    // magnified till in the middle of a sale and no obvious way back.
    //
    // THE FIX is font-size, not a viewport meta hack: `maximum-scale=1` would
    // suppress the zoom by disabling pinch-zoom for everyone, which is an
    // accessibility regression. Give the input >= 16px (text-base) and keep
    // the visual size with width/padding.
    //
    // The rest of the app already passes this at 390px, so when the three
    // lines above are fixed this test goes green as it stands.
    //
    // Deliberately measures the COMPUTED size, because the offending value
    // comes from a utility class, not from the element's own styles.
    const health = collectPageHealth(page)
    await page.setViewportSize({ width: 390, height: 664 })
    await signIn(page, E2E_ACCOUNTS.cashierA)

    for (const path of ['/pos', '/products', '/sales']) {
      await gotoAdminPage(page, path)
      await page.waitForTimeout(1_500)
      const small = await page.evaluate(() => {
        const out: { field: string; size: string; placeholder: string }[] = []
        for (const field of Array.from(document.querySelectorAll('input, select, textarea'))) {
          const element = field as HTMLInputElement
          if (element.type === 'hidden') continue
          const rect = element.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          const size = Number.parseFloat(window.getComputedStyle(element).fontSize)
          if (size >= 16) continue
          out.push({
            field: `${element.tagName.toLowerCase()}[type=${element.type || 'n/a'}]`,
            size: `${size}px`,
            placeholder: element.placeholder || element.getAttribute('aria-label') || '(unlabelled)',
          })
        }
        return out
      })
      expect(small, `${path}: fields Safari would zoom into`).toEqual([])
    }

    expectNoRuntimeErrors(health)
  })

  test('the fixed bottom bar sits on the edge, keeps its safe area, and covers nothing', async ({ page }) => {
    // CATCHES three separate phone defects at once:
    //  1. a bottom bar that floats above the edge (a strip of page shows under
    //     it while scrolling),
    //  2. a bar that loses env(safe-area-inset-bottom) and ends up under the
    //     iPhone home indicator,
    //  3. a bar that COVERS the last row of content, so the final product in a
    //     list can never be tapped.
    const health = collectPageHealth(page)
    await useSectionNavigation(page)
    await page.setViewportSize({ width: 390, height: 664 })
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/products')

    const nav = page.locator(FIXED_BOTTOM_NAV)
    await expect(nav, 'the sections-mode fixed bottom navigation must exist').toBeVisible({ timeout: 30_000 })

    const box = (await nav.boundingBox())!
    const viewport = page.viewportSize()!
    expect(Math.round(box.y + box.height), 'the bar must end exactly at the viewport bottom').toBe(viewport.height)
    expect(Math.round(box.width), 'the bar must span the full width').toBe(viewport.width)

    // The safe area itself cannot be MEASURED here: no browser Playwright
    // drives reports a non-zero env(safe-area-inset-bottom), so the inset is
    // 0px and the bar's height is the plain 3.55rem. What IS assertable, and
    // what actually broke in the past, is that the bar still carries the rule
    // that consumes the inset (styles/main.css:781 .safe-area-inset-bottom ->
    // padding-bottom: env(safe-area-inset-bottom, 0px)). Losing the class is
    // the regression; the device supplies the number.
    const padding = await nav.evaluate((node) => window.getComputedStyle(node).paddingBottom)
    expect(padding, 'the bar must resolve a safe-area padding-bottom').toMatch(/^\d+(\.\d+)?px$/)
    const usesEnv = await nav.evaluate((node) => Array.from(node.classList).includes('safe-area-inset-bottom'))
    expect(usesEnv, 'the bar must keep the class that consumes env(safe-area-inset-bottom)').toBe(true)

    // Every nav button must be tappable, not just present.
    const buttons = nav.locator('button[data-bos-nav-id]')
    const count = await buttons.count()
    expect(count, 'a bottom bar with no destinations is not a bottom bar').toBeGreaterThan(1)
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index)
      const buttonBox = (await button.boundingBox())!
      expect(buttonBox.width, `nav button ${index} width`).toBeGreaterThan(24)
      expect(buttonBox.height, `nav button ${index} height`).toBeGreaterThan(24)
    }

    // ...and nothing interactive hides underneath it. Checked by asking the
    // browser what it would actually hit at the bar's own coordinates.
    const covered = await page.evaluate((selector) => {
      const bar = document.querySelector(selector)
      if (!bar) return 'no bar'
      const rect = bar.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return hit && bar.contains(hit) ? 'bar' : `covered by ${hit ? hit.tagName.toLowerCase() : 'nothing'}`
    }, FIXED_BOTTOM_NAV)
    expect(covered, 'something is painted over the bottom bar').toBe('bar')

    expectNoRuntimeErrors(health)
  })

  test('an open modal covers the till instead of floating over a live page', async ({ page }) => {
    // CATCHES: the modal that is only visually on top -- the product grid
    // behind it still takes taps, so a finger that misses the dialog adds a
    // product to the cart, and the page behind scrolls away under a drag.
    //
    // NOT WRITTEN AS A SCROLL TEST, deliberately. `page.mouse.wheel` throws
    // "Mouse wheel is not supported in mobile WebKit", and a dispatched wheel
    // event is untrusted, so it scrolls nothing and any such assertion passes
    // vacuously on every implementation -- the worst kind of green. What is
    // measurable on all engines is what the browser says it would HIT at a
    // point, which is the same question ("can the page behind receive this
    // gesture") asked in a way that cannot be faked.
    const health = collectPageHealth(page)
    await page.setViewportSize({ width: 390, height: 664 })
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await gotoAdminPage(page, '/pos')
    await expect(page.getByText('E2E Product 001 Aurelia').first()).toBeVisible({ timeout: 30_000 })

    // The scanner modal is the one every cashier opens, and it is short.
    await page.locator('button[aria-label="Scan Barcode"]').first().click()
    await expect(page.getByRole('dialog').filter({ hasText: 'Scan Barcode' }).first()).toBeVisible({ timeout: 15_000 })

    const reachable = await page.evaluate(() => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]'))
        .find((node) => /Scan Barcode/.test((node as HTMLElement).innerText || ''))
      if (!dialog) return ['no dialog']
      const dialogBox = dialog.getBoundingClientRect()
      const width = document.documentElement.clientWidth
      const height = document.documentElement.clientHeight
      // Probe the corners and the edge midpoints -- every place a thumb lands
      // when it misses a dialog on a phone.
      const points = [
        [6, 6], [width - 6, 6], [6, height - 6], [width - 6, height - 6],
        [width / 2, 6], [width / 2, height - 6],
      ] as const
      const leaks: string[] = []
      for (const [x, y] of points) {
        if (x >= dialogBox.left && x <= dialogBox.right && y >= dialogBox.top && y <= dialogBox.bottom) continue
        const hit = document.elementFromPoint(x, y)
        if (!hit) continue
        if (dialog.contains(hit)) continue
        // The overlay itself is the correct answer; a product tile is not.
        const interactive = hit.closest('button, a, input, select, textarea')
        if (interactive && !dialog.contains(interactive)) {
          leaks.push(`(${Math.round(x)},${Math.round(y)}) -> ${interactive.tagName.toLowerCase()} "${String((interactive as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 30)}"`)
        }
      }
      return leaks
    })
    expect(reachable, 'the page behind an open modal must not be tappable').toEqual([])

    expectNoRuntimeErrors(health)
  })
})
