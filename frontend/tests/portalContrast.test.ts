// Public storefront colour contrast -- WCAG 2.1 AA (N45, "check color contrast").
//
// Three layers, because the palette alone cannot prove the storefront is
// legible:
//
//   1. The maths. relativeLuminance/contrastRatio are checked against the
//      published WCAG reference values, so a broken formula cannot make the
//      rest of the file pass by returning large numbers.
//   2. The palette. Every pair in PORTAL_CONTRAST_PAIRS must clear its
//      threshold, and every merchant-chosen colour must survive
//      ensureAccessibleSurface()/readableInkOn() -- swept across the whole
//      6-bit colour cube, not a handful of samples.
//   3. The SOURCE. This is the discriminating half: a palette table can be
//      written to pass while the components still paint the old tokens, so
//      these assertions read the storefront components and pin that the
//      specific failing combinations are gone. On 4e58891f every assertion in
//      section 3 fails -- CatalogAccountSection's submit button is
//      `bg-emerald-500 ... text-white` (2.54:1), the promo strip and both
//      promotion badges hardcode white on a merchant-typed colour, the
//      image-less promotion cards print white on `to-teal-400` (1.81:1),
//      and `text-slate-400` (2.56:1) carries real copy in five files.
//
// Run: node tests/portalContrast.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PORTAL_CONTRAST_AA_TEXT,
  PORTAL_CONTRAST_AA_UI,
  PORTAL_CONTRAST_PAIRS,
  PORTAL_DARK_SURFACE,
  PORTAL_HERO_GRADIENT_DEFAULTS,
  PORTAL_INK_ON_DARK,
  PORTAL_INK_ON_LIGHT,
  PORTAL_LIGHT_SURFACE,
  PORTAL_MERCHANT_COLOR_DEFAULTS,
  contrastRatio,
  ensureAccessibleSurface,
  meetsContrast,
  normalizePortalHex,
  readableInkOn,
  readableTextOn,
  relativeLuminance,
  requiredRatio,
} from '../src/components/catalog/portalContrast.ts'

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

const here = path.dirname(fileURLToPath(import.meta.url))
const catalogDir = path.join(here, '..', 'src', 'components', 'catalog')
const read = (file: string): string => fs.readFileSync(path.join(catalogDir, file), 'utf8')

// ---------------------------------------------------------------------------
// 1. The maths, against the published WCAG reference values.
// ---------------------------------------------------------------------------

runTest('relative luminance matches the WCAG reference values', () => {
  assert.equal(relativeLuminance('#ffffff').toFixed(4), '1.0000')
  assert.equal(relativeLuminance('#000000').toFixed(4), '0.0000')
  assert.equal(relativeLuminance('#808080').toFixed(4), '0.2159')
})

runTest('contrast ratio matches the WCAG reference values', () => {
  assert.equal(contrastRatio('#ffffff', '#000000').toFixed(2), '21.00')
  assert.equal(contrastRatio('#000000', '#000000').toFixed(2), '1.00')
  // The two ratios everyone quotes when arguing about slate-400 / emerald-500.
  assert.equal(contrastRatio('#94a3b8', '#ffffff').toFixed(2), '2.56')
  assert.equal(contrastRatio('#ffffff', '#10b981').toFixed(2), '2.54')
  // Symmetric: order of the arguments must not matter.
  assert.equal(contrastRatio('#0369a1', '#ffffff'), contrastRatio('#ffffff', '#0369a1'))
})

runTest('thresholds are the AA numbers, and meetsContrast uses them', () => {
  assert.equal(requiredRatio('text'), 4.5)
  assert.equal(requiredRatio('large'), 3)
  assert.equal(requiredRatio('ui'), 3)
  assert.equal(PORTAL_CONTRAST_AA_TEXT, 4.5)
  assert.equal(PORTAL_CONTRAST_AA_UI, 3)
  assert.equal(meetsContrast('#94a3b8', '#ffffff', 'text'), false)
  assert.equal(meetsContrast('#64748b', '#ffffff', 'text'), true)
  // slate-400 clears the 3:1 UI floor but not the 4.5:1 text one -- the test
  // would be blind to the whole bug if `kind` were ignored.
  assert.equal(meetsContrast('#94a3b8', '#ffffff', 'ui'), false)
  assert.equal(meetsContrast('#0369a1', '#ffffff', 'ui'), true)
})

runTest('normalizePortalHex accepts 3- and 6-digit hex and falls back otherwise', () => {
  assert.equal(normalizePortalHex('#ABCDEF', '#000000'), '#abcdef')
  assert.equal(normalizePortalHex('#f00', '#000000'), '#ff0000')
  assert.equal(normalizePortalHex('red', '#123456'), '#123456')
  assert.equal(normalizePortalHex(null, '#123456'), '#123456')
  assert.equal(normalizePortalHex(undefined, '#123456'), '#123456')
})

// ---------------------------------------------------------------------------
// 2. The palette: every pair the storefront theme produces.
// ---------------------------------------------------------------------------

runTest('every storefront text/background pair clears its AA threshold', () => {
  assert.ok(PORTAL_CONTRAST_PAIRS.length >= 30, 'the pair table must cover the whole theme')
  const failures: string[] = []
  for (const pair of PORTAL_CONTRAST_PAIRS) {
    const ratio = contrastRatio(pair.foreground, pair.background)
    if (!meetsContrast(pair.foreground, pair.background, pair.kind)) {
      failures.push(`${pair.name} (${pair.where}): ${ratio.toFixed(2)}:1, needs ${requiredRatio(pair.kind)}:1`)
    }
  }
  assert.deepEqual(failures, [])
})

runTest('both page grounds are the ones buildPortalBackground paints', () => {
  assert.equal(PORTAL_LIGHT_SURFACE, '#ffffff')
  assert.equal(PORTAL_DARK_SURFACE, '#0b0b0c')
  const publicPage = read('PublicCatalogPage.tsx')
  assert.match(publicPage, /return darkMode \? '#0b0b0c' : '#ffffff'/, 'buildPortalBackground still paints those two grounds')
})

runTest('readableTextOn picks the ink that actually wins on each ground', () => {
  assert.equal(readableTextOn('#ffffff'), PORTAL_INK_ON_LIGHT)
  assert.equal(readableTextOn('#0b0b0c'), PORTAL_INK_ON_DARK)
  assert.equal(readableTextOn('#fef08a'), PORTAL_INK_ON_LIGHT, 'a pale yellow badge needs dark ink')
  assert.equal(readableTextOn('#be123c'), PORTAL_INK_ON_DARK, 'a deep rose badge needs white ink')
  // Never returns a third colour, whatever it is handed.
  for (const input of ['', 'nonsense', null, undefined, '#zzzzzz']) {
    assert.ok([PORTAL_INK_ON_LIGHT, PORTAL_INK_ON_DARK].includes(readableTextOn(input)))
  }
})

runTest('ensureAccessibleSurface clears 4.5:1 for EVERY merchant-choosable colour', () => {
  // The whole 6-bit colour cube (32^3 = 32768 colours), not samples. Mid-greys
  // are the case that motivates the function: neither ink clears 4.5:1 on the
  // untouched colour, so it must move the background too.
  const failures: string[] = []
  let adjusted = 0
  for (let r = 0; r < 256; r += 8) {
    for (let g = 0; g < 256; g += 8) {
      for (let b = 0; b < 256; b += 8) {
        const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
        const surface = ensureAccessibleSurface(hex, 'text')
        if (!surface.exact) adjusted += 1
        if (!meetsContrast(surface.color, surface.background, 'text')) {
          failures.push(`${hex} -> ${surface.color} on ${surface.background} = ${surface.ratio.toFixed(2)}:1`)
        }
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} merchant colours still fail`)
  assert.ok(adjusted > 0, 'some colours must actually need adjusting, or the sweep proves nothing')
})

runTest('ensureAccessibleSurface leaves a colour that already passes untouched', () => {
  const rose = ensureAccessibleSurface('#be123c', 'text')
  assert.equal(rose.exact, true)
  assert.equal(rose.background, '#be123c', 'a merchant colour that already works is not repainted')
  assert.equal(rose.color, PORTAL_INK_ON_DARK)
  // A mid blue is the band where NEITHER ink clears 4.5:1 on the untouched
  // colour (white gives 4.29:1, the charcoal 4.19:1), so the fill itself has
  // to move -- 2118 of the 32768 colours in the sweep below land here.
  const midBlue = ensureAccessibleSurface('#0070f8', 'text')
  assert.equal(midBlue.exact, false)
  assert.notEqual(midBlue.background, '#0070f8')
  assert.ok(meetsContrast(midBlue.color, midBlue.background, 'text'))
})

runTest('ensureAccessibleSurface is deterministic', () => {
  for (const hex of ['#8a8a8a', '#fef08a', '#123456', '#dc2626']) {
    assert.deepEqual(ensureAccessibleSurface(hex, 'text'), ensureAccessibleSurface(hex, 'text'))
  }
})

runTest('readableInkOn makes a merchant colour legible on BOTH page grounds', () => {
  const failures: string[] = []
  for (let r = 0; r < 256; r += 16) {
    for (let g = 0; g < 256; g += 16) {
      for (let b = 0; b < 256; b += 16) {
        const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
        for (const ground of [PORTAL_LIGHT_SURFACE, '#262626']) {
          const ink = readableInkOn(hex, ground)
          if (!meetsContrast(ink, ground, 'text')) failures.push(`${hex} on ${ground} -> ${ink}`)
        }
      }
    }
  }
  assert.deepEqual(failures.slice(0, 5), [], `${failures.length} inks still fail`)
})

runTest('the shipped merchant defaults and the hero gradient are the documented ones', () => {
  assert.equal(PORTAL_MERCHANT_COLOR_DEFAULTS.promotionBadge, '#dc2626')
  assert.equal(PORTAL_MERCHANT_COLOR_DEFAULTS.promoRuleChip, '#e11d48')
  assert.equal(PORTAL_HERO_GRADIENT_DEFAULTS.end, '#ea580c')
  // The reason the About banner may not print text on itself.
  assert.ok(contrastRatio('#ffffff', PORTAL_HERO_GRADIENT_DEFAULTS.end) < PORTAL_CONTRAST_AA_TEXT)
  const secondary = read('CatalogSecondaryTabs.tsx')
  assert.match(
    secondary,
    /data-portal-about-hero="true"\s*\r?\n\s*className="relative h-20 sm:h-28"/,
    'the hero gradient band stays text-free -- text on it would inherit the 3.56:1 end stop',
  )
})

// ---------------------------------------------------------------------------
// 3. The SOURCE. Discriminating: each of these fails on 4e58891f.
// ---------------------------------------------------------------------------

runTest('the account submit button is no longer white on emerald-500 (2.54:1)', () => {
  const source = read('CatalogAccountSection.tsx')
  const submit = /const submitClass = '([^']+)'/.exec(source)
  assert.ok(submit, 'submitClass must still be a single class string')
  assert.ok(submit[1].includes('text-white'), 'the label is still white')
  assert.doesNotMatch(submit[1], /bg-emerald-[45]00\b/, 'emerald-400/500 under white text is 2.54:1 / 1.94:1')
  assert.match(submit[1], /bg-emerald-([78]00)\b/, 'the fill must be emerald-700 or darker (5.48:1)')
})

runTest('the account error alert clears AA on its own rose-50 ground', () => {
  const source = read('CatalogAccountSection.tsx')
  const alert = /className="mb-4 rounded-2xl border border-rose-300 bg-rose-50 ([^"]+)"/.exec(source)
  assert.ok(alert, 'the error alert must still be the rose-50 block')
  assert.doesNotMatch(alert[1], /text-rose-600\b/, 'rose-600 on rose-50 is 4.28:1')
  assert.match(alert[1], /text-rose-700\b/, 'rose-700 on rose-50 is 5.72:1')
})

runTest('no storefront file paints real copy in slate-400 on the white ground', () => {
  // 2.56:1. It was carrying the list-drawer hint, both empty states, the
  // saved/list price lines, the product sheet's eyebrow and the account
  // hints. Placeholders and decorative icons are exempt (see below).
  const failures: string[] = []
  for (const file of [
    'PublicCatalogPage.tsx',
    'CatalogPreviewSurface.tsx',
    'CatalogProductsSection.tsx',
    'ProductDetailFlyout.tsx',
    'CatalogAccountSection.tsx',
    'PortalFilterCombobox.tsx',
    'PortalPromoStrip.tsx',
    'PortalPromotionsBanner.tsx',
    // CatalogSecondaryTabs renders the Contact and AI-assistant sections of
    // the public storefront and was missing from this list -- which is why it
    // still painted the contact field names and both assistant headings in
    // slate-400 after every other file had been converted. A sweep is only
    // worth its green if it looks at the whole route.
    'CatalogSecondaryTabs.tsx',
    'PortalNoPaymentNotice.tsx',
    'catalogUi.tsx',
  ]) {
    const source = read(file)
    for (const line of source.split(/\r?\n/)) {
      if (!/\btext-slate-400\b/.test(line)) continue
      // `placeholder:text-slate-400` and a bare icon className are not copy.
      if (/placeholder:text-slate-400/.test(line) && !/\s text-slate-400/.test(line)) continue
      if (/aria-hidden="true"/.test(line)) continue
      failures.push(`${file}: ${line.trim().slice(0, 110)}`)
    }
  }
  assert.deepEqual(failures, [])
})

runTest('dark mode no longer uses neutral-500 (4.15:1) for storefront copy', () => {
  const failures: string[] = []
  for (const file of [
    'PublicCatalogPage.tsx',
    'CatalogPreviewSurface.tsx',
    'CatalogProductsSection.tsx',
    'ProductDetailFlyout.tsx',
    'CatalogAccountSection.tsx',
    'CatalogSecondaryTabs.tsx',
    'PortalNoPaymentNotice.tsx',
  ]) {
    const source = read(file)
    for (const line of source.split(/\r?\n/)) {
      if (/\bdark:text-neutral-500\b/.test(line)) failures.push(`${file}: ${line.trim().slice(0, 110)}`)
    }
  }
  assert.deepEqual(failures, [])
})

runTest('every merchant-chosen colour goes through the contrast helpers, never text-white', () => {
  // PortalPromoStrip campaign chip + price, PortalPromotionsBanner badge,
  // CatalogProductsSection promotion badge. All four hardcoded white ink.
  const strip = read('PortalPromoStrip.tsx')
  assert.match(strip, /ensureAccessibleSurface\(item\.color/, 'the campaign chip takes its ink from the colour')
  assert.match(strip, /readableInkOn\(item\.color/, 'the promoted price is darkened onto the card it sits on')
  assert.doesNotMatch(strip, /text-white[^"]*"\s*\r?\n\s*style=\{\{ backgroundColor: item\.color \}\}/, 'no hardcoded white on the merchant colour')

  const banner = read('PortalPromotionsBanner.tsx')
  assert.match(banner, /const badgeSurface = ensureAccessibleSurface\(promo\.badge_color/, 'the promotion badge takes its ink from the colour')
  assert.doesNotMatch(banner, /backgroundColor: promo\.badge_color \|\| '#dc2626'/, 'the raw colour is no longer painted under white text')

  const products = read('CatalogProductsSection.tsx')
  assert.match(products, /ensureAccessibleSurface\(badgeColor/, 'the product-card promotion badge takes its ink from the colour')
  assert.doesNotMatch(products, /color: '#fff'/, "the card badge's hardcoded white ink is gone")
})

runTest('the image-less promotion cards no longer print white on a pale gradient', () => {
  const banner = read('PortalPromotionsBanner.tsx')
  const table = /const FALLBACK_GRADIENTS = \[([\s\S]*?)\]/.exec(banner)
  assert.ok(table, 'the fallback gradient table must still exist')
  const stops = [...table[1].matchAll(/(?:from|via|to)-([a-z]+)-(\d{3})/g)]
  assert.ok(stops.length >= 12, 'every gradient must still declare its stops')
  const tooLight = stops.filter(([, , weight]) => Number(weight) < 700)
  assert.deepEqual(
    tooLight.map((m) => m[0]),
    [],
    'a -400/-500/-600 stop under the white card title runs 1.81:1 to 4.23:1',
  )
})

runTest('the storefront paints a real focus indicator and honours reduced motion', () => {
  const css = fs.readFileSync(path.join(here, '..', 'src', 'styles', 'public-portal.css'), 'utf8')
  assert.match(css, /\[data-portal-root='true'\] :focus-visible \{[\s\S]*?outline: 3px solid #0369a1/, 'a visible focus ring on the light ground')
  assert.match(css, /outline-color: #fcd34d/, 'and a legible one on the dark ground')
  assert.ok(meetsContrast('#0369a1', PORTAL_LIGHT_SURFACE, 'ui'), 'the light focus ring clears the 3:1 UI floor')
  assert.ok(meetsContrast('#fcd34d', PORTAL_DARK_SURFACE, 'ui'), 'the dark focus ring clears the 3:1 UI floor')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'the CSS half of the reduced-motion answer')
  const strip = read('PortalPromoStrip.tsx')
  assert.match(strip, /prefers-reduced-motion: reduce/, "the promo strip's own drift stops too")
  assert.match(strip, /if \(!reduceMotion && !pausedRef\.current/, 'and the drift is what the flag actually gates')
})

if (failed > 0) {
  console.error(`\n${failed} failing test(s)`)
  process.exit(1)
}
console.log('\nportalContrast: all green')
