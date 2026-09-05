import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.resolve(here, '../src/components/pos/POS.tsx'), 'utf8')

assert.match(source, /changeIsActual\?: boolean/, 'persisted orders default to no manual-change intent')
assert.match(source, /changeGivenUsd: e\.target\.value, changeIsActual: true/, 'editing USD change records explicit cashier intent, including typed zero')
assert.match(source, /changeGivenKhr: e\.target\.value, changeIsActual: true/, 'editing KHR change records explicit cashier intent, including typed zero')
assert.match(source, /onBlur=\{\(\) => patchActive\(\{ changeGivenKhr: String\(cashierChangeKhr/, 'the field visibly normalizes manual KHR change to the 100-riel cashier policy')
assert.match(source, /changeGivenUsd: changeUsd > 0[\s\S]*?changeIsActual: false/, 'the computed-fill shortcut remains canonical fallback rather than manual intent')
assert.match(source, /\.\.\.\(active\.changeIsActual === true \? \{ change_is_actual: true \} : \{\}\)/, 'only literal manual intent emits the server marker')
assert.match(source, /change_usd: active\.changeIsActual === true[\s\S]*?Math\.round\(\(parseFloat\(active\.changeGivenUsd\)/, 'manual USD change is sent at cent precision')
assert.match(source, /change_khr: active\.changeIsActual === true[\s\S]*?cashierChangeKhr\(parseFloat\(active\.changeGivenKhr\)/, 'manual KHR change keeps the cashier 100-riel floor policy')
assert.match(source, /: Math\.max\(0, changeUsd\)/, 'unmarked USD continues to use the computed fallback')
assert.match(source, /: Math\.max\(0, changeKhr\)/, 'unmarked KHR continues to use the computed dual display')

console.log('PASS POS native change intent contract')
