import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  dispatchResolvedSyncError,
  claimSyncProblemPresentation,
  hasLocalSyncProblemPresentation,
  subscribeSyncProblemPresentation,
  shouldClearResolvedSyncError,
  SYNC_ERROR_RESOLVED_EVENT,
} from '../src/utils/syncProblemLifecycle.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const current = { errorId: 'failure-1', channel: 'customers:create', code: 'contact_duplicate_decision_required' }
assert.equal(shouldClearResolvedSyncError(current, current), true)
assert.equal(shouldClearResolvedSyncError(current, { ...current, errorId: 'failure-2' }), false, 'a later same-channel error must survive')
assert.equal(shouldClearResolvedSyncError(current, { ...current, channel: 'delivery-contacts:create' }), false, 'an unrelated write channel must survive')
assert.equal(shouldClearResolvedSyncError(current, { ...current, code: 'membership_conflict' }), false, 'a different failure code must survive')
assert.equal(shouldClearResolvedSyncError(current, { errorId: 'failure-1' }), false, 'partial references must fail closed')

const globalRecord = globalThis as unknown as Record<string, unknown>
const previousWindow = globalRecord.window
const bus = new EventTarget()
globalRecord.window = {
  dispatchEvent: bus.dispatchEvent.bind(bus),
}
let resolved: Record<string, unknown> | null = null
bus.addEventListener(SYNC_ERROR_RESOLVED_EVENT, (event) => {
  resolved = (event as CustomEvent).detail as Record<string, unknown>
})
assert.equal(dispatchResolvedSyncError(current), true)
assert.deepEqual(resolved, current)
assert.equal(dispatchResolvedSyncError({ errorId: 'failure-1', channel: 'customers:create' }), false)
globalRecord.window = previousWindow

const statusProblem = { errorId: 'sale-timeout-1', channel: 'sales:status', code: 'write_outcome_unknown' }
let leaseChanges = 0
const unsubscribe = subscribeSyncProblemPresentation(() => { leaseChanges += 1 })
for (const owner of [
  { actorId: '', requestId: 'request-1', problem: statusProblem },
  { actorId: 'actor-1', requestId: '', problem: statusProblem },
  { actorId: 'actor-1', requestId: 'request-1', problem: { errorId: 'sale-timeout-1' } },
]) {
  const release = claimSyncProblemPresentation(owner)
  assert.equal(hasLocalSyncProblemPresentation(statusProblem, 'actor-1'), false, 'missing identity cannot suppress a banner')
  release()
}
const releaseFirst = claimSyncProblemPresentation({ actorId: 'actor-1', requestId: 'request-1', problem: statusProblem })
assert.equal(hasLocalSyncProblemPresentation(statusProblem, 'actor-1'), true, 'mounted modal owns only the matching error')
assert.equal(hasLocalSyncProblemPresentation(statusProblem, 'actor-2'), false, 'actor switch restores the global warning')
assert.equal(hasLocalSyncProblemPresentation({ ...statusProblem, errorId: 'sale-timeout-2' }, 'actor-1'), false)
assert.equal(hasLocalSyncProblemPresentation({ ...statusProblem, channel: 'sales:amend' }, 'actor-1'), false)
assert.equal(hasLocalSyncProblemPresentation({ ...statusProblem, code: 'other' }, 'actor-1'), false)
const releaseSecond = claimSyncProblemPresentation({ actorId: 'actor-1', requestId: 'request-1', problem: statusProblem })
releaseFirst()
releaseFirst()
assert.equal(hasLocalSyncProblemPresentation(statusProblem, 'actor-1'), true, 'stale cleanup cannot release another surface token')
releaseSecond()
assert.equal(hasLocalSyncProblemPresentation(statusProblem, 'actor-1'), false, 'closing the modal restores the unresolved banner')
assert.equal(leaseChanges, 4)
unsubscribe()

const httpSource = read('../src/api/http.ts')
const appSource = read('../src/App.tsx')
const contactSource = read('../src/components/contacts/contactDuplicates.ts')
const customerFormSource = read('../src/components/contacts/CustomerFormModal.tsx')
const supplierSource = read('../src/components/contacts/SuppliersTab.tsx')
const deliverySource = read('../src/components/contacts/DeliveryTab.tsx')
const posSource = read('../src/components/pos/POS.tsx')

assert.match(httpSource, /const errorId = createSyncErrorId\(\)[\s\S]*e\.syncErrorId = errorId[\s\S]*e\.syncErrorChannel = channel[\s\S]*detail: \{\s*errorId,\s*channel,/)
assert.match(appSource, /setSyncError\(\(current\) => shouldClearResolvedSyncError\(current, detail\) \? null : current\)/)
assert.match(appSource, /addEventListener\(SYNC_ERROR_RESOLVED_EVENT, onSyncErrorResolved\)/)
assert.match(appSource, /removeEventListener\(SYNC_ERROR_RESOLVED_EVENT, onSyncErrorResolved\)/)
assert.match(appSource, /presentation\.unknownOutcome && locallyPresented\) return null/, 'only presentation is suppressed, never underlying error state')
const salesDetailSource = read('../src/components/sales/SaleDetailModal.tsx')
assert.match(salesDetailSource, /return claimSyncProblemPresentation\(statusRecoveryOwner\)/, 'modal lease is released by effect cleanup')
assert.match(contactSource, /matches: check\.matches\.map\(\(match\) => \(\{ \.\.\.match, syncProblem \}\)\)/)
assert.match(contactSource, /dispatchResolvedSyncError\(value\?\.syncProblem\)/)

for (const [label, source] of [
  ['customer form', customerFormSource],
  ['supplier form', supplierSource],
  ['delivery form', deliverySource],
] as const) {
  assert.match(source, /duplicateDecision && \(result as \{ success\?: boolean \} \| null\)\?\.success === true[\s\S]*resolveContactDuplicateSyncError\(pendingDuplicateCheck\)/, `${label} clears only after a confirmed successful separate create`)
}

for (const [label, source] of [
  ['customer parent', read('../src/components/contacts/CustomersTab.tsx')],
  ['supplier parent', supplierSource],
  ['delivery parent', deliverySource],
] as const) {
  assert.match(source, /if \(!existing\) throw[\s\S]*resolveContactDuplicateSyncError\(match\)[\s\S]*catch/, `${label} clears only after the existing record loads`)
}

assert.match(posSource, /await selectCustomer\(createdCustomer\)[\s\S]*if \(duplicateDecision\) resolveContactDuplicateSyncError\(customerDuplicateCheck\)/)
assert.match(posSource, /await selectCustomer\(existing\)[\s\S]*resolveContactDuplicateSyncError\(match\)/)
assert.match(posSource, /selectDelivery\(created\)[\s\S]*if \(duplicateDecision\) resolveContactDuplicateSyncError\(deliveryDuplicateCheck\)/)

console.log('resolvedSyncError.test.ts OK')
