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
assert.match(transport, /fees:create:\$\{actorId\}:\$\{prepared\.client_request_id\}/, 'retry transport identity includes actor and durable request id')
assert.doesNotMatch(transport, /status >= 400 && status < 500/, '409 and other rejected retries must not erase an unresolved request')

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

  let retryBody: FeePayload | null = null
  globalThis.fetch = async (_input, init) => {
    retryBody = JSON.parse(String(init?.body || '{}')) as FeePayload
    return new Response(JSON.stringify({ fee: { id: 77 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const replay = await createFee(payload, 7)
  assert.equal(replay.fee.id, 77)
  assert.deepEqual(retryBody, attemptBodies[0], 'explicit retry sends the exact original ID and normalized body')
  assert.equal(getPendingFeeCreate(7), null, 'only a successful receipt clears the retry slot')

  discardPendingFeeCreate(9, 'revoked-request')
  assert.equal(getPendingFeeCreate(9), null, 'explicit discard clears only the matching actor request')
  assert.ok(getPendingFeeCreate(10), 'discarding another actor cannot clear a stale request')
} finally {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: originalWindow })
  setSyncServerUrl(originalServerUrl)
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
}

console.log('PASS expense grouping, metadata, 40px actions and actor-scoped exact create recovery')
