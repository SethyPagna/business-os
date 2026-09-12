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
assert.match(modalSource, /const DETAIL_PAGE_SIZE = 25/)
assert.match(modalSource, /const visibleGroups = groups\.slice\(detailStart, detailEnd\)/)
assert.match(modalSource, /visibleGroups\.map\(\(group\) =>/)
assert.doesNotMatch(modalSource, /groups\.map\(\(group\) =>/)
assert.match(modalSource, /setPreview\(result\)\s*setDetailPage\(1\)/)
assert.match(modalSource, /setDetailPage\(\(current\) => Math\.min\(Math\.max\(current, 1\), detailPageCount\)\)/)
assert.match(modalSource, /T\('showing', 'Showing'\)/)
assert.match(modalSource, /T\('back', 'Back'\)/)
assert.match(modalSource, /T\('next', 'Next'\)/)
assert.match(modalSource, /<ChevronLeft className="h-3\.5 w-3\.5" aria-hidden="true" \/>\s*\{T\('back', 'Back'\)\}/)
assert.match(modalSource, /\{T\('next', 'Next'\)\}\s*<ChevronRight className="h-3\.5 w-3\.5" aria-hidden="true" \/>/)
assert.match(modalSource, /onClick=\{onConfirm\}/, 'paging must not wrap or replace the existing confirmation callback')

console.log('PASS merge duplicate preview has bounded detail paging, a scoped timeout, and stale-request guards')
