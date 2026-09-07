import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMergeDuplicatesPreviewRequestCoordinator } from '../src/components/products/mergeDuplicatesPreviewRequest.ts'
import { MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS } from '../src/api/productWriteTransport.ts'

const here = dirname(fileURLToPath(import.meta.url))

const first = createMergeDuplicatesPreviewRequestCoordinator()
const oldRequest = first.begin()
const currentRequest = first.begin()
assert.equal(oldRequest.signal.aborted, true, 'a retry aborts the superseded fetch')
assert.equal(oldRequest.isCurrent(), false, 'a stale completion cannot update modal state')
assert.equal(oldRequest.finish(), false, 'a stale completion cannot clear current loading state')
assert.equal(currentRequest.isCurrent(), true)
assert.equal(currentRequest.finish(), true)

const second = createMergeDuplicatesPreviewRequestCoordinator()
const closingRequest = second.begin()
second.cancel()
assert.equal(closingRequest.signal.aborted, true, 'closing/unmounting the modal aborts the live fetch')
assert.equal(closingRequest.isCurrent(), false)
assert.equal(closingRequest.finish(), false)

assert.equal(MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS, 30_000, 'only the duplicate preview gets the 30 second read budget')

const modalSource = readFileSync(join(here, '..', 'src', 'components', 'products', 'MergeDuplicatesReviewModal.tsx'), 'utf8')
const transportSource = readFileSync(join(here, '..', 'src', 'api', 'productWriteTransport.ts'), 'utf8')
assert.match(modalSource, /onLoadPreview\(request\.signal\)/)
assert.match(modalSource, /previewRequestsRef\.current\?\.cancel\(\)/)
assert.match(transportSource, /MERGE_DUPLICATES_PREVIEW_TIMEOUT_MS, \{ signal: options\.signal \}/)
assert.doesNotMatch(modalSource, /oldest row in each duplicate group/i)
assert.match(modalSource, /fewest extra leading zeros/)
assert.match(modalSource, /highest current stock/)
assert.match(modalSource, /remaining ties keep the lowest ID/)

console.log('PASS merge duplicate preview has a scoped timeout, aborts on close/retry, and ignores stale completion')
