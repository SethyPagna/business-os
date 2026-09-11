import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8')
const formSource = read('../src/components/fees/FeeForm.tsx')
const pageSource = read('../src/components/fees/FeesPage.tsx')

function extractFunction(source: string, name: string): string {
  const match = source.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`))
  assert.ok(match, `${name} not found`)
  return stripTypeScriptTypes(match[0].replace('export ', ''))
}

const formHelpers = new Function(`${extractFunction(formSource, 'feeCreateBodyToFormState')}\n${extractFunction(formSource, 'feeFormInteractionLocked')}\nreturn { feeCreateBodyToFormState, feeFormInteractionLocked }`)() as {
  feeCreateBodyToFormState: (body: Record<string, unknown>) => Record<string, string>
  feeFormInteractionLocked: (saving: boolean, pending: unknown) => boolean
}

const recovered = formHelpers.feeCreateBodyToFormState({
  fee_type: 'expense', label: 'Staff lunch', amount_usd: 3.13, amount_khr: 0,
  fee_date: '2026-09-11', sale_id: null, branch_id: 2, delivery_contact_id: null, notes: 'Exact body',
})
assert.deepEqual(recovered, {
  fee_type: 'expense', label: 'Staff lunch', amount_usd: '3.13', amount_khr: '',
  fee_date: '2026-09-11', sale_id: '', branch_id: '2', notes: 'Exact body',
}, 'a reload restores form fields from the frozen normalized request body')
assert.equal(formHelpers.feeFormInteractionLocked(false, null), false)
assert.equal(formHelpers.feeFormInteractionLocked(true, null), true, 'in-flight save locks fields, close and minimize')
assert.equal(formHelpers.feeFormInteractionLocked(false, { client_request_id: 'pending' }), true, 'unknown outcome stays locked until exact retry or explicit discard')

assert.match(formSource, /mod\.getSales\(\{ search: query, limit: 8 \}\)/, 'linked sales use the existing searchable sales endpoint')
assert.match(formSource, /receipt, customer, phone, product, SKU or barcode/, 'the picker tells staff which real sale fields are searchable')
assert.match(formSource, /rows\.filter\(\(sale\) => sale\.branch_id != null && branchCanSell\(sale\.branch_name\)\)/, 'only real Shop sales appear as link candidates')
assert.match(formSource, /set\('sale_id', String\(sale\.id\)\)[\s\S]*set\('branch_id', String\(sale\.branch_id\)\)/, 'choosing a sale carries its exact id and branch together')
assert.match(formSource, /Sale ID #\{selectedSale\.id\}/, 'the selected sale keeps its database id visible')
assert.match(formSource, /role="listbox"[\s\S]*role="option"/, 'the search results expose listbox semantics')
assert.doesNotMatch(formSource, /id="fee-sale-id"/, 'staff are not asked to type an unverified numeric sale id')
assert.match(formSource, /filter\(\(row\) => row\.is_active !== false && branchCanSell\(row\.name\)\)/, 'manual expenses offer only active exact Shop branches')
assert.match(formSource, /return \[\{ value: '', label: t\('select_branch'\) \|\| 'Select Shop' \}, \.\.\.options\]/, 'manual expenses cannot save an unassigned branch from the picker')
assert.match(formSource, /if \(amountsInvalid \|\| dateInvalid \|\| !form\.branch_id\.trim\(\)\) return/, 'the form refuses a manual expense until its Shop is selected')

const detailSource = pageSource.slice(pageSource.indexOf('data-expense-detail=""'), pageSource.indexOf("{modal === 'form'"))
assert.equal((detailSource.match(/Sale ID #\$\{selected\.sale_id\}/g) || []).length, 2, 'expense detail displays a linked sale id in both receipt and id-only cases')
assert.match(formSource, /if \(savingRef\.current\) return/, 'a synchronous ref rejects duplicate Save before another request can start')
assert.match(formSource, /<fieldset disabled=\{interactionLocked\}/, 'busy or unresolved forms disable every editable field')
assert.match(formSource, /pendingCreate[\s\S]*retry_original_request[\s\S]*discard_retry/, 'unknown outcome offers only exact retry or explicit discard')
assert.match(formSource, /if \(!pendingCreate \|\| savingRef\.current \|\| !actorId\) return/, 'discard is unavailable while a retry is in flight')
assert.match(pageSource, /closeDisabled=\{feeFormLocked\}/, 'modal close is disabled while saving or unresolved')
assert.match(pageSource, /canMinimizeFeeForm && !feeFormLocked/, 'minimize cannot park an in-flight or unresolved request')
assert.match(pageSource, /disabled=\{feeFormLocked\}/, 'visible minimize control reflects its disabled state')
assert.match(pageSource, /key=\{`\$\{selected\?\.id \?\? 'new'\}:\$\{user\?\.id \?\? 'anonymous'\}`\}/, 'account changes remount the actor-scoped recovery form')
assert.doesNotMatch(pageSource, /withLoaderTimeout\(\s*\(\) => createFeeRequest/, 'create is not detached from its outcome by an outer UI timeout')

console.log('PASS fee picker, exact recovery and busy modal lifecycle contract')
