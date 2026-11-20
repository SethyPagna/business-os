// Compliance review, 13 Oct 2026: G15 (accessibility, public storefront only).
//
//   - contrast: the shared primary button (map "Load", consent "Agree") and .btn-primary clear 4.5:1 in light and dark
//   - the map iframe has a translated, human title
//   - JS smooth scroll respects prefers-reduced-motion
//   - the About video has controls and never autoplays
//
// Run: node tests/storefrontAccessibilityG15.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTAL_PRIMARY_BUTTON, PORTAL_PRIMARY_COLORS } from '../src/components/catalog/portalButtons.ts'
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

const IVORY = '#f4f1ea'
const CHARCOAL = '#23201b'
const CHARCOAL_HOVER = '#3a352c'
const IVORY_DARK = '#f5f1e8'
const IVORY_DARK_HOVER = '#d9d4c7'
const NEUTRAL_900 = '#171717'
const STONE_600 = '#57534e'
const NEUTRAL_300 = '#d4d4d4'
const WHITE = '#ffffff'
const AA_TEXT = 4.5
const AA_UI = 3
const ratio = (a: string, b: string) => Number(contrastRatio(a, b).toFixed(2))

// ---------------------------------------------------------------------------
// Contrast (WCAG 1.4.3 text, 1.4.11 component boundary)
// ---------------------------------------------------------------------------

runTest('the map Load and consent Agree buttons use the one storefront primary recipe, >= 4.5:1 in light and dark', () => {
  const source = read('components', 'catalog', 'legal', 'PortalEmbedConsent.tsx')
  assert.match(source, /const LOAD_BUTTON = PORTAL_PRIMARY_BUTTON\n/, 'the Load button is the shared primary button, not a local class string')
  assert.match(source, /<button type="button" onClick=\{accept\} className=\{LOAD_BUTTON\}>/, 'the Load button must still be the accept button')
  const renewal = read('components', 'catalog', 'legal', 'ConsentRenewalPrompt.tsx')
  assert.match(renewal, /className=\{`\$\{PORTAL_PRIMARY_BUTTON\} disabled:opacity-60`\}/, 'the Agree button is the shared primary button')
  assert.doesNotMatch(renewal, /bg-slate-900|dark:bg-white/, 'no slate/white fill that main.css remaps in dark mode')
  assert.ok(PORTAL_PRIMARY_BUTTON.includes(PORTAL_PRIMARY_COLORS), 'the button recipe carries the shared colours')
  assert.match(PORTAL_PRIMARY_BUTTON, /\bmin-h-11\b/, 'a 44 px target')
  assert.match(PORTAL_PRIMARY_COLORS, /(^| )bg-\[#23201b\]/)
  assert.match(PORTAL_PRIMARY_COLORS, /(^| )text-\[#f4f1ea\]/)
  assert.match(PORTAL_PRIMARY_COLORS, /(^| )hover:bg-\[#3a352c\]/)
  assert.match(PORTAL_PRIMARY_COLORS, /dark:bg-\[#f5f1e8\]/)
  assert.match(PORTAL_PRIMARY_COLORS, /dark:text-\[#23201b\]/)
  assert.match(PORTAL_PRIMARY_COLORS, /dark:hover:bg-\[#d9d4c7\]/)
  assert.doesNotMatch(PORTAL_PRIMARY_COLORS, /emerald|amber|slate/, 'named palette fills are remapped by main.css in dark mode; the recipe is literal hex')
  const rest = ratio(IVORY, CHARCOAL)
  const hover = ratio(IVORY, CHARCOAL_HOVER)
  const dark = ratio(CHARCOAL, IVORY_DARK)
  const darkHover = ratio(CHARCOAL, IVORY_DARK_HOVER)
  console.log(`  primary button: ivory on charcoal ${rest}:1; hover ${hover}:1; dark charcoal on ivory ${dark}:1; dark hover ${darkHover}:1`)
  assert.ok(rest >= AA_TEXT, `resting text contrast ${rest}`)
  assert.ok(hover >= AA_TEXT, `hover text contrast ${hover}`)
  assert.ok(dark >= AA_TEXT, `dark text contrast ${dark}`)
  assert.ok(darkHover >= AA_TEXT, `dark hover text contrast ${darkHover}`)
  assert.ok(ratio(CHARCOAL, PORTAL_LIGHT_SURFACE) >= AA_UI, 'the button edge is visible on a light surface')
  assert.ok(ratio(IVORY_DARK, NEUTRAL_900) >= AA_UI && ratio(IVORY_DARK, PORTAL_DARK_SURFACE) >= AA_UI, 'and on the dark card and dark page')
})

runTest('the open-in-Google-Maps icon keeps 4.5:1 in light and dark and is an icon-only link with a name', () => {
  const source = read('components', 'catalog', 'legal', 'PortalEmbedConsent.tsx')
  const icon = /const ICON_LINK = '([^']+)'/.exec(source)?.[1] ?? ''
  assert.match(icon, /\btext-stone-600\b/)
  assert.match(icon, /dark:text-neutral-300/)
  assert.match(icon, /\bh-11 w-11\b/, 'a 44 px target')
  assert.match(source, /aria-label=\{openLabel\}\s+title=\{openLabel\}/, 'the icon link has an accessible name and a tooltip')
  assert.ok(ratio(STONE_600, WHITE) >= AA_TEXT, 'light card')
  assert.ok(ratio(NEUTRAL_300, NEUTRAL_900) >= AA_TEXT, 'dark card')
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
