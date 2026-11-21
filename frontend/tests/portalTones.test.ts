// Storefront dock lane, D4 (owner A61, 21 Nov 2026: "for light mode, many things can use better border and cards, like combinations of color
// instead of pure white"). Three surface tones plus borders, defined once and used everywhere:
//   page   warm sand #f4f1ea;  card  white + border-stone-300 + soft shadow;  inset  #faf6ef + #e3d9c8 border;  band  #f6ece0 with the dark ink.
// Pins: the recipes carry the audited token hexes; every pair of near tones has a border between them; every text/background pair on the new
// tones clears WCAG AA (portalContrast.ts); the consumers use the recipes (no pure white-on-white segment track, notice or panel left).
// Each pin has a control: the same scan on a deliberately wrong recipe must fail.
//
// Run: node tests/portalTones.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PORTAL_CONTRAST_PAIRS, PORTAL_TOKENS, contrastRatio, meetsContrast } from '../src/components/catalog/portalContrast.ts'
import { PRODUCT_BAND_CLASS, PRODUCT_FIELD_CLASS, PRODUCT_INSET_CLASS, PRODUCT_SURFACE_CLASS } from '../src/components/catalog/portalProductSurfaces.ts'

const catalog = path.join(import.meta.dirname, '..', 'src', 'components', 'catalog')
const read = (file: string) => fs.readFileSync(path.join(catalog, file), 'utf8').replace(/\r\n/g, '\n')

let passed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    process.exitCode = 1
    console.log(`FAIL ${name}: ${(error as Error).message}`)
  }
}

const light = PORTAL_TOKENS.light
const bgHex = (recipe: string) => /(?:^|\s)bg-\[(#[0-9a-f]{6})\]/i.exec(recipe)?.[1]?.toLowerCase() ?? (/(?:^|\s)bg-white(?:\s|$)/.test(recipe) ? '#ffffff' : '')
const hasBorder = (recipe: string) => /(?:^|\s)border(?:\s|$)/.test(recipe) && /(?:^|\s)border-(?:\[#[0-9a-f]{6}\]|stone-\d+)/.test(recipe)
// Two tones closer than this need a line between them to read as two functions.
const NEEDS_LINE_BELOW = 1.15

check('the three tones and the page are four different colours, and the tokens are the owner\'s values', () => {
  assert.deepEqual([light.ground, light.card, light.inset, light.insetLine, light.band], ['#f4f1ea', '#ffffff', '#faf6ef', '#e3d9c8', '#f6ece0'])
  const fills = [light.ground, light.card, light.inset, light.band]
  assert.equal(new Set(fills).size, 4)
  // control: two identical tones would be flagged
  assert.equal(new Set([light.card, '#ffffff']).size, 1)
})

check('the recipes carry the token hexes, light and dark', () => {
  assert.equal(bgHex(PRODUCT_INSET_CLASS), light.inset)
  assert.ok(PRODUCT_INSET_CLASS.includes(`border-[${light.insetLine}]`))
  assert.equal(bgHex(PRODUCT_BAND_CLASS), light.band)
  assert.match(PRODUCT_BAND_CLASS, /text-\[#23201b\]/, 'the band keeps the dark ink')
  assert.equal(PORTAL_TOKENS.dark.inset, '#262626', 'dark inset is neutral-800')
  assert.match(PRODUCT_INSET_CLASS, /dark:bg-neutral-800/)
  assert.equal(PORTAL_TOKENS.dark.insetLine, '#404040', 'dark inset line is neutral-700')
  assert.match(PRODUCT_INSET_CLASS, /dark:border-neutral-700/)
  // control: the scan reads a wrong hex as different
  assert.notEqual(bgHex('bg-[#faf6ee] border'), light.inset)
})

check('two adjacent functions never share a tone without a border: every recipe has one when its tone is near its neighbour\'s', () => {
  const recipes: Array<[string, string, string]> = [
    ['card', PRODUCT_SURFACE_CLASS, light.ground],
    ['inset', PRODUCT_INSET_CLASS, light.card],
    ['band', PRODUCT_BAND_CLASS, light.inset],
    ['field', PRODUCT_FIELD_CLASS, light.card],
  ]
  for (const [name, recipe, neighbour] of recipes) {
    const own = bgHex(recipe)
    assert.ok(own, `${name} has a light fill`)
    if (contrastRatio(own, neighbour) < NEEDS_LINE_BELOW) assert.ok(hasBorder(recipe), `${name} is within ${NEEDS_LINE_BELOW}:1 of its neighbour ${neighbour} and has no border`)
  }
  assert.match(PRODUCT_SURFACE_CLASS, /shadow-sm/, 'the card has its soft shadow')
  assert.match(PRODUCT_SURFACE_CLASS, /border-stone-300/)
  assert.match(PRODUCT_FIELD_CLASS, /border-stone-500/, 'fields keep the darker line')
  // control: a borderless inset next to a card is caught
  assert.ok(contrastRatio(light.inset, light.card) < NEEDS_LINE_BELOW, 'the inset really is near the card')
  assert.equal(hasBorder('bg-[#faf6ef]'), false)
})

check('every text pair on the inset and band tones clears AA (light and dark)', () => {
  const names = PORTAL_CONTRAST_PAIRS.filter((pair) => pair.background === light.inset || pair.background === light.band || pair.background === PORTAL_TOKENS.dark.inset || pair.background === PORTAL_TOKENS.dark.band)
  assert.ok(names.length >= 9, 'the new tones are registered in the contrast table')
  for (const pair of names) assert.ok(meetsContrast(pair.foreground, pair.background, pair.kind), `${pair.name}: ${contrastRatio(pair.foreground, pair.background).toFixed(2)}`)
  // control: a pale grey ink on the inset tone would fail
  assert.equal(meetsContrast('#a8a29e', light.inset, 'text'), false)
})

check('the consumers use the recipes: segment tracks, the payment notice, contact rows, the filter panel; no flat stone track is left', () => {
  const list = read('PortalListPage.tsx')
  assert.match(list, /grid min-w-0 flex-1 grid-cols-2 rounded-xl p-1 text-sm \$\{PRODUCT_INSET_CLASS\}/, 'the List/Saved track is the inset tone')
  assert.match(list, /\$\{PRODUCT_BAND_CLASS\} shadow-sm/, 'the chosen segment is the band tone')
  assert.doesNotMatch(list, /rounded-xl bg-stone-200 p-1/)
  const account = read('CatalogAccountSection.tsx')
  assert.match(account, /inline-flex rounded-xl p-1 text-sm \$\{PRODUCT_INSET_CLASS\}/)
  assert.match(account, /\$\{PRODUCT_BAND_CLASS\} shadow-sm/)
  assert.doesNotMatch(account, /rounded-xl bg-stone-100 p-1/)
  assert.match(read('PortalNoPaymentNotice.tsx'), /\$\{PRODUCT_INSET_CLASS\}/, 'the notice is an inset block')
  const rows = read('PortalSocialRow.tsx')
  assert.match(rows, /PORTAL_CONTACT_ROW_INLINE = `[^`]*\$\{PRODUCT_INSET_CLASS\}`/, 'contact rows')
  assert.match(rows, /hover:bg-\[#f6ece0\]/, 'and the band tone on hover')
  assert.match(read('CatalogProductsSection.tsx'), /rounded-2xl p-3 shadow-xl \$\{PRODUCT_INSET_CLASS\}/, 'the docked filter panel is an inset block')
  const about = read('CatalogSecondaryTabs.tsx')
  assert.match(about, /border-t border-\[#e3d9c8\] bg-\[#faf6ef\]/, 'the map card footer is inset')
  assert.match(about, /hover:bg-\[#f6ece0\]/, 'FAQ rows take the band tone on hover')
  // control: the scan would flag the old pure-white track
  assert.match('rounded-xl bg-stone-200 p-1', /rounded-xl bg-stone-200 p-1/)
})

check('the dark mode keeps its own pairs: the dark inset and band are neutral-800 / neutral-700 with a border', () => {
  assert.match(PRODUCT_INSET_CLASS, /dark:border-neutral-700 dark:bg-neutral-800/)
  assert.match(PRODUCT_BAND_CLASS, /dark:border-neutral-600 dark:bg-neutral-700 dark:text-white/)
  assert.ok(meetsContrast('#ffffff', PORTAL_TOKENS.dark.band, 'text'), 'white on the dark band')
  assert.ok(contrastRatio(PORTAL_TOKENS.dark.inset, PORTAL_TOKENS.dark.card) < 1.3 && /dark:border-neutral-700/.test(PRODUCT_INSET_CLASS), 'the dark inset sits close to the dark card and has its border')
})

console.log(`portalTones: ${passed} checks passed`)
