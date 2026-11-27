// R40 review S3: a later payment on the Sales page that the Worker refused for want of an open shift (409 shift_required_for_cash) reads in the
// pack language and says who to ask, never the Worker's English. This happens whenever the form's own pre-check passed: a stale tab, a failed
// /current read, a retired branch.
// Mutants killed (each turns one assertion red):
//   the settlement error skips saleSubmitRefusalText (Worker English)   -> "the settlement failure is routed through the pack text"
//   the pack text is placed after getErrorMessage                       -> "the settlement failure is routed through the pack text"
//   the refusal drops who to ask                                        -> "a closed shift names the opener and an administrator"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { saleSubmitRefusalText } from '../src/api/saleSubmitErrors.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(path.join(here, '..', rel), 'utf8').replace(/\r\n/g, '\n')
const packs = { en: JSON.parse(read('src/lang/en.json')), km: JSON.parse(read('src/lang/km.json')) } as Record<string, Record<string, string>>
const tr = (pack: Record<string, string>) => (key: string) => pack[key]

let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const workerRefusal = (over: Record<string, unknown> = {}) => Object.assign(new Error('Open a shift to take cash.'), { status: 409, code: 'shift_required_for_cash', shift_state: 'closed', direction: 'in', who: 'ask_reopen', opener_name: 'Dara', ...over })

runTest('the settlement failure is routed through the pack text, before the Worker sentence', () => {
  const sales = read('src/components/sales/Sales.tsx')
  assert.match(sales, /: saleSubmitRefusalText\(error, t\) \?\? saleInvalidRateMessage\(error\) \?\? getErrorMessage\(error, /)
  assert.match(sales, /import \{ saleSubmitRefusalText \} from '\.\.\/\.\.\/api\/saleSubmitErrors\.ts'/)
})
runTest('a closed shift names the opener and an administrator, in English and Khmer', () => {
  const en = saleSubmitRefusalText(workerRefusal(), tr(packs.en))
  const km = saleSubmitRefusalText(workerRefusal(), tr(packs.km))
  assert.ok(en && en.includes('Dara') && /administrator/.test(en), String(en))
  assert.ok(km && km.includes('Dara') && /[ក-៿]/.test(km) && !/[A-Za-z]{4,}\s[A-Za-z]{3,}/.test(km.replace('Dara', '')), String(km))
  assert.notEqual(en, 'Open a shift to take cash.', 'not the Worker English')
})
runTest('no shift today reads as the pack text in Khmer, not the Worker English', () => {
  const km = saleSubmitRefusalText(workerRefusal({ shift_state: 'none', who: 'open', opener_name: null }), tr(packs.km))
  assert.equal(km, packs.km.shift_required_for_cash)
  assert.match(String(km), /[ក-៿]/)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
