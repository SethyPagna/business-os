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

// Replace flow: at the cap Approve opens a chooser (least recently seen pre-selected) and the swap is one online call.
assert.match(transport, /approve-replacing`, \{ revokeId: Number\(revokeId\)/, 'replace uses the one atomic Worker route')
const replaceTransport = transport.slice(transport.indexOf('export function approveDeviceReplacing'), transport.indexOf('export function rejectDevice'))
assert.doesNotMatch(replaceTransport, /route\(|queue|outbox/i, 'replace stays outside offline replay')
assert.match(panel, /deviceLimit && choices\.length >= deviceLimit\) \{\s*setReplacing\(\{ device, choices, selectedId: choices\[0\]\.id, confirmShared: knownShared \}\)/, 'an account at the cap opens the chooser instead of a refused approve')
assert.match(panel, /\.sort\(\(a, b\) => String\(a\.last_seen_at \|\| ''\)\.localeCompare\(String\(b\.last_seen_at \|\| ''\)\)\)/, 'choices are ordered least recently seen first, so the first is pre-selected')
assert.match(panel, /withSharedConfirm\(device, false, \(confirmed\) => approveDeviceReplacing\(device\.id, selectedId, confirmed\), \{ confirmed: confirmShared === true \}\)/, 'confirming sends the chosen device')
assert.doesNotMatch(panel, /window\.confirm\(/)
for (const key of ['device_replace_title', 'device_replace_intro', 'device_replace_new', 'device_replace_remove', 'device_replace_least_recent', 'device_replace_confirm', 'device_replace_done', 'device_replace_conflict', 'device_replace_invalid']) {
  assert.ok(en[key] && km[key], `both packs carry ${key}`)
  assert.notEqual(en[key], km[key], `Khmer ${key} is not the English copied`)
}

// L2 (review, 12 Nov 2026): a plain approve refused with device_limit_reached (stale page) reads that account's devices fresh and opens the chooser.
assert.match(panel, /errorCode[(]err[)] !== 'device_limit_reached'\) return false\s*const fresh = await getAllDevices\(device\.user_id\)/, 'the cap refusal triggers a fresh read of that account')
assert.match(panel, /setReplacing\(\{ device, choices: accountChoices, selectedId: accountChoices\[0\]\.id, confirmShared: confirmedNow \}\)\s*return true/, 'and opens the replace chooser')
assert.match(panel, /const handled = onError \? await onError\(err\)\.catch\(\(\) => false\) : false\s*if \(!handled/, 'a handled refusal shows no error toast')

// L4 (review, 13 Nov 2026): a pending request that claimed an approved device's id says so, in both packs.
assert.ok(panel.includes('device.claimed_approval_ref ? ('), 'the panel warns when a request claimed an approved device')
assert.ok(transport.includes('claimed_approval_ref?: number | null'), 'the record carries the claimed row id')
assert.ok(en.device_claimed_id && km.device_claimed_id && en.device_claimed_id !== km.device_claimed_id, 'both packs carry device_claimed_id, Khmer not copied')
assert.match(km.device_claimed_id, /[ក-៿]/, 'in Khmer script')

// L-4 (review round 3, 13 Nov 2026): a request that claims another device's id cannot be marked as a shop device from the panel, and the warning has no jargon.
assert.ok(panel.includes('{device.claimed_approval_ref ? null : ('), 'the shop button is hidden on a request flagged as claiming an approved device')
assert.ok(!/\b(id|cookie)\b/i.test(en.device_claimed_id), 'the English warning says no "id" or "cookie"')
assert.ok(!/ខូគី|\bID\b/i.test(km.device_claimed_id), 'nor the Khmer one')
for (const key of ['shop_device_held', 'shop_device_claimed']) {
  assert.ok(en[key] && km[key] && en[key] !== km[key] && /[ក-៿]/.test(km[key]), `both packs carry ${key}, Khmer in Khmer script`)
}
assert.ok(panel.includes("code === 'shop_device_held'"), 'the server refusal to mark a copied id is explained, not shown as a bare error')
assert.ok(panel.includes("code === 'shop_device_claimed'"), 'the server refusal to mark a request that claims an approved device is explained too (N-3)')

// N-5 (review round 4): the refusal shown on Approve for a retired id does not steer an administrator who wants a personal approval towards the shop button.
for (const [lang, pack] of [['en', en], ['km', km]] as const) {
  const text = pack.shop_device_retired
  assert.ok(text, `${lang} carries shop_device_retired`)
  if (lang === 'en') assert.ok(!/\bmark\b|\bid\b|cookie|phone/i.test(text), 'neutral English: no "mark", "id", "cookie" or phone wording')
  else assert.ok(!text.includes('កំណត់') && !/ខូគី|\bID\b/i.test(text), 'neutral Khmer: no "mark" verb, cookie or ID')
}

// P-1 (review round 5): the card says when another account already has the device.
assert.ok(panel.includes('device.shared_with && device.shared_with.length > 0'), 'the panel shows the other accounts on the same device')
assert.ok(transport.includes('shared_with?:'), 'the record carries shared_with')
for (const key of ['device_also_here']) assert.ok(en[key] && km[key] && en[key] !== km[key] && /[ក-៿]/.test(km[key]), `both packs carry ${key}`)

// P-1 (review round 5): approving, replacing or marking a device another account has goes through the shared confirm dialog and sends confirmShared.
assert.ok(panel.includes('if (knownShared && !(await confirmSharedDevice(sharedNames(device), false))) return'), 'Approve asks first when the card lists another account')
assert.ok(panel.includes("errorCode(err) !== 'device_shared_confirm'"), 'a stale list is answered by asking, not by a bare error')
assert.ok(!panel.includes("confirmSharedDevice('', "), 'the confirm never names nobody: the names come from the card or from a fresh read')
assert.ok(transport.includes('{ confirmShared: true }') && transport.includes('confirmShared = false'), 'the transport sends confirmShared only when confirmed')
assert.ok(!/(^|[^A-Za-z.])confirm\(/.test(panel), 'never the native confirm()')
for (const key of ['device_shared_title', 'device_shared_confirm', 'shop_device_shared_confirm']) {
  assert.ok(en[key] && km[key] && en[key] !== km[key] && /[ក-៿]/.test(km[key]), `both packs carry ${key}`)
  assert.ok(!/\b(id|cookie)\b|phone/i.test(en[key]), `${key}: no jargon`)
}

console.log('PASS device re-approval reset transport, history placement, confirmation, and bilingual copy')
