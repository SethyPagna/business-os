import assert from 'node:assert/strict'
import { createPosTrackingOwner, needsPosTrackingSheet, posTrackingFingerprint, provesUntrackedLots } from '../src/components/pos/posProductTracking.ts'

const user = { id: 7, permissions: { pos: true } }
const owner = createPosTrackingOwner()
const initial = posTrackingFingerprint(user, true, '2')
const scope = owner.scope(initial)
assert.equal(owner.scope(posTrackingFingerprint({ ...user }, true, '2')), scope)
assert.notEqual(owner.scope(posTrackingFingerprint(user, true, '3')), scope)
assert.notEqual(owner.scope(initial), scope, 'A-B-A never revives old work')
assert.notEqual(posTrackingFingerprint(user, false, '2'), initial)
assert.notEqual(posTrackingFingerprint({ ...user, permissions: { pos: false } }, true, '2'), initial)
for (const status of ['loading', 'failed'] as const) assert.ok(needsPosTrackingSheet({ scope, status, ids: new Set() }, scope, 3263))
assert.ok(needsPosTrackingSheet({ scope: 'old', status: 'ready', ids: new Set() }, scope, 3263))
assert.ok(needsPosTrackingSheet({ scope, status: 'ready', ids: new Set([3263]) }, scope, 3263))
assert.equal(needsPosTrackingSheet({ scope, status: 'ready', ids: new Set() }, scope, 3263), false)
for (const invalid of [null, {}, { batches: [] }, { batches: [], known_positive_quantity: '0' }, { batches: [], known_positive_quantity: 3 }, { batches: [{ quantity: 0 }], known_positive_quantity: 0 }]) assert.equal(provesUntrackedLots(invalid), false)
assert.ok(provesUntrackedLots({ batches: [], known_positive_quantity: 0 }))

console.log('PASS POS tracking helpers (the till no longer reads a tracked-products list; see d1ClientPosAlwaysSheet.test.ts)')
