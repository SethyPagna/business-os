// R40 review S6: the POS must not release a frozen checkout on 409 shift_required_for_cash without the receipt proof the design asks for
// (4.2 item 4, the same proof reviewCheckoutPrices uses). An earlier attempt with the same id can time out on the till, keep running, pass the
// Worker's check while the shift was open and commit AFTER the retry was refused; releasing at once would let the same cart be sold twice.
// Mutants killed (each turns one assertion red):
//   a committed receipt is released as if nothing was recorded      -> "a receipt that exists is shown, never released"
//   a lookup that fails releases the cart                           -> "a lookup that fails keeps the frozen request"
//   an unreadable answer releases the cart                          -> "an answer that is neither committed nor not committed keeps it"
//   no receipt means keep                                           -> "no receipt releases the request"
//   the POS releases without asking (the old call)                  -> "the POS asks for the receipt before it releases"
//   the retry path or the first path drops the proof                -> "both refusal catches wait for the proof"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cashShiftRefusalOutcome } from '../src/components/pos/cashShiftRefusalRelease.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

await runTest('a receipt that exists is shown, never released (the earlier attempt committed)', async () => {
  const response = { id: 41, receiptNumber: '20261127-101010' }
  const asked: string[] = []
  const outcome = await cashShiftRefusalOutcome(async (id) => { asked.push(id); return { committed: true, response } }, 'req-1')
  assert.deepEqual(outcome, { kind: 'recorded', response })
  assert.deepEqual(asked, ['req-1'], 'the receipt of the refused request id is asked for, once')
})
await runTest('no receipt releases the request', async () => {
  assert.deepEqual(await cashShiftRefusalOutcome(async () => ({ committed: false }), 'req-1'), { kind: 'release' })
})
await runTest('a lookup that fails keeps the frozen request', async () => {
  assert.deepEqual(await cashShiftRefusalOutcome(async () => { throw new Error('network') }, 'req-1'), { kind: 'keep' })
})
await runTest('an answer that is neither committed nor not committed keeps it', async () => {
  for (const answer of [null, undefined, {}, { committed: 'yes' }, { committed: null }, 'committed', 1]) {
    assert.deepEqual(await cashShiftRefusalOutcome(async () => answer, 'req-1'), { kind: 'keep' }, JSON.stringify(answer))
  }
})

await runTest('the POS asks for the receipt before it releases, on both refusal paths', () => {
  const pos = readFileSync(path.join(here, '..', 'src', 'components', 'pos', 'POS.tsx'), 'utf8').replace(/\r\n/g, '\n')
  const start = pos.indexOf('const releaseCashShiftRefusal = async')
  assert.ok(start > 0, 'the release is async: it waits for the proof')
  const release = pos.slice(start, pos.indexOf('\n  }\n', start))
  assert.ok(release.indexOf('cashShiftRefusalOutcome(') > 0, 'the proof is asked for')
  assert.ok(release.indexOf('cashShiftRefusalOutcome(') < release.indexOf('checkoutRequestId: \'\''), 'the proof comes before the frozen request is cleared')
  assert.match(release, /outcome\.kind === 'recorded'[^]*finishRecorded\(outcome\.response\)/, 'a committed sale is shown as the sale, not sold again')
  assert.match(release, /outcome\.kind !== 'release'/, 'only a proven absence releases')
  const catches = pos.match(/if \(await releaseCashShiftRefusal\(/g) ?? []
  assert.equal(catches.length, 2, 'the retry path and the first path both wait for the proof')
  assert.equal(pos.split('releaseCashShiftRefusal(').length - 1, 2, 'no call releases without waiting')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
