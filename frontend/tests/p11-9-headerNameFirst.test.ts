// P11-9: "for the top of the website, the buttons can be below the business
// name... so Leang Cosmetics first"
//
// Run: node tests/p11-9-headerNameFirst.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const previewSurface = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogPreviewSurface.tsx'), 'utf8')

const headerBlock = /grid grid-cols-\[minmax\(0,1fr\)_auto\] items-center gap-3 sm:grid-cols-\[auto_minmax\(0,1fr\)_auto\][\s\S]{0,6000}row-start-2 flex flex-nowrap items-center justify-end/.exec(previewSurface)
assert.ok(headerBlock, 'the header row structure must still exist')
const block = headerBlock[0]
// Source/DOM order is unchanged (social row, then name, then account row) --
// only the CSS Grid placement moved. `row-start-1` puts the name on the
// FIRST visual row on the base (sub-`sm`) grid; both button rows carry
// `row-start-2`, i.e. below it, with `sm:row-start-auto` restoring the
// ordinary single-row layout at `sm` and up.
assert.ok(block.includes('row-start-2 flex min-w-0 flex-nowrap'), 'the social-links row must be row-start-2 on the base grid')
assert.ok(block.includes('col-span-2 row-start-1 min-w-0 text-center'), 'the business-name block must be row-start-1 on the base grid')
assert.ok(block.includes('row-start-2 flex flex-nowrap items-center justify-end'), 'the wishlist/account/language row must be row-start-2 on the base grid')
assert.doesNotMatch(block, /col-span-2 row-start-2 min-w-0 text-center/, 'the business name must no longer be pushed below the button rows')

console.log('P11-9: the mobile header puts the business name before the icon rows -- PASS')
