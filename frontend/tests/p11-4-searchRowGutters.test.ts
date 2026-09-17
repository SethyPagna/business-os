// P11-4: "the search and filter row. can fully utlize the row. there are
// many space left and right to utilize."
//
// Run: node tests/p11-4-searchRowGutters.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const previewSurface = fs.readFileSync(path.join(here, '..', 'src', 'components', 'catalog', 'CatalogPreviewSurface.tsx'), 'utf8')

assert.doesNotMatch(previewSurface, /sm:px-10 sm:py-4 lg:px-16 xl:px-20/, 'the old oversized gutters must be gone')
assert.match(previewSurface, /px-4 py-3 sm:px-6 sm:py-4 lg:px-10 xl:px-14/, 'the column (search row included) now keeps a tighter, more usable gutter')

console.log('P11-4: the storefront column gutters were trimmed back -- PASS')
