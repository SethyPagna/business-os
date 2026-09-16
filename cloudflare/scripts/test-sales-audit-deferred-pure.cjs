// P4-4a fix 2: three audit() calls in routes/sales.ts used to be `await`ed
// directly on the request's critical path even though none of them gate the
// response (PATCH /:id/status, PATCH /:id/customer, and the shared
// auditAmendment() helper used by every amendment route). This mirrors the
// existing bumpVersion() deferral already living in the same
// `c.executionCtx.waitUntil(Promise.all([...]))` blocks.
//
// This is a source-structure test (not a runtime harness) because exercising
// these three Hono handlers end to end needs the full sales.ts dependency
// graph; the invariant we care about -- "audit() is inside the SAME
// waitUntil(Promise.all([...bumpVersion...])) block, not awaited before it"
// -- is entirely readable from the source text.
//
// Run: node scripts/test-sales-audit-deferred-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function read(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
}

// Extracts the source slice from `startMarker` up to (and including) the
// first `waitUntil(Promise.all([ ... ]))` call that follows it, using
// straightforward bracket counting on the `([` / `])` pair opened by
// `Promise.all([`.
function sliceThroughWaitUntil(src, startMarker) {
  const start = src.indexOf(startMarker)
  assert.ok(start >= 0, `marker not found: ${startMarker}`)
  const waitUntilAt = src.indexOf('c.executionCtx.waitUntil(Promise.all([', start)
  assert.ok(waitUntilAt >= start, `no waitUntil(Promise.all([...])) after marker: ${startMarker}`)
  const openIdx = src.indexOf('[', waitUntilAt)
  let depth = 0
  let i = openIdx
  for (; i < src.length; i++) {
    if (src[i] === '[') depth += 1
    else if (src[i] === ']') {
      depth -= 1
      if (depth === 0) break
    }
  }
  assert.ok(depth === 0, `unbalanced brackets scanning waitUntil block for: ${startMarker}`)
  return { block: src.slice(waitUntilAt, i + 1), beforeWaitUntil: src.slice(start, waitUntilAt) }
}

function assertAuditIsDeferred(src, startMarker, label) {
  const { block, beforeWaitUntil } = sliceThroughWaitUntil(src, startMarker)
  assert.ok(!/\bawait\s+audit\(/.test(beforeWaitUntil), `${label}: audit() must not be awaited before the waitUntil block (would be back on the critical path)`)
  assert.ok(/\baudit\(/.test(block), `${label}: audit() must be inside the waitUntil(Promise.all([...])) block`)
  // Accepts either the single-namespace bumpVersion() or the multi-namespace
  // bumpVersions() (both defer through lib/cache.ts's same D1-batched path;
  // see K1) -- the invariant is "a cache-version bump rides in the same
  // waitUntil as the deferred audit", not which of the two call shapes.
  assert.ok(/\bbumpVersions?\(/.test(block), `${label}: expected bumpVersion()/bumpVersions() alongside the deferred audit() call`)
}

function main() {
  const salesSrc = read('routes/sales.ts')

  check('PATCH /:id/status defers its audit() call into the same waitUntil as bumpVersion', () => {
    assertAuditIsDeferred(salesSrc, "app.patch('/:id/status'", 'PATCH /:id/status')
  })

  check('PATCH /:id/customer defers its audit() call into the same waitUntil as bumpVersion', () => {
    assertAuditIsDeferred(salesSrc, "app.patch('/:id/customer'", 'PATCH /:id/customer')
  })

  check('auditAmendment() defers its audit() call into the same waitUntil as bumpVersion', () => {
    assertAuditIsDeferred(salesSrc, 'async function auditAmendment(', 'auditAmendment()')
  })

  check('dead amendmentResponse() (re-SELECTs updated_at after the fact) is removed, buildAmendmentResponsePayload stays', () => {
    assert.ok(!/async function amendmentResponse\(/.test(salesSrc), 'amendmentResponse should have been deleted as dead code (zero callers)')
    assert.ok(/function buildAmendmentResponsePayload\(/.test(salesSrc), 'buildAmendmentResponsePayload is still used by live amendment routes and must remain')
  })

  console.log(`\nOK ${passed} checks`)
}

main()
