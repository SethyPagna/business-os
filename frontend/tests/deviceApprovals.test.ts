// F63 frontend contract: reset is an explicit online admin action shown only
// in rejected history. It removes a request; it never substitutes for approve.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', 'src', relative), 'utf8')
const transport = read('api/deviceAdminTransport.ts')
const panel = read('components/users/DeviceApprovals.tsx')
const en = JSON.parse(read('lang/en.json')) as Record<string, string>
const km = JSON.parse(read('lang/km.json')) as Record<string, string>

assert.match(transport, /apiFetch\('POST', `\/api\/auth\/devices\/\$\{encodeURIComponent\(String\(id\)\)\}\/reset`, \{\}\)/, 'reset uses the online admin API directly')
const resetTransport = transport.slice(transport.indexOf('export function resetDeviceForReapproval'), transport.indexOf('// ---- Live sessions'))
assert.doesNotMatch(resetTransport, /route\(|queue|outbox/i, 'reset transport remains outside offline replay')
// FX-ui: the explicit confirmation is the shared ConfirmDialog, never window.confirm.
assert.match(panel, /const confirmed = await askToConfirm\(\{[\s\S]*?'device_reapproval_reset_confirm'[\s\S]*?\}\)\s*if \(!confirmed\) return\s*void runAction\(device\.id, 'reset'/, 'reset requires an explicit confirmation')
assert.doesNotMatch(panel, /window\.confirm\(/, 'reset never uses the native confirm popup')
assert.match(panel, /resetDeviceForReapproval\(id\)/, 'reset handler calls only the reset transport')
assert.match(panel, /void runAction\(device\.id, 'reset'/, 'confirmed reset is distinct from approve')
const historyAt = panel.indexOf("'device_rejected_history'")
const resetButtonAt = panel.indexOf("'device_reapproval_reset'")
assert.ok(historyAt >= 0 && resetButtonAt > historyAt, 'reset control appears only in rejected/revoked history')
for (const key of ['device_reapproval_reset', 'device_reapproval_reset_confirm', 'device_reapproval_reset_done']) {
  assert.ok(en[key], `English reset copy exists: ${key}`)
  assert.ok(km[key], `Khmer reset copy exists: ${key}`)
}
assert.match(en.device_reapproval_reset_confirm, /does not approve/i, 'confirmation tells the admin reset is not approval')
assert.match(en.device_reapproval_reset_confirm, /sign in again/i, 'confirmation tells the admin the device must sign in again')

// Cap: the panel shows the Worker's `limit` and never a number of its own; the refusal is translated by its code.
assert.match(transport, /export type DeviceListResponse = \{ devices: TrustedDeviceRecord\[\]; limit\?: number \}/, 'device list responses type the Worker limit')
assert.match(panel, /limit: readLimit\(allRes, pendingRes\)/, 'the snapshot takes the limit from the API responses')
assert.match(panel, /deviceLimit \? `\$\{group\.devices\.length\} \/ \$\{deviceLimit\}`/, 'each account shows n / limit from the response')
assert.doesNotMatch(panel, /\/ 5\b|MAX_APPROVED|limit = 5|=== 5\b/, 'the panel never hard-codes the cap')
assert.match(panel, /code === 'device_limit_reached'[\s\S]*?tr\(t, 'device_limit_reached'/, 'the cap refusal is translated by its machine code')
assert.doesNotMatch(panel, /notify\(err instanceof Error \? err\.message/, 'no raw English Worker message reaches the toast')
for (const key of ['device_limit_reached', 'device_approvals_intro', 'device_approval_pending_desc']) {
  assert.ok(en[key] && km[key], `both packs carry ${key}`)
}
assert.notEqual(km.device_limit_reached, en.device_limit_reached, 'Khmer cap text is not the English copied')
assert.doesNotMatch(en.device_approval_pending_desc + en.device_approvals_intro, /for an admin account|admin account must/i, 'approval copy no longer claims the gate is for admin accounts')

console.log('PASS device re-approval reset transport, history placement, confirmation, and bilingual copy')
