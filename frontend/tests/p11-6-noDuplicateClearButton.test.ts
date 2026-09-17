// P11-6: "there is a clear button next to the filter menu button after
// having filters. no need for that. the clear in the filter menu is enough."
//
// Run: node tests/p11-6-noDuplicateClearButton.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const productsSection = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogProductsSection.tsx'), 'utf8')

const menuStart = productsSection.indexOf('<LazyPortalMenu')
assert.ok(menuStart >= 0, 'the mobile Filters LazyPortalMenu block must still exist')
const menuEnd = productsSection.indexOf('/>', productsSection.indexOf('renderFilterFields()}</div>', menuStart))
assert.ok(menuEnd > menuStart, 'the LazyPortalMenu self-close must be found')
const menuBlock = productsSection.slice(menuStart, menuEnd)
assert.match(menuBlock, /onClick=\{clearPortalFilters\}/, 'the ONE Clear control stays inside the filter menu itself')
const afterMenu = productsSection.slice(menuEnd, menuEnd + 400)
assert.doesNotMatch(afterMenu, /onClick=\{clearPortalFilters\}/, 'no second Clear button may sit right after the Filters trigger')

console.log('P11-6: the standalone Clear button beside the Filters trigger is gone -- PASS')
