import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  addressPrefixBeforePreset,
  cartTotalQuantity,
  composeAddress,
  normalizeAddressPresets,
  validateAddressPresets,
} from '../src/utils/addressPresets.ts'
import {
  normalizeAddressPresets as normalizeWorkerAddressPresets,
  validateAddressPresets as validateWorkerAddressPresets,
} from '../../cloudflare/src/lib/addressPresets.ts'

const pos = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
const picker = readFileSync(new URL('../src/components/pos/AddressPresetPicker.tsx', import.meta.url), 'utf8')
const transport = readFileSync(new URL('../src/api/posAddressPresetsTransport.ts', import.meta.url), 'utf8')
const settingsSensitive = readFileSync(new URL('../../cloudflare/src/lib/settingsSensitive.ts', import.meta.url), 'utf8')

const raw = {
  province: [' Phnom Penh ', 'phnom   penh', 'Kandal'],
  district: ['Chamkar Mon'],
  subdistrict: [' Tonle Bassac '],
}
assert.deepEqual(normalizeAddressPresets(raw), normalizeWorkerAddressPresets(raw), 'frontend and Worker normalization must match')
assert.deepEqual(validateAddressPresets(raw), validateWorkerAddressPresets(raw), 'frontend and Worker validation must match')
assert.deepEqual(normalizeAddressPresets(raw), {
  province: ['Phnom Penh', 'Kandal'],
  district: ['Chamkar Mon'],
  subdistrict: ['Tonle Bassac'],
})

const first = composeAddress('ផ្ទះ 12 ផ្លូវ 3', {
  province: 'ភ្នំពេញ',
  district: 'ខណ្ឌចំការមន',
  subdistrict: 'សង្កាត់ទន្លេបាសាក់',
})
assert.equal(first.address, 'ផ្ទះ 12 ផ្លូវ 3, សង្កាត់ទន្លេបាសាក់, ខណ្ឌចំការមន, ភ្នំពេញ')
assert.equal(addressPrefixBeforePreset(first.address, first.suffix), 'ផ្ទះ 12 ផ្លូវ 3', 'reopening replaces only the exact previously applied suffix')
assert.equal(addressPrefixBeforePreset('House 12, manually changed', first.suffix), 'House 12, manually changed', 'manual free text is never stripped by a stale suffix')
assert.equal(composeAddress('House  12 / Street  3', { province: 'Phnom Penh' }).address, 'House  12 / Street  3, Phnom Penh', 'applying presets retains deliberately typed prefix spacing')

assert.equal(cartTotalQuantity([{ quantity: 2 }, { quantity: '3' }, { quantity: 0.5 }, { quantity: -1 }, { quantity: 'bad' }]), 5.5)
assert.match(pos, /pos_item_line[\s\S]{0,300}pos_item_lines[\s\S]{0,240}pos_total_quantity/, 'singular/plural line count and total quantity share the cart summary row')
assert.match(pos, /cartTotalQuantity\(active\.cart\)/)
assert.match(pos, /pos-customer-address-inline[^]*?onClick=\{\(\) => setShowAddressPresets\(true\)\}/, 'clicking Address opens the picker without removing free-text onChange')
assert.match(pos, /onApply=\{\(\{ address, suffix \}\) => \{[^]*?patchActive\(\{ customer: \{ \.\.\.active\.customer, address \} \}\)/)
assert.match(pos, /actorKey=\{captureActorReadScope\('pos:address-presets'\)\.authority\}/, 'same-account relogin uses the opaque session authority, not an id/org cache key')

assert.match(picker, /captureActorReadScope\('pos:address-presets'\)/)
assert.match(picker, /isActorReadScopeCurrent\(actorScope\)/, 'late reads from an earlier account/session are ignored')
assert.match(picker, /response\.can_manage === true/)
assert.match(picker, /disabled=\{!canManage\}/, 'read-only POS access cannot open management controls')
assert.match(picker, /onApply\(preview\)/, 'selection changes only a preview until explicit Apply')
assert.match(transport, /apiFetch\('GET', '\/api\/pos\/address-presets'\)/)
assert.match(transport, /apiFetch\('PUT', '\/api\/pos\/address-presets'/)
assert.doesNotMatch(transport, /localDb|localStorage|routeMirrored/, 'shared presets never fall back to another actor\'s local cache')
assert.match(settingsSensitive, /'pos_address_presets_v1'/, 'the dedicated row is excluded from broad settings/bootstrap reads')

console.log('PASS POS item quantity and actor-scoped address preset contract')
