import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import { nativeChangeAmounts, roundMoney2 } from '../src/utils/moneyPrecision.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8')
const formSource = read('../src/components/fees/FeeForm.tsx')
const pageSource = read('../src/components/fees/FeesPage.tsx')

function extractFunction(source: string, name: string): string {
  const match = source.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`))
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
assert.match(formSource, /if \(!pendingCreate && \(amountsInvalid \|\| dateInvalid \|\| !form\.branch_id\.trim\(\)\)\) return/, 'new edits validate amounts/date/Shop; frozen retries are not rebuilt by new input policy')

const detailSource = pageSource.slice(pageSource.indexOf('data-expense-detail=""'), pageSource.indexOf("{modal === 'form'"))
assert.match(detailSource, /expenseSaleLabel\(selected\.sale_receipt_number, selected\.sale_id, tr\('sale', 'Sale'\)\)/, 'detail uses the localized receipt/id formatter')
assert.match(pageSource, /expenseSaleLabel\(fee\.sale_receipt_number, fee\.sale_id, tr\('sale', 'Sale'\)\)/, 'desktop uses the same localized receipt/id formatter')
const saleLabel = new Function(`${extractFunction(pageSource, 'expenseSaleLabel')}; return expenseSaleLabel`)()
assert.equal(saleLabel('R-1', 7, 'លក់'), 'R-1 · លក់ #7')
assert.equal(saleLabel('R-1', undefined, 'Sale'), 'R-1', 'receipt without sale ID never displays undefined')
assert.equal(saleLabel(null, 7, 'Sale'), 'Sale #7')
assert.equal(saleLabel(null, null, 'Sale'), '')
assert.match(formSource, /if \(savingRef\.current\) return/, 'a synchronous ref rejects duplicate Save before another request can start')
assert.match(formSource, /<fieldset disabled=\{interactionLocked\}/, 'busy or unresolved forms disable every editable field')
assert.match(formSource, /pendingCreate[\s\S]*retry_original_request[\s\S]*discard_retry/, 'unknown outcome offers only exact retry or explicit discard')
assert.match(formSource, /if \(!pendingCreate \|\| savingRef\.current \|\| !actorId\) return/, 'discard is unavailable while a retry is in flight')
assert.match(pageSource, /closeDisabled=\{feeFormLocked\}/, 'modal close is disabled while saving or unresolved')
assert.match(pageSource, /canMinimizeFeeForm && !feeFormLocked/, 'minimize cannot park an in-flight or unresolved request')
assert.match(pageSource, /disabled=\{feeFormLocked\}/, 'visible minimize control reflects its disabled state')
assert.match(pageSource, /key=\{`\$\{selected\?\.id \?\? 'new'\}:\$\{user\?\.id \?\? 'anonymous'\}`\}/, 'account changes remount the actor-scoped recovery form')
assert.doesNotMatch(pageSource, /withLoaderTimeout\(\s*\(\) => createFeeRequest/, 'create is not detached from its outcome by an outer UI timeout')

const feeFormMoney = new Function('nativeChangeAmounts', 'roundMoney2', `${extractFunction(formSource, 'feeFormMoney')}; return feeFormMoney`)(nativeChangeAmounts, roundMoney2)
for (const id of ['fee-amount-usd', 'fee-amount-khr']) {
  const input = formSource.slice(formSource.indexOf(`id="${id}"`)).split('/>')[0]
  assert.match(input, /step="any"/, 'native input must permit the raw decimal and historical value before submit normalization')
}
const saveSource = stripTypeScriptTypes(formSource.slice(formSource.indexOf('  const handleSave = async () => {'), formSource.indexOf('  const discardPending = () => {')))
const runSave = new Function('scope', `const { savingRef, setTouched, amountsInvalid, dateInvalid, form, pendingCreate, fee, money, amountUsd, amountKhr, setSaving, onSave, savedRef, dirtyRef, restoredDraftRef, clearWorkDraft, draftKey, onClose, actorId, getPendingFeeCreate, setPendingCreate, setForm, feeCreateBodyToFormState } = scope; ${saveSource}; return handleSave()`)
async function submitAmounts(usd: string, khr: string, existing: any = null, pending: any = null) {
  const form = { fee_type: 'expense', label: 'Physical expense', amount_usd: usd, amount_khr: khr, fee_date: '2026-09-13', sale_id: '', branch_id: '2', notes: 'Unchanged details' }
  const money = feeFormMoney(form, existing), payloads: any[] = []
  await runSave({ savingRef: { current: false }, setTouched() {}, amountsInvalid: !money.valid || (money.amountUsd <= 0 && money.amountKhr <= 0), dateInvalid: false,
    form, pendingCreate: pending, fee: existing, money, amountUsd: money.amountUsd, amountKhr: money.amountKhr, setSaving() {}, onSave(payload: any) { payloads.push(payload) },
    savedRef: { current: false }, dirtyRef: { current: true }, restoredDraftRef: { current: null }, clearWorkDraft() {}, draftKey: 'fixture', onClose() {}, actorId: 7,
    getPendingFeeCreate() { return pending }, setPendingCreate() {}, setForm() {}, feeCreateBodyToFormState: formHelpers.feeCreateBodyToFormState })
  return payloads
}
assert.equal((await submitAmounts('1.2301', '0'))[0].amount_usd, 1.23, 'actual submit uses physical nearest cents, not selling ceil')
for (const [input, expected] of [['1.235', 1.24], ['10.075', 10.08], ['1.234999999999', 1.23]] as const)
  assert.equal((await submitAmounts(input, '0'))[0].amount_usd, expected)
assert.equal((await submitAmounts('0', '1.499999999999999999'))[0].amount_khr, 1, 'whole KHR rounds raw decimal only once')
assert.equal((await submitAmounts('0', '1.5'))[0].amount_khr, 2)
for (const bad of ['-0.0000001', '-1e-99', 'invalid', '0x10', 'Infinity', '100000000001']) {
  assert.deepEqual(await submitAmounts(bad, '20'), [], `invalid USD ${bad} cannot hide behind positive KHR`)
  assert.deepEqual(await submitAmounts('1', bad), [], `invalid KHR ${bad} cannot hide behind positive USD`)
}
assert.deepEqual(await submitAmounts('', ''), [], 'blank amounts remain invalid')
assert.deepEqual(await submitAmounts('0.0001', '0'), [], 'sub-cent expense rounded to zero is not a positive physical payment')
const historical = { amount_usd: 1.2345, amount_khr: 20.25 }
const noOp = (await submitAmounts('1.234500', '20.25', historical))[0]
assert.equal(Object.hasOwn(noOp, 'amount_usd'), false, 'metadata/no-op edit omits unchanged historical USD rather than requantizing')
assert.equal(Object.hasOwn(noOp, 'amount_khr'), false, 'historical fractional KHR remains unchanged by no-op')
const edited = (await submitAmounts('1.2301', '20.25', historical))[0]
assert.equal(edited.amount_usd, 1.23)
assert.equal(Object.hasOwn(edited, 'amount_khr'), false)
const frozenBody = { fee_type: 'expense', label: 'Legacy', amount_usd: 1.23, amount_khr: 20.25, fee_date: '2026-09-11', sale_id: null, branch_id: 2, delivery_contact_id: null, notes: 'Exact legacy request' }
const frozenJson = JSON.stringify(frozenBody)
const retried = await submitAmounts('invalid', '-5', null, { client_request_id: 'legacy-exact', body: frozenBody })
assert.equal(retried[0], frozenBody, 'actual retry forwards original body, not the displayed/re-normalized form')
assert.equal(JSON.stringify(retried[0]), frozenJson)
const transportSource = read('../src/api/feesTransport.ts')
const { normalizeFeeCreateBody } = await import('../src/api/feesTransport.ts')
assert.equal((await submitAmounts('1', '20'))[0].fee_money_version, 1, 'fresh actual submit opts into backend denomination policy')
assert.equal(Object.hasOwn(retried[0], 'fee_money_version'), false, 'legacy actual retry never gains a version marker')
assert.equal(normalizeFeeCreateBody((await submitAmounts('1.2301', '1.5'))[0]).amount_usd, 1.23, 'actual create transport preserves prepared cent amount')
assert.equal(normalizeFeeCreateBody((await submitAmounts('10.075', '1.5'))[0]).amount_usd, 10.08)
assert.equal(normalizeFeeCreateBody((await submitAmounts('1', '1.5'))[0]).amount_khr, 2)
assert.equal(JSON.stringify(normalizeFeeCreateBody(frozenBody)), frozenJson, 'existing legacy request normalization/digest representation is unchanged')
const backendFees = read('../../cloudflare/src/routes/fees.ts')
const nativeUpdateMoney = new Function('body', 'existing', 'toNumber', 'nativeChangeAmounts', `${extractFunction(backendFees, 'round2')}\n${extractFunction(backendFees, 'feeMoneyVersion')}\n${extractFunction(backendFees, 'feeMoney')}\nconst version=feeMoneyVersion(body); return { amount_usd: feeMoney(body,'usd',version,existing.amount_usd), amount_khr: feeMoney(body,'khr',version,existing.amount_khr) }`)
assert.deepEqual(nativeUpdateMoney(noOp, historical, Number, nativeChangeAmounts), historical, 'actual backend PUT absence branches preserve historical money on no-op/metadata edit')
assert.deepEqual(nativeUpdateMoney(edited, historical, Number, nativeChangeAmounts), { amount_usd: 1.23, amount_khr: 20.25 })

console.log('PASS fee picker, exact recovery and busy modal lifecycle contract')
