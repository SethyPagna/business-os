import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeDuplicateChunkRequiresManualResume } from '../src/components/products/mergeDuplicatesRun.ts'

assert.equal(mergeDuplicateChunkRequiresManualResume({ interrupted: true }), true)
assert.equal(mergeDuplicateChunkRequiresManualResume({ interrupted: false }), false)
assert.equal(mergeDuplicateChunkRequiresManualResume(undefined), false)

const here = dirname(fileURLToPath(import.meta.url))
const products = readFileSync(join(here, '..', 'src', 'components', 'products', 'Products.tsx'), 'utf8')
const stopAt = products.indexOf('if (mergeDuplicateChunkRequiresManualResume(result))')
const continueAt = products.indexOf('const remainingBefore = Number(result?.remainingProductsBefore)', stopAt)
assert.ok(stopAt > 0 && continueAt > stopAt, 'an interrupted successful response must stop before automatic continuation')
const partialBlock = products.slice(stopAt, continueAt)
assert.match(partialBlock, /await load\(true\)/, 'partial success reloads authoritative product state')
assert.match(partialBlock, /setMergeDuplicatesReviewOpen\(false\)/, 'manual resume must start from a fresh preview')
assert.match(partialBlock, /merge_duplicates_partial_saved/, 'the user sees the committed count')

console.log('PASS product merge interruption stops automatic continuation and reports saved work')
