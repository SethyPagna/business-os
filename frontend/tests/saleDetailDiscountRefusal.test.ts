import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { saleSubmitRefusalText } from '../src/api/saleSubmitErrors.ts'
import { SaleDiscountRefusedError } from '../src/utils/saleItemPricing.ts'

const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const t = (key: string) => en[key]
const modal = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
function actual(source: string, name: string, env: Record<string, unknown>) {
  const parsed = ts.createSourceFile('actual.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => { if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(parsed) === name) found = node; ts.forEachChild(node, visit) }
  visit(parsed)
  assert.ok(found, name)
  const text = ts.isFunctionDeclaration(found) ? `(${found.getText(parsed).replace(/^export\s+/, '')})` : (found as ts.VariableDeclaration).initializer!.getText(parsed)
  const code = ts.transpileModule('const actual = ' + text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return new Function('env', 'with(env) { ' + code + '; return actual }')(env)
}

const priceSentence = en.sale_discount_exceeds_price
assert.ok(priceSentence && km.sale_discount_exceeds_price && km.sale_discount_exceeds_price !== priceSentence, 'both packs carry their own sentence')

{
  const errors: string[] = [], staged: unknown[] = []
  const env: Record<string, unknown> = {
    amendQtyText: '1', amendPriceText: '9.5', amendDiscountType: 'fixed', amendDiscountText: '12', items: [], sale: {},
    saleLineEditPreview: () => { throw new SaleDiscountRefusedError('sale_discount_exceeds_price', 'line-a') }, sellingPriceCeilCent: Number,
    saleSubmitRefusalText, t, translateOr: (_key: string, english: string) => english, fmtUSD: String,
    setAmendMutationError: (value: string) => errors.push(value), stageAmendReview: (value: unknown) => staged.push(value),
    amendRequestIdRef: { current: '' }, createSettlementRequestId: () => 'id', headerQuote: () => ({}),
  }
  actual(modal, 'stageLineUpdate', env)(7, 1, 9.5, null, 0, 0, 'Powder')
  assert.deepEqual(staged, [])
  assert.equal(errors.at(-1), priceSentence, 'a refused discount names the rule instead of the generic precision error')
  env.saleLineEditPreview = () => { throw new Error('sale_item_pricing_invalid') }
  actual(modal, 'stageLineUpdate', env)(7, 1, 9.5, null, 0, 0, 'Powder')
  assert.equal(errors.at(-1), en.money_precision_unavailable, 'any other failure keeps the generic sentence')
  console.log('PASS actual line-edit staging shows the discount refusal sentence')
}

{
  const provesNoCommit = actual(sales, 'saleLineRefusalProvesNoCommit', {})
  assert.equal(provesNoCommit({ status: 400, code: 'sale_discount_exceeds_price' }), true, 'a discount refusal is answered before any write')
  assert.equal(provesNoCommit({ status: 400, code: 'sale_discount_exceeds_subtotal' }), true)
  for (const name of ['handleAmendSale', 'handleAddSaleItems']) {
    const thrown = Object.assign(new Error('A fixed discount cannot be larger than the item price.'), { status: 400, code: 'sale_discount_exceeds_price' })
    const env: Record<string, unknown> = {
      statusSecurityRef: { current: 'scope' }, aliveRef: { current: true }, canAmendSales: true, canAddSaleItems: true, notify: () => {},
      translateOr: (_key: string, english: string) => english, t, withLoaderTimeout: async (run: () => unknown) => run(),
      getSalesApi: () => ({ amendSale: async () => { throw thrown }, addSaleItems: async () => { throw thrown } }),
      saleLineRefusalProvesNoCommit: provesNoCommit, directMutationOutcomeIsUnknown: () => false, isWriteConflict: () => false,
      getErrorMessage: (error: Error) => error.message, saleInvalidRateMessage: () => null, SALES_ADD_ITEMS_MUTATION_TIMEOUT_MS: 1,
    }
    const result = await actual(sales, name, env)(41, name === 'handleAmendSale' ? { client_request_id: 'x' } : [{ product_id: 2, quantity: 1 }], { client_request_id: 'x' })
    assert.equal(result.code, 'sale_discount_exceeds_price', `${name} keeps the refusal code`)
    assert.equal(result.proven_uncommitted, true, `${name} releases the refused request`)
  }
  console.log('PASS actual Sales handlers pass the discount refusal code through as a proven non-commit')
}

{
  const errors: string[] = []
  const result = { mutationError: 'Could not update the sale: A fixed discount cannot be larger than the item price.', code: 'sale_discount_exceeds_price', proven_uncommitted: true }
  const env: Record<string, unknown> = {
    onAmend: true, sale: { id: 41 }, amendConfirm: null, lineDraftOwned: () => true, detailScope: 'd', detailScopeRef: { current: 'd' }, detailAliveRef: { current: true },
    setAmendSaving: () => {}, moneyCapability: { assertReady() {} }, executeLineMutation: async () => result, saleSubmitRefusalText, t, stockRedirectFields: () => ({}),
    translateOr: (_key: string, english: string) => english, localizeBranchRuleError: (message: string) => message, setAmendMutationError: (value: string) => errors.push(value),
  }
  await actual(modal, 'submitAmendment', env)({ request: {}, draft: {} })
  assert.equal(errors.at(-1), priceSentence, 'the server refusal reads in the pack language, not the Worker English')
  const addErrors: string[] = []
  const addEnv: Record<string, unknown> = { ...env, onAddItems: true, addReview: { draft: {}, body: {} }, setAddSaving: () => {}, setAddMutationError: (value: string) => addErrors.push(value) }
  await actual(modal, 'submitAddItems', addEnv)()
  assert.equal(addErrors.at(-1), priceSentence)
  console.log('PASS actual amend and add confirmations restate a server discount refusal from the pack')
}

assert.match(modal, /catch \(error\) \{ return \{ refusal: saleSubmitRefusalText\(error, t\), editor: null \} \}/, 'the live preview keeps the refusal instead of going blank')
assert.match(modal, /\{editorRefusal \? <p role="alert" data-sale-line-discount-refusal=""/, 'the refusal shows under the discount input')
assert.match(modal, /amendMutationError && !amendConfirm && amendMutationError !== editorRefusal \? <p role="alert" data-sale-line-edit-error=""/, 'line-edit staging and redo messages render inside the line editor')
console.log('PASS live line preview shows the refusal under the discount and the line editor shows its own errors')
