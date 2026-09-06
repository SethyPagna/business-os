import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  amendShift,
  closeShift,
  closeShiftById,
  orderShiftRows,
  parseShiftCount,
  reopenShift,
  shiftLocalDateTimeToIso,
  type AmendShiftInput,
  type Shift,
  type ShiftReconciliation,
} from '../src/api/shiftTransport.ts'
import {
  __resetApiHealthForTests,
  __resetApiWriteDedupeForTests,
  getSyncServerUrl,
  setSyncServerUrl,
} from '../src/api/http.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const transport = read('src/api/shiftTransport.ts')
const settings = read('src/components/utils-settings/Settings.tsx')
const users = read('src/components/users/Users.tsx')
const profile = read('src/components/users/UserProfileModal.tsx')
const panel = read('src/components/shifts/ShiftHistoryPanel.tsx')
const modal = read('src/components/shifts/ShiftHistoryModal.tsx')
const summary = read('src/components/shifts/ShiftSummary.tsx')
const breakdown = read('src/components/shifts/ShiftCashBreakdown.tsx')
const currentSummary = read('src/components/shifts/CurrentShiftSummary.tsx')
const sales = read('src/components/sales/Sales.tsx')
const fees = read('src/components/fees/FeesPage.tsx')
const reports = read('src/components/sales/ReportsHub.tsx')
const pos = read('src/components/pos/POS.tsx')
const gate = read('src/components/pos/ShiftGate.tsx')

let checks = 0
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks += 1 }

const fixture = (id: number, businessDate: string, openedAt: string, closedAt: string | null): Shift => ({
  id,
  shift_code: `S-${id}`,
  scope_mode: 'per_account',
  user_id: 4,
  user_name: 'Cashier',
  branch_id: 2,
  branch_name: 'Shop',
  business_date: businessDate,
  opened_at: openedAt,
  opening_float_usd: 10.25,
  opening_float_khr: 100_000,
  opening_note: null,
  closed_at: closedAt,
  closing_counted_usd: closedAt ? 13.5 : null,
  closing_counted_khr: closedAt ? 135_000 : null,
  closing_note: null,
  closed_by_user_id: closedAt ? 4 : null,
  closed_by_user_name: closedAt ? 'Cashier' : null,
  revision: 0,
  capabilities: { can_edit: false, can_close: !closedAt, can_reopen: !!closedAt, can_cancel: false },
  cancelled_at: null,
  cancelled_by_user_id: null,
  cancelled_by_user_name: null,
  cancel_reason: null,
  parent_shift_id: null,
  reopen_reason: null,
  reopened_by_user_id: null,
  reopened_by_user_name: null,
})

// Behavioral invariants: unresolved historical opens are discoverable first,
// native differences are independent, and entered shop time becomes exact ISO.
const ordered = orderShiftRows([
  fixture(2, '2026-09-05', '2026-09-05T03:00:00.000Z', '2026-09-05T09:00:00.000Z'),
  fixture(1, '2026-09-04', '2026-09-04T08:11:09.183Z', null),
  fixture(3, '2026-09-05', '2026-09-05T05:00:00.000Z', '2026-09-05T10:00:00.000Z'),
])
assert.deepEqual(ordered.map((row) => row.id), [1, 3, 2])
checks += 1
// N5. The drawer difference is counted MINUS EXPECTED, and expected is the
// server's one reconciliation (opening + cash sales − refunds − expenses −
// courier). "counted − opening float" was never the shortage a cashier is
// asked about: on a normal trading day with $40 of cash sales it reports a
// $3.25 surplus for a drawer that is $28 short. The client reads the server
// figure and never recomputes it -- a second implementation here is exactly
// how the app and the Telegram report would come to disagree about one drawer.
const reconciled: ShiftReconciliation = {
  opening: { usd: 10.25, khr: 100_000 },
  cash_sales: { usd: 40, khr: 0 },
  refunds: { usd: 5, khr: 0 },
  expenses: { usd: 1.75, khr: 20_000 },
  courier: { usd: 2, khr: 0 },
  expected: { usd: 41.5, khr: 80_000 },
  counted: { usd: 13.5, khr: 135_000 },
  difference: { usd: -28, khr: 55_000 },
  needs_review: false,
  review_codes: [],
}
const closedRow = fixture(2, '2026-09-05', '2026-09-05T03:00:00.000Z', '2026-09-05T09:00:00.000Z')
// The old formula, run on this very row: 13.50 counted minus a 10.25 float
// is a $3.25 SURPLUS, where the reconciled drawer is $28 SHORT. Both cannot
// be put in front of a cashier, so the client-side subtraction was deleted
// rather than repointed -- nothing here recomputes what the server settled.
const openingFloatFormula = Number((closedRow.closing_counted_usd! - closedRow.opening_float_usd).toFixed(2))
assert.equal(openingFloatFormula, 3.25)
assert.notEqual(openingFloatFormula, reconciled.difference.usd)
assert.deepEqual(reconciled.difference, { usd: -28, khr: 55_000 })
ok(!/shiftCashDifference\(/.test(transport),
  'the transport reads the server difference and computes no drawer figure of its own')
checks += 3
assert.equal(shiftLocalDateTimeToIso('2026-09-04T22:30'), '2026-09-04T15:30:00.000Z')
checks += 1
assert.throws(() => shiftLocalDateTimeToIso(''), /required/i)
checks += 1
assert.equal(parseShiftCount('0'), 0)
assert.equal(parseShiftCount('12.50'), 12.5)
assert.equal(parseShiftCount(''), null)
assert.equal(parseShiftCount('not-a-count'), null)
assert.equal(parseShiftCount(Number.POSITIVE_INFINITY), null)
assert.equal(parseShiftCount(-1), null)
assert.equal(parseShiftCount(false), null)
checks += 7

for (const capability of ['can_edit', 'can_close', 'can_reopen', 'can_cancel']) {
  ok(new RegExp(`${capability}: boolean`).test(transport), `Shift consumes server ${capability}`)
}
ok(/POST', `\/api\/shifts\/\$\{id\}\/close`/.test(transport), 'transport closes a selected historical shift by exact id')
ok(/expected_revision: input\.expectedRevision/.test(transport), 'selected close/reopen writes send the loaded revision')
const amendTransport = transport.slice(transport.indexOf('export async function amendShift'), transport.indexOf('export type CloseShiftByIdInput'))
ok(/expected_revision: input\.expectedRevision/.test(amendTransport), 'actual amend transport sends the caller-captured revision')
ok(/closed_at: input\.closedAt/.test(transport), 'historical close sends an explicit ISO timestamp')
ok(/POST', `\/api\/shifts\/\$\{id\}\/reopen`/.test(transport), 'transport reopens through the linked-segment endpoint')
ok(/reason: input\.reason/.test(transport.slice(transport.indexOf('export async function reopenShift'))), 'reopen sends a mandatory reason')
const cancelTransport = transport.slice(transport.indexOf('export async function cancelShift'))
ok(/POST', `\/api\/shifts\/\$\{id\}\/cancel`/.test(cancelTransport), 'transport soft-cancels the selected shift by exact id')
ok(/expected_revision: expectedRevision/.test(cancelTransport) && /reason,/.test(cancelTransport), 'cancel sends only revision and the required reason')
ok(!/closing_counted|opening_float|closed_at/.test(cancelTransport), 'cancel never sends fake cash counts or a fabricated close time')

ok(/<ShiftHistoryModal/.test(panel) && !/<Modal\b/.test(panel), 'compatibility panel is only a popup launcher, never an inline list or nested modal')
ok((modal.match(/<Modal\b/g) || []).length === 1, 'one Modal owns both list and detail panes')
ok(/selected \? \(/.test(modal) && /setSelected\(null\)/.test(modal), 'row click and Back switch panes inside that same modal')
ok(/max-h-\[min\(65vh,38rem\)\][^"\n]*overflow-y-auto/.test(modal), 'the history list is compact and independently scrollable')
ok(/orderShiftRows\(result\.shifts\)/.test(modal), 'the popup keeps unresolved historical open shifts ahead of closed rows')

const dateIndex = summary.indexOf('fmtDateOnly(shift.business_date)')
const idIndex = summary.indexOf('{shift.shift_code}')
ok(dateIndex >= 0 && idIndex > dateIndex, 'every row leads with date and appends the compact shift id inline')
for (const token of ['fmtClock24(shift.opened_at)', "fmtClock24(shift.closed_at)", 'shift.user_name', 'opening_float_usd', 'opening_float_khr', 'closing_counted_usd', 'closing_counted_khr']) {
  ok(summary.includes(token), `default row renders ${token}`)
}
ok(/<ShiftCashBreakdown/.test(summary) && /shift\.reconciliation/.test(summary), 'detail renders the server reconciliation, never a locally recomputed difference')
ok(!/shiftCashDifference/.test(summary), 'the summary no longer subtracts the opening float to invent a difference')
for (const key of ['shift_recon_opening', 'shift_recon_cash_sales', 'refunds', 'fees', 'courier', 'shift_recon_expected', 'shift_recon_counted', 'shift_difference']) {
  ok(breakdown.includes(`'${key}'`), `the breakdown carries the ${key} row`)
}
ok(/shift_difference_hint/.test(breakdown) && /shift_recon_review/.test(breakdown), 'the breakdown explains expected and surfaces the server review flag')
ok(/detail \? \(/.test(summary) && /shift_duration/.test(summary) && /shift_cash_breakdown/.test(summary), 'duration and cash breakdown stay in detail rather than the default row')

for (const capability of ['can_edit', 'can_close', 'can_reopen', 'can_cancel']) {
  ok(modal.includes(`selected.capabilities.${capability}`), `detail action visibility comes from ${capability}`)
}
ok(!/hasPermission|canManage/.test(modal), 'the shift popup never derives actions from Settings permission')
ok(/expectedRevision: shift\.revision/.test(modal) && /expectedRevision: edit\.expectedRevision/.test(modal), 'the amend draft captures and submits the row revision without a pre-submit refresh')
// 2026-09-06: blank is 0 through the shared shiftCountOrZero rule (executed
// in tests/shiftGateUx.test.ts); an INVALID count is still never coerced.
ok(/shiftCountOrZero\(edit\.openingUsd\)/.test(modal) && !/Number\((?:edit|close|reopen)\.[^)]+\) \|\| 0/.test(modal), 'amend/close/reopen forms record a blank count as 0 through the shared rule and never coerce an invalid one')
ok(/useState<CloseDraft>\(blankClose\)/.test(modal) && /required value=\{close\.closedAt\}/.test(modal), 'historic close starts without a guessed timestamp and requires user entry')
ok(/shiftLocalDateTimeToIso\(close\.closedAt\)/.test(modal), 'entered historical close time is converted from Phnom Penh wall time to explicit ISO')
ok(/row\.id !== result\.shift\.id/.test(modal) && /setSelected\(result\.shift\)/.test(modal), 'reopen adds the linked child without replacing the preserved parent')
ok((modal.match(/await refreshDetails\(result\.shift\)/g) || []).length >= 4 && !/setAmendments\(\[\]\)[\s\S]{0,180}shift_reopen_saved/.test(modal), 'all lifecycle saves reload amendments, including close and reopen')
ok(/amendmentFields\.filter/.test(modal) && /before\[field\].*after\[field\]/.test(modal), 'amendment detail renders whitelisted before-to-after field changes')
ok(/selected\.capabilities\.can_cancel/.test(modal) && /maxLength=\{500\}/.test(modal), 'only the server can_cancel capability reveals the bounded reason form')
ok(/cancelShift\(selected\.id, selected\.revision, cancelReason\.trim\(\)\)/.test(modal), 'cancel submits the selected revision and required reason without replacement values')
ok(/refreshMountedShiftState\(\)/.test(modal) && /SHIFT_STATE_CHANGED_EVENT/.test(modal), 'popup lifecycle writes refresh mounted current-shift consumers')
ok(/status\?\: unknown[\s\S]{0,160}=== 409/.test(modal) && /detailsError[\s\S]{0,500}t\('refresh'\)/.test(modal), 'a stale write exposes an explicit detail reload path')
ok(/shift\.cancelled_at/.test(summary) && /shift_cancel_preserved_hint/.test(summary), 'cancelled detail is labelled closed out and keeps recorded facts visible')

ok(/branchId=\{branchId\}/.test(currentSummary) && !/setShowHistory|aria-expanded/.test(currentSummary), 'transaction pages launch floating history with their operational branch and never expand inline')
for (const [surface, source] of [['Sales', sales], ['Expenses', fees], ['Income', reports]] as const) {
  ok(/<CurrentShiftSummary\b/.test(source), `${surface} retains the shared shift launcher surface`)
}
ok(/<ShiftHistoryPanel branchId=\{primaryBranchFilterId\} compact label=\{t\('shift_code'\)\}/.test(pos), 'POS has a persistent branch-scoped Shift button')
ok(/layer="nested"/.test(profile), 'Profile opens the shared shift popup above its parent modal')
ok(/userId=\{currentUserId\}/.test(profile) && !/canManage=\{hasPermission/.test(profile), 'Profile shows the signed-in user while actions still come only from server capabilities')
ok(!/ShiftHistoryPanel|Shift history/.test(settings), 'Settings contains no shift-history import or mount')
ok(/<ShiftHistoryPanel userId=\{user\.id\}/.test(users), 'each Users row/card opens that user’s own shift history')
ok(/<CurrentShiftSummary showHistory=\{false\}/.test(reports) && /<ShiftHistoryPanel compact limit=\{50\}/.test(reports), 'Reports has one dedicated shift-history section without a duplicate launcher')

// O8. The POS End shift chain: the button calls the transport, the transport
// posts to the close route, and the dialog shows the server's breakdown. The
// route half is proved against a real database in
// cloudflare/scripts/test-shift-close-chain-pure.cjs.
ok(/onClick=\{\(\) => void submitClose\(\)\}/.test(gate) && /await closeShift\(\{/.test(gate),
  'the End shift button submits through the close transport, not a local state flip')
ok(/POST', '\/api\/shifts\/close'/.test(transport), 'the close transport posts to the shift close route')
ok(/publish\(next\)/.test(gate) && /if \(next\.shift\) setClosed\(next\.shift\)/.test(gate),
  'the closed row the server returned is what the summary renders')
ok(/<ShiftCashBreakdown reconciliation=\{shift\.reconciliation\}/.test(gate),
  'the close dialog shows the server drawer breakdown before and after the close')
// One close affordance: the Modal header X. "Back" and "Done" were a second
// and a third control doing exactly what it already does.
ok(!/t\('back'\)/.test(gate) && !/t\('done'\)/.test(gate),
  'the end-shift modal has one close affordance, and its footer only writes')
ok(!/onClick=\{dismiss\}/.test(gate) && /onClose=\{dismiss\}/.test(gate),
  'dismissal happens through the modal header alone')

const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
const usedShiftKeys = [...new Set([...`${modal}\n${summary}`.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]).filter((key) => key.startsWith('shift_')))]
ok(usedShiftKeys.every((key) => key in en), 'every popup shift key exists in English')
ok(usedShiftKeys.every((key) => key in km), 'every popup shift key exists in Khmer')
const breakdownKeys = [...new Set([...breakdown.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]))]
  .concat([...breakdown.matchAll(/: '([a-z_]+)',$/gm)].map((match) => match[1]))
ok(breakdownKeys.length >= 12, `expected the breakdown to name its rows through the pack, found ${breakdownKeys.length}`)
ok(breakdownKeys.every((key) => key in en), `breakdown keys missing from English: ${breakdownKeys.filter((key) => !(key in en)).join(', ')}`)
ok(breakdownKeys.every((key) => key in km), `breakdown keys missing from Khmer: ${breakdownKeys.filter((key) => !(key in km)).join(', ')}`)
ok(/expected drawer/i.test(en.shift_difference_hint) && !/opening cash\./i.test(en.shift_difference_hint),
  'the difference hint explains the expected drawer, not the old opening-float subtraction')

// Execute the real transport against a deterministic fetch boundary. The
// server revision advances only on successful writes, so the middle request
// proves a stale draft reaches the server with its original revision and is
// rejected instead of silently overwriting the first change.
const originalFetch = globalThis.fetch
const originalServerUrl = getSyncServerUrl()
const transportCalls: Array<{ url: string; body: Record<string, unknown> }> = []
let serverRevision = 4
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
  transportCalls.push({ url: String(input), body })
  if (String(input).endsWith('/api/shifts/close')) {
    return new Response(JSON.stringify({
      shift: { ...fixture(17, '2026-09-05', '2026-09-05T01:00:00.000Z', '2026-09-05T09:00:00.000Z'), reconciliation: reconciled },
      policy: { scope_mode: 'per_account', admin_exempt: true },
      exempt: false, needs_registration: false, is_open: false, can_end: false, already_closed: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (body.expected_revision !== serverRevision) {
    return new Response(JSON.stringify({ error: 'Shift changed concurrently. Reload and try again.', code: 'write_conflict', entity: 'shift_session' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  serverRevision += 1
  return new Response(JSON.stringify({
    shift: { ...fixture(17, '2026-09-05', '2026-09-05T01:00:00.000Z', '2026-09-05T09:00:00.000Z'), revision: serverRevision },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch

const amendInput: AmendShiftInput = {
  expectedRevision: 4,
  reason: 'Correct count',
  openedAt: '2026-09-05T01:00:00.000Z',
  openingFloatUsd: 10,
  openingFloatKhr: 40_000,
  openingNote: null,
  closedAt: '2026-09-05T09:00:00.000Z',
  closingCountedUsd: 15,
  closingCountedKhr: 60_000,
  closingNote: null,
}

try {
  __resetApiHealthForTests()
  __resetApiWriteDedupeForTests()
  setSyncServerUrl('https://sync.example.test')

  const firstAmend = await amendShift(17, amendInput)
  assert.equal(firstAmend.shift.revision, 5)
  await assert.rejects(() => amendShift(17, amendInput), /changed concurrently/i)
  const latestAmend = await amendShift(17, { ...amendInput, expectedRevision: 5, reason: 'Second correction' })
  assert.equal(latestAmend.shift.revision, 6)
  assert.deepEqual(transportCalls.map((call) => call.body.expected_revision), [4, 4, 5])
  checks += 4

  // The close transport, driven for real: it must POST to the shift close
  // route and hand back the server's reconciliation untouched.
  const closeState = await closeShift({ branchId: 2, closingCountedUsd: 13.5, closingCountedKhr: 135_000 })
  const closeCall = transportCalls[transportCalls.length - 1]
  assert.ok(closeCall.url.endsWith('/api/shifts/close'), `close posted to ${closeCall.url}`)
  assert.deepEqual(closeCall.body, {
    branch_id: 2, closing_counted_usd: 13.5, closing_counted_khr: 135_000, closing_note: null,
  })
  assert.deepEqual(closeState.shift?.reconciliation, reconciled)
  assert.deepEqual(closeState.shift?.reconciliation?.difference, { usd: -28, khr: 55_000 })
  checks += 4

  const callsBeforeInvalidCounts = transportCalls.length
  await assert.rejects(
    () => amendShift(17, { ...amendInput, expectedRevision: 6, openingFloatUsd: '' as unknown as number }),
    /Opening USD count must be an explicit non-negative number/,
  )
  await assert.rejects(
    () => closeShiftById(17, { expectedRevision: 6, closedAt: amendInput.closedAt!, closingCountedUsd: '' as unknown as number, closingCountedKhr: 1 }),
    /Closing USD count must be an explicit non-negative number/,
  )
  await assert.rejects(
    () => closeShiftById(17, { expectedRevision: 6, closedAt: amendInput.closedAt!, closingCountedUsd: 1, closingCountedKhr: Number.NaN }),
    /Closing KHR count must be an explicit non-negative number/,
  )
  await assert.rejects(
    () => reopenShift(17, { expectedRevision: 6, reason: 'Try again', openingFloatUsd: -1, openingFloatKhr: 0 }),
    /Opening USD count must be an explicit non-negative number/,
  )
  assert.equal(transportCalls.length, callsBeforeInvalidCounts, 'invalid counts must fail before fetch')
  checks += 5
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl(originalServerUrl)
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
}

console.log(`shiftManagement: all ${checks} checks passed`)
