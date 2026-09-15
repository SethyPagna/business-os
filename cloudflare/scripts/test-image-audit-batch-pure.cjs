// p6/efficiency-3 step 4: pins the sequential-D1-round-trip reduction made
// to lib/imageAudit.ts. Both normalizeStoredImage() (the media-queue
// consumer's per-message kernel -- queue.ts's handleMediaQueue calls it for
// every 'optimize-image' message) and reprocessAuditedImages() (the 6h
// sweep's paced reprocessing pass) wrote image_audit and file_assets as two
// separate sequential awaits; both now go over one db.batch(), same
// independent-writes-fan-out shape as the rest of this wave.
//
// Runtime coverage for normalizeStoredImage's write path already lives in
// test-image-normalize-pure.cjs (real sqlite via the D1-compat harness, all
// checks green against the batched form); this is the source lock plus the
// mirror check for reprocessAuditedImages, which has no existing test.
//
// Run (from cloudflare/): node scripts/test-image-audit-batch-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const src = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'imageAudit.ts'), 'utf8')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `${label}: start marker not found`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `${label}: end marker not found after start`)
  return source.slice(start, end)
}

check('syncFileAssetMetadata was replaced by a statement builder (no bare .run() inside it)', () => {
  assert.doesNotMatch(src, /async function syncFileAssetMetadata/, 'the old immediately-executing helper must be gone')
  assert.match(src, /function buildFileAssetMetadataStatement/, 'expected the statement-building replacement')
})

check('normalizeStoredImage batches its image_audit upsert with the file_assets sync', () => {
  const block = sliceBetween(src, 'export async function normalizeStoredImage', 'export async function enqueueImageNormalization', 'normalizeStoredImage')
  assert.match(block, /return db\.batch\(statements\)/, 'expected the two independent writes to go over one db.batch()')
  assert.doesNotMatch(block, /await syncFileAssetMetadata\(/, 'must not regress to a standalone awaited file_assets sync')
})

check('reprocessAuditedImages batches its image_audit UPDATE with the file_assets sync', () => {
  const block = sliceBetween(src, 'export async function reprocessAuditedImages', 'export type NormalizeOutcome', 'reprocessAuditedImages')
  assert.match(block, /await db\.batch\(statements\)/, 'expected the two independent writes to go over one db.batch()')
  assert.doesNotMatch(block, /await syncFileAssetMetadata\(/, 'must not regress to a standalone awaited file_assets sync')
})

console.log(`\n${passed} checks passed`)
