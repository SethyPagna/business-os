import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage } from './support/harness'
import { framedPicture, stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-about-layout.spec.ts -- the About page (owner ask, 2 Nov 2026).
 *
 *  - The cover is laid out by its own shape and never letterboxes: a wide picture is a full-width banner
 *    (object-cover, height from the ratio, capped at 520 px); a square or tall one keeps its own ratio
 *    (max 460 px wide, max 60vh tall) with the text beside it from md up.
 *  - The story takes the full width; right under it one details card (address, chat rows, account rows) sits BESIDE the live map on a large
 *    screen and stacks on a small one; nothing leaves a hole.
 *  - The map is live: the iframe is there when the tab is shown, with no consent click (owner A63, 21 Nov 2026). No horizontal scroll at any width.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-about-layout
 *
 * Each test names the wrong implementation it catches.
 */

test.use({ serviceWorkers: 'block' })

const COVER_PATH = '/uploads/about-cover-e2e.svg'
const SQUARE_PATH = '/uploads/about-square-e2e.svg'
const COVER = { width: 1600, height: 900 }
const MAP_EMBED = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1!2d104.9!3d11.56'
const WIDTHS = [360, 390, 768, 1024, 1280, 1600] as const
const LARGE = 1024

const PATCH = {
  businessCover: COVER_PATH,
  showCover: true,
  aboutContent: 'An independent beauty retailer. Genuine products from official brand stores.',
  links: { website: 'https://shop.example.test', facebook: 'https://facebook.com/sample.shop', instagram: 'https://instagram.com/sample_shop', telegram: 'https://t.me/sample_shop' },
  showWebsite: true, showFacebook: true, showInstagram: true, showTelegram: true,
  businessAddress: '12 Street 271, Phnom Penh',
  showAddress: true,
  googleMapsEmbed: MAP_EMBED,
  showGoogleMap: true,
}

async function openAbout(page: Page, width: number, patch: Record<string, unknown> = PATCH, coverStatus = 200): Promise<void> {
  await page.context().route('**/maps/embed**', (route) => route.abort())
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 })
  await seedStorefrontLanguage(page.context(), STOREFRONT_ORIGIN, 'en')
  await stubStorefrontConfig(page, patch)
  await page.route(`**${COVER_PATH}`, (route) => (coverStatus === 200
    ? route.fulfill({ body: framedPicture(COVER.width, COVER.height, 'Cover 16:9'), contentType: 'image/svg+xml' })
    : route.fulfill({ status: coverStatus, body: 'missing' })))
  await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
  await expect(page.locator('[data-portal-about-hero]')).toBeVisible()
}

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number }
const boxOf = (page: Page, selector: string): Promise<Box> => page.locator(selector).first().evaluate((element) => {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, right: rect.right, top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY, width: rect.width, height: rect.height }
})

test.describe('About page layout', () => {
  for (const width of WIDTHS) {
    test(`cover at ${width}px: a full-width banner, never letterboxed, capped only on a very wide screen`, async ({ page }) => {
      // CATCHES: the old `object-contain` box (grey frame bars either side once the height cap bites), a banner that grows past 520 px, and a
      // picture that stops short of the card edges.
      const health = collectPageHealth(page)
      await openAbout(page, width)
      const cover = page.locator('[data-portal-cover]')
      await expect(cover).toBeVisible()
      await expect.poll(() => cover.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBe(COVER.width)
      await expect(page.locator('[data-portal-cover-frame]')).toHaveAttribute('data-portal-cover-shape', 'wide')
      await cover.scrollIntoViewIfNeeded()

      const measured = await cover.evaluate((img: HTMLImageElement) => {
        const rect = img.getBoundingClientRect()
        const card = (img.closest('[data-portal-cover-frame]') as HTMLElement).parentElement as HTMLElement
        const cardRect = card.getBoundingClientRect()
        return { fit: getComputedStyle(img).objectFit, width: rect.width, height: rect.height, left: rect.left, right: rect.right, cardLeft: cardRect.left, cardRight: cardRect.right, viewport: document.documentElement.clientWidth }
      })
      const natural = measured.width * COVER.height / COVER.width
      expect(measured.fit).toBe('cover')
      expect(Math.abs(measured.left - measured.cardLeft), 'no bar on the left').toBeLessThanOrEqual(1.5)
      expect(Math.abs(measured.right - measured.cardRight), 'no bar on the right').toBeLessThanOrEqual(1.5)
      expect(measured.right).toBeLessThanOrEqual(measured.viewport)
      expect(measured.height, 'never taller than the banner cap').toBeLessThanOrEqual(520 + 1)
      expect(Math.abs(measured.height - Math.min(natural, 520)), `box ${measured.width}x${measured.height}, natural ${natural}`).toBeLessThanOrEqual(1.5)

      // Pixels, while the banner is uncapped (the whole picture is shown): the magenta frame stroke is visible on all four sides.
      if (natural <= 520) {
        const shot = await cover.screenshot()
        const edges = await page.evaluate(async ({ base64 }) => {
          const image = new Image()
          image.src = `data:image/png;base64,${base64}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d') as CanvasRenderingContext2D
          context.drawImage(image, 0, 0)
          const band = Math.max(3, Math.ceil(image.width / 200))
          const magenta = (x: number, y: number) => {
            const [red, green, blue] = context.getImageData(Math.max(0, Math.min(image.width - 1, Math.round(x))), Math.max(0, Math.min(image.height - 1, Math.round(y))), 1, 1).data
            return red > 190 && green < 110 && blue > 190
          }
          const anyIn = (points: Array<[number, number]>) => points.some(([x, y]) => magenta(x, y))
          const across = (cx: number, cy: number, dx: number, dy: number): Array<[number, number]> => Array.from({ length: band + 1 }, (_, step) => [cx + dx * step, cy + dy * step])
          return {
            top: anyIn(across(image.width / 2, 0, 0, 1)),
            bottom: anyIn(across(image.width / 2, image.height - 1, 0, -1)),
            left: anyIn(across(0, image.height / 2, 1, 0)),
            right: anyIn(across(image.width - 1, image.height / 2, -1, 0)),
          }
        }, { base64: shot.toString('base64') })
        expect(edges, 'frame stroke visible on every side').toEqual({ top: true, bottom: true, left: true, right: true })
      }

      expectNoRuntimeErrors(health)
    })

    test(`square cover at ${width}px: its own ratio, no bars, beside the text from md up`, async ({ page }) => {
      // CATCHES: a square picture stretched into a banner, grey bars around it, a hero that stays stacked on a desktop, and a picture taller
      // than 60vh or wider than 460 px.
      await openAbout(page, width, { ...PATCH, businessCover: SQUARE_PATH })
      await page.route(`**${SQUARE_PATH}`, (route) => route.fulfill({ body: framedPicture(1254, 1254, 'Cover 1:1'), contentType: 'image/svg+xml' }))
      await page.reload({ waitUntil: 'load' })
      const cover = page.locator('[data-portal-cover]')
      await expect(page.locator('[data-portal-cover-frame]')).toHaveAttribute('data-portal-cover-shape', 'tall')
      await expect.poll(() => cover.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBe(1254)
      const measured = await cover.evaluate((img: HTMLImageElement) => {
        const rect = img.getBoundingClientRect()
        const name = document.querySelector('[data-portal-about-hero]')?.parentElement?.querySelector('h2')?.getBoundingClientRect()
        return { fit: getComputedStyle(img).objectFit, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, top: rect.top, nameLeft: name?.left ?? 0, nameTop: name?.top ?? 0, viewportHeight: window.innerHeight }
      })
      expect(measured.fit).toBe('cover')
      expect(Math.abs(measured.width - measured.height), 'the box is the picture\'s own square').toBeLessThanOrEqual(1.5)
      expect(measured.width, 'never wider than 460 px').toBeLessThanOrEqual(460 + 1)
      expect(measured.height, 'never taller than 60vh').toBeLessThanOrEqual(measured.viewportHeight * 0.6 + 1)
      if (width >= 768) expect(measured.nameLeft, 'the name sits to the right of the picture').toBeGreaterThanOrEqual(measured.right - 1)
      else expect(measured.nameTop, 'on a phone the text comes under the picture').toBeGreaterThanOrEqual(measured.bottom - 1)
    })

    test(`layout at ${width}px: no horizontal scroll, no hole`, async ({ page }) => {
      // CATCHES: a grid that overflows a phone, a contacts card and a map that stack on a desktop (or sit
      // side by side on a phone), and cards of different heights that leave a hole beside the shorter one.
      await openAbout(page, width)
      await expect(page.locator('[data-portal-map-card]')).toBeVisible()
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
      expect(overflow.scroll, 'no horizontal scroll').toBeLessThanOrEqual(overflow.client)

      const tray = await boxOf(page, '[data-portal-contact-tray]')
      const map = await boxOf(page, '[data-portal-map-card]')
      for (const box of [tray, map]) {
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(overflow.client)
      }
      if (width >= LARGE) {
        expect(Math.abs(tray.top - map.top), 'one row').toBeLessThanOrEqual(1)
        // The two cards keep their own heights (the map keeps its 16:9); nothing is stretched into a hole.
        expect(tray.right, 'contacts left of the map').toBeLessThanOrEqual(map.left)
        expect(map.width, 'the map gets the larger share').toBeGreaterThan(tray.width)
      } else {
        expect(map.top, 'stacked: the map under the contacts').toBeGreaterThanOrEqual(tray.bottom - 1)
        expect(Math.abs(map.width - tray.width), 'same width when stacked').toBeLessThanOrEqual(1)
      }

      const details = await boxOf(page, '[data-portal-about-details]')
      const footer = await boxOf(page, 'footer')
      expect(footer.top - details.bottom, 'the page ends right under the map and contacts').toBeLessThanOrEqual(64)
    })
  }

  test('the story is a full-width card above the contacts and the map', async ({ page }) => {
    // CATCHES: the old row that put the story beside the contacts and left the empty column under it.
    await openAbout(page, 1280)
    const story = await boxOf(page, 'section p.whitespace-pre-line')
    const details = await boxOf(page, '[data-portal-about-details]')
    const tray = await boxOf(page, '[data-portal-contact-tray]')
    expect(story.bottom).toBeLessThanOrEqual(details.top)
    expect(details.top - story.bottom, 'the story card sits right above the row').toBeLessThanOrEqual(48)
    expect(Math.abs(tray.left - details.left)).toBeLessThanOrEqual(1)
  })

  test('the map is live: the iframe is there when About is shown, with no click and no consent gate', async ({ page }) => {
    // CATCHES: the old click-to-load gate coming back (a Load map button, no iframe until a click), and a map card with no Open in Maps link.
    await openAbout(page, 1280)
    await expect(page.locator('[data-portal-map-card] iframe[src*="google.com/maps"]')).toHaveCount(1)
    await expect(page.locator('[data-portal-map-card] iframe')).toHaveAttribute('loading', 'lazy')
    await expect(page.getByRole('button', { name: 'Load map' })).toHaveCount(0)
    await expect(page.locator('[data-portal-map-card]').getByRole('link', { name: 'Open in Maps' })).toBeVisible()
  })

  test('no embed configured: no map card and no iframe', async ({ page }) => {
    // CATCHES: an empty map frame or a dead Open in Maps button when the shop has not set a map.
    await openAbout(page, 1280, { ...PATCH, googleMapsEmbed: '', showGoogleMap: false })
    await expect(page.locator('[data-portal-map-card]')).toHaveCount(0)
    await expect(page.locator('iframe[src*="google.com/maps"]')).toHaveCount(0)
  })

  test('without a cover the brand banner stays, and the name keeps its overlap', async ({ page }) => {
    // CATCHES: dropping the gradient banner when there is no photo (an empty card top).
    await openAbout(page, 1280, { ...PATCH, businessCover: '' })
    await expect(page.locator('[data-portal-cover]')).toHaveCount(0)
    const hero = await boxOf(page, '[data-portal-about-hero]')
    expect(hero.height).toBeLessThanOrEqual(120)
  })

  test('a cover that fails to load falls back to the banner instead of a hole', async ({ page }) => {
    // CATCHES: a broken-image box or a collapsed frame where the photo should be.
    await openAbout(page, 1280, PATCH, 404)
    await expect(page.locator('[data-portal-cover]')).toHaveCount(0)
    await expect(page.locator('[data-portal-about-hero]')).toBeVisible()
    const hero = await boxOf(page, '[data-portal-about-hero]')
    expect(hero.height).toBeGreaterThan(40)
    expect(hero.height).toBeLessThanOrEqual(120)
  })
})
