import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P4-B: FastStockInModal.tsx used to commit its queued lines one HTTP
// request at a time -- `for (const line of pending) { ... await
// adjustStock(...) / await receiveBatchStock(...) }` -- an N-line shipment
// meant N sequential Worker round trips. It now issues ONE request
// (commitFastStockIn, POST /api/inventory/fast-stock-in/commit) for the
// whole session, and falls back to the original per-line loop only when
// that endpoint answers 404 (an old Worker build still live during a
// rolling deploy).
//
// No DOM renderer is available in this harness, so this is a source-
// assertion test in the project's existing style (see
// tests/productStockAdjustPatchNotRefetch.test.ts).

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const modal = readFrontend('src/components/inventory/FastStockInModal.tsx')
const inventoryTransport = readFrontend('src/api/inventoryWriteTransport.ts')
const batchesTransport = readFrontend('src/api/batchesTransport.ts')

runTest('the modal imports the batched commit transport', () => {
  assert.match(modal, /import \{ adjustStock, commitFastStockIn, isDeferredStockInResult, type FastStockInCommitLine, type FastStockInCommitLineResult, type FastStockInCommitSettled \} from '\.\.\/\.\.\/api\/inventoryWriteTransport\.ts'/)
})

runTest('performCommit issues ONE commitFastStockIn call for the whole pending list, not a per-line request loop', () => {
  const start = modal.indexOf('const performCommit = async (pending: ReceivedLine[]) => {')
  assert.notEqual(start, -1, 'performCommit must exist')
  const body = modal.slice(start, modal.indexOf('\n  const successCount', start))
  assert.match(body, /batched = await commitFastStockIn\(pending\.map\(buildLineRequest\), foldRound\)/, 'exactly one call, covering every pending line (the transport re-sends only deferred lines)')
  // Positive control: the pre-fix shape awaited adjustStock/receiveBatchStock
  // directly inside a `for (const line of pending)` loop as the PRIMARY path.
  // That loop must survive only as the named 404 fallback below, not as
  // performCommit's own body.
  assert.doesNotMatch(body, /for \(const line of pending\) \{[\s\S]*await adjustStock/, 'performCommit itself must not loop one request per line')
})

runTest('a 404 from the batched endpoint -- and ONLY a 404 -- falls back to the original per-line loop', () => {
  assert.match(inventoryTransport, /if \(error && typeof error === 'object' && \(error as \{ status\?: number \}\)\.status === 404\) return null/, 'commitFastStockIn must resolve to null on a 404 and rethrow everything else')
  assert.match(modal, /if \(batched === null\) \{\s*\/\/ The deployed Worker predates POST \/api\/inventory\/fast-stock-in\/commit\.\s*failed = await performCommitSequential\(pending\)/, 'only the null (404) branch reaches the old sequential fallback')
  assert.match(modal, /const performCommitSequential = async \(pending: ReceivedLine\[\]\): Promise<number> => \{/, 'the original per-line loop must still exist, as the fallback function')
  assert.match(modal, /await adjustStock\(request\.body\)/)
  assert.match(modal, /await receiveBatchStock\(request\.body\)/)
})

runTest('one line-building function feeds both the batched request and the sequential fallback (no second, driftable copy of the wire bodies)', () => {
  assert.match(modal, /const buildLineRequest = \(line: ReceivedLine\): FastStockInCommitLine => \{/)
  // Both call sites reuse it.
  assert.match(modal, /batched = await commitFastStockIn\(pending\.map\(buildLineRequest\), foldRound\)/)
  assert.match(modal, /const request = buildLineRequest\(line\)/)
})

runTest("a whole-request failure that is NOT a 404 fails every still-pending line with one message, instead of silently retrying the slow loop", () => {
  const start = modal.indexOf('const performCommit = async (pending: ReceivedLine[]) => {')
  const body = modal.slice(start, modal.indexOf('\n  const successCount', start))
  assert.match(body, /catch \(error\) \{\s*const message = error instanceof Error \? error\.message : tr\('error', 'Error'\)[\s\S]*?failed \+= unsettled\.size\s*lines = lines\.map\(\(item\) => \(unsettled\.has\(item\.key\)/,
    'every line no round has answered fails with the one message; a line an earlier round saved keeps "saved"')
})

runTest("the receive-wire body is converted to the wire's snake_case shape through one shared conversion, not a second hand-written copy", () => {
  assert.match(batchesTransport, /export function receiveBatchWireBody\(payload: ReceiveBatchPayload\): Record<string, unknown> \{/)
  assert.match(inventoryTransport, /import \{ receiveBatchWireBody, type ReceiveBatchPayload \} from '\.\/batchesTransport\.ts'/)
  assert.match(inventoryTransport, /receiveBatchWireBody\(line\.body\)/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All fastStockInBatchedCommit tests passed')
}
