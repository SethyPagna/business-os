import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { fmtClock24 } from '../src/utils/formatters.ts'
import {
  createFee,
  discardPendingFeeCreate,
  getPendingFeeCreate,
  normalizeFeeCreateBody,
  pendingFeeCreateStorageKey,
  prepareFeeCreatePayload,
  type FeePayload,
} from '../src/api/feesTransport.ts'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  getSyncServerUrl,
  setSyncServerUrl,
} from '../src/api/http.ts'
import {
  shouldClearResolvedSyncError,
  SYNC_ERROR_RESOLVED_EVENT,
  type SyncProblemReference,
} from '../src/utils/syncProblemLifecycle.ts'

const read = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const page = read('components/fees/FeesPage.tsx')
const transport = read('api/feesTransport.ts')

const groupSource = page.slice(page.indexOf('export function groupFeesByDate'), page.indexOf('export function feeTypeToneClass'))
const groupFeesByDate = new Function(`${stripTypeScriptTypes(groupSource.replace('export ', ''))}; return groupFeesByDate`)() as (
  rows: Array<{ fee_date: string; id: number }>,
) => Array<{ date: string; rows: Array<{ id: number }> }>
const grouped = groupFeesByDate([
  { id: 3, fee_date: '2026-09-11' },
  { id: 2, fee_date: '2026-09-11' },
  { id: 1, fee_date: '2026-09-10' },
])
assert.deepEqual(grouped.map((group) => [group.date, group.rows.map((row) => row.id)]), [
  ['2026-09-11', [3, 2]],
  ['2026-09-10', [1]],
], 'already ordered expense rows stay grouped by their recorded business date')
assert.equal(fmtClock24('2026-09-10T17:00:00.000Z'), '00:00', 'row time uses the Phnom Penh 24-hour clock')

assert.doesNotMatch(page, /import StatsRangeRow/, 'Expenses does not render a second standalone date row')
assert.match(page, /<StatsStrip[\s\S]*?range=\{stripRange\}[\s\S]*?onRangeChange=\{setStripRange\}/, 'Stats owns the shared date/actions row and preset rail')
assert.match(page, /toolbarIconButtonClassName/, 'Add and Export use the shared icon-only toolbar height contract')
assert.match(page, /aria-label=\{tr\('add_fee', 'Add Expense'\)\}/)
assert.match(page, /<ExportMenu[\s\S]*?iconOnly/, 'Export is icon-only with its accessible label retained')
assert.equal((page.match(/<PaginationControls/g) || []).length, 2, 'the same compact pager appears above and below results')
assert.match(page, /group\.rows\.map\(\(fee\)/, 'desktop and mobile render day-group rows')
assert.match(page, /\{fmtClock24\(fee\.created_at\)\}/, 'rows show time rather than repeating their group date')
assert.equal((page.match(/data-expense-line=/g) || []).length, 2, 'a narrow expense card has at most two information rows')
assert.match(page, /fee\.sale_receipt_number \|\| fee\.sale_id/, 'linked rows expose receipt/sale identity')
assert.match(page, /fee\.branch_name \?/, 'branch metadata is conditional so unavailable manual metadata stays omitted')
assert.match(page, /fee\.created_by_name[\s\S]*fee\.branch_name[\s\S]*fee\.delivery_contact_name/, 'available creator, branch, then delivery metadata keeps its frozen order')
assert.ok((page.match(/h-10 w-10/g) || []).length >= 4, 'desktop and mobile Edit/Delete use 40px targets')
assert.doesNotMatch(page, /customer_name/, 'compact expense metadata does not invent unavailable customer data')

assert.match(transport, /PENDING_FEE_CREATE_PREFIX/)
assert.match(transport, /storage\.setItem\(key, serialized\)/, 'request envelope is persisted before route() starts')
assert.match(transport, /fees:create:\$\{pending\.actor_id\}:\$\{pending\.client_request_id\}/, 'retry transport identity includes actor and durable request id')
assert.doesNotMatch(transport, /status >= 400 && status < 500/, '409 and other rejected retries must not erase an unresolved request')
assert.match(transport, /isAuthoritativeFeeCreateResponse\(result, pending\)/, 'response evidence is checked inside route() before it can report success')
assert.match(transport, /clearPendingFeeCreate\([\s\S]*dispatchResolvedSyncError\(pending\.sync_problem\)/, 'only confirmed success clears pending state and resolves its exact warning')
assert.match(transport, /export function discardPendingFeeCreate[\s\S]*pending\.client_request_id !== requestId[\s\S]*removeItem[\s\S]*dispatchResolvedSyncError\(pending\.sync_problem\)/, 'explicit discard removes and resolves only one exact pending envelope')

const payload: FeePayload = {
  fee_type: 'expense',
  label: '  Staff   lunch ',
  amount_usd: 3.125,
  amount_khr: 0,
  fee_date: '2026-09-11',
  sale_id: null,
  branch_id: 2,
  delivery_contact_id: null,
  notes: ' original body ',
}
const originalWindow = globalThis.window
const originalFetch = globalThis.fetch
const originalServerUrl = getSyncServerUrl()
const sessionItems = new Map<string, string>()
const memoryStorage = {
  getItem: (key: string) => sessionItems.get(key) ?? null,
  setItem: (key: string, value: string) => { sessionItems.set(key, value) },
  removeItem: (key: string) => { sessionItems.delete(key) },
  clear: () => { sessionItems.clear() },
  key: (index: number) => [...sessionItems.keys()][index] ?? null,
  get length() { return sessionItems.size },
}
const fakeWindow = new EventTarget() as EventTarget & {
  sessionStorage: Storage
  localStorage: Storage
  location: { origin: string; hostname: string }
  setTimeout: typeof setTimeout
}
fakeWindow.sessionStorage = memoryStorage as Storage
fakeWindow.localStorage = memoryStorage as Storage
fakeWindow.location = { origin: 'https://expenses.test', hostname: 'expenses.test' }
fakeWindow.setTimeout = setTimeout
const syncErrors: SyncProblemReference[] = []
const resolvedSyncErrors: SyncProblemReference[] = []
fakeWindow.addEventListener('sync:error', (event) => {
  syncErrors.push((event as CustomEvent<SyncProblemReference>).detail)
})
fakeWindow.addEventListener(SYNC_ERROR_RESOLVED_EVENT, (event) => {
  resolvedSyncErrors.push((event as CustomEvent<SyncProblemReference>).detail)
})

function authoritativeFee(actorId: number, id: number): Record<string, unknown> {
  return {
    id,
    ...normalizeFeeCreateBody(payload),
    created_by: actorId,
    created_by_name: 'Expense Tester',
    created_at: '2026-09-11T01:02:03.000Z',
    updated_at: '2026-09-11T01:02:03.000Z',
  }
}

try {
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: fakeWindow })
  setSyncServerUrl('https://expenses.test')
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()

  let requestCount = 0
  const attemptBodies: FeePayload[] = []
  globalThis.fetch = async (_input, init) => {
    requestCount += 1
    assert.ok(sessionItems.has(pendingFeeCreateStorageKey(7)), 'actor-scoped ID and original body exist before network I/O')
    attemptBodies.push(JSON.parse(String(init?.body || '{}')) as FeePayload)
    throw new TypeError('Failed to fetch after the server may have committed')
  }
  await assert.rejects(createFee(payload, 7), (error: unknown) => (
    (error as { outcome?: string }).outcome === 'unknown'
  ), 'lost acknowledgement is surfaced as unknown rather than treated as a safe failure')

  const lostAckPending = getPendingFeeCreate(7)
  assert.ok(lostAckPending, 'lost acknowledgement preserves the actor-scoped request across reload')
  assert.deepEqual(lostAckPending.body, normalizeFeeCreateBody(payload), 'the exact normalized original body is recoverable')
  assert.equal(attemptBodies[0]?.client_request_id, lostAckPending.client_request_id)
  assert.deepEqual(lostAckPending.sync_problem, {
    actor_id: '7',
    client_request_id: lostAckPending.client_request_id,
    errorId: syncErrors[0]?.errorId,
    channel: syncErrors[0]?.channel,
    code: syncErrors[0]?.code,
  }, 'reload also preserves the exact actor/request/global-warning identity')

  await assert.rejects(
    createFee({ ...payload, label: 'Changed draft' }, 7),
    (error: unknown) => (error as { code?: string }).code === 'pending_fee_create_exists',
    'a changed draft cannot overwrite or borrow the unresolved request ID',
  )
  assert.equal(requestCount, 1, 'changed drafts fail before network I/O')
  assert.deepEqual(getPendingFeeCreate(7), lostAckPending, 'changed draft leaves the frozen envelope untouched')

  prepareFeeCreatePayload(payload, 8, memoryStorage, () => 'account8-request')
  assert.equal(getPendingFeeCreate(8)?.client_request_id, 'account8-request', 'another account receives a separate slot')
  assert.equal(getPendingFeeCreate(7)?.client_request_id, lostAckPending.client_request_id, 'account switch cannot expose or replace the first actor slot')

  prepareFeeCreatePayload(payload, 9, memoryStorage, () => 'revoked-request')
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'Permission revoked', code: 'forbidden' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
  await assert.rejects(createFee(payload, 9), (error: unknown) => (error as { status?: number }).status === 403)
  assert.equal(getPendingFeeCreate(9)?.client_request_id, 'revoked-request', 'permission revocation retains the exact unresolved request')

  prepareFeeCreatePayload(payload, 10, memoryStorage, () => 'stale-request')
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'Request ID conflicts with its original body', code: 'idempotency_conflict' }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  })
  await assert.rejects(createFee(payload, 10), (error: unknown) => (
    (error as { status?: number; code?: string }).status === 409
      && (error as { code?: string }).code === 'idempotency_conflict'
  ))
  assert.equal(getPendingFeeCreate(10)?.client_request_id, 'stale-request', '409 never erases the original request')

  prepareFeeCreatePayload(payload, 11, memoryStorage, () => 'missing-proof-request')
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
  await assert.rejects(createFee(payload, 11), (error: unknown) => (
    (error as { code?: string; outcome?: string }).code === 'write_outcome_unknown'
      && (error as { outcome?: string }).outcome === 'unknown'
  ), 'HTTP 200 without an expense receipt is still an unknown outcome')
  assert.equal(getPendingFeeCreate(11)?.client_request_id, 'missing-proof-request', 'missing success evidence retains the frozen request')
  assert.equal(resolvedSyncErrors.length, 0, 'malformed success cannot resolve a global warning')

  prepareFeeCreatePayload(payload, 12, memoryStorage, () => 'wrong-proof-request')
  globalThis.fetch = async () => new Response(JSON.stringify({ fee: authoritativeFee(99, 78) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
  await assert.rejects(createFee(payload, 12), (error: unknown) => (
    (error as { code?: string }).code === 'write_outcome_unknown'
  ), 'a plausible row for another actor is not authoritative evidence for this request')
  const unrelatedWarning = syncErrors.at(-1)
  assert.equal(getPendingFeeCreate(12)?.client_request_id, 'wrong-proof-request', 'mismatched receipt evidence retains the frozen request')

  let retryBody: FeePayload | null = null
  globalThis.fetch = async (_input, init) => {
    retryBody = JSON.parse(String(init?.body || '{}')) as FeePayload
    return new Response(JSON.stringify({ fee: authoritativeFee(7, 77) }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const replay = await createFee(payload, 7)
  assert.equal(replay.fee.id, 77)
  assert.deepEqual(retryBody, attemptBodies[0], 'explicit retry sends the exact original ID and normalized body')
  assert.equal(getPendingFeeCreate(7), null, 'only a successful receipt clears the retry slot')
  assert.equal(resolvedSyncErrors.length, 1, 'successful exact retry emits one warning resolution')
  assert.deepEqual(resolvedSyncErrors[0], {
    errorId: lostAckPending.sync_problem?.errorId,
    channel: lostAckPending.sync_problem?.channel,
    code: lostAckPending.sync_problem?.code,
  }, 'successful retry resolves only the warning stored on its actor/request envelope')
  assert.equal(shouldClearResolvedSyncError(syncErrors[0], resolvedSyncErrors[0]), true, 'the matching original banner is resolvable')
  assert.equal(shouldClearResolvedSyncError(unrelatedWarning, resolvedSyncErrors[0]), false, 'a later unrelated warning remains visible')
  assert.equal(getPendingFeeCreate(8)?.client_request_id, 'account8-request', 'successful replay does not clear another actor request')
  assert.ok(getPendingFeeCreate(11), 'a truly unknown malformed response remains retryable after another request succeeds')
  assert.ok(getPendingFeeCreate(12), 'another actor request remains isolated after successful replay')

  const discardedUnknown = getPendingFeeCreate(11)
  assert.ok(discardedUnknown?.sync_problem, 'the explicitly discarded unknown request carries its matching warning identity')
  assert.equal(discardPendingFeeCreate(11, 'wrong-request-id'), false, 'mismatched discard is a no-op')
  assert.deepEqual(getPendingFeeCreate(11), discardedUnknown, 'mismatched discard cannot remove the exact pending request')
  assert.equal(discardPendingFeeCreate(12, discardedUnknown.client_request_id), false, 'another actor cannot discard this request identity')
  assert.equal(getPendingFeeCreate(12)?.client_request_id, 'wrong-proof-request', 'cross-actor discard cannot remove the other actor envelope')
  assert.equal(resolvedSyncErrors.length, 1, 'mismatched discard cannot resolve any warning')
  assert.equal(discardPendingFeeCreate(11, discardedUnknown.client_request_id), true, 'exact explicit discard removes the pending request')
  assert.equal(getPendingFeeCreate(11), null)
  assert.equal(resolvedSyncErrors.length, 2, 'exact explicit discard resolves one matching warning')
  assert.deepEqual(resolvedSyncErrors[1], {
    errorId: discardedUnknown.sync_problem.errorId,
    channel: discardedUnknown.sync_problem.channel,
    code: discardedUnknown.sync_problem.code,
  })
  assert.equal(shouldClearResolvedSyncError(unrelatedWarning, resolvedSyncErrors[1]), false, 'discard resolution leaves another actor warning untouched')
  assert.equal(getPendingFeeCreate(12)?.client_request_id, 'wrong-proof-request', 'discard resolution leaves another actor request untouched')

  discardPendingFeeCreate(9, 'revoked-request')
  assert.equal(getPendingFeeCreate(9), null, 'explicit discard clears only the matching actor request')
  assert.equal(resolvedSyncErrors.length, 2, 'discard without a stored unknown warning emits no unrelated resolution')
  assert.ok(getPendingFeeCreate(10), 'discarding another actor cannot clear a stale request')
} finally {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow })
  setSyncServerUrl(originalServerUrl)
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
}

console.log('PASS expense grouping, metadata, 40px actions and actor-scoped exact create recovery')
