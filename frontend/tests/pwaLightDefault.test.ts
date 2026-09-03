// P2-9 finding 1: the admin app must render LIGHT before first paint and must
// never auto-honour the OS dark preference (user decision 5). The pre-paint
// shell in index.html is the only code that runs at that moment -- React, the
// theme context and main.css are all still downloading -- so this test reads
// index.html itself and pins the branch its inline script takes.
//
// Run: node tests/pwaLightDefault.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// Matches an actual OS-dark BRANCH, not the phrase in a comment: either a media
// query whose condition names it, or a scripted matchMedia probe. Both of these
// files deliberately explain in prose that they do NOT do this.
const OS_DARK_BRANCH = /@media[^{]*prefers-color-scheme|matchMedia\s*\([^)]*prefers-color-scheme/

runTest('index.html never branches on the OS colour scheme', () => {
  // The violation this replaced was a whole `@media (prefers-color-scheme: dark)`
  // block painting the old navy #101827. Any reintroduction -- media query or
  // matchMedia call -- silently restores auto-dark before React can stop it.
  assert.equal(
    OS_DARK_BRANCH.test(indexHtml), false,
    'index.html must never branch on the OS colour scheme: the admin app defaults to light and only the manual toggle turns it dark',
  )
})

runTest(':root pins color-scheme: light, not "light dark"', () => {
  // `color-scheme: light dark` hands the browser permission to paint its own
  // form controls, scrollbars and canvas dark under an OS dark preference,
  // which is the same auto-dark by another route.
  assert.ok(
    /color-scheme:\s*light\s*[;}]/.test(indexHtml),
    'index.html :root must declare `color-scheme: light`',
  )
  assert.equal(
    /color-scheme:\s*light\s+dark/.test(indexHtml), false,
    '`color-scheme: light dark` lets the UA paint dark on its own',
  )
})

runTest('the pre-paint script defaults to light and only a STORED dark wins', () => {
  assert.ok(
    /var storedTheme = 'light'/.test(indexHtml),
    'the pre-paint theme variable must start at light',
  )
  // Every storage key the app has ever written a theme into must be consulted,
  // or a returning dark user gets a light flash on each cold start.
  for (const key of ['businessos_device_settings', 'businessos_theme', 'businessos_settings']) {
    assert.ok(indexHtml.includes(key), `pre-paint script must read the stored theme from ${key}`)
  }
  assert.ok(
    /=== 'dark'/.test(indexHtml),
    'the only path to dark is an explicit stored value of "dark"',
  )
  assert.ok(
    /data-business-os-initial-theme/.test(indexHtml),
    'the resolved theme must be stamped on <html> so the palette rules can key off it',
  )
})

runTest('the dark palette is reachable only via the stamped attribute', () => {
  assert.ok(
    /\[data-business-os-initial-route="admin"\]\[data-business-os-initial-theme="dark"\]/.test(indexHtml),
    'admin dark pre-paint colours must be scoped to the stamped attribute pair',
  )
})

runTest('the admin branch moves theme-color onto the palette', () => {
  // The STATIC meta stays on the storefront's brand blue on purpose: iOS
  // "Add to Home Screen" can snapshot the raw HTML before the script's public
  // branch runs, and the storefront is the surface customers install. It must
  // therefore equal portal-manifest.json's theme_color or the two drift. The
  // admin app never paints with it -- the head script rewrites the meta in its
  // else-branch, synchronously, before first paint.
  const staticThemeColor = (indexHtml.match(/<meta name="theme-color" content="([^"]+)"/) || [])[1]
  const portalManifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'portal-manifest.json'), 'utf8'))
  assert.equal(
    staticThemeColor, portalManifest.theme_color,
    'the static theme-color belongs to the storefront and must match portal-manifest.json',
  )
  assert.ok(
    /adminThemeColor[\s\S]{0,200}#161513[\s\S]{0,40}#f7f4ee/.test(indexHtml),
    'the admin branch must set theme-color to the dark ground when stored dark and the ivory ground otherwise',
  )
  assert.ok(indexHtml.includes('#f7f4ee'), 'the ivory ground must be the admin light pre-paint background')
  assert.ok(indexHtml.includes('#161513'), 'the dark ground must be the admin dark pre-paint background')
  assert.equal(
    indexHtml.includes('#101827'), false,
    'the old navy auto-dark ground must be gone',
  )
})

runTest('the admin manifest carries the palette too', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.json'), 'utf8'))
  assert.equal(manifest.background_color, '#f7f4ee', 'manifest background_color must be the ivory ground')
  assert.equal(manifest.theme_color, '#f7f4ee', 'manifest theme_color must be the ivory ground')
})

runTest('offline.html is light by default and never auto-darkens', () => {
  const offline = fs.readFileSync(path.join(root, 'public', 'offline.html'), 'utf8')
  assert.equal(
    OS_DARK_BRANCH.test(offline), false,
    'offline.html must not auto-honour the OS dark preference either',
  )
  assert.ok(/color-scheme:\s*light/.test(offline), 'offline.html must declare color-scheme: light')
  assert.ok(offline.includes('#f7f4ee'), 'offline.html must use the ivory ground')
  assert.ok(
    offline.includes('/fonts/'),
    'offline.html must reference the self-hosted faces -- it is the one page guaranteed to render with no network',
  )
})

if (failed > 0) process.exitCode = 1
else console.log('PASS pwaLightDefault')
