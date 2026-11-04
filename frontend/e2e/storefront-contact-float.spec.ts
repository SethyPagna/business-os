import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_EN_LABELS, STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage, storefrontCards, storefrontSectionTab } from './support/harness'
import { stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-contact-float.spec.ts -- the floating contact buttons (owner ask, 2 Nov 2026).
 *
 *  - One round brand-colour button per CONFIGURED chat account on the right side; each opens the chat itself:
 *    Telegram t.me/<name>, Messenger m.me/<page>, Instagram DM ig.me/m/<name> (never a profile page).
 *  - The accounts are the Website Editor's contact settings; an account that is not set has no button.
 *  - Accessible names are translated (en and km); the page end clears the whole stack; no horizontal scroll.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-contact-float
 *
 * Each test names the wrong implementation it catches. Handles are synthetic: the repository is public.
 */

test.use({ serviceWorkers: 'block' })

const NO_SOCIAL = { website: '', facebook: '', instagram: '', telegram: '' }
const BLANK_CONTACT = { messenger: '', telegram: '', whatsapp: '', phone: '', instagram: '' }
const THREE = {
  links: NO_SOCIAL,
  contactLinks: { ...BLANK_CONTACT, messenger: 'sample.page', telegram: '@sample_tg', instagram: 'sample_ig' },
  showContactMessenger: true,
  showContactTelegram: true,
  showContactInstagram: true,
  showContactWhatsapp: false,
  showContactPhone: false,
}
const ALL_FIVE = {
  ...THREE,
  contactLinks: { ...THREE.contactLinks, whatsapp: '+855 12 345 678', phone: '+855 98 765 432' },
  showContactWhatsapp: true,
  showContactPhone: true,
}
const BRAND = {
  telegram: 'rgb(29, 147, 210)',
  messenger: 'rgb(0, 132, 255)',
  whatsapp: 'rgb(18, 140, 126)',
}

async function openStorefront(page: Page, width: number, patch: Record<string, unknown>, language: 'en' | 'km' = 'en'): Promise<void> {
  await page.setViewportSize({ width, height: width < 700 ? 760 : 900 })
  await seedStorefrontLanguage(page.context(), STOREFRONT_ORIGIN, language)
  await stubStorefrontConfig(page, patch)
  await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
  await expect(page.locator('footer[data-portal-footer="true"]')).toBeVisible()
}

const floatButtons = (page: Page) => page.locator('[data-portal-contact-float="true"] a')
const platforms = (page: Page): Promise<string[]> => floatButtons(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-portal-contact-platform') ?? ''))
const myList = (page: Page) => page.locator('button[aria-label="My List"]')

test.describe('Floating contact buttons', () => {
  test('each configured account is a brand-colour button that links straight to its chat', async ({ page }) => {
    // CATCHES: the old single grey Headset button that opened a list first, a profile link (t.me/<name> is the
    // chat, instagram.com/<name> is not), Instagram missing from the set, a hard-coded account, and a button
    // that is not in its brand colour.
    const health = collectPageHealth(page)
    await openStorefront(page, 1280, THREE)
    expect(await platforms(page)).toEqual(['messenger', 'telegram', 'instagram'])
    const hrefs = await floatButtons(page).evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.getAttribute('data-portal-contact-platform'), node.getAttribute('href')])))
    expect(hrefs).toEqual({
      messenger: 'https://m.me/sample.page',
      telegram: 'https://t.me/sample_tg',
      instagram: 'https://ig.me/m/sample_ig',
    })
    const looks = await floatButtons(page).evaluateAll((nodes) => nodes.map((node) => {
      const style = getComputedStyle(node)
      return { platform: node.getAttribute('data-portal-contact-platform'), background: style.backgroundColor, image: style.backgroundImage, target: node.getAttribute('target'), rel: node.getAttribute('rel') }
    }))
    const byPlatform = Object.fromEntries(looks.map((look) => [look.platform, look]))
    expect(byPlatform.telegram.background).toBe(BRAND.telegram)
    expect(byPlatform.messenger.background).toBe(BRAND.messenger)
    expect(byPlatform.instagram.image, 'the Instagram gradient').toContain('linear-gradient')
    for (const look of looks) {
      expect(look.target).toBe('_blank')
      expect(look.rel).toContain('noopener')
    }
    expectNoRuntimeErrors(health)
  })

  test('tapping a button opens that chat in a new tab', async ({ page, context }) => {
    // CATCHES: a button whose click is swallowed (it opens a sheet or a menu instead of the chat) and a link that
    // navigates the storefront away instead of opening a new tab.
    await context.route('https://t.me/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>chat</title>' }))
    await openStorefront(page, 390, THREE)
    const popup = context.waitForEvent('page')
    await page.locator('[data-portal-contact-platform="telegram"]').click()
    const opened = await popup
    expect(opened.url()).toBe('https://t.me/sample_tg')
    expect(page.url(), 'the storefront itself stays where it was').toContain(STOREFRONT_ORIGIN)
  })

  test('only configured accounts get a button', async ({ page }) => {
    // CATCHES: a button for every platform whether or not an account exists (an empty chat link).
    await openStorefront(page, 1280, { ...THREE, contactLinks: { ...BLANK_CONTACT, telegram: 'sample_tg' } })
    expect(await platforms(page)).toEqual(['telegram'])
  })

  test('the Website Editor toggle still hides its button', async ({ page }) => {
    // CATCHES: a toggle that no longer hides its button.
    await openStorefront(page, 1280, { ...THREE, showContactTelegram: false })
    expect(await platforms(page)).toEqual(['messenger', 'instagram'])
  })

  test('nothing configured: no floating contact buttons at all', async ({ page }) => {
    // CATCHES: an empty round button, or a dead Contact us control, on a shop that set no chat accounts.
    await openStorefront(page, 390, { links: NO_SOCIAL, contactLinks: BLANK_CONTACT })
    await expect(page.locator('[data-portal-contact-float="true"]')).toHaveCount(0)
  })

  test('the profile fallback works and the Instagram button is on by default', async ({ page }) => {
    // CATCHES: a shop that only filled the social links losing its chat buttons, a profile URL pasted as the
    // chat link, and Instagram being left off for shops that never touched the new toggle.
    await openStorefront(page, 1280, {
      links: { website: '', facebook: 'https://facebook.com/sample.page', instagram: 'https://instagram.com/sample_ig', telegram: '' },
      contactLinks: BLANK_CONTACT,
      showContactInstagram: undefined,
    })
    const hrefs = await floatButtons(page).evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.getAttribute('data-portal-contact-platform'), node.getAttribute('href')])))
    expect(hrefs).toEqual({ messenger: 'https://m.me/sample.page', instagram: 'https://ig.me/m/sample_ig' })
  })

  test('a changed account changes the link: nothing is hard-coded', async ({ page }) => {
    // CATCHES: handles baked into the bundle: the same page with other settings must link to the other accounts.
    await openStorefront(page, 1280, { ...THREE, contactLinks: { ...BLANK_CONTACT, telegram: 'another_tg', instagram: 'another_ig' } })
    const hrefs = await floatButtons(page).evaluateAll((nodes) => Object.fromEntries(nodes.map((node) => [node.getAttribute('data-portal-contact-platform'), node.getAttribute('href')])))
    expect(hrefs).toEqual({ telegram: 'https://t.me/another_tg', instagram: 'https://ig.me/m/another_ig' })
  })

  test('accessible names and tooltips are translated in English', async ({ page }) => {
    // CATCHES: icon-only links with no name or tooltip.
    await openStorefront(page, 390, THREE, 'en')
    expect(await floatButtons(page).evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('aria-label'), node.getAttribute('title')]))).toEqual([
      ['Chat on Messenger', 'Chat on Messenger'],
      ['Chat on Telegram', 'Chat on Telegram'],
      ['Message us on Instagram', 'Message us on Instagram'],
    ])
  })

  test('accessible names are translated in Khmer', async ({ page }) => {
    // CATCHES: a Khmer page that reads the English labels.
    await openStorefront(page, 390, THREE, 'km')
    const khmer = await floatButtons(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''))
    expect(khmer).toHaveLength(3)
    for (const name of khmer) expect(name).toMatch(/[ក-៿]/)
  })

  for (const width of [360, 390, 768, 1280]) {
    test(`at ${width}px the page end clears all five buttons and nothing scrolls sideways`, async ({ page }) => {
      // CATCHES: a taller stack than the reserve at the bottom of the page (the footer links hidden under a
      // button) and a button pushed past the viewport edge.
      await openStorefront(page, width, ALL_FIVE)
      expect(await platforms(page)).toEqual(['messenger', 'telegram', 'instagram', 'whatsapp', 'phone'])
      const report = await page.evaluate(async () => {
        window.scrollTo(0, document.documentElement.scrollHeight)
        await new Promise((resolve) => setTimeout(resolve, 400))
        const buttons = [...document.querySelectorAll('[data-portal-contact-float="true"] a')].map((node) => node.getBoundingClientRect())
        const footer = [...document.querySelectorAll('footer[data-portal-footer="true"] a, footer[data-portal-footer="true"] button')]
        const overlaps: string[] = []
        const untappable: string[] = []
        for (const link of footer) {
          const rect = link.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue
          for (const button of buttons) {
            if (rect.left < button.right && button.left < rect.right && rect.top < button.bottom && button.top < rect.bottom) overlaps.push((link.textContent || link.getAttribute('aria-label') || '').trim().slice(0, 30))
          }
          if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
            if (hit && hit !== link && !link.contains(hit) && hit.closest('[data-portal-contact-float="true"]')) untappable.push((link.textContent || '').trim().slice(0, 30))
          }
        }
        return {
          overlaps,
          untappable,
          atEnd: Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight,
          insideViewport: buttons.every((rect) => rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          count: buttons.length,
        }
      })
      expect(report.atEnd).toBe(true)
      expect(report.count).toBe(5)
      expect(report.overlaps).toEqual([])
      expect(report.untappable).toEqual([])
      expect(report.insideViewport).toBe(true)
      expect(report.overflow).toBeLessThanOrEqual(0)
    })
  }

  test('the five buttons never overlap each other and each is a 44 px target', async ({ page }) => {
    // CATCHES: buttons that touch, and a target below the 44 px touch size.
    await openStorefront(page, 360, ALL_FIVE)
    const rects = await floatButtons(page).evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect()
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height }
    }))
    expect(rects).toHaveLength(5)
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThanOrEqual(44)
      expect(rect.height).toBeGreaterThanOrEqual(44)
    }
    const ordered = [...rects].sort((a, b) => a.top - b.top)
    for (let index = 1; index < ordered.length; index += 1) expect(ordered[index].top).toBeGreaterThan(ordered[index - 1].bottom)
  })

  test('at 390px the stack never covers the announcement bar or the tab and search row, and the end of the page leaves the last row clear', async ({ page }) => {
    // CATCHES: a taller stack or a shorter page end that leaves the last row's price or Add button under a button
    // (nothing can scroll it free), and a stack that reaches up over the announcement bar or the tab bar with its
    // search. Mid-scroll a fixed button always passes over some card; that is not what this asserts. The worst case
    // is used: all five chat buttons plus My List.
    await openStorefront(page, 390, {
      ...ALL_FIVE,
      announcementEnabled: true,
      announcementTextEn: 'Sample sale this week',
      announcementTextKm: '',
      announcementLink: '',
      announcementStart: '',
      announcementEnd: '',
      announcementVersion: 'v1',
    })
    await storefrontSectionTab(page, STOREFRONT_EN_LABELS, 'products').click()
    await expect(page.locator(storefrontCards).first()).toBeVisible()
    await expect(myList(page)).toBeVisible()

    const probe = () => page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
      type Box = { left: number; top: number; right: number; bottom: number }
      const box = (node: Element | null): Box | null => {
        const rect = node?.getBoundingClientRect()
        return rect && rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null
      }
      const touches = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
      const stack = [
        ...[...document.querySelectorAll('[data-portal-contact-float="true"] a')].map(box),
        box(document.querySelector('button[aria-label="My List"]')),
      ].filter((rect): rect is Box => rect !== null)
      const hits = (target: Box | null) => (target ? stack.filter((rect) => touches(rect, target)).length : 0)
      const cards = [...document.querySelectorAll('article[data-product-card="true"]')]
      const lastTop = cards[cards.length - 1]?.getBoundingClientRect().top ?? 0
      const lastRow = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - lastTop) < 4)
      const lastControls = lastRow.flatMap((card) => [...card.querySelectorAll('.notranslate, button[aria-label="Add to list"]')])
      return {
        stackSize: stack.length,
        bar: hits(box(document.querySelector('[data-portal-announcement="true"]'))),
        tabsAndSearch: hits(box(document.querySelector('nav[aria-label="Section navigation"]'))),
        lastRowControls: lastControls.length,
        lastRowCovered: lastControls.filter((node) => hits(box(node)) > 0).length,
        atEnd: Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight,
      }
    })
    const scrollTo = (where: 'top' | 'middle' | 'end') => page.evaluate((target) => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo(0, target === 'top' ? 0 : target === 'middle' ? Math.round(max / 2) : max)
    }, where)

    for (const where of ['top', 'middle', 'end'] as const) {
      await scrollTo(where)
      if (where === 'end') {
        await page.waitForTimeout(500)
        await scrollTo('end')
      }
      const report = await probe()
      expect(report.stackSize, `${where}: five chat buttons and My List are measured`).toBe(6)
      expect(report.bar, `${where}: the announcement bar is clear of the stack`).toBe(0)
      expect(report.tabsAndSearch, `${where}: the tab bar and its search are clear of the stack`).toBe(0)
      if (where === 'end') {
        expect(report.atEnd).toBe(true)
        expect(report.lastRowControls, 'the last row has prices and Add buttons to check').toBeGreaterThan(0)
        expect(report.lastRowCovered, 'at the end of the page the last row price and Add button are clear of the stack').toBe(0)
      }
    }
  })
})
