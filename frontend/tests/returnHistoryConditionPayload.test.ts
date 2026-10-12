import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const pagePath = 'frontend/src/components/returns/Returns.tsx'
const page = readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
const parent = execFileSync('git', ['show', `847d1a0f5d5532b55b5f2add3c9c8a1a87bdbf86:${pagePath}`], { encoding: 'utf8' })

function pageCallback(source: string, name: string, scope: Record<string, unknown> = {}): any {
  const ast = ts.createSourceFile('Returns.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(initializer, `the real Returns ${name} callback must be present`)
  const compiled = ts.transpileModule(`return (${initializer.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  return new Function('useCallback', ...Object.keys(scope), compiled)((callback: unknown) => callback, ...Object.values(scope))
}
const historyBuilder = (source: string) => pageCallback(source, 'buildReturnHistoryPayload')

const snapshot = {
  id: 10, branch_id: 1, reason: 'Recorded condition', return_type: 'refund',
  items: [{ sale_item_id: 50, product_id: 2, product_name: 'Keeper', quantity: 0.1,
    applied_price_usd: 10, return_to_stock: 0, stock_action: 'damaged', stock_condition: 'expired',
    condition_tag: 'expired', damaged_disposition: 'keep', branch_id: 1, batch_id: 1100 }],
}

const build = historyBuilder(page)
const archived = JSON.stringify(snapshot)
const actual = build(snapshot).items[0]
assert.equal(actual.return_to_stock, false, 'persisted zero must retain its no ordinary restock meaning')
for (const field of ['sale_item_id', 'product_id', 'stock_action', 'stock_condition', 'condition_tag', 'damaged_disposition', 'batch_id']) {
  assert.equal(actual[field], (snapshot.items[0] as Record<string, unknown>)[field], `history preserves ${field}`)
}
assert.equal(JSON.stringify(snapshot), archived, 'history payload creation must preserve the archived snapshot')

for (const value of [0, '0', false]) assert.equal(build({ ...snapshot, items: [{ return_to_stock: value }] }).items[0].return_to_stock, false)
for (const value of [1, '1', true, null, undefined]) assert.equal(build({ ...snapshot, items: [{ return_to_stock: value }] }).items[0].return_to_stock, true)
for (const stock_action of ['none', 'restock', 'damaged']) {
  const item = { ...snapshot.items[0], stock_action, batch_id: null, damaged_disposition: 'remove' }
  const payload = build({ ...snapshot, items: [item] }).items[0]
  assert.equal(payload.stock_action, stock_action)
  assert.equal(payload.batch_id, null, 'genuine NULL attribution stays NULL')
  assert.equal(payload.damaged_disposition, 'remove')
}
const legacy = build({ id: 11, items: [{ product_id: 1, quantity: 1 }] }).items[0]
assert.equal(legacy.stock_condition, null, 'missing condition stays available for server original-condition inference')
assert.equal(legacy.condition_tag, null)
assert.equal(legacy.damaged_disposition, null)
assert.equal(legacy.stock_action, null)
assert.equal(Object.hasOwn(actual, 'cost_price_usd'), false, 'permission-redacted costs are never replaced by client zeroes')

let pending: any = null
let freshReads = 0
const submitted: any[] = []
const restore = pageCallback(page, 'restoreReturnSnapshot', {
  buildReturnHistoryPayload: build,
  currentPendingHistoryRequest: () => pending,
  historyRestoreInFlightRef: { current: false },
  beginSingleAction: () => true,
  finishSingleAction: () => {},
  setHistoryRestoreSaving: () => {},
  fetchReturnDetail: async () => { freshReads++; return { updated_at: 'current-authority' } },
  prepareReturnRequest: async (id: number, payload: any) => ({ ...payload, client_request_id: `stable-${id}` }),
  freezeDirectMutationBody: (body: unknown) => Object.freeze(body),
  savePendingHistoryRequest: (id: number, body: unknown, history: unknown) => { pending = { entityId: id, body, history } },
  submitReturnHistoryRequest: async (_id: number, body: unknown) => { submitted.push(body) },
  tr: (_key: string, fallback: string) => fallback,
})
const history = { entryId: 'entry-10', direction: 'undo' }
await restore(snapshot, 'Undo return edit', history)
assert.deepEqual(submitted[0].items[0], actual, 'actual restore callback submits the complete history tuple')
assert.equal(submitted[0].expected_updated_at, 'current-authority')
await restore({ ...snapshot, items: [{ ...snapshot.items[0], stock_condition: 'ordinary' }] }, 'Later state', history)
assert.equal(submitted[1], submitted[0], 'unknown-outcome replay reuses the exact frozen pending body')
assert.equal(freshReads, 1, 'pending retry never rebuilds the original intent from newer state')

const old = historyBuilder(parent)(snapshot).items[0]
assert.equal(old.return_to_stock, true, 'archived parent exposes persisted zero corruption')
assert.equal(old.stock_condition, undefined, 'archived parent exposes lost condition')
assert.equal(old.batch_id, undefined, 'archived parent exposes lost receipt')
console.log('PASS actual Returns history builder preserves stock source, condition and disposition; archived parent discriminates')
