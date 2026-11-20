import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage } from './support/harness'
import { stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-contact-menu.spec.ts -- the one Contact menu (public-web overhaul, owner ask A27), which replaces the header's social chip
 * row and the two floating chat buttons.
 *
 *  - The header Contact button opens a menu with no title row: one row per way to reach the shop, in the order Phone, Messenger,
 *    Telegram, Instagram, Facebook, TikTok, WhatsApp, Website, Email, Map. A row is the brand icon and the account name, never "@name".
 *  - A Facebook share link has no readable name, so the row shows the Messenger account name; its accessible name says Facebook.
 *  - There are no floating chat buttons and no chip row under the header.
 *  - Escape closes the menu and gives focus back to the Contact button.
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
  await closeInstallNotice(page)
}

// On iOS Safari the shop shows its "Add to Home Screen" notice unprompted, fixed over the top of the page (unchanged from production
// 90ad75aa0), so it lies on the header until the visitor closes it (gate run 44769528745, ios-webkit: the Contact button never took the
// tap). A visitor closes it first; so does this spec. Where that notice should sit is a separate question from the Contact menu.
async function closeInstallNotice(page: Page): Promise<void> {
  if (page.context().browser()?.browserType().name() !== 'webkit') return
  const notice = page.locator('div[role="status"]').filter({ has: page.locator('img[src*="icon-192"]') })
  await notice.first().waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined)
  if (await notice.count() === 0) return
  await notice.first().getByRole('button').last().click()
  await expect(notice).toHaveCount(0)
}

const trigger = (page: Page) => page.locator('[data-portal-contact-trigger]')
const rows = (page: Page) => page.locator('[data-portal-contact-menu="true"] a')

test.describe('Contact menu', () => {
  test('the header Contact button opens one menu in the spec order, names without "@", Facebook named from Messenger', async ({ page }) => {
    // CATCHES: the old chip row under the header, floating chat buttons, a platform word ("Facebook") as the visible text of a share link,
    // a leading "@" on any name, and rows out of order.
    const health = collectPageHealth(page)
    await openStorefront(page, 1280)
    await trigger(page).click()
    await expect(rows(page)).toHaveCount(5)
    const platforms = await rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-portal-contact-platform')))
    expect(platforms).toEqual(['phone', 'messenger', 'telegram', 'instagram', 'facebook'])
    const texts = await rows(page).evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()))
    expect(texts[0]).toContain('345 678')
    expect(texts.slice(1)).toEqual(['sample.page', 'sample_tg', 'sample_ig', 'sample.page'])
    for (const text of texts) expect(text).not.toContain('@')
    const names = await rows(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
    expect(names).toContain('Facebook: sample.page')
    await expect(page.locator('[data-portal-contact-menu="true"]').locator('xpath=..').getByText('Contact us', { exact: true })).toHaveCount(0)
    expectNoRuntimeErrors(health)
  })

  test('no chip row under the header and no floating chat buttons', async ({ page }) => {
    // CATCHES: the 56 px social row and the right-hand column of brand-colour chat buttons coming back.
    await openStorefront(page, 390)
    await expect(page.locator('[data-portal-social-row]')).toHaveCount(0)
    await expect(page.locator('[data-portal-contact-float]')).toHaveCount(0)
    const header = await page.locator('header.portal-header-shell').boundingBox()
    const nav = await page.locator('.portal-nav-shell').boundingBox()
    expect(header && nav && nav.y - (header.y + header.height), 'the tab strip follows the one header row directly').toBeLessThanOrEqual(2)
  })

  test('Escape closes the menu and returns focus to the Contact button', async ({ page }) => {
    // CATCHES: a menu that leaves focus on the page body after closing.
    await openStorefront(page, 1280)
    await trigger(page).click()
    await expect(rows(page).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(rows(page)).toHaveCount(0)
    await expect(trigger(page)).toBeFocused()
  })

  test('Contact shows the word from sm up and the icon alone on a phone, with a tooltip and an accessible name either way', async ({ page }) => {
    // CATCHES: an icon-only button with no name, or a phone header that has no room for the shop name.
    await openStorefront(page, 390)
    await expect(trigger(page)).toHaveAttribute('aria-label', 'Contact us')
    await expect(trigger(page)).toHaveAttribute('title', 'Contact us')
    await expect(trigger(page).locator('span')).toBeHidden()
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(trigger(page).locator('span')).toBeVisible()
    await expect(trigger(page).locator('span')).toHaveText('Contact')
  })

  test('nothing configured: no Contact button at all', async ({ page }) => {
    // CATCHES: an empty menu behind a dead button on a shop that set no way to reach it.
    await openStorefront(page, 390, {
      ...SHOP,
      links: { website: '', facebook: '', instagram: '', telegram: '' },
      contactLinks: { messenger: '', telegram: '', whatsapp: '', phone: '', instagram: '' },
    })
    await expect(trigger(page)).toHaveCount(0)
  })

  test('Khmer: the same names, the Khmer word on the button', async ({ page }) => {
    // CATCHES: a Khmer page that translates or reshapes an account name, or leaves the button word in English.
    await openStorefront(page, 1280, SHOP, 'km')
    await expect(trigger(page).locator('span')).toHaveText('ទាក់ទង')
    await trigger(page).click()
    const texts = await rows(page).evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()))
    expect(texts).toContain('sample.page')
    expect(texts).toContain('sample_ig')
  })
})
