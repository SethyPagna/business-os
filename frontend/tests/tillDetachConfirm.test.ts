// KHQR security review N4: "Sell without this order" asks first. The order stays paid and can be handed over again, so one tap must not drop the link; the question uses the shared
// compact confirm dialog (never the browser's native dialog), shows before -> after, and says the order is still to be handed over or refunded.
//
// Run: node tests/tillDetachConfirm.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { detachConfirmCopy } from '../src/components/online-orders/fulfilOrder.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => fs.readFileSync(path.join(here, '..', ...parts), 'utf8')
const en = JSON.parse(read('src', 'lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('src', 'lang', 'km.json')) as Record<string, string>
const fmt = (n: number) => `$${n.toFixed(2)}`

test('the question names the order, shows before -> after with the amount paid, and says the order must still be handed over or refunded', () => {
  // CATCHES: a bare yes/no, and wording that hides that the order stays paid.
  const tt = (key: string, fallback: string) => en[key] ?? fallback
  const copy = detachConfirmCopy({ order_no: 'W261109K7Q2', paid_usd: 25 }, tt, fmt)
  assert.equal(copy.message, 'W261109K7Q2')
  assert.equal(copy.items.length, 2)
  assert.ok(copy.items.every((row) => row.value.includes('→')), 'each row is before -> after')
  assert.ok(copy.items[1].value.includes('$25.00') && /still paid/.test(copy.items[1].value))
  assert.match(copy.note, /stays paid/)
  assert.match(copy.note, /refund/)
})

test('every sentence exists in both packs, and Khmer is a real sentence', () => {
  // CATCHES: an English fallback on a Khmer till.
  for (const key of ['oo_till_detach_title', 'oo_till_detach_sale', 'oo_till_detach_sale_value', 'oo_till_detach_order', 'oo_till_detach_order_value', 'oo_till_detach_note', 'oo_till_detach_go']) {
    assert.ok(en[key], `en ${key}`)
    assert.ok(km[key] && km[key] !== en[key] && /[ក-៿]/.test(km[key]), `km ${key}`)
  }
  assert.ok(en.oo_till_detach_order_value.includes('{amount}') && km.oo_till_detach_order_value.includes('{amount}'))
})

test('the till asks before it lets go, with the shared dialog, and the banner only reports the tap', () => {
  // CATCHES: the link dropped in the same tap (detach first, ask never), a native dialog, and the banner dropping the link itself.
  const pos = read('src', 'components', 'pos', 'POS.tsx').split('\r\n').join('\n')
  const body = /const detachOnlineOrder = async \(\) => \{([\s\S]*?)\n  \}\n/.exec(pos)?.[1] ?? ''
  assert.ok(body.includes('askToConfirm(detachConfirmCopy('), 'asks through the shared dialog')
  assert.ok(body.indexOf('askToConfirm') < body.indexOf('patchActive({ onlineOrder: undefined })'), 'the question comes before the link is dropped')
  assert.ok(body.indexOf('askToConfirm') < body.indexOf('withOnlineTender(details'), 'and before the online payment row is removed')
  assert.ok(!/window\.confirm/.test(body), 'never the native dialog')
  assert.ok(/\{confirmDialog\}/.test(pos), 'the dialog is rendered')
  assert.ok(/onDetach=\{\(\) => \{ void detachOnlineOrder\(\) \}\}/.test(pos))
})
