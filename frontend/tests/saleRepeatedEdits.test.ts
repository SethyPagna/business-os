import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { mutationVersionAtLeast } from '../src/utils/directMutationRequest.ts'
import { parseDeliveryAmountUsd, deliveryAmountChanged } from '../src/utils/deliveryAmounts.ts'

const modal = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
function callback(source: string, name: string, env: any) {
  const parsed = ts.createSourceFile('actual.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) initializer = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(initializer, name)
  const code = ts.transpileModule('const actual = ' + initializer.getText(parsed), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('env', 'with(env) { ' + code + '; return actual }')(env)
}
const r0 = '2026-10-04T01:00:00.000Z'
const r1 = '2026-10-04T01:00:01.000Z'
const r2 = '2026-10-04T01:00:02.000Z'
function fixture() {
  let sequence = 0
  const env: any = {
    sale: { id: 8, updated_at: r0, exchange_rate: 4000 }, savedExchangeRate: 4000,
    detailScope: 'actor-one:8', lineMutationActor: 'actor-one', lineRefreshRequired: false,
    captureActorReadScope: () => ({ actor: 'actor-one' }), isActorReadScopeCurrent: (scope: any) => scope.actor === env.lineMutationActor,
    amendDraftRef: { current: null }, addDraftRef: { current: null }, amendRequestIdRef: { current: 'amend-0' }, addRequestIdRef: { current: 'add-0' },
    createSettlementRequestId: () => 'request-' + (++sequence), structuredClone,
    t: (key: string) => key, translateOr: (_key: string, english: string) => english, fmtUSD: String,
    detailAliveRef: { current: true }, detailScopeRef: { current: 'actor-one:8' },
    onAmend: true, onAddItems: true, onClose: () => { env.closed = true },
    moneyCapability: { assertReady() {} }, localizeBranchRuleError: (error: string) => error,
    settlementSession: { expectedUpdatedAt: r0, exchangeRate: 4000, rows: [{ method: 'Cash', amount_usd: 5 }], requestId: 'tender-original' },
    settlementRows: [{ method: 'Cash', amount_usd: 5 }], settlementBaselineRef: { current: [{ method: 'Cash', amount_usd: 0 }] },
    settlementRequestIdRef: { current: 'tender-original' },
    sent: [] as any[], executeLineMutation: async (kind: string, body: any) => { env.sent.push({ kind, body: structuredClone(body) }); return { committed: true } },
    parseDeliveryAmountUsd, deliveryAmountChanged, DELIVERY_AMOUNT_ERROR_KEYS: {}, actualCostText: '2.50',
    addLines: [{ productId: 22, quantity: 1, branchId: 1, batchId: 72, batchLabel: 'Original date', unitPriceUsd: 3, name: 'Added' }],
    addedSubtotalUsd: 3, addHeaderQuote: { total_usd: 12.5 },
    stagedLinePricingIntent: (line: any, rate: number) => ({ pricing_quote: { total_usd: line.unitPriceUsd * line.quantity, total_khr: line.unitPriceUsd * line.quantity * rate } }),
  }
  for (const name of ['AmendSaving', 'AmendLineId', 'ReplaceLineId', 'FeeEditing', 'ActualCostEditing', 'DeliveryAdding', 'DeliveryContact', 'DeliverySearch', 'AmendQtyText', 'AmendPriceText', 'AmendDiscountText', 'AmendDiscountType', 'AmendReloadToken', 'AddSaving', 'AddConfirmOpen', 'AddLines', 'AmendMutationError', 'AddMutationError']) {
    env['set' + name] = (value: any) => { env[name] = typeof value === 'function' ? value(env[name] || 0) : value }
  }
  env.setAmendConfirm = (value: any) => { env.amendConfirm = value }
  env.setAddReview = (value: any) => { env.addReview = value }
  for (const name of ['captureLineDraft', 'lineDraftOwned', 'lineDraftCurrent', 'lineDraftConflict', 'stageAmendReview', 'submitAmendment', 'stageActualDeliveryCostAmendment', 'stageAddReview', 'submitAddItems']) env[name] = callback(modal, name, env)
  return env
}
const tenderState = (env: any) => JSON.stringify([env.settlementSession, env.settlementRows, env.settlementBaselineRef.current, env.settlementRequestIdRef.current])
{
  const env = fixture(), tender = tenderState(env), ids: string[] = []
  for (const [version, quantity] of [[r0, 2], [r1, 3], [r2, 1]] as const) {
    env.sale = { ...env.sale, updated_at: version }
    env.amendDraftRef.current = env.captureLineDraft()
    env.amendRequestIdRef.current = env.createSettlementRequestId()
    ids.push(env.amendRequestIdRef.current)
    env.stageAmendReview({ request: { kind: 'line_updated', quantity }, title: 'Quantity', summary: String(quantity) })
    await env.submitAmendment()
    assert.equal(env.sent.at(-1).body.expected_updated_at, version)
    assert.equal(env.sent.at(-1).body.quantity, quantity)
  }
  assert.equal(new Set(ids).size, 3)
  assert.equal(tenderState(env), tender, 'new line reviews must not rebase typed tender or its baseline')
  console.log('PASS actual line-review callbacks advance only new reviews across three same-scope edits')
}
{
  const env = fixture(), tender = tenderState(env)
  env.amendDraftRef.current = env.captureLineDraft()
  env.stageActualDeliveryCostAmendment(1)
  const reviewed = structuredClone(env.amendConfirm.request)
  assert.equal(reviewed.kind, 'delivery_actual_cost_changed')
  assert.equal(Object.hasOwn(reviewed, 'expected_header_quote'), false)
  env.sale = { ...env.sale, updated_at: r1, exchange_rate: 4100 }
  env.savedExchangeRate = 4100
  env.amendRequestIdRef.current = 'later-unrelated-id'
  await env.submitAmendment()
  assert.deepEqual(env.sent[0].body, reviewed, 'confirmation without header quote must retain reviewed R0, rate, ID and intent')
  assert.equal(reviewed.expected_updated_at, r0)
  assert.equal(tenderState(env), tender)
  console.log('PASS actual cost confirmation preserves old review through a later row and FX refresh')
}
{
  const env = fixture()
  env.amendDraftRef.current = env.captureLineDraft()
  env.sale = { ...env.sale, updated_at: r1 }
  env.stageActualDeliveryCostAmendment(1)
  assert.equal(env.amendConfirm, undefined)
  assert.equal(env.actualCostText, '2.50')
  assert.equal(env.sent.length, 0)
  assert.ok(env.AmendMutationError)
  env.lineMutationActor = 'actor-two'
  env.stageAmendReview({ request: { kind: 'line_removed' }, title: '', summary: '' })
  assert.equal(env.amendConfirm, undefined)
  console.log('PASS draft-start revision and actor protect staging without clearing typed values')
}
{
  const env = fixture(), tender = tenderState(env)
  env.sale = { ...env.sale, updated_at: r1 }
  env.addDraftRef.current = env.captureLineDraft()
  env.stageAddReview()
  const reviewed = structuredClone(env.addReview.body)
  env.sale = { ...env.sale, updated_at: r2 }
  env.savedExchangeRate = 4200
  env.addLines[0].quantity = 99
  env.addHeaderQuote.total_usd = 999
  env.addRequestIdRef.current = 'changed-after-review'
  await env.submitAddItems()
  assert.deepEqual(env.sent[0].body, reviewed)
  assert.equal(reviewed.expected_updated_at, r1, 'amendment then newly staged Add must not borrow tender R0')
  assert.equal(reviewed.items[0].quantity, 1)
  assert.equal(env.closed, true, 'normal committed Add close behavior remains')
  assert.equal(tenderState(env), tender)
  console.log('PASS Add captures full request, reviewed rate and latest new-review revision independently of tender')
}
{
  const env = fixture()
  env.amendDraftRef.current = env.captureLineDraft()
  env.stageActualDeliveryCostAmendment(1)
  env.lineMutationActor = 'actor-two'
  await env.submitAmendment()
  assert.equal(env.sent.length, 0)
  env.lineMutationActor = 'actor-one'
  env.sale = { ...env.sale, id: 9 }
  await env.submitAmendment()
  assert.equal(env.sent.length, 0)
  env.sale = { ...env.sale, id: 8 }
  env.lineRefreshRequired = true
  await env.submitAmendment()
  assert.equal(env.sent.length, 0)
  console.log('PASS actor, sale and unresolved refresh gates refuse captured callbacks without dispatch')
}
{
  const detail = { id: 8, updated_at: r0, items: [{ quantity: 1 }] }
  const env: any = { aliveRef: { current: true }, statusSecurityRef: { current: 'actor-one' }, salesRef: { current: [] }, detail, selected: null,
    mutationVersionAtLeast, readAuthoritativeSale: async (_id: number, accept: (row: any) => boolean) => { const row = { id: 8, updated_at: r1, items: [{ quantity: 2 }] }; return accept(row) ? row : null },
    setLineRefreshGate: (value: any) => { env.gate = typeof value === 'function' ? value(env.gate) : value },
    setSales: (value: any) => { env.rows = value }, setDetailSale: (update: any) => { env.detail = update(env.detail) }, setSelectedSale: (update: any) => { env.selected = update(env.selected) },
  }
  const refresh = callback(sales, 'refreshCommittedLineSale', env)
  await refresh(8, r1, 'actor-one')
  assert.deepEqual(env.detail.items, [{ quantity: 2 }])
  assert.equal(env.salesRef.current.length, 0, 'off-list sale need not be inserted into the filtered list')
  assert.equal(env.gate, null)
  const committed = env.detail
  env.readAuthoritativeSale = async () => { throw Error('read unavailable') }
  await refresh(8, r2, 'actor-one')
  assert.equal(env.detail, committed, 'failed convergence must not close detail and lose other drafts')
  assert.equal(env.gate.version, r2)
  env.readAuthoritativeSale = async () => { env.statusSecurityRef.current = 'actor-two'; return { id: 8, updated_at: r2 } }
  await refresh(8, r2, 'actor-one')
  assert.equal(env.detail, committed, 'late old-actor refresh cannot publish detail')
  console.log('PASS exact-ID committed refresh covers off-list sale and preserves detail on failure or actor change')
}
assert.ok(modal.includes('expected_updated_at: settlementSession.expectedUpdatedAt'), 'payment retains its original settlement revision')
assert.ok(modal.includes('}, [detailScope])'), 'row-version refresh must not reset the entire detail/tender lifecycle')
console.log('PASS tender lifecycle and backend CAS boundaries remain separate from new line reviews')
