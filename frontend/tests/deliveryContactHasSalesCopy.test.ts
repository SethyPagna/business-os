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
