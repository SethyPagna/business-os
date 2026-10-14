// FX-exc1 item 3 (R-cp3a1 E1, 28 Sep 2026): the till restates the Worker's
// receipt_number_conflict refusal in the operator's language.
//
// POST /api/sales answers 409 { code: 'receipt_number_conflict' } when two
// sales mint the same receipt number at the same moment
// (cloudflare/src/routes/sales.ts). POS showed the server's English on both
// checkout paths -- the fresh submit reduced the error to its message before
// localizing, so the code was already gone, and the pending-retry path showed
// the message as is. frontend/src/api/saleSubmitErrors.ts now restates a coded
// refusal from the pack, on both paths, and leaves every other error to the
// localizing the path already did.
//
// Run: node tests/saleSubmitRefusal.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(here, '..')
const WORKER = path.resolve(here, '..', '..', 'cloudflare')

type Pack = Record<string, unknown>
const readPack = (name: string): Pack => JSON.parse(fs.readFileSync(path.join(FRONTEND, 'src', 'lang', `${name}.json`), 'utf8')) as Pack
const EN = readPack('en')
const KM = readPack('km')

function loadModule(rel: string, deps: Record<string, unknown> = {}): Record<string, any> {
  const file = path.join(FRONTEND, 'src', rel)
  assert.ok(fs.existsSync(file), `frontend/src/${rel} does not exist`)
  const code = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, (request: string) => {
    const hit = Object.entries(deps).find(([suffix]) => request.endsWith(suffix))
    if (!hit) throw new Error(`${rel} imports ${request}, which this test does not provide`)
    return hit[1]
  })
  return mod.exports
}

const failures: string[] = []
async function runCase(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error).split('\n').join('\n  ')}`)
  }
}

const SERVER_ENGLISH = 'Another sale took this receipt number at the same moment. Nothing was recorded. Try the sale again.'
const translator = (pack: Pack) => (key: string) => (typeof pack[key] === 'string' ? String(pack[key]) : undefined)
const apiError = (message: string, status: number, code: string | null) => Object.assign(new Error(message), { status, code })

await runCase('the Worker still answers the race with this code and this English', () => {
  const sales = fs.readFileSync(path.join(WORKER, 'src', 'routes', 'sales.ts'), 'utf8')
  assert.ok(sales.includes(`error: '${SERVER_ENGLISH}',`), 'routes/sales.ts answers the pinned English')
  assert.match(sales, /code: 'receipt_number_conflict',\s*\}, 409\)/, 'routes/sales.ts answers 409 receipt_number_conflict')
})

await runCase('both packs carry receipt_number_conflict; the Khmer is Khmer and uses the POS receipt-number term', () => {
  assert.equal(EN.receipt_number_conflict, SERVER_ENGLISH, 'en restates the Worker sentence')
  const khmer = String(KM.receipt_number_conflict || '')
  assert.match(khmer, /[ក-៿]/, 'km is Khmer')
  assert.notEqual(khmer, EN.receipt_number_conflict)
  assert.ok(khmer.includes('លេខវិក្កយបត្រ'), 'km names the receipt number the way the POS does (show_receipt_number)')
  assert.ok(khmer.includes('គ្មានអ្វីត្រូវបានកត់ត្រាទេ'), 'km says nothing was recorded')
})

const branchRules = loadModule('api/branchRuleErrors.ts')
const helper = (() => {
  try { return loadModule('api/saleSubmitErrors.ts', { '/branchRuleErrors.ts': branchRules }) } catch (error) { return { loadError: error } }
})()

for (const [language, pack] of [['en', EN], ['km', KM]] as const) {
  await runCase(`${language}: a receipt_number_conflict refusal is restated from the ${language} pack`, () => {
    assert.ok(!helper.loadError, String(helper.loadError))
    const text = helper.saleSubmitRefusalText(apiError(SERVER_ENGLISH, 409, 'receipt_number_conflict'), translator(pack))
    assert.equal(text, pack.receipt_number_conflict)
  })
}

// 13 Oct 2026: a stock movement that lands between a sale's reads and its write aborts the write (the batch's source guard
// compares every column of the product rows). The Worker used to answer that "Pricing changed ... Review the current
// quote."; it now says the stock changed, under its own code.
const STOCK_CHANGED_ENGLISH = 'Stock changed while this sale was being saved. Nothing was recorded. Try again.'
await runCase('the Worker answers a stock movement in the write window with this code and this English, from the create and the add-items routes', () => {
  const pricing = fs.readFileSync(path.join(WORKER, 'src', 'lib', 'saleItemPricing.ts'), 'utf8')
  assert.ok(pricing.includes(`SALE_STOCK_CHANGED_ERROR = '${STOCK_CHANGED_ENGLISH}'`), 'the pinned English')
  assert.ok(pricing.includes("SALE_STOCK_CHANGED_CODE = 'sale_stock_changed'"), 'the pinned code')
  const sales = fs.readFileSync(path.join(WORKER, 'src', 'routes', 'sales.ts'), 'utf8')
  assert.equal((sales.match(/error:SALE_STOCK_CHANGED_ERROR,code:SALE_STOCK_CHANGED_CODE\},409/g) || []).length, 2, 'POST /sales and POST /sales/:id/items both answer it')
  assert.ok(!/pric/i.test(STOCK_CHANGED_ENGLISH), 'it does not say pricing changed')
})

await runCase('both packs carry sale_stock_changed; en restates the Worker sentence, km is Khmer and says nothing was recorded', () => {
  assert.equal(EN.sale_stock_changed, STOCK_CHANGED_ENGLISH)
  const khmer = String(KM.sale_stock_changed || '')
  assert.match(khmer, /[ក-៿]/, 'km is Khmer')
  assert.notEqual(khmer, EN.sale_stock_changed)
  assert.ok(khmer.includes('ស្តុក'), 'km names the stock')
  assert.ok(khmer.includes('គ្មានអ្វីត្រូវបានកត់ត្រាទេ'), 'km says nothing was recorded')
  assert.ok(!khmer.includes('តម្លៃ'), 'km does not say the price changed')
})

for (const [language, pack] of [['en', EN], ['km', KM]] as const) {
  await runCase(`${language}: a sale_stock_changed refusal is restated from the ${language} pack on the till and by the generic localizer`, () => {
    assert.ok(!helper.loadError, String(helper.loadError))
    const refusal = apiError(STOCK_CHANGED_ENGLISH, 409, 'sale_stock_changed')
    assert.equal(helper.saleSubmitRefusalText(refusal, translator(pack)), pack.sale_stock_changed)
    // Paths that only reach the shared branch-rule localizer (the Sales page "Add items" modal) get it by code and by message.
    assert.equal(branchRules.localizeBranchRuleError(refusal, translator(pack)), pack.sale_stock_changed)
    assert.equal(branchRules.localizeBranchRuleError(STOCK_CHANGED_ENGLISH, translator(pack)), pack.sale_stock_changed)
  })
}

await runCase('a pricing change keeps its own refusal: it is still not restated as a stock change', () => {
  const t = translator(KM)
  const pricing = apiError('Pricing changed before the sale was saved. Review the current quote.', 409, 'sale_pricing_quote_conflict')
  assert.equal(helper.saleSubmitRefusalText(pricing, t), null)
  assert.notEqual(branchRules.localizeBranchRuleError(pricing, t), KM.sale_stock_changed)
})

await runCase('any other error is left to the path\'s own localizing (null)', () => {
  assert.ok(!helper.loadError, String(helper.loadError))
  const t = translator(KM)
  for (const error of [
    apiError('Pricing changed before the sale was saved. Review the current quote.', 409, 'sale_pricing_quote_conflict'),
    apiError('Only allow Shop sale. Please transfer to Shop first.', 400, null),
    new Error('Network down'),
    null,
    'receipt_number_conflict',
  ]) assert.equal(helper.saleSubmitRefusalText(error, t), null, JSON.stringify(error && (error as Error).message))
  // A pack without the key keeps the server's English rather than a blank toast.
  assert.equal(helper.saleSubmitRefusalText(apiError(SERVER_ENGLISH, 409, 'receipt_number_conflict'), () => undefined), null)
})

await runCase('both POS checkout paths restate the refusal before their own fallback', () => {
  const pos = fs.readFileSync(path.join(FRONTEND, 'src', 'components', 'pos', 'POS.tsx'), 'utf8')
  assert.match(pos, /import \{ saleSubmitRefusalText \} from '\.\.\/\.\.\/api\/saleSubmitErrors\.ts'/)
  // Pending-retry path (a saved checkout request retried).
  assert.match(pos, /notify\(saleSubmitRefusalText\(error, t\) \?\? \(getErrorMessage\(error\) === 'money_checkout_recovery_required'/)
  // Fresh submit path: the code is read from the error, not from its message.
  assert.match(pos, /notify\(saleSubmitRefusalText\(e, t\) \?\? localizeBranchRuleError\(getErrorMessage\(e, t\('error'\) \|\| 'Error'\), t\), 'error'\)/)
  // A result that carries the refusal instead of throwing it, on both paths.
  assert.equal(pos.match(/notify\(saleSubmitRefusalText\(result, t\) \?\? \(localizeBranchRuleError\(result\.error, t\) \|\| t\('error'\)\), 'error'\)/g)?.length, 2)
})

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll sale submit refusal checks passed.')
