import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage } from './support/harness'
import { stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-contact-float.spec.ts -- the floating contact buttons (owner ask, 2 Nov 2026).
 *
 *  - One round brand-colour button per CONFIGURED chat account on the right side; each opens the chat itself:
 *    Telegram t.me/<name>, Messenger m.me/<page>, Instagram DM ig.me/m/<name> (never a profile page).
 *  - The accounts are the Website Editor's contact settings; an account that is not set has no button.
 *  - Accessible names are translated (en and km); the page end clears the whole stack; no horizontal scroll.
 *  - From 640 px the column is always shown. Below it the column would cover the right-hand product card, so a
 *    phone shows one Contact button that opens the same links (3 Nov review, N2).
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
const toggle = (page: Page) => page.locator('[data-portal-contact-toggle="true"]')
const myList = (page: Page) => page.locator('button[aria-label="My List"]')

/** On a phone the chat buttons wait behind the Contact button; from 640 px they are already there. */
async function revealFloat(page: Page): Promise<void> {
  if (await toggle(page).isVisible()) await toggle(page).click()
  await expect(floatButtons(page).first()).toBeVisible()
}

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
    await revealFloat(page)
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
    await revealFloat(page)
    expect(await floatButtons(page).evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('aria-label'), node.getAttribute('title')]))).toEqual([
      ['Chat on Messenger', 'Chat on Messenger'],
      ['Chat on Telegram', 'Chat on Telegram'],
      ['Message us on Instagram', 'Message us on Instagram'],
    ])
  })

  test('accessible names are translated in Khmer', async ({ page }) => {
    // CATCHES: a Khmer page that reads the English labels.
    await openStorefront(page, 390, THREE, 'km')
    await revealFloat(page)
    const khmer = await floatButtons(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''))
    expect(khmer).toHaveLength(3)
    for (const name of khmer) expect(name).toMatch(/[ក-៿]/)
  })

  for (const width of [360, 390, 768, 1280]) {
    test(`at ${width}px the page end clears all five buttons and nothing scrolls sideways`, async ({ page }) => {
      // CATCHES: a taller stack than the reserve at the bottom of the page (the footer links hidden under a
      // button) and a button pushed past the viewport edge.
      await openStorefront(page, width, ALL_FIVE)
      await revealFloat(page)
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
    await revealFloat(page)
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

  for (const width of [360, 390]) {
    test(`at ${width}px one Contact button stands in for the column, and it opens and closes the chat buttons`, async ({ page }) => {
      // CATCHES: the always-open column on a phone (4 round buttons over the right-hand card and the About text), a
      // Contact button that opens nothing, one that cannot be closed (Escape, a tap elsewhere), and a toggle that
      // is not a 44 px target or has no translated name.
      await openStorefront(page, width, ALL_FIVE)
      await expect(toggle(page)).toBeVisible()
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle(page)).toHaveAttribute('aria-label', 'Contact us')
      const size = await toggle(page).boundingBox()
      expect(size?.width).toBeGreaterThanOrEqual(44)
      expect(size?.height).toBeGreaterThanOrEqual(44)
      for (const link of await floatButtons(page).all()) await expect(link).toBeHidden()

      await toggle(page).click()
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
      await expect(toggle(page)).toHaveAttribute('aria-label', 'Close')
      await expect(floatButtons(page)).toHaveCount(5)
      for (const link of await floatButtons(page).all()) await expect(link).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
      for (const link of await floatButtons(page).all()) await expect(link).toBeHidden()

      await toggle(page).click()
      await expect(floatButtons(page).first()).toBeVisible()
      await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
      await expect(floatButtons(page).first()).toBeHidden()
    })
  }

  test('on a tablet and a desktop the column is always shown and there is no Contact button', async ({ page }) => {
    // CATCHES: the phone toggle leaking to 640 px and up, where a column fits beside the content.
    for (const width of [640, 768, 1280]) {
      await openStorefront(page, width, ALL_FIVE)
      await expect(toggle(page), `${width}px`).toBeHidden()
      for (const link of await floatButtons(page).all()) await expect(link, `${width}px`).toBeVisible()
    }
  })

  test('at 390px the floating controls stay in the bottom corner, clear of each other and of the viewport edge', async ({ page }) => {
    // CATCHES: the 4-button stack (3 chat buttons + My List) that covered the right-hand product card and the About
    // text: closed, the Contact button and My List together reach no higher than 8rem above the bottom, and opened,
    // the five chat buttons never touch My List.
    await openStorefront(page, 390, ALL_FIVE)
    const box = async (locator: ReturnType<typeof myList>) => {
      const rect = await locator.boundingBox()
      expect(rect).not.toBeNull()
      return rect as { x: number; y: number; width: number; height: number }
    }
    const height = page.viewportSize()?.height ?? 0
    const contact = await box(toggle(page))
    const list = await box(myList(page))
    expect(Math.min(contact.y, list.y), 'closed, nothing floats above 8rem').toBeGreaterThanOrEqual(height - 128)
    expect(contact.y + contact.height, 'the Contact button sits above My List').toBeLessThanOrEqual(list.y)

    await toggle(page).click()
    await expect(floatButtons(page)).toHaveCount(5)
    for (const link of await floatButtons(page).all()) {
      const rect = await box(link)
      expect(rect.x + rect.width, 'inside the viewport').toBeLessThanOrEqual(390)
      expect(rect.y, 'inside the viewport').toBeGreaterThanOrEqual(0)
      expect(rect.y + rect.height, 'above My List').toBeLessThanOrEqual(list.y)
    }
  })
})
