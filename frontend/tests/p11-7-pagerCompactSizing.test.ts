// P11-7: "the back items per page, page number and number of pages and next
// button are too fat and large. make it more consistent."
//
// Run: node tests/p11-7-pagerCompactSizing.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const paginationControls = fs.readFileSync(path.join(here, '..', 'src', 'components', 'shared', 'PaginationControls.tsx'), 'utf8')

assert.doesNotMatch(paginationControls, /arrowButtonClass = `inline-flex h-10 shrink-0 items-center gap-0\.5 px-3/, 'the old 40px/px-3 arrow buttons must be gone')
assert.match(paginationControls, /arrowButtonClass = `inline-flex h-9 shrink-0 items-center gap-0\.5 px-2\.5/, 'the arrows are now a tighter 36px/px-2.5')
assert.match(paginationControls, /h-9 min-w-9 border-0 bg-transparent px-0 text-center/, 'the page-number box shrank to match')

console.log('P11-7: the storefront pager pill was made more compact -- PASS')
