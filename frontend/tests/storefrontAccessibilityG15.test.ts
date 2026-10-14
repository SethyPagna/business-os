// Compliance review, 13 Oct 2026: G15 (accessibility, public storefront only).
//
//   - contrast: the map "Load" button and the storefront .btn-primary clear 4.5:1 in light and dark
//   - the map iframe has a translated, human title
//   - JS smooth scroll respects prefers-reduced-motion
//   - the About video has controls and never autoplays
//
// Run: node tests/storefrontAccessibilityG15.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTAL_DARK_SURFACE, PORTAL_LIGHT_SURFACE, contrastRatio } from '../src/components/catalog/portalContrast.ts'
import { portalScrollBehavior } from '../src/components/catalog/portalMotion.ts'
import { resolveStorefrontCopy } from '../src/components/catalog/portalLanguagePacks.ts'

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SRC = path.join(FRONTEND, 'src')
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8').replace(/\r\n/g, '\n')
const readPack = (name: string) => JSON.parse(fs.readFileSync(path.join(SRC, 'lang', name), 'utf8')) as Record<string, string>

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

const TAILWIND_EMERALD: Record<string, string> = { '500': '#10b981', '600': '#059669', '700': '#047857', '800': '#065f46' }
const NEUTRAL_900 = '#171717'
const WHITE = '#ffffff'
const AA_TEXT = 4.5
const AA_UI = 3
const ratio = (a: string, b: string) => Number(contrastRatio(a, b).toFixed(2))

// ---------------------------------------------------------------------------
// Contrast (WCAG 1.4.3 text, 1.4.11 component boundary)
// ---------------------------------------------------------------------------

runTest('the map Load button is white on emerald-700 (>= 4.5:1), and darker on hover', () => {
  const source = read('components', 'catalog', 'legal', 'PortalEmbedConsent.tsx')
  const button = /<button\s+type="button"\s+onClick=\{accept\}\s+className="([^"]+)"/.exec(source)?.[1] ?? ''
  assert.ok(button, 'the Load button must still be the accept button')
  const rest = /(?<![:-])bg-emerald-(\d+)/.exec(button)?.[1] ?? ''
  const hover = /hover:bg-emerald-(\d+)/.exec(button)?.[1] ?? ''
  assert.ok(TAILWIND_EMERALD[rest] && TAILWIND_EMERALD[hover], `unexpected palette step in "${button}"`)
  assert.match(button, /\btext-white\b/)
  const restRatio = ratio(WHITE, TAILWIND_EMERALD[rest])
  const hoverRatio = ratio(WHITE, TAILWIND_EMERALD[hover])
  console.log(`  map Load button: white on emerald-${rest} ${restRatio}:1 (was 2.54:1 on emerald-500); hover emerald-${hover} ${hoverRatio}:1; boundary on dark card ${ratio(TAILWIND_EMERALD[rest], NEUTRAL_900)}:1, on dark page ${ratio(TAILWIND_EMERALD[rest], PORTAL_DARK_SURFACE)}:1, on light page ${ratio(TAILWIND_EMERALD[rest], PORTAL_LIGHT_SURFACE)}:1`)
  assert.ok(restRatio >= AA_TEXT, `resting text contrast ${restRatio}`)
  assert.ok(hoverRatio >= AA_TEXT, `hover text contrast ${hoverRatio}`)
  assert.ok(ratio(TAILWIND_EMERALD[rest], NEUTRAL_900) >= AA_UI, 'the button edge is visible on the dark card')
  assert.ok(ratio(TAILWIND_EMERALD[rest], PORTAL_DARK_SURFACE) >= AA_UI, 'and on the dark page')
  assert.ok(ratio(TAILWIND_EMERALD[rest], PORTAL_LIGHT_SURFACE) >= AA_UI, 'and on the light page')
  assert.doesNotMatch(button, /bg-emerald-(?:400|500)/, 'the 2.54:1 and 1.92:1 fills are gone')
})

runTest('the map link keeps 4.5:1 on hover in light and dark', () => {
  const source = read('components', 'catalog', 'legal', 'PortalEmbedConsent.tsx')
  const link = /className="(text-xs font-semibold text-emerald-700[^"]+)"/.exec(source)?.[1] ?? ''
  assert.match(link, /\btext-emerald-700\b/)
  assert.match(link, /hover:text-emerald-800/)
  assert.match(link, /dark:text-emerald-300/)
  assert.match(link, /dark:hover:text-emerald-200/)
  assert.ok(ratio(TAILWIND_EMERALD['700'], PORTAL_LIGHT_SURFACE) >= AA_TEXT)
  assert.ok(ratio(TAILWIND_EMERALD['800'], PORTAL_LIGHT_SURFACE) >= AA_TEXT, 'hover on the light page')
  assert.ok(ratio('#6ee7b7', NEUTRAL_900) >= AA_TEXT && ratio('#a7f3d0', NEUTRAL_900) >= AA_TEXT, 'resting and hover on the dark card')
})

runTest('the storefront .btn-primary is white on a brass of >= 4.5:1 in light and dark; the admin rule is untouched', () => {
  const css = read('styles', 'main.css')
  const rule = /html\[data-public-portal='true'\] \.btn-primary,\s*html\[data-business-os-initial-route='public'\] \.btn-primary \{\s*background-color: (#[0-9a-fA-F]{6}) !important; border-color: ([^;]+) !important;/.exec(css)
  assert.ok(rule, 'a storefront-scoped .btn-primary override must exist')
  const brass = rule[1]
  const text = ratio(WHITE, brass)
  console.log(`  storefront .btn-primary: white on ${brass} ${text}:1 (was ${ratio(WHITE, '#9c7a3c')}:1 on #9c7a3c); boundary on dark page ${ratio(brass, PORTAL_DARK_SURFACE)}:1, on dark card ${ratio(brass, NEUTRAL_900)}:1, on light page ${ratio(brass, PORTAL_LIGHT_SURFACE)}:1`)
  assert.ok(text >= AA_TEXT, `text contrast ${text}`)
  assert.ok(ratio(brass, PORTAL_DARK_SURFACE) >= AA_UI && ratio(brass, NEUTRAL_900) >= AA_UI, 'edge visible on dark grounds')
  assert.ok(ratio(brass, PORTAL_LIGHT_SURFACE) >= AA_UI, 'edge visible on the light ground')
  assert.ok(ratio(WHITE, '#9c7a3c') < AA_TEXT, 'control: the brass the admin keeps does not clear 4.5:1, which is why the override exists')
  assert.match(css, /\n\.btn-primary \{ background-color: var\(--ui-accent,#9c7a3c\) !important;/, 'the app-wide rule (admin, themed accent) is unchanged')
})

// ---------------------------------------------------------------------------
// Iframe title (WCAG 4.1.2)
// ---------------------------------------------------------------------------

runTest('the map iframe is named by a translated sentence, not a code name', () => {
  const source = read('components', 'catalog', 'CatalogSecondaryTabs.tsx')
  assert.doesNotMatch(source, /portal-about-map/, 'the code-name title is gone')
  const call = /title=\{copy\('portal_a11y_map_title', "([^"]+)", '([^']+)'\)\}/.exec(source)
  assert.ok(call, 'the title comes from copy() with an English and a Khmer fallback')
  const en = readPack('en.json')
  const km = readPack('km.json')
  assert.equal(en.portal_a11y_map_title, call[1])
  assert.equal(km.portal_a11y_map_title, call[2])
  assert.match(call[2], /[ក-៿]/, 'real Khmer')
  const identity = (key: string) => key
  assert.equal(resolveStorefrontCopy('en', identity, 'portal_a11y_map_title', call[1], call[2]), call[1])
  assert.equal(resolveStorefrontCopy('km', identity, 'portal_a11y_map_title', call[1], call[2]), call[2])
  const embed = read('components', 'catalog', 'legal', 'PortalEmbedConsent.tsx')
  assert.match(embed, /<iframe\s+title=\{title\}/, 'the title reaches the iframe')
})

// ---------------------------------------------------------------------------
// Reduced motion (WCAG 2.3.3 / the owner's accessibility standard)
// ---------------------------------------------------------------------------

runTest('portalScrollBehavior is auto under prefers-reduced-motion and smooth otherwise', () => {
  const globals = globalThis as unknown as { window?: unknown }
  const previous = globals.window
  try {
    globals.window = { matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }) }
    assert.equal(portalScrollBehavior(), 'auto')
    globals.window = { matchMedia: () => ({ matches: false }) }
    assert.equal(portalScrollBehavior(), 'smooth')
    globals.window = {}
    assert.equal(portalScrollBehavior(), 'smooth', 'no matchMedia: keep the old behaviour')
    delete globals.window
    assert.equal(portalScrollBehavior(), 'smooth', 'no window (server render)')
  } finally {
    if (previous === undefined) delete globals.window
    else globals.window = previous
  }
})

runTest('no storefront JS scroll hard-codes smooth behaviour', () => {
  for (const file of ['PublicCatalogPage.tsx', 'PortalPromoStrip.tsx']) {
    assert.doesNotMatch(read('components', 'catalog', file), /behavior:\s*'smooth'/, `${file} must go through portalScrollBehavior()`)
    assert.match(read('components', 'catalog', file), /behavior:\s*portalScrollBehavior\(\)/)
  }
  const page = read('components', 'catalog', 'CatalogPage.tsx')
  const scrollPublic = /const scrollPublicPortal = [\s\S]*?window\.scrollTo\(\{ top, behavior: ([^}]+) \}\)/.exec(page)?.[1]
  assert.equal(scrollPublic, 'portalScrollBehavior()', 'the shared catalog page scrolls the public view the same way')
})

// ---------------------------------------------------------------------------
// About video (WCAG 1.2.2: no fake captions; controls present, nothing autoplays)
// ---------------------------------------------------------------------------

runTest('every storefront <video> has controls and none autoplays', () => {
  const dir = path.join(SRC, 'components', 'catalog')
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.tsx'))
  let seen = 0
  for (const file of files) {
    for (const match of read('components', 'catalog', file).matchAll(/<video\b[\s\S]*?\/>/g)) {
      seen += 1
      assert.match(match[0], /\bcontrols\b/, `${file}: a video without controls cannot be paused`)
      assert.doesNotMatch(match[0], /\bautoPlay\b|\bautoplay\b/, `${file}: a video must not autoplay`)
    }
  }
  assert.ok(seen >= 1, 'the About tab video element still exists')
  assert.doesNotMatch(read('components', 'catalog', 'CatalogSecondaryTabs.tsx'), /<track\b/, 'no fabricated captions: captions are an owner content item')
})

if (failed > 0) {
  console.error(`\n${failed} failing test(s)`)
  process.exit(1)
}
console.log('\nstorefrontAccessibilityG15: all green')
