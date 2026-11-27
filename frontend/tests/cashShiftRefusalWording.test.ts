// R40 review N3 + N4, wording of the cash-needs-a-shift refusal.
//  N3: a user who cannot open a shift (a returns-only role has no pos or sales access) is told to ask a cashier or an administrator to open
//      today's shift, never to open one themselves.
//  N4: a user who cannot reopen today's closed shift is never told to "Reopen it": "Today's shift is closed. Ask <opener> or an administrator to reopen it."; the opener and administrators keep "... Reopen it to take cash / give cash back."
// Mutants killed (each turns one assertion red):
//   canOpen=false still says "Open a shift ..."            -> "a role that cannot open a shift is told who to ask"
//   canOpen defaults to false                               -> "a role that can open a shift keeps the open sentence"
//   closed + out falls back to the open sentence            -> "cash going out on a closed shift says the shift is closed"
//   the closed sentence drops who to ask                    -> "a closed shift tells the opener ..."
//   opener or administrator loses the Reopen sentence       -> "a closed shift tells the opener ..."
//   a non-reopener gets "Reopen it" (picker or refusal)      -> "a closed shift tells the opener ...", "the picker note ..."
//   a pack key is missing or not Khmer                      -> "every new string exists in both packs, short and plain"
//   the note ignores the permission                         -> "the note asks the permission the Worker asks"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cashShiftRefusalText } from '../src/api/saleSubmitErrors.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(here, '..', rel), 'utf8').replace(/\r\n/g, '\n')
const packs = { en: JSON.parse(read('src/lang/en.json')), km: JSON.parse(read('src/lang/km.json')) } as Record<string, Record<string, string>>
const tr = (pack: Record<string, string>) => (key: string) => pack[key]
let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const NEW_KEYS = ['shift_open_ask_cashier', 'shift_closed_for_refund', 'shift_closed_plain']
const none = { shift_state: 'none', direction: 'out', who: 'open', opener_name: null }
const closedOut = { shift_state: 'closed', direction: 'out', who: 'ask_reopen', opener_name: 'Dara' }

runTest('every new string exists in both packs, short and plain', () => {
  for (const key of NEW_KEYS) {
    assert.ok(String(packs.en[key] || '').trim(), `en.${key}`)
    assert.match(String(packs.km[key] || ''), /[ក-៿]/, `km.${key} is Khmer`)
    assert.ok(packs.en[key].length <= 80 && packs.km[key].length <= 80, `${key} stays short`)
    assert.ok(!/\{/.test(packs.en[key]) && !/\{/.test(packs.km[key]), `${key} has no placeholder`)
  }
  assert.equal(packs.en.shift_open_ask_cashier, "Today's shift is not open. Ask a cashier or an administrator to open it.")
  assert.equal(packs.en.shift_closed_for_refund, "Today's shift is closed. Reopen it to give cash back.")
  assert.equal(packs.en.shift_closed_plain, "Today's shift is closed.")
  assert.equal(packs.km.shift_closed_plain, 'វេនថ្ងៃនេះបានបិទហើយ។')
})
runTest('a role that cannot open a shift is told who to ask, never to open one', () => {
  for (const lang of ['en', 'km']) {
    for (const direction of ['in', 'out']) {
      for (const shift_state of ['none', 'cancelled']) {
        const text = cashShiftRefusalText({ ...none, direction, shift_state }, tr(packs[lang]), { canOpen: false })
        assert.equal(text, packs[lang].shift_open_ask_cashier, `${lang} ${direction} ${shift_state}`)
        assert.notEqual(text, packs[lang].shift_required_for_cash)
        assert.notEqual(text, packs[lang].shift_required_for_refund)
      }
    }
  }
  assert.ok(!/^Open a shift/i.test(String(cashShiftRefusalText(none, tr(packs.en), { canOpen: false }))))
})
runTest('a role that can open a shift keeps the open sentence', () => {
  assert.equal(cashShiftRefusalText(none, tr(packs.en)), packs.en.shift_required_for_refund)
  assert.equal(cashShiftRefusalText(none, tr(packs.en), { canOpen: true }), packs.en.shift_required_for_refund)
  assert.equal(cashShiftRefusalText({ ...none, direction: 'in' }, tr(packs.km)), packs.km.shift_required_for_cash)
})
runTest('a closed shift tells the opener and an administrator to reopen it, and everyone else who to ask', () => {
  assert.equal(cashShiftRefusalText(closedOut, tr(packs.en)), "Today's shift is closed. Ask Dara or an administrator to reopen it.")
  assert.equal(cashShiftRefusalText({ ...closedOut, opener_name: null }, tr(packs.en)), "Today's shift is closed. Ask an administrator to reopen it.")
  assert.equal(cashShiftRefusalText({ ...closedOut, who: 'reopen' }, tr(packs.en)), "Today's shift is closed. Reopen it to give cash back.")
  assert.equal(cashShiftRefusalText({ ...closedOut, who: 'reopen', direction: 'in' }, tr(packs.en)), "Today's shift is closed. Reopen it to take cash.")
  const km = String(cashShiftRefusalText(closedOut, tr(packs.km)))
  assert.equal(km, `${packs.km.shift_closed_plain} ${packs.km.shift_reopen_ask.replace('{name}', 'Dara')}`)
  assert.ok(!km.includes(packs.km.shift_closed_for_refund), 'a user who cannot reopen is not told to reopen')
  assert.equal(cashShiftRefusalText({ ...closedOut, direction: 'in' }, tr(packs.en)), "Today's shift is closed. Ask Dara or an administrator to reopen it.")
  assert.equal(cashShiftRefusalText(closedOut, tr(packs.en), { canOpen: false }), "Today's shift is closed. Ask Dara or an administrator to reopen it.", 'a closed shift is reopened by the opener or an administrator whoever asks')
  for (const lang of ['en', 'km']) {
    for (const direction of ['in', 'out']) {
      const text = String(cashShiftRefusalText({ ...closedOut, direction }, tr(packs[lang])))
      assert.ok(!text.includes(packs[lang][direction === 'in' ? 'shift_closed_for_cash' : 'shift_closed_for_refund']), `${lang} ${direction} ask_reopen never says Reopen it`)
    }
  }
})
runTest('the picker note on a closed shift follows the same split', () => {
  const pos = read('src/components/pos/POS.tsx')
  assert.ok(!/t\(posCashGate\.shiftState === 'closed' \? 'shift_closed_for_cash'/.test(pos), 'the picker no longer prints the Reopen sentence for everyone')
  assert.match(pos, /posCashGate\.kind === 'block' \? cashShiftNoteText\(posCashGate, 'in', t\)/)
})
runTest('no Khmer sign sits glued to a plus in the shift difference hint, and the refusal keeps its spaces', () => {
  assert.ok(!/\+[ក-៿]|[ក-៿]\+/.test(packs.km.shift_difference_hint), packs.km.shift_difference_hint)
  assert.ok(!/\+\S/.test(packs.en.shift_difference_hint.replace(/\+ /g, '')), packs.en.shift_difference_hint)
  const probe = read('../cloudflare/src/lib/shiftCurrentProbe.ts')
  assert.match(probe, /export const CASH_IN_REFUSAL = 'Open a shift to take cash\.'/)
  assert.match(probe, /export const CASH_OUT_REFUSAL = 'Open a shift to give cash back\.'/)
})
runTest('the Returns toast and the note ask the permission the Worker asks', () => {
  const modal = read('src/components/returns/NewReturnModal.tsx')
  assert.match(modal, /saleSubmitRefusalText\(error, \(key\) => T\(key, ''\), \{ canOpen: canUseShifts \}\)/)
  assert.match(modal, /const canUseShifts = typeof getPermissionTier !== 'function' \|\| getPermissionTier\('pos'\) === 'full' \|\| getPermissionTier\('sales'\) === 'full'/)
  const note = read('src/components/shifts/CashShiftNote.tsx')
  assert.match(note, /const canOpen = !hasPermission \|\| hasPermission\('pos'\) \|\| hasPermission\('sales'\)/)
  assert.match(note, /cashShiftNoteText\(block, direction, t, \{ canOpen \}\)/)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
