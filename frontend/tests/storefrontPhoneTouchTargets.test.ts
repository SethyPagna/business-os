// P-public-11 (owner, 2026-09-25): phone pass at 360/390 -- touch targets of
// at least 40px on the storefront's own controls. The pointer:coarse floor in
// public-portal.css already lifts aria-labelled buttons to 44px on touch; the
// controls below are the ones it does not reach (the header icon rows are
// exempted from it) or whose drawn size lied about the hit box.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8').replace(/\r\n/g, '\n')
const publicPage = read('src/components/catalog/PublicCatalogPage.tsx')
const flyout = read('src/components/catalog/ProductDetailFlyout.tsx')
const legal = read('src/components/catalog/legal/LegalPages.tsx')
const products = read('src/components/catalog/CatalogProductsSection.tsx')
const surface = read('src/components/catalog/CatalogPreviewSurface.tsx')

assert.match(publicPage, /className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700[^"]*"\s*onClick=\{\(\) => \{\s*setContactOpen\(false\)\s*setContactMinimized\(true\)/, 'contact minimize X is a 40px control, not 24px')
assert.match(flyout, /className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-500/, 'product flyout close is 40px')
assert.match(legal, /ref=\{closeRef\}[\s\S]{0,200}inline-flex h-10 w-10|inline-flex h-10 w-10[\s\S]{0,300}ref=\{closeRef\}/, 'policy reader close is 40px')
assert.match(products, /inline-flex h-10 w-10 items-center justify-center rounded-lg[\s\S]{0,300}aria-label=\{copy\('closeFilters', 'Close filters'\)\}/, 'filter dialog close is 40px')
assert.match(products, /<label htmlFor="portal-product-search" className="flex min-h-10/, 'search field is 40px tall')
assert.match(products, /inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-xl border/, 'Filters trigger is 40px')
assert.match(products, /inline-flex min-h-10 items-center rounded-full border px-3 py-1\.5 text-xs font-semibold leading-5/, 'stock chips are 40px and no longer leading-none (Khmer clipping)')
assert.doesNotMatch(products, /className="text-xs font-semibold text-slate-500[^"]*" onClick=\{clearPortalFilters\}/, 'a bare-text (16px tall) Clear control is back')
assert.equal((products.match(/className="min-h-10 rounded-lg px-2 text-xs font-semibold text-slate-500[^"]*" onClick=\{clearPortalFilters\}/g) || []).length, 2, 'both Clear controls (phone layer, desktop panel) are 40px')
assert.doesNotMatch(surface, /inline-flex h-8 w-8 shrink-0/, 'header icons are 40px tall on a phone')

console.log('PASS storefront phone touch targets')
