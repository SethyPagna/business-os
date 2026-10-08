import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { ensureClientRequestId } from '../src/api/requestIds.ts'

const source = process.env.OWNER_PRICE_BASELINE ? execFileSync('git', ['show', '8b0e2c4cf608c3f6f3dbcad1d1a2ff8fa7ee1240:frontend/src/components/products/Products.tsx'], { encoding: 'utf8' }) : readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('Products.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let initializer: ts.Expression | undefined
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'runBulkPriceAdjustAllProducts') initializer = node.initializer
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(initializer)
assert.match(source, /onClick=\{runBulkPriceAdjustAllProducts\}/, 'the executed callback is actually wired')
const callbackJs = ts.transpileModule('return ' + initializer.getText(ast).replace("import('../../api/productWriteTransport.ts')", 'Promise.resolve(api)'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
function fixture({ lostAck = false, refreshFailure = false, decrease = false } = {}) {
  const pending = { current: new Map() }, calls: Array<Record<string, unknown>> = [], receipts = new Map<string, number>(), notices: unknown[] = []
  const form = { adjust_amount: 1, adjust_currency: 'usd', adjust_selling: true, adjust_direction: decrease ? 'decrease' : 'increase', adjust_wholesale: false, adjust_cost: false, adjust_skip_zero: false }
  let price = decrease ? 1 : 5, fail = lostAck, authority = 'actor-server-A'
  let confirm: () => Promise<boolean> = async () => true
  const scope = {
    catalogPricePendingRef: pending, catalogPriceInFlightRef: { current: false }, bulkActionBusy: false, bulkEditForm: form, canEditCosts: true, canViewCosts: true,
    captureActorReadScope: () => ({ authority }), assertActorReadScope: (captured: { authority: string }) => { if (captured.authority !== authority) throw Error('stale actor') },
    ensureClientRequestId, useCallback: (callback: unknown) => callback, setBulkActionBusy: () => {},
    tr: (_key: string, fallback: string) => fallback, khrSymbol: '៛', usdSymbol: '$', bulkFieldLabel: (field: string) => field,
    notify: (...args: unknown[]) => notices.push(args), getErrorMessage: (error: Error) => error.message,
    askToConfirm: () => confirm(), load: async () => { if (refreshFailure) throw Error('refresh failed') },
    api: { bulkPriceAdjustAllProducts: async (payload: Record<string, unknown>) => {
      calls.push({ ...payload })
      if (payload.preview) return { count: price > 0 ? 1 : 0 }
      const id = String(payload.client_request_id || '')
      if (receipts.has(id) && id) return { success: true, replayed: true, changed: receipts.get(id) }
      price = Math.max(0, price + (payload.direction === 'decrease' ? -1 : 1) * Number(payload.amount))
      if (id) receipts.set(id, 1)
      if (fail) { fail = false; throw Error('ACK lost after committed price write') }
      return { success: true, changed: 1 }
    } },
  }
  const callback = new Function(...Object.keys(scope), callbackJs)(...Object.values(scope)) as () => Promise<void>
  return { callback, calls, pending, form, receipts, notices, price: () => price, switchActor: () => { authority = 'actor-server-B' }, holdConfirm: (fn: () => Promise<boolean>) => { confirm = fn } }
}
{
  const f = fixture({ lostAck: true }); await f.callback(); assert.equal(f.price(), 6); await f.callback()
  console.log('OBSERVED callback retry', JSON.stringify({price:f.price(),applies:f.calls.filter(c=>!c.preview)}))
  const applies = f.calls.filter(c => !c.preview); assert.equal(applies.length, 2); assert.ok(applies[0].client_request_id)
  assert.equal(applies[1].client_request_id, applies[0].client_request_id, 'actual second click retries original ID')
  assert.equal(f.price(), 6, 'lost ACK retry never changes the catalog again'); assert.equal(f.receipts.size, 1)
  assert.equal(f.calls.filter(c => c.preview).length, 1, 'pending intent bypasses a fresh plan')
  await f.callback(); assert.equal(f.price(), 7); assert.equal(f.receipts.size, 2, 'confirmed success followed by explicit new adjustment gets new ID')
}
{
  const f = fixture({ lostAck: true, decrease: true }); await f.callback(); assert.equal(f.price(), 0); await f.callback()
  assert.equal(f.calls.filter(c => !c.preview).length, 2, 'zero-price fresh preview cannot suppress original receipt recovery'); assert.equal(f.receipts.size, 1)
}
{
  const f = fixture({ lostAck: true }); await f.callback(); const original = String(f.calls.find(c => !c.preview)?.client_request_id)
  f.form.adjust_amount = 2; await f.callback(); assert.equal(f.price(), 8)
  assert.notEqual(f.calls.filter(c => !c.preview)[1].client_request_id, original, 'changed confirmed intent is a new operation')
  f.form.adjust_amount = 1; await f.callback(); assert.equal(f.price(), 8, 'returning to unresolved original intent recovers old ID')
  assert.equal(f.calls.filter(c => !c.preview)[2].client_request_id, original)
}
{
  const f = fixture({ refreshFailure: true }); await f.callback(); assert.equal(f.pending.current.size, 0, 'confirmed commit ends pending identity before refresh failure')
  await f.callback(); assert.equal(f.receipts.size, 2, 'later explicit apply is not confused with failed refresh')
}
{
  const f = fixture(); f.holdConfirm(async () => { f.switchActor(); return true }); await f.callback()
  assert.equal(f.calls.filter(c => !c.preview).length, 0, 'actor/server changed during confirmation cannot dispatch'); assert.equal(f.price(), 5)
}
{
  const f = fixture()
  let release!: (answer: boolean) => void
  let entered!: () => void
  const waiting = new Promise<void>(resolve => { entered = resolve })
  f.holdConfirm(() => { entered(); return new Promise<boolean>(resolve => { release = resolve }) })
  const first = f.callback()
  await waiting
  await f.callback()
  release(true)
  await first
  assert.equal(f.calls.filter(c => !c.preview).length, 1, 'same-frame duplicate click cannot admit a second intent before React busy state updates')
  assert.equal(f.price(), 6)
  assert.equal(f.receipts.size, 1)
}
console.log('actual catalog price callback lifetime PASS: lost ACK/zero-price recovery/new-intent/refresh/actor/concurrent-click controls')
