import type { Page } from '@playwright/test'

/**
 * Per-test variations of the storefront's public config, layered over the fixture server's
 * /api/portal/bootstrap and /api/portal/config (the two routes that carry the config).
 */
export async function stubStorefrontConfig(page: Page, patch: Record<string, unknown>): Promise<void> {
  for (const endpoint of ['**/api/portal/bootstrap', '**/api/portal/config']) {
    await page.route(endpoint, async (route) => {
      const response = await route.fetch()
      const body = await response.json() as { config?: Record<string, unknown> } & Record<string, unknown>
      const stubbed = body.config ? { ...body, config: { ...body.config, ...patch } } : { ...body, ...patch }
      await route.fulfill({ response, json: stubbed })
    })
  }
}

/** The frame colour the pixel checks look for: a crop on any side removes that side's stroke. */
export const FRAME_STROKE = 6

/**
 * A synthetic picture with a magenta frame stroke on all four edges. No real shop content:
 * the repository is public.
 */
export function framedPicture(width: number, height: number, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b4f2a"/><stop offset="1" stop-color="#d9b16a"/></linearGradient></defs>'
    + `<rect width="${width}" height="${height}" fill="url(#g)"/>`
    + `<rect x="${FRAME_STROKE / 2}" y="${FRAME_STROKE / 2}" width="${width - FRAME_STROKE}" height="${height - FRAME_STROKE}" fill="none" stroke="#ff00ff" stroke-width="${FRAME_STROKE}"/>`
    + `<text x="${width / 2}" y="${height / 2}" font-family="Georgia" font-size="${Math.round(height / 8)}" fill="#fff" text-anchor="middle">${label}</text>`
    + '</svg>'
}
