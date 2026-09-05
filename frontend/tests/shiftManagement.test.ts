import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { orderShiftRows, shiftCashDifference, shiftLocalDateTimeToIso, type Shift } from '../src/api/shiftTransport.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const transport = read('src/api/shiftTransport.ts')
const settings = read('src/components/utils-settings/Settings.tsx')
const users = read('src/components/users/Users.tsx')
const profile = read('src/components/users/UserProfileModal.tsx')
const panel = read('src/components/shifts/ShiftHistoryPanel.tsx')
const modal = read('src/components/shifts/ShiftHistoryModal.tsx')
const summary = read('src/components/shifts/ShiftSummary.tsx')
const currentSummary = read('src/components/shifts/CurrentShiftSummary.tsx')
const sales = read('src/components/sales/Sales.tsx')
const fees = read('src/components/fees/FeesPage.tsx')
const reports = read('src/components/sales/ReportsHub.tsx')
const pos = read('src/components/pos/POS.tsx')

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
assert.deepEqual(shiftCashDifference(fixture(2, '2026-09-05', '2026-09-05T03:00:00.000Z', '2026-09-05T09:00:00.000Z')), { usd: 3.25, khr: 35_000 })
checks += 1
assert.equal(shiftLocalDateTimeToIso('2026-09-04T22:30'), '2026-09-04T15:30:00.000Z')
checks += 1
assert.throws(() => shiftLocalDateTimeToIso(''), /required/i)
checks += 1

for (const capability of ['can_edit', 'can_close', 'can_reopen', 'can_cancel']) {
  ok(new RegExp(`${capability}: boolean`).test(transport), `Shift consumes server ${capability}`)
}
ok(/POST', `\/api\/shifts\/\$\{id\}\/close`/.test(transport), 'transport closes a selected historical shift by exact id')
ok(/expected_revision: input\.expectedRevision/.test(transport), 'selected close/reopen writes send the loaded revision')
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
ok(/shiftCashDifference\(shift\)/.test(summary), 'detail computes native drawer difference from close minus open')
ok(/shift_difference_hint/.test(summary) && /not profit/.test(summary), 'detail explicitly says the drawer difference is not profit')
ok(/detail \? \(/.test(summary) && /shift_duration/.test(summary) && /shift_cash_breakdown/.test(summary), 'duration and cash breakdown stay in detail rather than the default row')

for (const capability of ['can_edit', 'can_close', 'can_reopen', 'can_cancel']) {
  ok(modal.includes(`selected.capabilities.${capability}`), `detail action visibility comes from ${capability}`)
}
ok(!/hasPermission|canManage/.test(modal), 'the shift popup never derives actions from Settings permission')
ok(/useState<CloseDraft>\(blankClose\)/.test(modal) && /required value=\{close\.closedAt\}/.test(modal), 'historic close starts without a guessed timestamp and requires user entry')
ok(/shiftLocalDateTimeToIso\(close\.closedAt\)/.test(modal), 'entered historical close time is converted from Phnom Penh wall time to explicit ISO')
ok(/row\.id !== result\.shift\.id/.test(modal) && /setSelected\(result\.shift\)/.test(modal), 'reopen adds the linked child without replacing the preserved parent')
ok(/amendmentFields\.filter/.test(modal) && /before\[field\].*after\[field\]/.test(modal), 'amendment detail renders whitelisted before-to-after field changes')
ok(/selected\.capabilities\.can_cancel/.test(modal) && /maxLength=\{500\}/.test(modal), 'only the server can_cancel capability reveals the bounded reason form')
ok(/cancelShift\(selected\.id, selected\.revision, cancelReason\.trim\(\)\)/.test(modal), 'cancel submits the selected revision and required reason without replacement values')
ok(/refreshMountedShiftState\(\)/.test(modal) && /SHIFT_STATE_CHANGED_EVENT/.test(modal), 'popup lifecycle writes refresh mounted current-shift consumers')
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

const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
const usedShiftKeys = [...new Set([...`${modal}\n${summary}`.matchAll(/\bt\('([^']+)'\)/g)].map((match) => match[1]).filter((key) => key.startsWith('shift_')))]
ok(usedShiftKeys.every((key) => key in en), 'every popup shift key exists in English')
ok(usedShiftKeys.every((key) => key in km), 'every popup shift key exists in Khmer')

console.log(`shiftManagement: all ${checks} checks passed`)
