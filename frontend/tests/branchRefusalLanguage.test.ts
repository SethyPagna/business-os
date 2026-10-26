// Lane LI follow-up: the sale and expense writers' branch refusals reach a Khmer screen in Khmer.
//
// After the cutover a stale till (Old Shop) was refused with "Sales can only be recorded at the Shop. Transfer Warehouse
// stock to the Shop first." and an expense with "Every expense must use the active Shop branch." -- English sentences
// that name branches that no longer exist, shown as error.message on a Khmer screen. The Worker now sends a coded,
// role-neutral sentence (cloudflare/src/lib/branchRoleGuards.ts, routes/fees.ts) and api/http.ts restates it from the
// pack by code (api/branchRefusalLanguage.ts). This runs the real module (esbuild -> CommonJS) and pins the codes to the
// Worker's source, so renaming a code on either side fails here.
//
// Run: node tests/branchRefusalLanguage.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { BRANCH_RULE_CODE_KEYS, branchRuleErrorKey, branchRuleMessageKey, localizeBranchRuleError } from '../src/api/branchRuleErrors.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const WORKER = path.resolve(FRONTEND, '..', 'cloudflare', 'src')
const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), 'utf8')
const EN = JSON.parse(read(FRONTEND, 'src', 'lang', 'en.json')) as Record<string, string>
const KM = JSON.parse(read(FRONTEND, 'src', 'lang', 'km.json')) as Record<string, string>

let failed = 0
async function runTest(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

let uiLanguage = 'en'
let packServed: Record<string, string> = KM
let packLoads = 0
Object.assign(globalThis, { document: { documentElement: { getAttribute: (name: string) => (name === 'lang' ? uiLanguage : null) } } })

function loadModule(): { restateBranchRefusal: (error: Error & { code?: unknown }) => Promise<Error & { code?: unknown }>; RESTATED_REFUSAL_KEYS: Record<string, string> } {
  const source = read(FRONTEND, 'src', 'api', 'branchRefusalLanguage.ts')
  // dynamic-import off: the pack's import() becomes require(), served below.
  const code = transformSync(source, { loader: 'ts', format: 'cjs', supported: { 'dynamic-import': false } }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => {
    if (request.endsWith('/lang/km.json')) { packLoads += 1; return packServed }
    throw new Error(`branchRefusalLanguage.ts imports ${request}, which this harness does not provide`)
  })
  return mod.exports as never
}
const lang = loadModule()

// CUTOVER-LR adds the disabled-branch family (lib/branchEffect.ts), restated the same way when no redirect float answers.
const REDIRECT_CODES = ['branch_redirect_required', 'branch_redirect_target_invalid', 'branch_retired_no_successor', 'branch_retired_damaged_stock']
const BULK_CODES = ['bulk_delete_queue_unavailable', 'bulk_delete_queue_resume_required']
const PLAN_CODES = ["stock_session_query_budget_exceeded","customer_return_over_plan_budget","stock_import_unit_over_tier_budget","stock_import_reconcile_over_tier_budget","import_queue_required","import_apply_permission_revoked"]
const CODES = [...PLAN_CODES,'branch_not_sellable', 'sale_branch_mismatch', 'sale_identity_conflict', 'unrecorded_stock_line_invalid', 'fee_branch_invalid', 'fee_sale_invalid', 'fee_sale_branch_mismatch', ...REDIRECT_CODES, 'product_has_stock', 'product_status_unsupported', 'product_replacement_incomplete', 'product_merge_permission_required', ...BULK_CODES, 'bulk_price_outcome_unknown']
const refusal = (code: unknown, message = 'Worker English', status = 400) => Object.assign(new Error(message), { status, code })
const STOCK_ALIASES = { stock_schema_unavailable: 'stock_receipt_unavailable', stock_transaction_outcome_unknown: 'stock_request_outcome_unknown' }
// A step-up refusal of a destructive system route (cloudflare/src/lib/destructiveStepUp.ts), restated like the branch rules.
CODES.push('repair_integrity_restore_permission_required')
CODES.push('loyalty_points_disabled')
// Return money and product supplier refusals (6.0.930): each pack's English is the Worker's own sentence, word for word.
// [Worker file, code, status the Worker answers with (409 when not named)].
const WORKER_SENTENCE_CODES: Record<string, [string, string] | [string, string, number]> = {
  customer_return_owed_unreadable: ['lib/returnRefundSplit.ts', 'customer_return_owed_unreadable'],
  return_refund_khr_unavailable: ['routes/returns.ts', 'return_refund_khr_unavailable'],
  return_reopens_paid_sale_debt: ['lib/returnRefundSplit.ts', 'return_reopens_paid_sale_debt'],
  product_supplier_edit_required: ['lib/productSupplierGate.ts', 'product_supplier_edit_required'],
  // 6.0.926: a replacement line priced under the floor (403), and the two fixed texts that replaced the database's own message on a failed save (500).
  return_replacement_price_forbidden: ['lib/returnReplacementPrice.ts', 'return_replacement_price_forbidden', 403],
  // 6.0.958: PATCH /returns/:id that would leave a recorded replacement under its floor; the pack says to record the extra unit as a separate return.
  return_edit_replacement_floor: ['lib/returnReplacementPrice.ts', 'return_edit_replacement_floor', 403],
  // 6.0.963: restoring an exchange return from the list after its cancel moved the refund credit to Not Paid; the sentence is the Worker's word for word.
  return_restore_exchange_credit: ['lib/returnBulkAction.ts', 'return_restore_exchange_credit', 409],
  // 6.0.964: cancelling an exchange that handed change back; the sentence is the Worker's word for word.
  return_cancel_exchange_change: ['lib/returnBulkAction.ts', 'return_cancel_exchange_change', 409],
  // 6.0.965: an exchange of a sale line with no lot; the sentence is the Worker's word for word.
  return_exchange_line_no_lot: ['lib/returnExchangePlan.ts', 'return_exchange_line_no_lot', 409],
  supplier_return_failed: ['routes/returns.ts', 'supplier_return_failed', 500],
  return_edit_failed: ['routes/returns.ts', 'return_edit_failed', 500],
  // 6.0.949 (review P3-4): an import file that would move stock, approved without Adjust / receive at Full (403 at approve and at retry-as-apply).
  product_import_stock_adjust_required: ['lib/importEngine.ts', 'product_import_stock_adjust_required', 403],
  // 6.0.951: a changed default price without products:price. The Khmer is short on purpose (owner, 22 Oct): the essence, not a translation.
  product_price_edit_required: ['lib/productDiscountGate.ts', 'product_price_edit_required', 403],
}
// idempotency_conflict is the one restated code that is NOT one Worker sentence: about fifteen sentences across sales, returns, expenses,
// transfers and stock carry it, so its pack text is a single operator-language sentence for the class (checked below).
const SHARED_CODES = ['idempotency_conflict', 'money_precision_review_needed']
CODES.push(...Object.keys(WORKER_SENTENCE_CODES), ...SHARED_CODES)

await runTest('return money and supplier refusals carry the Worker sentence as English and a real Khmer pair', async () => {
  for (const [code, [file, , status = 409]] of Object.entries(WORKER_SENTENCE_CODES)) {
    const source = read(WORKER, ...file.split('/'))
    assert.ok(source.includes(code), code + ' is still a Worker code in ' + file)
    assert.ok(source.includes(EN[code]), code + ': the English pack text is the Worker sentence in ' + file)
    uiLanguage = 'km'; packServed = KM
    const error = refusal(code, EN[code], status)
    await lang.restateBranchRefusal(error)
    assert.equal(error.message, KM[code]); assert.equal(error.code, code); assert.equal((error as { status?: number }).status, status, code + ' keeps its status')
  }
  uiLanguage = 'en'
})

await runTest('the failed-save and price-floor texts are the Worker fixed sentences, with the response status and code beside them', () => {
  const returns = read(WORKER, 'routes', 'returns.ts')
  assert.ok(returns.includes(`unexpectedFailureBody('returns', error, '${EN.supplier_return_failed}', 'supplier_return_failed'), 500)`), 'POST /returns/supplier answers a failed save with the fixed text, 500, detail to the log')
  assert.ok(returns.includes(`unexpectedFailureBody('returns', error, '${EN.return_edit_failed}', 'return_edit_failed'), 500)`), 'PATCH /returns/:id answers a failed save with the fixed text, 500, detail to the log')
  const price = read(WORKER, 'lib', 'returnReplacementPrice.ts')
  assert.ok(price.includes(`error: '${EN.return_replacement_price_forbidden}',`) && price.includes("code: 'return_replacement_price_forbidden',"))
  assert.ok(returns.includes('RETURN_REPLACEMENT_PRICE_REFUSAL, product_id: offender.productId }, 403)'), 'refused with 403 before anything is written')
  // The two failed-save texts replaced an interpolated (error as Error).message: no database text is put into either response any more.
  assert.ok(!returns.includes('Failed to record supplier return items'), 'the raw supplier failure text is gone')
  assert.ok(!returns.includes('Failed to update return:'), 'the raw return-edit failure text is gone')
})

await runTest('the import stock-adjust refusal is the Worker coded 403 at approve and retry-as-apply, for products, inventory and stock-action files alike', async () => {
  const engine = read(WORKER, 'lib', 'importEngine.ts')
  assert.ok(engine.includes(`error: '${EN.product_import_stock_adjust_required}',`) && engine.includes("code: 'product_import_stock_adjust_required',"), 'PRODUCT_IMPORT_STOCK_REFUSAL is the pack English, word for word')
  assert.ok(/export function isStockAdjustImportType\(type: string\): boolean \{\s*return type === 'products' \|\| type === 'inventory' \|\| type === 'stock_actions'\s*\}/.test(engine), 'the refusal is reachable from all three import types (inventory and stock actions since 6.0.946)')
  const jobs = read(WORKER, 'routes', 'importJobs.ts')
  assert.ok(jobs.includes('return c.json({ success: false, ...PRODUCT_IMPORT_STOCK_REFUSAL }, 403)'), 'refused with 403 before anything is queued')
  assert.equal((jobs.match(/const stockDenied = await requireChangedProductImportStockAction\(c as any, job\)/g) || []).length, 2, 'at approve and at retry-as-apply')
  uiLanguage = 'km'; packServed = KM
  const error = refusal('product_import_stock_adjust_required', EN.product_import_stock_adjust_required, 403)
  await lang.restateBranchRefusal(error)
  assert.equal(error.message, KM.product_import_stock_adjust_required); assert.equal(error.code, 'product_import_stock_adjust_required'); assert.equal((error as { status?: number }).status, 403)
  assert.equal(localizeBranchRuleError(error, key => KM[key]), KM.product_import_stock_adjust_required, 'a t() surface restates it by code too')
  assert.match(KM.product_import_stock_adjust_required, /កែតម្រូវស្តុក/, 'it names adjusting stock in the term the pack already uses (perm_act_inventory_adjust)')
  uiLanguage = 'en'
  assert.equal((await lang.restateBranchRefusal(refusal('product_import_stock_adjust_required', EN.product_import_stock_adjust_required, 403))).message, EN.product_import_stock_adjust_required, 'an English screen keeps the Worker sentence')
})

await runTest('idempotency_conflict is restated for every request-id refusal with one sentence that names no internal field', async () => {
  const sources = [['lib', 'supplierReturnReceipt.ts'], ['routes', 'returns.ts'], ['routes', 'sales.ts'], ['routes', 'fees.ts']].map(parts => read(WORKER, ...parts))
  for (const source of sources) assert.ok(source.includes("code: 'idempotency_conflict'"), 'the Worker still sends the code')
  // The Worker sentences differ (and name client_request_id); the pack's single sentence must not claim to be any of them.
  assert.ok(!/client_request_id|request identity/i.test(EN.idempotency_conflict + KM.idempotency_conflict), 'no internal field name reaches the operator')
  assert.ok(sources.every(source => !source.includes(EN.idempotency_conflict)), 'it is a class sentence, not one Worker sentence')
  assert.match(EN.idempotency_conflict, /nothing was changed/i); assert.match(KM.idempotency_conflict, /គ្មានអ្វីត្រូវបានផ្លាស់ប្ដូរ/)
  uiLanguage = 'km'; packServed = KM
  for (const worker of ['client_request_id was already used for different return data.', 'client_request_id is already owned by another return.', 'Request identity was used for different sale data.']) {
    const error = refusal('idempotency_conflict', worker, 409)
    assert.equal((await lang.restateBranchRefusal(error)).message, KM.idempotency_conflict, worker)
    assert.equal(error.code, 'idempotency_conflict'); assert.equal((error as { status?: number }).status, 409)
  }
  uiLanguage = 'en'
  const english = 'client_request_id was already used for different return data.'
  assert.equal((await lang.restateBranchRefusal(refusal('idempotency_conflict', english, 409))).message, english, 'an English screen keeps the Worker sentence')
  assert.equal(branchRuleErrorKey({ code: 'idempotency_conflict' }), 'idempotency_conflict')
  // A surface that decides on the code (stock lines: "remove and add again") keeps its own, more specific text.
  const outcome = read(FRONTEND, 'src', 'utils', 'stockAdjustOutcome.ts')
  assert.ok(/idempotency_conflict: \{\s*key: 'stock_request_id_conflict'/.test(outcome), 'stock lines still say what to do')
})

await runTest('loyalty refusal is localized without promising retroactive points or changing its status', async () => {
  uiLanguage = 'km'; packServed = KM
  const error = refusal('loyalty_points_disabled', 'Loyalty points are disabled.')
  await lang.restateBranchRefusal(error)
  assert.equal(error.message, KM.loyalty_points_disabled)
  assert.equal(error.status, 400)
  assert.equal(error.code, 'loyalty_points_disabled')
  assert.equal(localizeBranchRuleError(error, key => KM[key]), KM.loyalty_points_disabled)
  assert.equal(branchRuleMessageKey(EN.loyalty_points_disabled), 'loyalty_points_disabled')
  assert.match(EN.loyalty_points_disabled, /before the reset or while loyalty was off cannot earn points/)
  assert.match(KM.loyalty_points_disabled, /មុនការកំណត់ពិន្ទុឡើងវិញ.*មិនអាចទទួលពិន្ទុបានទេ/)
})

await runTest('queue-unavailable HTTP refusal keeps retryable 503 and stable code in Khmer', async () => {
  uiLanguage = 'km'; packServed = KM
  const error = refusal('import_queue_required', EN.import_queue_required, 503)
  await lang.restateBranchRefusal(error)
  assert.equal(error.message, KM.import_queue_required)
  assert.equal(error.status, 503)
  assert.equal(error.code, 'import_queue_required')
})

await runTest('changed import authority keeps conflict status and localizes the real refusal', async () => {
  uiLanguage = 'km'; packServed = KM
  const error = refusal('import_apply_permission_revoked', EN.import_apply_permission_revoked, 409)
  assert.equal(await lang.restateBranchRefusal(error), error)
  assert.equal(error.message, KM.import_apply_permission_revoked)
  assert.equal(error.status, 409)
  assert.equal(error.code, 'import_apply_permission_revoked')
  assert.equal(localizeBranchRuleError(error, key => KM[key]), KM.import_apply_permission_revoked)
})

await runTest('money_precision_review_needed is restated at all four Worker sites with one restart-or-reload sentence', async () => {
  const sales = read(WORKER, 'routes', 'sales.ts'), returns = read(WORKER, 'routes', 'returns.ts')
  assert.equal((sales.match(/code: 'money_precision_review_needed'/g) || []).length, 3, 'POST /sales, POST /sales/:id/items and amendments')
  assert.equal((returns.match(/code: 'money_precision_review_needed'/g) || []).length, 1, 'returns create and edit share one constant')
  assert.match(EN.money_precision_review_needed, /restart or reload/i)
  assert.ok(!sales.includes(EN.money_precision_review_needed) && !returns.includes(EN.money_precision_review_needed), 'a class sentence, not one Worker sentence')
  uiLanguage = 'km'; packServed = KM
  for (const worker of ['Keep this return and review it with the current app before recording it.', 'Preserve the pending request and review this basket with the current app.']) {
    const error = refusal('money_precision_review_needed', worker, 409)
    assert.equal((await lang.restateBranchRefusal(error)).message, KM.money_precision_review_needed, worker)
    assert.equal(error.code, 'money_precision_review_needed'); assert.equal((error as { status?: number }).status, 409)
  }
  assert.equal(localizeBranchRuleError(refusal('money_precision_review_needed', 'x', 409), key => KM[key]), KM.money_precision_review_needed)
  uiLanguage = 'en'
})

await runTest('the restated codes match the Worker refusals and their language pack keys', () => {
  assert.deepEqual(Object.keys(lang.RESTATED_REFUSAL_KEYS).sort(), [...CODES, ...Object.keys(STOCK_ALIASES)].sort())
  for (const code of CODES) {
    assert.equal(lang.RESTATED_REFUSAL_KEYS[code], code)
    assert.ok(EN[code] && KM[code] && EN[code] !== KM[code] && /[ក-៿]/.test(KM[code]), `${code} is a real pair`)
    assert.equal(BRANCH_RULE_CODE_KEYS[code], code, `branchRuleErrors maps ${code} too, for the surfaces that localize by t()`)
  }
})

await runTest('stock admission and uncertain outcome retain distinct localized recovery messages', async () => {
  const source = read(WORKER, 'lib', 'stockTransaction.ts')
  uiLanguage = 'km'; packServed = KM
  for (const [code, key] of Object.entries(STOCK_ALIASES)) {
    assert.ok(source.includes(`readonly code = '${code}'`))
    assert.equal(lang.RESTATED_REFUSAL_KEYS[code], key)
    assert.equal(branchRuleErrorKey({ code }), key)
    assert.ok(EN[key] && KM[key] && EN[key] !== KM[key] && /[ក-៿]/.test(KM[key]))
    const error = refusal(code, 'Worker stock refusal', 503)
    assert.equal(await lang.restateBranchRefusal(error), error)
    assert.equal(error.message, KM[key]); assert.equal(error.status, 503); assert.equal(error.code, code)
  }
  assert.notEqual(STOCK_ALIASES.stock_schema_unavailable, STOCK_ALIASES.stock_transaction_outcome_unknown)
})

await runTest('uncertain catalog price HTTP result keeps 503, original-request wording and stable code in Khmer', async () => {
  const products = read(WORKER, 'routes', 'products.ts')
  assert.ok(products.includes(`error: '${EN.bulk_price_outcome_unknown}', code: 'bulk_price_outcome_unknown' }, 503)`))
  uiLanguage = 'km'; packServed = KM
  const error = refusal('bulk_price_outcome_unknown', EN.bulk_price_outcome_unknown, 503)
  await lang.restateBranchRefusal(error)
  assert.equal(error.message, KM.bulk_price_outcome_unknown)
  assert.equal(error.status, 503)
  assert.equal(error.code, 'bulk_price_outcome_unknown')
})

await runTest('every code is one the Worker really sends, with the pack English as its sentence', () => {
  const planSources = ['stockSession.ts', 'returnCreateAction.ts', 'importEngine.ts'].map(file => read(WORKER, 'lib', file)).join('\n')
  for (const code of PLAN_CODES) { assert.ok(planSources.includes(code)); assert.ok(planSources.includes(EN[code]), code) }
  const guards = read(WORKER, 'lib', 'branchRoleGuards.ts')
  const fees = read(WORKER, 'routes', 'fees.ts')
  const sales = read(WORKER, 'routes', 'sales.ts')
  for (const code of ['branch_not_sellable', 'sale_branch_mismatch', 'sale_identity_conflict', 'unrecorded_stock_line_invalid']) {
    assert.ok(guards.includes(`= '${code}'`), `${code} is a branchRoleGuards.ts code`)
  }
  for (const code of ['fee_branch_invalid', 'fee_sale_invalid', 'fee_sale_branch_mismatch']) {
    assert.ok(fees.includes(`code: '${code}'`), `${code} is a fees.ts code`)
    assert.ok(fees.includes(`error: '${EN[code]}'`), `fees.ts sends the pack English for ${code}`)
  }
  assert.equal((sales.match(/NOT_SELLING_BRANCH_BODY, 400\)/g) || []).length, 8, 'every sale refusal of a non-selling branch is the coded body')
  const effect = read(WORKER, 'lib', 'branchEffect.ts')
  for (const code of REDIRECT_CODES) {
    const constant = new RegExp(`export const (BRANCH_[A-Z_]+)_CODE = '${code}'`).exec(effect)
    assert.ok(constant, `${code} is a branchEffect.ts code`)
    const english = new RegExp(`export const ${constant[1]}_ERROR = '([^']+)'`).exec(effect)
    assert.equal(english?.[1], EN[code], `branchEffect.ts sends the pack English for ${code}`)
  }
  assert.equal((sales.match(/SALE_BRANCH_MISMATCH_BODY, 400\)/g) || []).length, 4, 'every header/line branch disagreement is the coded body')
  const stepUp = read(WORKER, 'lib', 'destructiveStepUp.ts')
  assert.ok(stepUp.includes("REPAIR_INTEGRITY_PERMISSION_CODE = 'repair_integrity_restore_permission_required'"), 'the data-repair permission refusal is destructiveStepUp.ts code')
  assert.ok(stepUp.includes("REPAIR_INTEGRITY_PERMISSION_ERROR = '" + EN.repair_integrity_restore_permission_required + "'"), 'destructiveStepUp.ts sends the pack English for it')
})

await runTest('the merge-permission refusal is the Worker\'s own coded 403, with the pack English as its sentence', () => {
  // cloudflare/src/routes/products.ts PRODUCT_MERGE_PERMISSION_REFUSAL, returned by identityFoldRefusal before the review queue.
  const route = read(WORKER, 'routes', 'products.ts')
  assert.ok(route.includes(`error: '${EN.product_merge_permission_required}',`), 'the Worker sends the pack English word for word')
  assert.ok(route.includes("code: 'product_merge_permission_required',"))
  assert.ok(route.includes('return c.json(PRODUCT_MERGE_PERMISSION_REFUSAL, 403)'), 'refused with 403, not queued')
})

await runTest('the merge-permission refusal says what to do next, in both languages, and a text-only surface maps it too', () => {
  // The refusal pattern: why it was refused AND the way forward (change the identity, or ask someone who can merge).
  assert.match(EN.product_merge_permission_required, /Change the name or barcode, or ask someone who can merge products\.$/)
  assert.match(KM.product_merge_permission_required, /សូមប្ដូរឈ្មោះ ឬបាកូដ ឬសុំអ្នកដែលអាចបញ្ចូលផលិតផលចូលគ្នាបាន។$/)
  assert.equal(branchRuleMessageKey(EN.product_merge_permission_required), 'product_merge_permission_required')
  assert.equal(localizeBranchRuleError(`Could not update the product: ${EN.product_merge_permission_required}`, key => KM[key]), KM.product_merge_permission_required)
})

await runTest('on a Khmer screen each refusal becomes the Khmer pack text, keeping its code and status', async () => {
  uiLanguage = 'km'; packServed = KM
  for (const code of CODES) {
    const error = refusal(code, EN[code])
    const out = await lang.restateBranchRefusal(error)
    assert.equal(out, error, 'the same error object is rethrown, so every catch that checks identity or fields still works')
    assert.equal(out.message, KM[code], code)
    assert.equal(out.code, code); assert.equal((out as { status?: number }).status, 400)
  }
})

await runTest('on an English screen the Worker sentence is left alone and no pack is loaded', async () => {
  uiLanguage = 'en'; packLoads = 0
  for (const code of CODES) assert.equal((await lang.restateBranchRefusal(refusal(code, EN[code]))).message, EN[code])
  uiLanguage = ''
  assert.equal((await lang.restateBranchRefusal(refusal('branch_not_sellable', 'x'))).message, 'x')
  assert.equal(packLoads, 0)
})

await runTest('any other refusal is untouched: another code, no code, a prototype name', async () => {
  uiLanguage = 'km'; packServed = KM
  for (const code of ['write_conflict', 'transfer_direction_invalid', 'canonical_branch_configuration_invalid', null, undefined, 'toString', 'constructor', 42]) {
    assert.equal((await lang.restateBranchRefusal(refusal(code, 'Worker English'))).message, 'Worker English', String(code))
  }
})

await runTest('a pack without the key, or one that cannot load, keeps the Worker English', async () => {
  uiLanguage = 'km'
  packServed = {}
  assert.equal((await lang.restateBranchRefusal(refusal('fee_branch_invalid', 'Worker English'))).message, 'Worker English')
  packServed = { fee_branch_invalid: '   ' }
  assert.equal((await lang.restateBranchRefusal(refusal('fee_branch_invalid', 'Worker English'))).message, 'Worker English', 'a blank value is not a translation')
  packServed = KM
})

await runTest('http.ts restates before it throws, so every surface that shows error.message is covered', () => {
  const http = read(FRONTEND, 'src', 'api', 'http.ts')
  // Loaded on the refusal path only (dynamic import) so the storefront catalog closure does not carry it.
  assert.ok(http.includes("import('./branchRefusalLanguage.ts')"), 'loaded lazily')
  assert.ok(!http.split(String.fromCharCode(10)).some((line) => line.startsWith('import ') && line.includes('branchRefusalLanguage')), 'never a static import')
  const call = http.indexOf('.restateBranchRefusal(apiError)')
  assert.ok(call > http.indexOf('const apiError = createApiError(res.status, parsed, text)'), 'after the error is built')
  assert.ok(call < http.indexOf('throw apiError || new Error('), 'and before it is thrown')
})

await runTest('surfaces that localize by t() map the new codes and the old English a Worker in flight still sends', () => {
  const t = (key: string) => KM[key]
  for (const code of CODES) assert.equal(branchRuleErrorKey({ code, message: 'anything' }), code)
  for (const [old, key] of [
    ['Sales can only be recorded at the Shop. Transfer Warehouse stock to the Shop first.', 'branch_not_sellable'],
    ['Every expense must use the active Shop branch.', 'fee_branch_invalid'],
    ['Choose an existing sale recorded at the Shop.', 'fee_sale_invalid'],
    ['The linked sale and expense must use the same Shop branch.', 'fee_sale_branch_mismatch'],
    ['The sale header and every line must use the same Shop branch.', 'sale_branch_mismatch'],
    ['The sale header and every added line must use the same Shop branch.', 'sale_branch_mismatch'],
    ['The sale header and every amended line must use the same Shop branch.', 'sale_branch_mismatch'],
    ['The sale header and replacement line must use the same Shop branch.', 'sale_branch_mismatch'],
    ['The Shop or batch changed while this sale was being recorded. Refresh the sale and pick the current batch before trying again.', 'sale_identity_conflict'],
    ['Unrecorded stock must be a regular Shop sale line.', 'unrecorded_stock_line_invalid'],
  ] as const) {
    assert.equal(branchRuleMessageKey(old), key, old)
    assert.equal(localizeBranchRuleError(`Could not update the sale: ${old}`, t), KM[key], 'a wrapped message is restated whole')
  }
})

await runTest('bulk job status strings translate by exact code without classifying arbitrary error text', () => {
  for (const code of BULK_CODES) {
    assert.equal(localizeBranchRuleError(code, key => KM[key]), KM[code])
    assert.equal(localizeBranchRuleError(code, key => EN[key]), EN[code])
  }
  for (const text of ['constructor', 'toString', 'bulk_delete_queue_resume_required_extra']) {
    assert.equal(branchRuleErrorKey(text), null)
    assert.equal(localizeBranchRuleError(text, key => KM[key]), text)
  }
  const products = read(FRONTEND, 'src', 'components', 'products', 'Products.tsx')
  assert.ok(products.includes('localizeBranchRuleError(status.lastError, t)'), 'the polling consumer translates the saved job code')
  const route = read(WORKER, 'routes', 'products.ts')
  assert.ok(route.includes("code === 'bulk_delete_queue_unavailable'"), 'admission failure preserves the stable code')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('branch refusal language tests passed')
