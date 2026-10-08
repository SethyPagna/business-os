import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { BRANCH_RULE_CODE_KEYS } from '../src/api/branchRuleErrors.ts'
import { RESTATED_REFUSAL_KEYS } from '../src/api/branchRefusalLanguage.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
for (const key of ['bulk_price_outcome_unknown', 'bulk_price_request_not_saved', 'bulk_price_pending_recovery', 'bulk_price_recover_saved', 'bulk_price_recovery_unavailable']) {
  assert.equal(typeof en[key], 'string'); assert.match(km[key], /[\u1780-\u17ff]/)
}
assert.equal(BRANCH_RULE_CODE_KEYS.bulk_price_outcome_unknown, 'bulk_price_outcome_unknown')
assert.equal(RESTATED_REFUSAL_KEYS.bulk_price_outcome_unknown, 'bulk_price_outcome_unknown')
Object.assign(globalThis, { document: { documentElement: { getAttribute: () => 'km' } } })
const error = Object.assign(new Error(en.bulk_price_outcome_unknown), { code: 'bulk_price_outcome_unknown' })
const refusalSource = readFileSync(new URL('../src/api/branchRefusalLanguage.ts', import.meta.url), 'utf8').replaceAll("import('../lang/km.json')", 'Promise.resolve({default: providedPack})')
const output = ts.transpileModule(refusalSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} as { restateBranchRefusal: (e: typeof error) => Promise<unknown> } }
new Function('exports', 'module', 'providedPack', output)(module.exports, module, km)
await module.exports.restateBranchRefusal(error)
assert.equal(error.message, km.bulk_price_outcome_unknown, 'actual shared HTTP restatement localizes saved server refusal')
const source = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
assert.match(source, /bulk_price_pending_recovery/); assert.match(source, /bulk_price_recover_saved/)
console.log('catalog price recovery EN/KM and shared HTTP code restatement PASS')
