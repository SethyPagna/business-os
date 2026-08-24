import assert from 'node:assert/strict'
import { buildPortalManifest } from '../src/utils/portalManifest.ts'

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// Real, confirmed gap (see progress.md's public-portal item): the app ships
// one static /manifest.json ("Business OS", generic icon) shared by both the
// admin app and every customer's public storefront, so "Add to Home Screen"
// on a business's portal installed as the ADMIN app's branding, not that
// business's own name/icon. These tests cover the pure manifest-content
// builder; the DOM-swap effect that actually applies it (CatalogPage.tsx)
// isn't covered here -- no jsdom/Canvas in this Node-only test runner, same
// gap the pre-existing favicon/title DOM effect already has.
runTest('uses the portal business name, falling back to title, then a generic default', () => {
  assert.equal(buildPortalManifest({ businessName: 'Leang Cosmetics' }).name, 'Leang Cosmetics')
  assert.equal(buildPortalManifest({ businessName: '', title: 'Fallback Title' }).name, 'Fallback Title')
  assert.equal(buildPortalManifest({}).name, 'Leang Cosmetics')
})

runTest('short_name mirrors the full name unless it needs truncating', () => {
  const manifest = buildPortalManifest({ businessName: 'Leang Cosmetics' })
  assert.equal(manifest.short_name, 'Leang Cosmetics')
  const longName = 'A Very Long Business Name That Exceeds The Home Screen Label Limit'
  const truncated = buildPortalManifest({ businessName: longName })
  assert.ok(truncated.short_name.length <= 30)
  assert.ok(truncated.short_name.endsWith('…'))
})

runTest('start_url comes from the portal\'s configured public path, not the admin app root', () => {
  assert.equal(buildPortalManifest({ publicPath: '/shop' }).start_url, '/shop')
  assert.equal(buildPortalManifest({}).start_url, '/customer-portal')
})

runTest('icons array is empty without a source, and includes any+maskable variants when supplied', () => {
  assert.deepEqual(buildPortalManifest({}).icons, [])
  const manifest = buildPortalManifest({ icon192: 'data:image/png;base64,AAA', icon512: 'data:image/png;base64,BBB' })
  assert.equal(manifest.icons.length, 4)
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any'))
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'maskable'))
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'))
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'))
})

runTest('display is always standalone and colors fall back to sensible defaults', () => {
  const manifest = buildPortalManifest({})
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.background_color, '#f9fafb')
  assert.equal(manifest.theme_color, '#1e3a8a')
  const custom = buildPortalManifest({ backgroundColor: '#000000', themeColor: '#ff0000' })
  assert.equal(custom.background_color, '#000000')
  assert.equal(custom.theme_color, '#ff0000')
})

if (failed > 0) {
  process.exitCode = 1
}
