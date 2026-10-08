import assert from 'node:assert/strict'
import fs from 'node:fs'
import { importRowDetailText, importRowMessageText, importWarningText } from '../src/components/imports/importRowText.ts'
import { localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
const translate = (key: string, fallback: string) => km[key] || fallback
const codes = ['stock_session_query_budget_exceeded', 'customer_return_over_plan_budget', 'stock_import_unit_over_tier_budget', 'stock_import_reconcile_over_tier_budget', 'import_queue_required']
for (const code of codes) {
  assert.ok(km[code], code)
  assert.equal(importRowDetailText({ code, message: 'Saved Worker English' }, translate), km[code])
  assert.equal(localizeBranchRuleError(`${code}: Saved Worker English`, key => km[key]), km[code])
}
assert.equal(importRowMessageText('Unexpected vendor failure', translate, 'vendor_unknown'), 'Unexpected vendor failure')
assert.equal(localizeBranchRuleError('vendor_unknown: original detail', key => km[key]), 'vendor_unknown: original detail')
assert.equal(importRowMessageText('Enter a shop, warehouse or store quantity. Other detail.', translate), `${km.stock_import_quantity_required} Other detail.`)
assert.equal(importWarningText({ code: 'stock_import_branch_routing', message: 'Original', params: {} }, translate), 'Original')
assert.equal(importWarningText({ code: 'stock_import_branch_routing', message: 'Original', params: {branch:'LC',columns:'A + B',total:4} }, translate), km.stock_import_branch_routing.replace('{branch}','LC').replace('{columns}','A + B').replace('{total}','4'))
console.log('PASS Khmer saved row/job codes; unknown errors and existing warning details retained')
