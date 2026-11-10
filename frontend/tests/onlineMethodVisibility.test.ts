// KHQR security review N6: the configured online method ("ABA KHQR") is not a button on plain sales, settlements, returns' exchange payments or the bulk relabel. The Worker refuses it
// there (online_method_requires_order); it exists only as the locked online row the till adds for a Fulfil sale.
//
// Run: node tests/onlineMethodVisibility.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { hiddenOnlineMethod, withoutOnlineMethod } from '../src/components/online-orders/onlineMethodVisibility.ts'
import { withOnlineTender } from '../src/components/online-orders/fulfilOrder.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => fs.readFileSync(path.join(here, '..', ...parts), 'utf8').split('\r\n').join('\n')
const methods = ['ABA KHQR', 'Cash', 'Card', 'Wing']

test('with the online method configured it is left out of every list, whatever its case or spacing; the rest keep their order', () => {
  // CATCHES: the online method offered as an ordinary tender (a cashier picks it and the Worker refuses the sale), and a case-sensitive comparison.
  assert.deepEqual(withoutOnlineMethod(methods, { online_order_payment_method: 'ABA KHQR' }), ['Cash', 'Card', 'Wing'])
  assert.deepEqual(withoutOnlineMethod(methods, { online_order_payment_method: '  aba khqr ' }), ['Cash', 'Card', 'Wing'])
  assert.deepEqual(withoutOnlineMethod(['KHQR Pay', 'Cash'], { online_order_payment_method: 'KHQR Pay' }), ['Cash'])
})

test('the Worker method in force is the one rule: stored or not, the UI hides exactly what the Worker publishes', () => {
  // CATCHES: the switch ON with nothing stored (the Worker refuses "ABA KHQR" on plain sales) while the UI still offers it, and the UI hiding a stored name the Worker is not refusing yet.
  assert.deepEqual(withoutOnlineMethod(methods, { online_order_method_in_force: 'ABA KHQR', online_order_payment_method: '' }), ['Cash', 'Card', 'Wing'])
  assert.deepEqual(withoutOnlineMethod(methods, { online_order_method_in_force: '', online_order_payment_method: 'ABA KHQR' }), methods, 'the Worker says nothing is refused')
  assert.equal(hiddenOnlineMethod({ online_order_method_in_force: ' Bakong ' }), 'Bakong')
  assert.deepEqual(withoutOnlineMethod(methods, { online_order_payment_method: 'ABA KHQR' }), ['Cash', 'Card', 'Wing'], 'an answer without the key falls back to the stored setting')
  assert.ok(/online_order_method_in_force/.test(read('src', 'components', 'sales', 'Sales.tsx')), 'the bulk relabel list reads the same key')
})

test('with no online method configured nothing is hidden: a shop that uses "ABA KHQR" as an ordinary method keeps it', () => {
  // CATCHES: hiding the default name for everyone (breaking shops that never turned online orders on).
  for (const settings of [{}, { online_order_payment_method: '' }, { online_order_payment_method: '   ' }, null, undefined]) {
    assert.deepEqual(withoutOnlineMethod(methods, settings), methods)
    assert.equal(hiddenOnlineMethod(settings), '')
  }
})

test('the Fulfil sale still gets its online row: the till adds it itself, not from the list', () => {
  // CATCHES: hiding the method from the list also removing it from the Fulfil sale.
  const rows = withOnlineTender([] as Array<{ id: string; method: string; usd: string; khr: string }>, 'ABA KHQR', 25)
  assert.deepEqual(rows.map((row) => [row.method, row.usd]), [['ABA KHQR', '25.00']])
})

test('every picker of payment methods goes through the filter', () => {
  // CATCHES: one list (the till, the settlement editor, the returns exchange payment, the bulk relabel) still offering the method.
  const pos = read('src', 'components', 'pos', 'POS.tsx')
  assert.ok(/const posPaymentMethods = useMemo\(\(\) => \{ const offered = withoutOnlineMethod\(configuredPosPaymentMethods, settings\)/.test(pos), 'the till offers the filtered list')
  assert.ok(/methodMissing=\{configuredPosPaymentMethods\.some\(/.test(pos), 'while "is it set up" still reads the full list')
  assert.ok(/withoutOnlineMethod\(JSON\.parse\(settings\.pos_payment_methods\) as string\[\], settings\)/.test(pos), 'and the default method is never the online one')
  assert.ok(/withoutOnlineMethod\(configuredSettlementMethods\(rawSettings\.pos_payment_methods\), rawSettings\)/.test(read('src', 'components', 'sales', 'SaleDetailModal.tsx')))
  assert.ok(/withoutOnlineMethod\(configuredSettlementMethods\(methods\), value\)/.test(read('src', 'components', 'sales', 'saleSettlementConfig.ts')))
  assert.ok(/withoutOnlineMethod\(configuredSettlementMethods\(settings\?\.pos_payment_methods\), settings\)/.test(read('src', 'components', 'returns', 'NewReturnModal.tsx')))
  assert.ok(/\.filter\(\(method\) => !hiddenOnlineMethod \|\| String\(method \?\? ''\)\.trim\(\)\.toLocaleLowerCase\(\) !== hiddenOnlineMethod\)/.test(read('src', 'components', 'sales', 'Sales.tsx')), 'the bulk relabel list')
})
