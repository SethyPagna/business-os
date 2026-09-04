import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
const transport = read('src/api/shiftTransport.ts')
const settings = read('src/components/utils-settings/Settings.tsx')
const profile = read('src/components/users/UserProfileModal.tsx')
const history = read('src/components/shifts/ShiftHistoryPanel.tsx')
const summary = read('src/components/shifts/ShiftSummary.tsx')
const currentSummary = read('src/components/shifts/CurrentShiftSummary.tsx')
const gate = read('src/components/pos/ShiftGate.tsx')
const sales = read('src/components/sales/Sales.tsx')
const fees = read('src/components/fees/FeesPage.tsx')
const reports = read('src/components/sales/ReportsHub.tsx')
const pos = read('src/components/pos/POS.tsx')

let checks = 0
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks += 1 }

ok(/shift_scope_mode/.test(settings) && /per_account/.test(settings) && /shop_wide/.test(settings), 'Settings exposes both server-supported scope modes')
ok(/shift_admin_exempt/.test(settings), 'Settings exposes the administrator exemption')
ok(/getPermissionTier\('settings'\) === 'full'/.test(settings), 'the existing full-settings permission still gates saves')
ok(/<ShiftHistoryPanel canManage/.test(settings), 'authorized Settings users receive shop shift history and amendment UI')

ok(/GET', `\/api\/shifts\$\{query\}`/.test(transport), 'transport lists shifts through the authorized history route')
ok(/GET', `\/api\/shifts\/\$\{id\}\/history`/.test(transport), 'transport reads append-only amendment history')
ok(/PATCH', `\/api\/shifts\/\$\{id\}`/.test(transport), 'transport amends through the manager-only route')
ok(/reason: input\.reason/.test(transport), 'every amendment sends its required reason')
ok(/null,\s*true,/.test(transport.slice(transport.indexOf('export async function amendShift'))), 'amendment writes have no offline fallback')

ok(/userId=\{currentUserId\}/.test(profile), 'Profile requests only the signed-in user’s shift rows')
ok(/activeSection === 'shifts'/.test(profile), 'Profile has a dedicated shift summary section')
ok(/hasPermission\('settings'\) \|\| hasPermission\('all'\)/.test(profile), 'Profile only offers amendment controls to server-authorized managers')

ok(/intentionally excludes opening\/closing cash, costs, profit and notes/.test(summary), 'reusable summary documents its non-sensitive boundary')
for (const forbidden of ['opening_float_usd', 'opening_float_khr', 'closing_counted_usd', 'closing_counted_khr', 'cost', 'profit', 'opening_note', 'closing_note']) {
  ok(!summary.includes(`shift.${forbidden}`), `summary does not render sensitive field ${forbidden}`)
}
ok(/Cashier/.test(summary) && /Opened/.test(summary) && /Closed/.test(summary) && /Duration/.test(summary), 'summary renders useful non-sensitive shift facts')
ok(/canManage \?/.test(history), 'amendment form is hidden from ordinary history viewers')
ok(/shift_no_amendments/.test(history), 'history translates its immutable-ledger empty state')
ok(/JSON.stringify\(draft\) !== JSON.stringify\(initialDraft\(selected\)\)/.test(history), 'every draft field participates in unsaved-change protection')
ok(/requestId === detailsRequest.current/.test(history) && /requestId === listRequest.current/.test(history), 'list and detail responses reject superseded requests')
ok(/fieldset disabled=\{saving \|\| detailsLoading \|\| !!detailsError\}/.test(history), 'pending or failed history reads cannot overwrite editable fields')
ok(history.indexOf("notify?.(t('shift_amend_saved')") < history.indexOf('const history = await fetchShiftHistory(result.shift.id)'), 'saved state is acknowledged before the optional history refresh')

ok(/export function useSharedShift/.test(gate), 'transaction pages reuse the live POS shift state')
ok(!/publishShift\(shiftCacheKey\(userId, null, scopeMode\), next\)/.test(gate), 'a branch-specific write never aliases the unassigned branch')
ok(/state: loadedKey === key \? state : null/.test(gate), 'a changed scope cannot render the previous branch row before effects')
ok(/sessionStorage\.getItem\('pos_branch'\)/.test(currentSummary), 'current summary follows the operational POS branch rather than report filters')
ok(/SHIFT_BRANCH_CHANGED_EVENT/.test(pos) && /addEventListener\(SHIFT_BRANCH_CHANGED_EVENT/.test(currentSummary), 'current summaries follow POS branch changes without a remount')
ok(/useSharedShift\(branchId, user\?\.id, settings\?\.shift_scope_mode\)/.test(currentSummary), 'current summary partitions shift state by branch, user, and policy')
ok(/shift_current_unavailable/.test(currentSummary) && /onClick=\{\(\) => void refresh\(\)\}/.test(currentSummary), 'failed current-shift reads remain visible and retryable')
ok(/showHistory \? <ShiftHistoryPanel/.test(currentSummary) && /aria-expanded=\{showHistory\}/.test(currentSummary), 'transaction pages expose lazy shift history, including when no current shift exists')
ok(!/ShiftHistoryPanel[^>]*canManage/.test(currentSummary), 'transaction history never exposes cash amendment controls')
for (const [surface, source] of [['Sales', sales], ['Expenses', fees], ['Income', reports]] as const) {
  ok(/<CurrentShiftSummary\b/.test(source), `${surface} mounts the shared current-shift summary`)
}
ok(!/CurrentShiftSummary branchId=\{branchFilter\}/.test(fees) && !/CurrentShiftSummary branchId=\{branchFilter\}/.test(reports), 'historical report filters never redefine the operational shift')

console.log(`shiftManagement: all ${checks} checks passed`)
