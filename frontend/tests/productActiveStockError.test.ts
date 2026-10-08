import assert from 'node:assert/strict'
import fs from 'node:fs'
import { branchRuleErrorKey, localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'
import { RESTATED_REFUSAL_KEYS } from '../src/api/branchRefusalLanguage.ts'

const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
const refusal = { code: 'product_has_stock', error: 'Worker fallback' }
assert.equal(branchRuleErrorKey(refusal), 'product_has_stock')
assert.equal(RESTATED_REFUSAL_KEYS.product_has_stock, 'product_has_stock')
for (const pack of [en, km]) {
  assert.equal(typeof pack.product_has_stock, 'string')
  assert.equal(localizeBranchRuleError(refusal, key => pack[key]), pack.product_has_stock)
}
assert.notEqual(en.product_has_stock, km.product_has_stock)
assert.equal(branchRuleErrorKey({ code: 'some_other_error', error: 'Worker fallback' }), null)
console.log('PASS stock refusal uses both language packs and shared HTTP/surface maps')
