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
const PLAN_CODES = ["stock_session_query_budget_exceeded","customer_return_over_plan_budget","stock_import_unit_over_tier_budget","stock_import_reconcile_over_tier_budget","import_queue_required"]
const CODES = [...PLAN_CODES,'branch_not_sellable', 'sale_branch_mismatch', 'sale_identity_conflict', 'unrecorded_stock_line_invalid', 'fee_branch_invalid', 'fee_sale_invalid', 'fee_sale_branch_mismatch', ...REDIRECT_CODES, 'product_has_stock', 'product_status_unsupported', 'product_replacement_incomplete', ...BULK_CODES, 'bulk_price_outcome_unknown']
const refusal = (code: unknown, message = 'Worker English', status = 400) => Object.assign(new Error(message), { status, code })

await runTest('queue-unavailable HTTP refusal keeps retryable 503 and stable code in Khmer', async () => {
  uiLanguage = 'km'; packServed = KM
  const error = refusal('import_queue_required', EN.import_queue_required, 503)
  await lang.restateBranchRefusal(error)
  assert.equal(error.message, KM.import_queue_required)
  assert.equal(error.status, 503)
  assert.equal(error.code, 'import_queue_required')
})

await runTest('the restated codes match the Worker refusals and their language pack keys', () => {
  assert.deepEqual(Object.keys(lang.RESTATED_REFUSAL_KEYS).sort(), [...CODES].sort())
  for (const code of CODES) {
    assert.equal(lang.RESTATED_REFUSAL_KEYS[code], code)
    assert.ok(EN[code] && KM[code] && EN[code] !== KM[code] && /[ក-៿]/.test(KM[code]), `${code} is a real pair`)
    assert.equal(BRANCH_RULE_CODE_KEYS[code], code, `branchRuleErrors maps ${code} too, for the surfaces that localize by t()`)
  }
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
