import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { roundMoney2 } from '../src/utils/moneyPrecision.ts'
import { cashierChangeKhr } from '../src/utils/rielRounding.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.resolve(here, '../src/components/pos/POS.tsx'), 'utf8')

assert.match(source, /changeIsActual\?: boolean/, 'persisted orders default to no manual-change intent')
assert.match(source, /changeGivenUsd: e\.target\.value, changeIsActual: true/, 'editing USD change records explicit cashier intent, including typed zero')
assert.match(source, /changeGivenKhr: e\.target\.value, changeIsActual: true/, 'editing KHR change records explicit cashier intent, including typed zero')
assert.match(source, /onBlur=\{\(\) => patchActive\(\{ changeGivenKhr: String\(cashierChangeKhr/, 'the field visibly normalizes manual KHR change to the 100-riel cashier policy')
assert.match(source, /changeGivenUsd: changeUsd > 0[\s\S]*?changeIsActual: false/, 'the computed-fill shortcut remains canonical fallback rather than manual intent')
assert.match(source, /\.\.\.\(active\.changeIsActual === true \? \{ change_is_actual: true \} : \{\}\)/, 'only literal manual intent emits the server marker')
assert.match(source, /change_usd: active\.changeIsActual === true[\s\S]*?roundMoney2\(active\.changeGivenUsd\.trim\(\) \|\| '0'\)/, 'manual USD change is sent directly from decimal input at cent precision')
assert.match(source, /change_khr: active\.changeIsActual === true[\s\S]*?cashierChangeKhr\(parseFloat\(active\.changeGivenKhr\)/, 'manual KHR change keeps the cashier 100-riel floor policy')
assert.match(source, /: Math\.max\(0, changeUsd\)/, 'unmarked USD continues to use the computed fallback')
assert.match(source, /: Math\.max\(0, changeKhr\)/, 'unmarked KHR continues to use the computed dual display')
const start = source.indexOf('      change_usd: active.changeIsActual === true')
const end = source.indexOf('      exchange_rate:', start)
assert.ok(start > 0 && end > start)
const serialize = new Function('active', 'changeUsd', 'changeKhr', 'roundMoney2', 'cashierChangeKhr', `return ({${source.slice(start, end)}})`)
for (const [input, expected] of [['1.2301', 1.23], ['10.075', 10.08], ['0', 0]] as const) {
  assert.deepEqual(serialize({ changeIsActual: true, changeGivenUsd: input, changeGivenKhr: '199' }, 9, 999, roundMoney2, cashierChangeKhr), { change_usd: expected, change_khr: 100, change_is_actual: true })
}
assert.deepEqual(serialize({ changeIsActual: false }, 0, 20, roundMoney2, cashierChangeKhr), { change_usd: 0, change_khr: 20 }, 'computed 4020-rate subcent surplus retains native KHR without manual marker')

console.log('PASS POS native change intent contract')
