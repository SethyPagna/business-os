import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { STOREFRONT_ORIGIN } from './support/harness'

/**
 * storefront-footer-clearance.spec.ts -- at the end of the page no floating button (scroll, list,
 * contact) covers a footer link: every policy link is on screen, clear of them, and takes the tap.
 *
 * CATCHES: a footer that ends flush with the viewport bottom, so the fixed bottom-left scroll
 * buttons (and the bottom-right list/contact buttons) cover the policy links at 360 and 390 px.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-footer-clearance
 */

type FooterReport = {
  settled: boolean
  floating: number
  targets: number
  overlaps: string[]
  untappable: string[]
}

// One measurement, taken only once the page sits at its end with the scroll buttons faded in;
// a page still growing (late sections, fonts) reports settled: false and is measured again.
// Floating buttons are the fixed ones in the lower half; the dismissible install notice sits at the top.
function measureFooterAtPageEnd(page: Page): Promise<FooterReport> {
  return page.evaluate(async () => {
    const FADE_MS = 300
    window.scrollTo(0, document.documentElement.scrollHeight)
    await new Promise((resolve) => setTimeout(resolve, FADE_MS))
    const atEnd = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight

    const lowerHalfFixedAncestor = (element: Element | null): Element | null => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).position === 'fixed') return node.getBoundingClientRect().top > window.innerHeight / 2 ? node : null
      }
      return null
    }
    const shown = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false
      }
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const inViewport = (element: Element) => {
      const rect = element.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= window.innerHeight
    }
    const name = (element: Element) => (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 40)

    const floating = [...document.querySelectorAll('button, a')].filter((element) => lowerHalfFixedAncestor(element) && shown(element) && !element.closest('footer'))
    const footerLinks = [...document.querySelectorAll('footer[data-portal-footer="true"] a, footer[data-portal-footer="true"] button')].filter(shown)
    const policyLinks = footerLinks.filter((element) => element.closest('[data-portal-footer-policies="true"]'))
    const targets = footerLinks.filter(inViewport)
    const settled = atEnd && floating.length >= 2 && policyLinks.length > 0 && policyLinks.every(inViewport)

    const overlaps: string[] = []
    const untappable: string[] = []
    for (const target of targets) {
      const t = target.getBoundingClientRect()
      for (const control of floating) {
        const c = control.getBoundingClientRect()
        if (t.left < c.right && c.left < t.right && t.top < c.bottom && c.top < t.bottom) overlaps.push(`"${name(target)}" under "${name(control)}"`)
      }
      const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2)
      const blocker = hit && hit !== target && !target.contains(hit) ? lowerHalfFixedAncestor(hit) : null
      if (blocker) untappable.push(`"${name(target)}" taken by ${blocker.tagName.toLowerCase()} "${name(blocker)}"`)
    }
    return { settled, floating: floating.length, targets: targets.length, overlaps, untappable }
  })
}

for (const width of [360, 390, 1280]) {
  test(`footer links stay clear of the floating buttons at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator('footer[data-portal-footer="true"]')).toBeVisible()

    let report: FooterReport = { settled: false, floating: 0, targets: 0, overlaps: [], untappable: [] }
    await expect.poll(async () => (report = await measureFooterAtPageEnd(page)).settled, { message: 'the page settles at its end with every policy link on screen and the scroll buttons showing' }).toBe(true)

    expect(report.targets, 'footer links on screen at the page end').toBeGreaterThanOrEqual(3)
    expect(report.overlaps).toEqual([])
    expect(report.untappable).toEqual([])
  })
}
