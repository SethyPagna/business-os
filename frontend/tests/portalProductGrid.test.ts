// Products page, owner ask 2 Nov 2026:
//  - the grid follows the screen: 2 on phones, 3 on tablets, 4 at 1024px, 5 at 1280px, 6 at 1536px;
//  - the search and Filters join the section tabs (the tab row on a desktop, directly under the tabs on a phone).
//
// "Automatic columns" is the default and is a new Website Editor setting; a shop that turns it off keeps the fixed
// column counts it chose, byte for byte (the old two-helper class string). That old behaviour is the parity target.
//
// Run: node tests/portalProductGrid.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PORTAL_AUTO_GRID_CLASS,
  getPortalGridClass,
  getPortalMobileGridClass,
  getPortalProductGridClass,
} from '../src/components/catalog/portalCatalogDisplay.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const code = (source: string): string => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

let failed = 0
function run(name: string, test: () => void): void {
  try {
    test()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

/** Tailwind widths of the screen names used by the grid classes. */
const SCREENS: ReadonlyArray<readonly [prefix: string, minWidth: number]> = [['', 0], ['sm:', 640], ['md:', 768], ['lg:', 1024], ['xl:', 1280], ['2xl:', 1536]]

/** The column count a class string gives at a viewport width (the widest matching `grid-cols-N` wins, as in CSS). */
function columnsAt(classes: string, width: number): number {
  let columns = 0
  for (const [prefix, minWidth] of SCREENS) {
    if (width < minWidth) continue
    const hit = classes.split(/\s+/).find((token) => token.startsWith(`${prefix}grid-cols-`) && (prefix !== '' || !token.includes(':')))
    if (hit) columns = Number(hit.slice(hit.lastIndexOf('-') + 1))
  }
  return columns
}

run('automatic by default: 2 on phones, 3 on tablets, 4 / 5 / 6 on wider screens', () => {
  const cases: Array<[number, number]> = [[320, 2], [390, 2], [639, 2], [640, 3], [768, 3], [1023, 3], [1024, 4], [1279, 4], [1280, 5], [1535, 5], [1536, 6], [1920, 6], [2560, 6]]
  for (const [width, expected] of cases) assert.equal(columnsAt(PORTAL_AUTO_GRID_CLASS, width), expected, `${width}px`)
  assert.equal(getPortalProductGridClass({}), PORTAL_AUTO_GRID_CLASS, 'an unset setting is automatic')
  assert.equal(getPortalProductGridClass({ gridColumnsAuto: true, gridColumnsDesktop: 2, gridColumnsMobile: 3 }), PORTAL_AUTO_GRID_CLASS, 'stored fixed counts do not matter while automatic is on')
  assert.equal(getPortalProductGridClass({ gridColumnsAuto: undefined, gridColumnsDesktop: 2 }), PORTAL_AUTO_GRID_CLASS)
  assert.equal(getPortalProductGridClass({ gridColumnsAuto: 'false' }), PORTAL_AUTO_GRID_CLASS, 'only a real false turns it off (the Worker always sends a boolean)')
})

run('the old stored count was the bug: a shop with 2 desktop columns showed 2 on every large screen', () => {
  const old = (mobile: unknown, desktop: unknown) => `${getPortalMobileGridClass(mobile)} ${getPortalGridClass(desktop)}`
  assert.equal(columnsAt(old(1, 2), 1600), 2, 'the plausible wrong fix (keep the stored count) still shows 2')
  assert.equal(columnsAt(getPortalProductGridClass({ gridColumnsDesktop: 2, gridColumnsMobile: 1 }), 1600), 6, 'automatic ignores the stored 2')
})

run('turned off, the fixed counts are exactly what the old code produced (parity, every pair)', () => {
  for (let mobile = 1; mobile <= 3; mobile += 1) {
    for (let desktop = 2; desktop <= 8; desktop += 1) {
      const expected = `${getPortalMobileGridClass(mobile)} ${getPortalGridClass(desktop)}`
      assert.equal(getPortalProductGridClass({ gridColumnsAuto: false, gridColumnsMobile: mobile, gridColumnsDesktop: desktop }), expected, `mobile ${mobile}, desktop ${desktop}`)
    }
  }
  assert.equal(getPortalProductGridClass({ gridColumnsAuto: false }), `${getPortalMobileGridClass(undefined)} ${getPortalGridClass(undefined)}`, 'unset counts use the old defaults')
})

run('the live page, the editor preview, the draft and the Save all carry the setting', () => {
  const publicPage = code(read('../src/components/catalog/PublicCatalogPage.tsx'))
  assert.match(publicPage, /const productGridClass = getPortalProductGridClass\(displayConfig\)/)
  assert.match(publicPage, /gridColumnsAuto: true,/, 'the first-paint default is automatic')
  const editorPage = code(read('../src/components/catalog/CatalogPage.tsx'))
  assert.match(editorPage, /const productGridClass = getPortalProductGridClass\(\{ \.\.\.displayConfig, gridColumnsMobile: mobileGridColumns, gridColumnsDesktop: desktopGridColumns \}\)/, 'the preview uses the same builder')
  assert.match(editorPage, /customer_portal_grid_columns_auto: config\.gridColumnsAuto !== false,/, 'the draft starts from the published value; unset is automatic')
  assert.match(editorPage, /gridColumnsAuto: toBoolean\(draft\.customer_portal_grid_columns_auto, config\.gridColumnsAuto !== false\),/, 'the preview reads the draft')
  assert.match(editorPage, /customer_portal_grid_columns_auto: editorDraft\.customer_portal_grid_columns_auto === false \? 'false' : 'true',/, 'the Save writes it')
  const surface = code(read('../src/components/catalog/CatalogEditorSurface.tsx'))
  assert.match(surface, /id="portal-grid-auto" name="customer_portal_grid_columns_auto" type="checkbox" checked=\{editorDraft\.customer_portal_grid_columns_auto !== false\}/)
  const disabled = surface.match(/disabled=\{editorDraft\.customer_portal_grid_columns_auto !== false\}/g) || []
  assert.equal(disabled.length, 2, 'both number inputs are off while automatic is on (no looks-wired-but-is-not control)')
})

run('the search joins the tabs: the surface lends a slot, the products section draws into it, the editor preview keeps its card', () => {
  const surface = code(read('../src/components/catalog/CatalogPreviewSurface.tsx'))
  assert.match(surface, /\{publicView \? \(\s*<div\s+ref=\{setSearchSlotElement\}\s+data-portal-nav-search-slot="true"/, 'only the public page has the slot')
  assert.match(surface, /expected: publicView, element: searchSlotElement/)
  assert.match(surface, /<PortalNavSearchSlotContext\.Provider value=\{searchSlot\}>\{catalogSection\}<\/PortalNavSearchSlotContext\.Provider>/)
  assert.match(surface, /className="relative w-full min-w-0 shrink-0 pb-2 empty:hidden lg:w-\[min\(34rem,52%\)\] lg:pb-0"/, 'under the tabs on a phone, on the tab row from lg')
  assert.match(surface, /lg:flex-nowrap/)
  const section = code(read('../src/components/catalog/CatalogProductsSection.tsx'))
  assert.match(section, /const searchDocked = navSlot\.expected/)
  assert.match(section, /navSlot\.element \? createPortal\(<>\{searchControls\}\{desktopFiltersPanel\}<\/>, navSlot\.element\) : null/, 'nothing is drawn until the slot exists (no inline flash)')
  assert.match(section, /\) : \(\s*<div className="sticky top-16 z-20 -mx-1 mb-5 space-y-2 rounded-\[22px\]/, 'without a slot the old card is kept')
  assert.match(section, /searchDocked \? 'absolute right-0 top-full z-50 mt-2 w-\[min\(56rem,calc\(100vw-3rem\)\)\]/, 'docked, the desktop Filters panel floats under the bar instead of growing the sticky tab row')
  const slot = code(read('../src/components/catalog/portalNavSearchSlot.ts'))
  assert.match(slot, /createContext<PortalNavSearchSlot>\(\{ expected: false, element: null \}\)/, 'the default is no slot')
})

if (failed) {
  console.error(`\n${failed} product grid check(s) failed`)
  process.exit(1)
}
console.log('\nAll product grid checks passed')
