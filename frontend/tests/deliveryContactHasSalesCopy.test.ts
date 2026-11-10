import assert from 'node:assert/strict'
import fs from 'node:fs'

// The delivery-person delete refusal points at the real merge screen: the Contacts tab labelled by
// possible_duplicates ("Conflicts" / Khmer ទំនាស់ទិន្នន័យ), never a screen name that does not exist.
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

for (const [name, pack] of [['en', en], ['km', km]] as const) {
  const label = pack.possible_duplicates
  const text = pack.delivery_contact_has_sales
  assert.ok(label && text, `${name}: both keys exist`)
  assert.ok(text.includes(label), `${name}: the refusal names the tab label "${label}"`)
  assert.ok(!/Possible Duplicates|ស្ទួនដែលអាចកើតមាន/.test(text), `${name}: no stale tab name`)
}
assert.ok(/\p{Script=Khmer}/u.test(km.delivery_contact_has_sales), 'km is real Khmer')
console.log('deliveryContactHasSalesCopy: ok')

// The reset confirmation must not promise a full wipe: drivers a sale or fee names stay.
const resetSource = fs.readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')
for (const [name, pack] of [['en', en], ['km', km]] as const) {
  assert.ok(!/\ball\b/i.test(pack.reset_delivery_contacts_desc) || name === 'km', 'en: the description does not say "all"')
  assert.ok(!/^All delivery contacts$/.test(pack.reset_delivery_contacts_deleted), `${name}: not the old "All delivery contacts" line`)
}
assert.ok(/no sale or fee names/.test(en.reset_delivery_contacts_desc) && /stay/.test(en.reset_delivery_contacts_desc), 'en desc says named drivers stay')
assert.ok(!/ទាំងអស់/.test(km.reset_delivery_contacts_desc) && !/ទាំងអស់/.test(km.reset_delivery_contacts_deleted), 'km does not say "all"')
assert.ok(resetSource.includes(`T('reset_delivery_contacts_desc', '${en.reset_delivery_contacts_desc}')`), 'the fallback matches en desc')
assert.ok(resetSource.includes(`T('reset_delivery_contacts_deleted', '${en.reset_delivery_contacts_deleted}')`), 'the fallback matches en deleted line')
assert.ok(!resetSource.includes('Deletes all delivery contacts'), 'no stale fallback')
console.log('deliveryContactHasSalesCopy reset copy: ok')
