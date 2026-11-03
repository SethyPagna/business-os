import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage } from './support/harness'
import { framedPicture, stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-about-layout.spec.ts -- the About page (owner ask, 2 Nov 2026).
 *
 *  - The cover photo shows IN FULL at its own proportions: never cropped, never stretched, and
 *    only capped in height on a very wide screen.
 *  - The story takes the full width; under it the contacts and socials sit BESIDE the map on a large
 *    screen and stack on a small one; nothing leaves a hole.
 *  - The map keeps its consent gate. No horizontal scroll at any width.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-about-layout
 *
 * Each test names the wrong implementation it catches.
 */

test.use({ serviceWorkers: 'block' })

const COVER_PATH = '/uploads/about-cover-e2e.svg'
const COVER = { width: 1600, height: 900 }
const MAP_EMBED = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1!2d104.9!3d11.56'
const WIDTHS = [360, 390, 768, 1024, 1280, 1600] as const
const LARGE = 1024

const PATCH = {
  businessCover: COVER_PATH,
  showCover: true,
  aboutContent: 'An independent beauty retailer. Genuine products from official brand stores.',
  links: { website: 'https://shop.example.test', facebook: 'https://facebook.com/sample.shop', instagram: 'https://instagram.com/sample_shop', telegram: 'https://t.me/sample_shop' },
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
    test(`cover at ${width}px: whole, undistorted, only capped on a very wide screen`, async ({ page }) => {
      // CATCHES: the old absolute `object-cover` banner (a thin h-20/h-28 strip that crops the photo), a
      // fixed-height box with `object-fill` (stretches it), and a cap that ever crops (anything but `contain`).
      const health = collectPageHealth(page)
      await openAbout(page, width)
      const cover = page.locator('[data-portal-cover]')
      await expect(cover).toBeVisible()
      await expect.poll(() => cover.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBe(COVER.width)
      await cover.scrollIntoViewIfNeeded()

      const measured = await cover.evaluate((img: HTMLImageElement) => {
        const rect = img.getBoundingClientRect()
        return { fit: getComputedStyle(img).objectFit, width: rect.width, height: rect.height, left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth, viewportHeight: window.innerHeight }
      })
      const cap = Math.min(measured.viewportHeight * 0.72, 680)
      const natural = measured.width * COVER.height / COVER.width
      expect(measured.fit).toBe('contain')
      expect(measured.left).toBeGreaterThanOrEqual(0)
      expect(measured.right).toBeLessThanOrEqual(measured.viewport)
      expect(measured.height, 'never taller than the cap').toBeLessThanOrEqual(cap + 1)
      // Under the cap the box IS the photo's proportions; over it the height is the cap and the photo is letterboxed.
      expect(Math.abs(measured.height - Math.min(natural, cap)), `box ${measured.width}x${measured.height}, natural ${natural}, cap ${cap}`).toBeLessThanOrEqual(1.5)

      // Pixels: the magenta frame stroke is visible on all four sides of the picture as drawn.
      const shot = await cover.screenshot()
      const edges = await page.evaluate(async ({ base64, boxWidth, boxHeight, ratio }) => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d') as CanvasRenderingContext2D
        context.drawImage(image, 0, 0)
        const scale = image.width / boxWidth
        const drawnWidth = Math.min(boxWidth, boxHeight * ratio)
        const drawnHeight = drawnWidth / ratio
        const left = ((boxWidth - drawnWidth) / 2) * scale
        const top = ((boxHeight - drawnHeight) / 2) * scale
        const right = left + drawnWidth * scale
        const bottom = top + drawnHeight * scale
        const band = Math.max(3, Math.ceil(scale * 3))
        const magenta = (x: number, y: number) => {
          const [red, green, blue] = context.getImageData(Math.max(0, Math.min(image.width - 1, Math.round(x))), Math.max(0, Math.min(image.height - 1, Math.round(y))), 1, 1).data
          return red > 190 && green < 110 && blue > 190
        }
        const anyInBand = (points: Array<[number, number]>) => points.some(([x, y]) => magenta(x, y))
        const across = (cx: number, cy: number, dx: number, dy: number): Array<[number, number]> => Array.from({ length: band + 1 }, (_, step) => [cx + dx * step, cy + dy * step])
        const midX = (left + right) / 2
        const midY = (top + bottom) / 2
        return {
          top: anyInBand(across(midX, top, 0, 1)),
          bottom: anyInBand(across(midX, bottom - 1, 0, -1)),
          left: anyInBand(across(left, midY, 1, 0)),
          right: anyInBand(across(right - 1, midY, -1, 0)),
        }
      }, { base64: shot.toString('base64'), boxWidth: measured.width, boxHeight: measured.height, ratio: COVER.width / COVER.height })
      expect(edges, 'frame stroke visible on every side').toEqual({ top: true, bottom: true, left: true, right: true })

      expectNoRuntimeErrors(health)
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
        expect(Math.abs(tray.height - map.height), 'equal heights: no hole beside the shorter card').toBeLessThanOrEqual(1)
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

  test('the map keeps its consent gate', async ({ page }) => {
    // CATCHES: a layout change that mounts the Google iframe on render (a third party contacted before a click).
    await openAbout(page, 1280)
    await expect(page.locator('iframe[src*="google.com/maps"]')).toHaveCount(0)
    await page.getByRole('button', { name: 'Load the map' }).click()
    await expect(page.locator('iframe[src*="google.com/maps"]')).toHaveCount(1)
    await expect(page.locator('[data-portal-map-card] iframe')).toBeVisible()
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
