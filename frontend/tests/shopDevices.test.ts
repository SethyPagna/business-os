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
assert.match(transport, /\/mark-shop`, \{ label \}/, 'mark sends the name to the approved device row')
assert.match(transport, /\/api\/auth\/devices\/shop\/\$\{encodeURIComponent\(String\(shopId\)\)\}\/unmark/, 'unmark names the shop row')
const shopTransport = transport.slice(transport.indexOf('export type ShopDeviceRecord'), transport.indexOf('// Reset only removes'))
assert.doesNotMatch(shopTransport, /route\(|queue|outbox/i, 'shop calls stay outside offline replay')

assert.match(panel, /const confirmed = await askToConfirm\(\{[\s\S]*?'shop_device_mark_confirm'[\s\S]*?\}\)\s*if \(!confirmed\) return\s*void runOnlineAction\('device', device\.id, \(\) => markShopDevice\(device\.id, label\)/, 'marking needs the review dialog, then one online call')
assert.match(panel, /const confirmed = await askToConfirm\(\{[\s\S]*?'shop_device_unmark_confirm'[\s\S]*?danger: true,\s*\}\)\s*if \(!confirmed\) return\s*void runOnlineAction\('device', -shop\.id, \(\) => unmarkShopDevice\(shop\.id\)/, 'unmarking is a danger confirmation, then one online call')
assert.doesNotMatch(panel, /window\.confirm\(/, 'never the native popup')
assert.match(panel, /shopDeviceIds\.has\(device\.device_id\)/, 'an already marked device shows its badge instead of the mark button')
assert.match(panel, /disabled=\{!markingShop\.label\.trim\(\)\}/, 'a name is required before review')
assert.match(panel, /maxLength=\{SHOP_LABEL_MAX\}/, 'the name is capped like the Worker')
assert.match(panel, /const SHOP_LABEL_MAX = 60/, 'cap matches the Worker (60)')
assert.match(panel, /code === 'shop_device_exists'[\s\S]*?code === 'shop_label_invalid'/, 'Worker refusals are translated by machine code')

assert.equal(panel.split("setMarkingShop({ device, label: '' })").length - 1, 2, 'a pending request and an approved device both offer the shop button')
assert.match(en.shop_device_mark_confirm, /device slot/i, 'the mark dialog says no slot is used')
assert.match(en.shop_device_mark_confirm, /waiting for this device are removed/i, 'the mark dialog says waiting requests are removed')
assert.match(en.shop_device_mark_confirm, /individual employees/i, 'the mark dialog says individual approvals are replaced')
assert.match(panel, /markShopDevice[(]device[.]id, label[)]/, 'the same call serves both rows')

assert.match(panel, /shop[.]last_seen_at [?] [(]/, 'the list shows where and when a shop device was last used')

const keys = [
  'shop_device', 'shop_devices', 'shop_devices_intro', 'no_shop_devices', 'shop_device_mark', 'shop_device_mark_title', 'shop_device_mark_confirm',
  'shop_device_name', 'shop_device_name_placeholder', 'shop_device_continue', 'shop_device_marked_done', 'shop_device_marked_by', 'shop_device_unmark',
  'shop_device_unmark_title', 'shop_device_unmark_confirm', 'shop_device_unmarked_done', 'shop_device_exists', 'shop_device_conflict', 'shop_label_invalid',
]
for (const key of keys) {
  assert.ok(en[key] && km[key], `both packs carry ${key}`)
  assert.notEqual(en[key], km[key], `Khmer ${key} is not the English copied`)
  assert.match(km[key], /[ក-៿]/, `Khmer ${key} is in Khmer script`)
}
const used = new Set([...panel.matchAll(/tr\(t, '(shop_[a-z_]+|no_shop_devices)'/g)].map((m) => m[1]))
for (const key of used) assert.ok(keys.includes(key), `the panel's ${key} is in the key list under test`)
assert.match(en.shop_device_unmark_confirm, /signed out/i, 'the unmark warning says employees are signed out')

console.log('PASS shop devices panel: review dialogs, online-only calls, name cap, bilingual copy')
