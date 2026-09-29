import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors } from './support/harness'

/**
 * storefront-about-picture.spec.ts -- the About picture shows WHOLE on the
 * About page (AB-F AF-1, AF-7).
 *
 * The poster fixture is a synthetic 256 x 256 square with a 4 px magenta frame,
 * so a crop on any side removes that side's frame from the screenshot.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-about-picture
 */

const POSTER = readFileSync(new URL('./fixtures/about-poster.png', import.meta.url))
const POSTER_PATH = '/uploads/about-poster-e2e.png'
const POSTER_SIDE = 256
const WIDTHS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const

async function servePoster(page: Page): Promise<void> {
  for (const endpoint of ['**/api/portal/bootstrap', '**/api/portal/config']) {
    await page.route(endpoint, async (route) => {
      const response = await route.fetch()
      const body = await response.json() as { config?: Record<string, unknown> } & Record<string, unknown>
      const withPoster = body.config
        ? { ...body, config: { ...body.config, aboutImage: POSTER_PATH, aboutImageAlt: 'Leang Cosmetics poster' } }
        : { ...body, aboutImage: POSTER_PATH, aboutImageAlt: 'Leang Cosmetics poster' }
      await route.fulfill({ response, json: withPoster })
    })
  }
  await page.route(`**${POSTER_PATH}`, (route) => route.fulfill({ body: POSTER, contentType: 'image/png' }))
}

type Rgb = [number, number, number]
const isFrame = ([red, green, blue]: Rgb): boolean => red > 200 && green < 90 && blue > 200

test.describe('About picture on the storefront', () => {
  for (const viewport of WIDTHS) {
    test(`AF-1 at ${viewport.width}px: square, whole, every frame edge visible; AF-7 the tap opens the same picture`, async ({ page }) => {
      // CATCHES: object-cover, a max-height cap, a rounded or overflow-hidden
      // box, or a box wider than the viewport -- each hides at least one frame edge.
      const health = collectPageHealth(page)
      await page.setViewportSize(viewport)
      await servePoster(page)
      await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })

      const picture = page.locator('[data-portal-about-picture] img')
      await expect(picture).toBeVisible()
      await expect.poll(() => picture.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBe(POSTER_SIDE)
      await picture.scrollIntoViewIfNeeded()

      const box = await picture.evaluate((img: HTMLImageElement) => {
        const rect = img.getBoundingClientRect()
        return { fit: getComputedStyle(img).objectFit, width: rect.width, height: rect.height, left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth }
      })
      expect(box.fit).toBe('contain')
      expect(Math.abs(box.width - box.height), 'a square box').toBeLessThanOrEqual(1)
      expect(box.left).toBeGreaterThanOrEqual(0)
      expect(box.right).toBeLessThanOrEqual(box.viewport)
      expect(box.width, 'never wider than 640 px').toBeLessThanOrEqual(640.5)

      const shot = await picture.screenshot()
      const samples = await page.evaluate(async (base64: string) => {
        const image = new Image()
        image.src = `data:image/png;base64,${base64}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d') as CanvasRenderingContext2D
        context.drawImage(image, 0, 0)
        const inset = 2
        const at = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3))
        const midX = Math.floor(image.width / 2)
        const midY = Math.floor(image.height / 2)
        return {
          top: at(midX, inset),
          bottom: at(midX, image.height - 1 - inset),
          left: at(inset, midY),
          right: at(image.width - 1 - inset, midY),
          centre: at(midX, midY),
        }
      }, shot.toString('base64')) as Record<'top' | 'bottom' | 'left' | 'right' | 'centre', Rgb>
      for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
        expect(isFrame(samples[edge]), `${edge} frame edge visible (${samples[edge].join(',')})`).toBe(true)
      }
      expect(isFrame(samples.centre), 'the sample is the poster, not a flat frame colour').toBe(false)

      await picture.click()
      const viewer = page.getByRole('dialog')
      await expect(viewer).toBeVisible()
      await expect(viewer.locator(`img[src*="${POSTER_PATH}"]`).first()).toBeVisible()

      expectNoRuntimeErrors(health)
      expect(health.failedApiResponses, 'storefront API responses').toEqual([])
    })
  }
})
