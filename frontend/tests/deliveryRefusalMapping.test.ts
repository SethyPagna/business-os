import assert from 'node:assert/strict'
import fs from 'node:fs'
import { deliveryBulkDeleteMessage, isDeliveryHasSalesRefusal, localizeDeliveryHasSalesRefusal } from '../src/components/contacts/deliveryRefusal.ts'

// contact_has_sales (409 from DELETE /api/delivery-contacts/:id) is shown in the user's language on EVERY surface that deletes a delivery
// person: the delete button, undo of an add, redo of a delete, bulk delete and its redo. No surface may surface the server's English text
// or put a hard-coded English prefix in front of the translated sentence.
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const makeTr = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] || fallback

const refusal = Object.assign(new Error('Gone Driver is on 3 sale(s) and 0 delivery fee(s), so it can\'t be deleted. If it\'s a duplicate, merge it in Conflicts.'), { code: 'contact_has_sales', status: 409 })

// The mapping.
assert.equal(isDeliveryHasSalesRefusal(refusal), true)
assert.equal(isDeliveryHasSalesRefusal(Object.assign(new Error('x'), { code: 'other' })), false)
assert.equal(isDeliveryHasSalesRefusal(null), false)
for (const [name, pack] of [['en', en], ['km', km]] as const) {
  const mapped = localizeDeliveryHasSalesRefusal(refusal, makeTr(pack)) as Error & { code?: string; status?: number }
  assert.equal(mapped.message, pack.delivery_contact_has_sales, `${name}: the message is the pack text, not the server text`)
  assert.notEqual(mapped.message, refusal.message)
  assert.equal(mapped.code, 'contact_has_sales'); assert.equal(mapped.status, 409)
}
const other = new Error('Network down')
assert.equal(localizeDeliveryHasSalesRefusal(other, makeTr(en)), other, 'any other error passes through untouched')

// The bulk sentence: translated head, no English prefix, plus the has-sales sentence only when one refusal was that code.
for (const [name, pack] of [['en', en], ['km', km]] as const) {
  const withSales = deliveryBulkDeleteMessage(makeTr(pack), 3, 2, true)
  const without = deliveryBulkDeleteMessage(makeTr(pack), 3, 2, false)
  assert.ok(withSales.includes(pack.delivery_contact_has_sales), `${name}: names what to do instead`)
  assert.ok(!without.includes(pack.delivery_contact_has_sales))
  assert.ok(withSales.includes('3') && withSales.includes('2'), `${name}: counts present`)
  assert.ok(!withSales.includes('{'), `${name}: no unreplaced placeholder`)
}
assert.ok(!/Deleted/.test(deliveryBulkDeleteMessage(makeTr(km), 3, 2, true)), 'km carries no English prefix')

// Every delete call in the tab goes through the one localizing helper.
function assertTabRoutesThroughHelper(source: string) {
  const direct = source.match(/getDeliveryApi\(\)\.deleteDeliveryContact\(/g) || []
  assert.equal(direct.length, 1, 'getDeliveryApi().deleteDeliveryContact( appears only inside removeDeliveryContact')
  assert.ok(/localizeDeliveryHasSalesRefusal\(error, tr\)/.test(source), 'the helper localizes the refusal')
  const helperCalls = source.match(/removeDeliveryContact\(/g) || []
  assert.equal(helperCalls.length, 5, 'the five delete surfaces')
  for (const label of ['Undo delivery contact create', 'Delete delivery contact', 'Redo delivery contact delete', 'Bulk delete delivery contacts', 'Redo bulk delivery contact delete']) {
    assert.ok(source.includes(`, '${label}')`) && new RegExp(`removeDeliveryContact\([^\n]*'${label}'\)`).test(source), `surface "${label}" uses the helper`)
  }
  assert.ok(!/`Deleted \$\{/.test(source), 'no hard-coded English bulk prefix')
}
const tab = read('../src/components/contacts/DeliveryTab.tsx').split('\r\n').join('\n')
assertTabRoutesThroughHelper(tab)

// Mutants: the guard above must catch a surface that bypasses the helper and a restored English prefix.
assert.throws(() => assertTabRoutesThroughHelper(tab.replace("removeDeliveryContact(targetId, undefined, 'Redo delivery contact delete')", "getDeliveryApi().deleteDeliveryContact(targetId)")), 'a bypassing redo-delete is caught')
assert.throws(() => assertTabRoutesThroughHelper(tab.replace('deliveryBulkDeleteMessage(tr, deletedCount, failedIds.length, keptOnSales)', '`Deleted ${deletedCount} delivery contact(s)`')), 'an English bulk prefix is caught')
assert.throws(() => assertTabRoutesThroughHelper(tab.replace('throw localizeDeliveryHasSalesRefusal(error, tr)', 'throw error')), 'a helper that stops localizing is caught')

console.log('deliveryRefusalMapping: ok')
