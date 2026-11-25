import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage } from './support/harness'
import { stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-contact-menu.spec.ts -- the Contact panel behind the bottom-right dock (storefront dock lane, owner asks A57, A58, 21 Nov 2026).
 *
 *  - Contact is the ways to message or call the shop, in the order Phone, Messenger, Telegram, WhatsApp. A row is the brand icon and the real name
 *    or number, never "@name". Accounts (Facebook, Instagram, TikTok, Website) are information elsewhere (About, footer), never in the panel.
 *  - From 1888 px there is room beside the content for the five-button stack, with Contact (icon + word) at the bottom; below that, at every width,
 *    ONE round menu button opens a menu whose first row is Contact.
 *  - The header holds no Contact button, no chip row and no floating chat buttons. Escape closes the panel and gives focus back to its button.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-contact-menu
 *
 * Each test names the wrong implementation it catches. Handles are synthetic: the repository is public.
 */

test.use({ serviceWorkers: 'block' })

const SHOP = {
  businessName: 'Sample Cosmetics',
  businessPhone: '',
  businessEmail: '',
  links: { website: '', facebook: 'https://www.facebook.com/share/1ABCsample', instagram: 'https://instagram.com/sample_ig', telegram: 'https://t.me/sample_tg?direct' },
  linkLabels: { website: 'Website', facebook: 'Facebook', instagram: 'Instagram', telegram: 'Telegram' },
  contactLinks: { messenger: 'https://m.me/sample.page', telegram: 'https://t.me/sample_tg?direct', whatsapp: '', phone: '+855 12 345 678', instagram: '' },
  contactLinkLabels: { messenger: 'Messenger', telegram: 'Telegram', whatsapp: 'WhatsApp', phone: '', instagram: 'Instagram' },
  showFacebook: true,
  showInstagram: true,
  showTelegram: true,
  showWebsite: true,
  showContactMessenger: true,
  showContactTelegram: true,
  showContactInstagram: true,
  showContactWhatsapp: false,
  showContactPhone: true,
  showPhone: false,
  showEmail: false,
  showAddress: false,
}

async function openStorefront(page: Page, width: number, patch: Record<string, unknown> = SHOP, language: 'en' | 'km' = 'en'): Promise<void> {
  await page.setViewportSize({ width, height: width < 700 ? 760 : 900 })
  await seedStorefrontLanguage(page.context(), STOREFRONT_ORIGIN, language)
  await stubStorefrontConfig(page, patch)
  await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
  await expect(page.locator('header.portal-header-shell')).toBeVisible()
}

// On iOS Safari the shop shows its "Add to Home Screen" notice unprompted. It is pinned to the bottom and these tests leave it open on purpose:
// the dock has to work with the notice showing.

const WIDE = 1920
const trigger = (page: Page) => page.locator('[data-portal-contact-trigger]')
const menuButton = (page: Page) => page.locator('[data-portal-dock-button="menu"]')
const rows = (page: Page) => page.locator('[data-portal-contact-menu="true"] a')
const menuRows = (page: Page) => page.locator('[data-portal-dock-menu-view="contact"] a')

async function openContactFromPhoneMenu(page: Page): Promise<void> {
  await menuButton(page).click()
  await page.locator('[data-portal-dock-menu]').getByRole('button', { name: 'Contact' }).click()
  await expect(menuRows(page).first()).toBeVisible()
}

test.describe('Contact panel', () => {
  test('the dock Contact button opens the chat rows only, in the spec order, names without "@"', async ({ page }) => {
    // CATCHES: accounts (Facebook, Instagram) mixed into the panel again, a platform word ("Facebook") as visible text, a leading "@" on any name,
    // and rows out of order.
    const health = collectPageHealth(page)
    await openStorefront(page, WIDE)
    await trigger(page).click()
    await expect(rows(page)).toHaveCount(3)
    const platforms = await rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-portal-contact-platform')))
    expect(platforms).toEqual(['phone', 'messenger', 'telegram'])
    const texts = await rows(page).evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()))
    expect(texts[0]).toContain('345 678')
    expect(texts.slice(1)).toEqual(['sample.page', 'sample_tg'])
    for (const text of texts) expect(text).not.toContain('@')
    await expect(page.locator('[data-portal-contact-menu="true"] [data-portal-contact-platform="facebook"], [data-portal-contact-menu="true"] [data-portal-contact-platform="instagram"]')).toHaveCount(0)
    expectNoRuntimeErrors(health)
  })

  test('below 1888 px the one round menu button opens the menu, and its Contact row shows the same chat rows', async ({ page }) => {
    // CATCHES: a phone or laptop with no way to reach Contact, or a menu row that opens a different list.
    for (const width of [390, 800, 1366]) {
      await openStorefront(page, width)
      await expect(menuButton(page)).toBeVisible()
      await expect(page.locator('[data-portal-dock-wide]')).toBeHidden()
      await openContactFromPhoneMenu(page)
      const platforms = await menuRows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-portal-contact-platform')))
      expect(platforms, `at ${width}px`).toEqual(['phone', 'messenger', 'telegram'])
    }
  })

  test('the five-button stack shows only from 1888 px, with Contact at the bottom; one button below', async ({ page }) => {
    // CATCHES: the stack sitting on the product column or the About card at laptop widths (it needs 160 px beside the content), and both dock
    // variants showing at once.
    await openStorefront(page, WIDE)
    await expect(page.locator('[data-portal-dock-wide]')).toBeVisible()
    await expect(menuButton(page)).toBeHidden()
    const order = await page.locator('[data-portal-dock-wide] [data-portal-dock-button]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-portal-dock-button')))
    expect(order.at(-1), 'Contact is the bottom button').toBe('contact')
    expect(order.slice(0, -1)).toEqual(expect.arrayContaining(['theme', 'account', 'shop']))
    await page.setViewportSize({ width: 1887, height: 900 })
    await expect(page.locator('[data-portal-dock-wide]')).toBeHidden()
    await expect(menuButton(page)).toBeVisible()
  })

  test('no chip row, no floating chat buttons, and no buttons in the header', async ({ page }) => {
    // CATCHES: the 56 px social row, the right-hand column of chat buttons, or the old header icons coming back.
    await openStorefront(page, 390)
    await expect(page.locator('[data-portal-social-row]')).toHaveCount(0)
    await expect(page.locator('[data-portal-contact-float]')).toHaveCount(0)
    await expect(page.locator('header.portal-header-shell button')).toHaveCount(0)
    const header = await page.locator('header.portal-header-shell').boundingBox()
    const nav = await page.locator('.portal-nav-shell').boundingBox()
    expect(header && nav && nav.y - (header.y + header.height), 'the tab strip follows the one header row directly').toBeLessThanOrEqual(2)
  })

  test('Escape closes the panel and returns focus to the Contact button; the phone menu returns focus to its button', async ({ page }) => {
    // CATCHES: a panel that leaves focus on the page body after closing.
    await openStorefront(page, WIDE)
    await trigger(page).click()
    await expect(rows(page).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(rows(page)).toHaveCount(0)
    await expect(trigger(page)).toBeFocused()
    await page.setViewportSize({ width: 390, height: 760 })
    await menuButton(page).click()
    await expect(page.locator('[data-portal-dock-menu]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-portal-dock-menu]')).toHaveCount(0)
    await expect(menuButton(page)).toBeFocused()
  })

  test('Contact shows the word (no-translate) and has an accessible name and no tooltip; the phone button names itself', async ({ page }) => {
    // CATCHES: an icon-only button with no name, a title tooltip, or a Contact word a page translator could rewrite.
    await openStorefront(page, WIDE)
    await expect(trigger(page)).toHaveAttribute('aria-label', 'Contact us')
    await expect(trigger(page)).not.toHaveAttribute('title', /.*/)
    await expect(trigger(page).locator('span')).toHaveText('Contact')
    await expect(trigger(page).locator('span')).toHaveAttribute('translate', 'no')
    await page.setViewportSize({ width: 390, height: 760 })
    await expect(menuButton(page)).toHaveAttribute('aria-label', 'Menu')
  })

  test('nothing configured: no Contact button, and the phone menu has no Contact row', async ({ page }) => {
    // CATCHES: an empty panel behind a dead button on a shop that set no way to reach it.
    const bare = {
      ...SHOP,
      links: { website: '', facebook: '', instagram: '', telegram: '' },
      contactLinks: { messenger: '', telegram: '', whatsapp: '', phone: '', instagram: '' },
    }
    await openStorefront(page, WIDE, bare)
    await expect(trigger(page)).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 760 })
    await menuButton(page).click()
    await expect(page.locator('[data-portal-dock-menu]').getByRole('button', { name: 'Contact' })).toHaveCount(0)
  })

  test('Khmer: the same names, the Khmer word on the button', async ({ page }) => {
    // CATCHES: a Khmer page that translates or reshapes an account name, or leaves the button word in English.
    await openStorefront(page, WIDE, SHOP, 'km')
    await expect(trigger(page).locator('span')).toHaveText('ទាក់ទង')
    await trigger(page).click()
    const texts = await rows(page).evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()))
    expect(texts).toContain('sample.page')
    expect(texts).toContain('sample_tg')
  })
})
