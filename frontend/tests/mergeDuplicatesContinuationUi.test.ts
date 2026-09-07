// The Worker deliberately commits at most 25 duplicate cases per request.
// This locks the Products UI to that continuation contract: one confirmed
// run keeps the same request id and AbortSignal, proceeds only while the
// server proves progress, and closes only after `complete`.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../src/components/products/MergeDuplicatesReviewModal.tsx', import.meta.url), 'utf8')

const start = source.indexOf('const handleMergeDuplicates = async () => {')
const end = source.indexOf('// --- Exact-duplicate', start)
assert.ok(start > 0 && end > start, 'merge handler exists as one bounded block')
const handler = source.slice(start, end)

assert.equal((handler.match(/const requestId =/g) || []).length, 1, 'one stable request id is created per confirmed run')
assert.ok(handler.indexOf('const requestId =') < handler.indexOf('while (calls < callCeiling)'), 'request id is created outside the continuation loop')
assert.match(handler, /productApi\.mergeDuplicates\(\{ requestId, signal: controller\.signal \}\)/,
  'every continuation call carries the same id and abort signal')
assert.match(handler, /if \(result\?\.complete\) \{[\s\S]*completed = true[\s\S]*break/,
  'complete is the only successful loop terminator')
assert.match(handler, /result\?\.stalled \|\| !madeProgress/,
  'the UI stops when the Worker reports a stall or no progress')
assert.match(handler, /remaining >= remainingBefore/,
  'the UI stops when the remaining-product count fails to decrease')
assert.match(handler, /callCeiling = calls \+ additional/,
  'the Worker-provided remaining-group bound limits sequential requests')
assert.ok(handler.indexOf('setMergeDuplicatesReviewOpen(false)') > handler.indexOf("if (!completed) throw"),
  'the review closes only after the complete check')
assert.match(handler, /if \(calls > 0 \|\| controller\.signal\.aborted\) await load\(true\)/,
  'timeout/error/abort reloads products because earlier atomic cases may already be saved')

assert.match(source, /const active = mergeDuplicatesAbortRef\.current[\s\S]{0,100}active\?\.abort\(\)[\s\S]{0,120}setMergeDuplicatesReviewOpen\(false\)/,
  'closing the modal aborts the active request and closes immediately')
assert.match(source, /mergeDuplicates: async \(options\)[\s\S]{0,260}merge\(options\)/,
  'the lazy ProductApi adapter forwards request options to the transport')

// Identity owns the modal itself. Its Cancel control must remain enabled while
// working so the parent abort path above is reachable during a long catalog.
assert.match(modal, /onClick=\{onClose\}/, 'the review modal renders its parent close action')
assert.doesNotMatch(modal, /onClick=\{onClose\}[^>]*disabled=\{working\}/,
  'Cancel is not disabled while the continuation run is working')

console.log('PASS duplicate merge continuation UI contract')
