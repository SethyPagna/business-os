import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { ensureClientRequestId } from '../src/api/requestIds.ts'

const calls: Array<{ path: string; body: unknown; timeout?: number }> = []
const source = fs.readFileSync(new URL('../src/api/branchTransport.ts', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
const module = { exports: {} as any }
new Function('exports', 'require', 'module', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(module.exports, (id: string) => {
  if (id === './http.ts') return { route: (_key: string, online: () => unknown) => online(), apiFetch: async (_method: string, path: string, body?: unknown, timeout?: number) => { calls.push({ path, body, timeout }); return { success: true } } }
  if (id === './requestIds.ts') return { ensureClientRequestId }
  if (id === '../utils/deviceInfo.ts') return { getClientDeviceInfo: () => ({ device_name: 'test' }) }
  if (id === '../utils/syncProblemLifecycle.ts') return { dispatchResolvedSyncError: () => {} }
  if (id === './query.ts' || id === './expectedUpdatedAt.ts') return {}
  throw new Error(`Unexpected import ${id}`)
}, module)
const { prepareTransferRun, loadTransferRun, saveTransferRun, executeTransferRun, transferStock, transferStockBulk, getBranchSummary } = module.exports
function store() {
  const rows = new Map<string, string>()
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
}

for (const kind of ['submit', 'undo', 'redo']) for (const direction of [[1, 2], [2, 1]]) {
  test(`Inventory ${kind} ${direction.join(' → ')} survives lost commit, reload and exact replay`, async () => {
    const storage = store()
    const inv = { exports: {} as any }
    const receipts = new Map<string, string>()
    const bodies: any[] = []
    let from = 10, to = 0, commits = 0, loseReply = true
    const inventorySource = fs.readFileSync(new URL('../src/api/inventoryWriteTransport.ts', import.meta.url), 'utf8')
    new Function('exports', 'require', 'module', ts.transpileModule(inventorySource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText)(inv.exports, (id: string) => {
      if (id === './branchTransport.ts') return module.exports
      if (id === './requestIds.ts') return { ensureClientRequestId }
      if (id === '../utils/deviceInfo.ts') return { getClientDeviceInfo: () => ({ device_name: 'changed after reload' }) }
      if (id === './http.ts') return {
        route: (_key: string, online: () => unknown) => online(),
        apiFetch: async (_method: string, path: string, body: any) => {
          assert.equal(path, '/api/inventory/transfer')
          bodies.push(body)
          const json = JSON.stringify(body)
          const previous = receipts.get(body.client_request_id)
          if (previous && previous !== json) throw new Error('409 conflict')
          if (!previous) { receipts.set(body.client_request_id, json); from -= body.quantity; to += body.quantity; commits++ }
          if (loseReply) { loseReply = false; throw new Error('Lost committed response') }
          return { success: true }
        },
      }
      throw new Error(`Unexpected import ${id}`)
    }, inv)
    const api = inv.exports
    const original = { productId: 1, quantity: 2.5, fromBranchId: direction[0], toBranchId: direction[1], reason: `${kind}: restock`, userId: 7 }
    const run = api.prepareInventoryTransfer(7, original, { kind, original, productName: 'Tea', entryId: 'history-entry', serverId: 11 })
    api.saveInventoryTransfer(7, run, storage)
    const frozen = JSON.stringify(run.requests[0].body)
    original.quantity = 99
    const checkpoint = (next: unknown) => api.saveInventoryTransfer(7, next, storage)
    await assert.rejects(api.executeInventoryTransfer(run, checkpoint), /Lost committed response/)
    assert.equal(loadTransferRun(7, storage), null, 'Branch recovery must never see an Inventory request')
    assert.equal(api.loadInventoryTransfer(8, storage), null, 'actor isolation')
    const reloaded = api.loadInventoryTransfer(7, storage)
    assert.equal(reloaded.context.original.quantity, 2.5)
    assert.equal(reloaded.context.kind, kind)
    assert.equal(reloaded.context.serverId, 11)
    const complete = await api.executeInventoryTransfer(reloaded, checkpoint)
    assert.equal(JSON.stringify(bodies[0]), frozen)
    assert.deepEqual(bodies[0], bodies[1], 'metadata/body/key stay exact')
    assert.equal(complete.next, 1)
    assert.equal(commits, 1)
    assert.equal(from, 7.5); assert.equal(to, 2.5); assert.equal(from + to, 10)
    await assert.rejects(api.transferInventoryStock({ ...reloaded.requests[0].body, quantity: 3 }), /409 conflict/)
    assert.equal(commits, 1)
    api.saveInventoryTransfer(7, null, storage)
    assert.equal(api.loadInventoryTransfer(7, storage), null)
  })
}

for (const direction of [[1, 2], [2, 1]]) for (const count of [1, 3, 201]) {
  test(`${direction.join(' → ')} ${count} selected/all products: lost committed chunk replays exactly once`, async () => {
    const storage = store()
    const stock = new Map(Array.from({ length: count }, (_, i) => [i + 1, { from: 10, to: 0 }]))
    const items = [...stock.keys()].map((productId) => ({ productId, quantity: 2.5 }))
    const requests = []
    for (let index = 0; index < items.length; index += 200) requests.push({ bulk: true, body: {
      fromBranchId: direction[0], toBranchId: direction[1], reason: 'restock', items: items.slice(index, index + 200),
    } })
    const run = prepareTransferRun(7, requests)
    const original = JSON.stringify(run.requests)
    // Editing the original form after confirmation cannot mutate the frozen body.
    items[0].quantity = 99
    saveTransferRun(7, run, storage)
    assert.equal(loadTransferRun(8, storage), null)
    const receipts = new Map<string, string>()
    let loseReply = true
    let writes = 0
    const send = async (request: any) => {
      const body = request.body
      const json = JSON.stringify(body)
      const previous = receipts.get(body.client_request_id)
      if (previous) assert.equal(json, previous, 'same-key intent must be identical')
      else {
        for (const item of body.items) {
          const row = stock.get(item.productId)!
          row.from -= item.quantity; row.to += item.quantity
        }
        receipts.set(body.client_request_id, json); writes++
      }
      if (loseReply && writes === requests.length) { loseReply = false; throw Object.assign(new Error('Lost reply'), { outcome: 'unknown' }) }
      return { success: true, transferredCount: body.items.length }
    }
    const checkpoint = (next: unknown) => saveTransferRun(7, next, storage)
    await assert.rejects(executeTransferRun(run, checkpoint, send), /Lost reply/)
    const reopened = loadTransferRun(7, storage)
    assert.equal(JSON.stringify(reopened.requests), original, 'close/reopen retains every key and frozen payload')
    assert.equal(reopened.next, requests.length - 1)
    const done = await executeTransferRun(reopened, checkpoint, send)
    assert.equal(done.next, requests.length)
    assert.equal(done.transferred, count)
    assert.equal(writes, requests.length)
    for (const row of stock.values()) { assert.equal(row.from, 7.5); assert.equal(row.to, 2.5); assert.equal(row.from + row.to, 10) }
    saveTransferRun(7, null, storage)
    assert.equal(loadTransferRun(7, storage), null)
  })
}

test('single and bulk transport preserve prepared keys, metadata, and deadlines', async () => {
  calls.length = 0
  for (const bulk of [false, true]) {
    const body = { productId: 1, quantity: 2, items: [{ productId: 1, quantity: 2 }], fromBranchId: 1, toBranchId: 2, reason: 'restock' }
    const run = prepareTransferRun(7, [{ bulk, body }])
    const send = bulk ? transferStockBulk : transferStock
    await send(run.requests[0].body)
    await send(run.requests[0].body)
    assert.deepEqual(calls.at(-1)?.body, calls.at(-2)?.body)
    if (bulk) assert.equal(calls.at(-1)?.timeout, 90_000)
  }
})

test('persistence and checkpoint failures retain the last safe request', async () => {
  const storage = store()
  const run = prepareTransferRun(7, [{ bulk: false, body: { productId: 1, quantity: 1 } }])
  assert.throws(() => saveTransferRun(8, run, storage), /another user/)
  assert.throws(() => saveTransferRun(7, run, { ...storage, setItem: () => {} }), /could not be saved/)
  saveTransferRun(7, run, storage)
  assert.throws(() => saveTransferRun(7, prepareTransferRun(7, [{ bulk: false, body: { productId: 2, quantity: 2 } }]), storage), /saved transfer/)
  await assert.rejects(executeTransferRun(run, () => { throw new Error('storage full') }, async () => ({ success: true })), /storage full/)
  assert.equal(loadTransferRun(7, storage).next, 0)
  assert.equal(loadTransferRun(7, storage).requests[0].body.client_request_id, run.requests[0].body.client_request_id)
})

test('current-stock request remains independent of date selection', async () => {
  calls.length = 0
  await getBranchSummary({ startDate: '2026-01-01', endDate: '2026-02-01' })
  await getBranchSummary({ startDate: '2026-08-01', endDate: '2026-08-02' })
  assert.deepEqual(calls.map(({ path, body }) => ({ path, body })), [
    { path: '/api/branches/summary', body: undefined }, { path: '/api/branches/summary', body: undefined },
  ])
})

test('availability fails closed and keeps fractional/numeric-string stock', () => {
  const code = modal.match(/const finiteStockAvailable = \(value: unknown\) => \{([\s\S]*?)\n  \}/)![1]
  const available = new Function('value', code)
  for (const value of [NaN, Infinity, -Infinity, 'broken', -3, null, undefined, true, {}, []]) assert.equal(available(value), 0)
  assert.equal(available('2.5'), 2.5)
  assert.equal(Math.min(available('2.5'), available(1.25)), 1.25)
  assert.match(modal, /const canTransferStock = can\('branches', 'transfer'\)/)
  assert.match(modal, /if \(!canTransferStock \|\| retryStorageError\) return/)
  assert.match(modal, /disabled=\{saving \|\| savingBulk\}/)
  assert.match(modal, /<fieldset disabled=\{saving \|\| savingBulk \|\| !!savedRun/)
})
