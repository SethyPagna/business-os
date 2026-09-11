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

const deleteSource = page.slice(page.indexOf('export async function performExpenseDelete'), page.indexOf('function formatFeeDate'))
const performExpenseDelete = new Function(`${stripTypeScriptTypes(deleteSource.replace('export ', ''))}; return performExpenseDelete`)() as (
  operation: {
    canDelete: () => boolean
    confirmDelete: () => boolean
    begin: () => boolean
    remove: () => Promise<unknown>
    onStart: () => void
    onSuccess: (outcome: 'deleted' | 'pending') => Promise<void>
    onError: (error: unknown) => void
    onFinish: () => void
  },
) => Promise<boolean>

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
assert.match(page, /<StatsStrip[\s\S]*?iconOnly[\s\S]*?compactRange/, 'Stats/date controls use the compact icon treatment without squeezing range endpoints')
assert.match(page, /toolbarIconButtonClassName/, 'Add and Export use the shared icon-only toolbar height contract')
assert.match(page, /aria-label=\{tr\('add_fee', 'Add Expense'\)\}/)
assert.match(page, /border-blue-600 bg-blue-600 text-white/, 'Add Expense is the solid blue plus action on the date row')
assert.match(page, /<ExportMenu[\s\S]*?iconOnly/, 'Export is icon-only with its accessible label retained')
assert.equal((page.match(/<PaginationControls/g) || []).length, 2, 'the same compact pager appears above and below results')
assert.equal((page.match(/compactCentered/g) || []).length, 2, 'both top and bottom pagers use the centered compact geometry')
const pagerRow = page.slice(page.indexOf('<PagerActionRow'), page.indexOf('</PagerActionRow>'))
assert.match(pagerRow, /<ShiftHistoryModal[\s\S]*<History[\s\S]*sr-only[\s\S]*tr\('shift_code', 'Shift'\)/, 'Shift moves to the leading track as a compact icon with an accessible name')
assert.match(pagerRow, /trailing=\{canEditFee[\s\S]*aria-label=\{tr\('manage_expense_labels'[\s\S]*<Tags/, 'Labels is an accessible icon action on the trailing track')
assert.match(pagerRow, /<PaginationControls[\s\S]*compactCentered/, 'the shared row centers its compact pager between the action tracks')
assert.match(page, /group\.rows\.map\(\(fee\)/, 'desktop and mobile render day-group rows')
assert.match(page, /\{fmtClock24\(fee\.created_at\)\}/, 'rows show time rather than repeating their group date')
assert.equal((page.match(/data-expense-line=/g) || []).length, 2, 'a narrow expense card has at most two information rows')
const primaryLine = page.slice(page.indexOf('data-expense-line="primary"'), page.indexOf('data-expense-line="secondary"'))
assert.ok(primaryLine.indexOf('fmtClock24(fee.created_at)') < primaryLine.indexOf('feeTypeLabel(fee.fee_type)') && primaryLine.indexOf('feeTypeLabel(fee.fee_type)') < primaryLine.indexOf("fee.label || ''") && primaryLine.indexOf("fee.label || ''") < primaryLine.indexOf('fmtMoney('), 'compact primary row is time, category, label, then amount')
const secondaryLine = page.slice(page.indexOf('data-expense-line="secondary"'), page.indexOf('</button>', page.indexOf('data-expense-line="secondary"')))
assert.ok(secondaryLine.indexOf('fee.created_by_name') < secondaryLine.indexOf('fee.branch_name'), 'compact secondary row is cashier then branch')
assert.doesNotMatch(secondaryLine, /fee\.delivery_contact_name|feeTypeLabel|fee\.label/, 'secondary row stays focused on normal cashier and branch text')
assert.match(page, /onClick=\{\(\) => openDetail\(fee\)\}/, 'compact and desktop rows open the detail surface')
const listSource = page.slice(page.indexOf('<div className="dense-data-shell'), page.indexOf("{modal === 'detail'"))
assert.doesNotMatch(listSource, /<Pencil|<Trash2|tr\('actions'/, 'Edit/Delete controls and the Actions column are absent from the list')
assert.match(page, /data-expense-detail=""[\s\S]*selected\.sale_receipt_number[\s\S]*selected\.delivery_contact_name[\s\S]*selected\.notes/, 'detail preserves linked receipt, delivery and notes metadata')
assert.match(page, /fee\.branch_name \?/, 'branch metadata is conditional so unavailable manual metadata stays omitted')
assert.match(page, /data-expense-detail-actions=""[\s\S]*min-h-10[\s\S]*min-h-10/, 'detail Edit/Delete retain usable action heights')
assert.doesNotMatch(page, /customer_name/, 'compact expense metadata does not invent unavailable customer data')

const deleteEvents: string[] = []
const deleteOperation = (overrides: Partial<Parameters<typeof performExpenseDelete>[0]> = {}): Parameters<typeof performExpenseDelete>[0] => ({
  canDelete: () => { deleteEvents.push('permission'); return true },
  confirmDelete: () => { deleteEvents.push('confirm'); return true },
  begin: () => { deleteEvents.push('begin'); return true },
  remove: async () => { deleteEvents.push('remove'); return { success: true } },
  onStart: () => { deleteEvents.push('start') },
  onSuccess: async () => { deleteEvents.push('success') },
  onError: () => { deleteEvents.push('error') },
  onFinish: () => { deleteEvents.push('finish') },
  ...overrides,
})

deleteEvents.length = 0
assert.equal(await performExpenseDelete(deleteOperation({ canDelete: () => false })), false)
assert.deepEqual([...deleteEvents], [], 'permission denial performs no confirmation or mutation')

deleteEvents.length = 0
assert.equal(await performExpenseDelete(deleteOperation({ confirmDelete: () => { deleteEvents.push('cancel'); return false } })), false)
assert.deepEqual([...deleteEvents], ['permission', 'cancel'], 'cancelling confirmation performs no delete')

deleteEvents.length = 0
let permissionChecks = 0
assert.equal(await performExpenseDelete(deleteOperation({ canDelete: () => { deleteEvents.push('permission'); permissionChecks += 1; return permissionChecks === 1 } })), false)
assert.deepEqual([...deleteEvents], ['permission', 'confirm', 'permission'], 'authority is rechecked after confirmation and revocation blocks the write')

deleteEvents.length = 0
assert.equal(await performExpenseDelete(deleteOperation()), true)
assert.deepEqual([...deleteEvents], ['permission', 'confirm', 'permission', 'begin', 'start', 'remove', 'success', 'finish'], 'confirmed authorized delete finishes and permits the detail to close')

// Execute the real page success callback: an accepted approval request may
// close detail, but it must reload the server list and never claim deletion.
const successStart = page.indexOf('onSuccess: async (outcome)')
const successEnd = page.indexOf('      onError:', successStart)
const successExpression = page.slice(successStart + 'onSuccess: '.length, successEnd).trim().replace(/,$/, '')
const notices: string[] = []
let reloads = 0
const successCallback = new Function('notify', 'tr', 'load', `return (${stripTypeScriptTypes(successExpression)})`)(
  (message: string) => notices.push(message), (key: string) => key, async (silent: boolean) => { assert.equal(silent, true); reloads++ },
)
assert.equal(await performExpenseDelete(deleteOperation({ remove: async () => ({ success: true, pending: true, pendingActionId: 93 }), onSuccess: successCallback })), true)
assert.deepEqual(notices, ['reason_submitted_for_review'])
assert.equal(reloads, 1, 'queued row remains server-owned; no optimistic deletion')
notices.length = 0
assert.equal(await performExpenseDelete(deleteOperation({ remove: async () => ({ success: true }), onSuccess: successCallback })), true)
assert.deepEqual(notices, ['fee_deleted'])
assert.equal(reloads, 2)
notices.length = 0
assert.equal(await performExpenseDelete(deleteOperation({ remove: async () => ({ success: false }), onSuccess: successCallback })), false)
assert.deepEqual(notices, [], 'unconfirmed response never emits a completion toast or permits close')
deleteEvents.length = 0
assert.equal(await performExpenseDelete(deleteOperation({ begin: () => false })), false)
assert.deepEqual(deleteEvents, ['permission', 'confirm', 'permission'], 'duplicate in-flight delete never starts another write')

deleteEvents.length = 0
assert.equal(await performExpenseDelete(deleteOperation({ remove: async () => { deleteEvents.push('remove'); throw new Error('failed') } })), false)
assert.deepEqual([...deleteEvents], ['permission', 'confirm', 'permission', 'begin', 'start', 'remove', 'error', 'finish'], 'failed delete keeps detail open and releases the in-flight guard')

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

console.log('PASS expense grouping, detail actions, guarded delete/cancel and actor-scoped exact create recovery')
