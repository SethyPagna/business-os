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
ok(/No amendments recorded/.test(history), 'history gives a clear immutable-ledger empty state')

console.log(`shiftManagement: all ${checks} checks passed`)
