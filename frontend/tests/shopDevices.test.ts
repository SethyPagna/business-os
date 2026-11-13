// Shop devices (owner 12 Nov 2026) in the device approvals panel: mark an approved device with a name, list, unmark.
// Every change goes through the shared compact review dialog (never native confirm), online only, both packs.
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

assert.match(transport, /apiFetch\('GET', '\/api\/auth\/devices\/shop'\)/, 'the list reads the admin-only shop route')
assert.match(transport, /\/mark-shop`, \{ label[,} ]/, 'mark sends the name to the approved device row')
assert.match(transport, /\/api\/auth\/devices\/shop\/\$\{encodeURIComponent\(String\(shopId\)\)\}\/unmark/, 'unmark names the shop row')
const shopTransport = transport.slice(transport.indexOf('export type ShopDeviceRecord'), transport.indexOf('// Reset only removes'))
assert.doesNotMatch(shopTransport, /route\(|queue|outbox/i, 'shop calls stay outside offline replay')

assert.match(panel, /const confirmed = knownShared\s*\? await confirmSharedDevice\(sharedNames\(device\), true, nameItems\)\s*: await askToConfirm\(\{[\s\S]*?'shop_device_mark_confirm'[\s\S]*?\}\)\s*if \(!confirmed\) return\s*void runOnlineAction\('device', device\.id, withSharedConfirm\(device, true, \(confirmShared\) => markShopDevice\(device\.id, label, confirmShared\), \{ confirmed: knownShared \}\)/, 'marking needs ONE review dialog (the shared-device one when the card already lists another account), then one online call')
assert.match(panel, /const confirmed = await askToConfirm\(\{[\s\S]*?'shop_device_unmark_confirm'[\s\S]*?danger: true,\s*\}\)\s*if \(!confirmed\) return\s*void runOnlineAction\('device', -shop\.id, \(\) => unmarkShopDevice\(shop\.id\)/, 'unmarking is a danger confirmation, then one online call')
assert.doesNotMatch(panel, /window\.confirm\(/, 'never the native popup')
assert.match(panel, /shopDeviceIds\.has\(device\.device_id\)/, 'an already marked device shows its badge instead of the mark button')
assert.match(panel, /disabled=\{!markingShop\.label\.trim\(\)\}/, 'a name is required before review')
assert.match(panel, /maxLength=\{SHOP_LABEL_MAX\}/, 'the name is capped like the Worker')
assert.match(panel, /const SHOP_LABEL_MAX = 60/, 'cap matches the Worker (60)')
assert.match(panel, /code === 'shop_device_exists'[\s\S]*?code === 'shop_label_invalid'/, 'Worker refusals are translated by machine code')

assert.equal(panel.split('onClick={() => pressMarkShop(device)}').length - 1, 2, 'a pending request and an approved device both offer the shop button')
assert.equal(panel.split("setMarkingShop({ device, label: '' })").length - 1, 1, 'and only pressMarkShop opens the naming form')
assert.match(en.shop_device_mark_confirm, /device slot/i, 'the mark dialog says no slot is used')
assert.match(en.shop_device_mark_confirm, /waiting for this device are removed/i, 'the mark dialog says waiting requests are removed')
assert.match(en.shop_device_mark_confirm, /individual employees/i, 'the mark dialog says individual approvals are replaced')
assert.match(panel, /markShopDevice[(]device[.]id, label, confirmShared[)]/, 'the same call serves both rows')

assert.match(panel, /shop[.]last_seen_at [?] [(]/, 'the list shows where and when a shop device was last used')

const keys = [
  'shop_device', 'shop_devices', 'shop_devices_intro', 'no_shop_devices', 'shop_device_mark', 'shop_device_mark_title', 'shop_device_mark_confirm',
  'shop_device_name', 'shop_device_name_placeholder', 'shop_device_continue', 'shop_device_marked_done', 'shop_device_marked_by', 'shop_device_unmark',
  'shop_device_unmark_title', 'shop_device_unmark_confirm', 'shop_device_unmarked_done', 'shop_device_exists', 'shop_device_conflict', 'shop_device_retired', 'shop_device_held', 'shop_device_claimed', 'shop_device_shared_confirm', 'shop_device_unbound', 'shop_device_unbound_pending', 'shop_label_invalid',
]
for (const key of keys) {
  assert.ok(en[key] && km[key], `both packs carry ${key}`)
  assert.notEqual(en[key], km[key], `Khmer ${key} is not the English copied`)
  assert.match(km[key], /[ក-៿]/, `Khmer ${key} is in Khmer script`)
}
const used = new Set([...panel.matchAll(/tr\(t, '(shop_[a-z_]+|no_shop_devices)'/g)].map((m) => m[1]))
for (const key of used) assert.ok(keys.includes(key), `the panel's ${key} is in the key list under test`)
// L-4 (release review): the administrator reads no "cookie" or "id" anywhere in the device and shop device copy, in either language.
for (const [key, text] of [...Object.entries(en), ...Object.entries(km)]) {
  if (!/^(shop_device|device_)/.test(key) || typeof text !== 'string') continue
  assert.doesNotMatch(text, /cookie|\bids?\b|ខូគី/i, `${key} says cookie or id`)
}
// B8 L-d: the panel's fallback text shows if a key is ever missing, so it must be the pack's words, never the old "cookie" wording.
for (const m of panel.matchAll(/tr\(t, '((?:shop_device|device_)[a-z_]*)', '((?:[^'\\]|\\.)*)'/g)) {
  if (typeof en[m[1]] === 'string') assert.equal(m[2], en[m[1]], `the panel fallback for ${m[1]} is the English pack text`)
}
assert.doesNotMatch(panel.replace(/^\s*\/\/.*$/gm, ''), /cookie(?!_bound_at)/i, 'the panel source has no user-facing cookie wording')
assert.match(en.shop_device_unmark_confirm, /signed out/i, 'the unmark warning says employees are signed out')
assert.match(en.shop_device_unmark_confirm, /new identity[^.]*copy of its sign-in stops working/i, 'the unmark warning says the device gets a new identity and a copied sign-in stops')
// M-A (release review): a device whose browser never had the cookie cannot be marked; the buttons are disabled with the reason, and the refusal is translated.
assert.equal((panel.match(/aria-disabled=\{!canMarkShop\(device\)\}/g) || []).length, 2, 'both mark buttons say they are unavailable until the device has had its cookie (its own row or another account on the device); pressing one then explains why')
assert.ok(panel.includes("if (canMarkShop(device)) setMarkingShop({ device, label: '' })"), 'a device that cannot be marked yet opens no naming form')
assert.ok(panel.includes('const canMarkShop = (device: TrustedDeviceRecord) => !heldByApproved(device) && (Boolean(device.cookie_bound_at) || (device.shared_with || []).some((other) => other.bound))'), 'markable means bound through some row on the device and not held by another account approval')
assert.match(panel, /code === 'shop_device_unbound'/, 'the unbound refusal is translated by machine code')
assert.match(panel, /code === 'shop_device_retired'/, 'the retired-id refusal is translated by machine code')

console.log('PASS shop devices panel: review dialogs, online-only calls, name cap, bilingual copy')
