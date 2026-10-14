import assert from 'node:assert/strict'
import { closeShiftById, amendShift } from '../src/api/shiftTransport.ts'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, getSyncServerUrl, setSyncServerUrl } from '../src/api/http.ts'

// The real transport against a deterministic fetch: an employee's close from the Shifts popup posts no closed_at (the
// Worker stamps its own clock, so a stale minute-floored draft cannot be refused as "before the last sale"), a chosen
// time is posted as typed, and an amend that leaves a time alone posts no opened_at/closed_at for the Worker to compare.

function readableStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => { values.clear() },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(String(key)) ?? null,
    setItem: (key: string, value: string) => { values.set(String(key), String(value)) },
    removeItem: (key: string) => { values.delete(String(key)) },
  }
}

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
const originalServerUrl = getSyncServerUrl()
const session = readableStorage()
globalThis.window = Object.assign(new EventTarget(), { localStorage: readableStorage(), sessionStorage: session }) as unknown as Window & typeof globalThis

const bodies: Array<{ url: string; body: Record<string, unknown> }> = []
const shift = {
  id: 31, shift_code: 'S-1', scope_mode: 'per_account', user_id: 7, user_name: 'sokha', branch_id: 1, branch_name: 'Shop', business_date: '2026-09-14',
  opened_at: '2026-09-14T01:00:00.000Z', opening_float_usd: 10, opening_float_khr: 0, opening_note: null, closed_at: '2026-09-14T05:00:00.000Z',
  closing_counted_usd: 10, closing_counted_khr: 0, closing_note: null, closed_by_user_id: 7, closed_by_user_name: 'sokha', revision: 1,
  capabilities: { can_edit: true, can_close: false, can_reopen: false, can_cancel: false }, cancelled_at: null, cancelled_by_user_id: null,
  cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null, reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null,
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  bodies.push({ url: String(input), body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown> })
  const id = Number(/shifts\/(\d+)/.exec(String(input))?.[1])
  return new Response(JSON.stringify({ shift: { ...shift, id, revision: 2 }, already_closed: false, is_open: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch

try {
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
  setSyncServerUrl('https://sync.example.test')

  await closeShiftById(31, { actorId: 7, expectedRevision: 0, closingCountedUsd: 10, closingCountedKhr: 0 })
  assert.equal(bodies.length, 1)
  assert.ok(bodies[0].url.endsWith('/api/shifts/31/close'))
  assert.equal('closed_at' in bodies[0].body, false, 'an employee close without a time posts no closed_at')
  assert.equal(bodies[0].body.expected_revision, 0)

  await closeShiftById(32, { actorId: 7, expectedRevision: 0, closedAt: '2026-09-14T04:00:00.000Z', closingCountedUsd: 10, closingCountedKhr: 0 })
  assert.equal(bodies[1].body.closed_at, '2026-09-14T04:00:00.000Z', 'an administrator\'s chosen time is posted as typed')

  await amendShift(33, { actorId: 7, expectedRevision: 1, reason: 'Count', openingFloatUsd: 10, openingFloatKhr: 0, closedAt: shift.closed_at, closedAtUnchanged: true, closingCountedUsd: 11, closingCountedKhr: 0 })
  assert.equal('opened_at' in bodies[2].body, false, 'an untouched opening time is not posted')
  assert.equal('closed_at' in bodies[2].body, false, 'an untouched closing time is not posted')
  assert.equal(bodies[2].body.closing_counted_usd, 11, 'the count of a closed shift is still posted')

  await amendShift(34, { actorId: 7, expectedRevision: 1, reason: 'Moved', openedAt: '2026-09-14T01:05:00.000Z', openingFloatUsd: 10, openingFloatKhr: 0, closedAt: '2026-09-14T04:30:00.000Z', closingCountedUsd: 11, closingCountedKhr: 0 })
  assert.equal(bodies[3].body.opened_at, '2026-09-14T01:05:00.000Z')
  assert.equal(bodies[3].body.closed_at, '2026-09-14T04:30:00.000Z')
} finally {
  globalThis.fetch = originalFetch
  globalThis.window = originalWindow
  setSyncServerUrl(originalServerUrl)
}
console.log('PASS the shift transport posts a time only when one was chosen')
