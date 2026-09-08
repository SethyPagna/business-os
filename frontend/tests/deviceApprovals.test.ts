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
assert.match(panel, /window\.confirm\(tr\([\s\S]*?'device_reapproval_reset_confirm'/, 'reset requires an explicit confirmation')
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

console.log('PASS device re-approval reset transport, history placement, confirmation, and bilingual copy')
