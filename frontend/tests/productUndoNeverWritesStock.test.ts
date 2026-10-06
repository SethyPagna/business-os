// F2 / RV-1 (5 Oct 2026): a Products-page Undo never overwrites stock with an
// old figure. Undo/Redo of a product edit, bulk update or price adjustment
// restores product FIELDS only; actions that moved stock (Set Out of Stock,
// Change Branch) refuse Undo with WHY + WHERE; a removed product that held
// stock is not re-created here with its old figure.
//
// The defect: restoreProductSnapshots also posted an /adjust "correction" of
// snapshot minus current per branch. Edit while 10 on hand, sell 3, Undo: the
// shelf showed 10 again while the sale still stood -- 3 phantom units.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildProductWritePayload,
  PRODUCT_RESTORE_STOCK_KEYS,
  restoreProductSnapshotFields,
  snapshotHoldsStock,
  stripProductStockFields,
} from '../src/components/products/helpers/productWriteHelpers.ts'

type Row = { id: number; name: string; selling_price_usd: number; updated_at: string; stock_quantity: number; branch_stock: Array<{ branch_id: number; quantity: number }> }

let failures = 0
async function runTest(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`ok - ${name}`) } catch (error) { failures++; console.error(`not ok - ${name}`); console.error(error) }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// A one-product server: product fields plus branch stock, with the same
// write rule the Worker has -- a PUT writes whatever columns it is sent.
function makeServer(initial: Row) {
  const row = clone(initial)
  let version = 1
  const adjustCalls: unknown[] = []
  const putPayloads: Record<string, unknown>[] = []
  const stockOnHand = () => row.branch_stock.reduce((sum, entry) => sum + entry.quantity, 0)
  return {
    row,
    adjustCalls,
    putPayloads,
    stockOnHand,
    sell(branchId: number, quantity: number) {
      const entry = row.branch_stock.find((b) => b.branch_id === branchId)!
      entry.quantity -= quantity
      row.stock_quantity = stockOnHand()
      row.updated_at = `v${++version}`
    },
    edit(fields: Partial<Row>) { Object.assign(row, fields); row.updated_at = `v${++version}` },
    deps: {
      fetchProductsByIds: async (ids: number[]) => ids.includes(row.id) ? [clone(row)] : [],
      buildPayload: (snapshot: Record<string, unknown>) => buildProductWritePayload(snapshot, { id: 1, name: 'Owner' }) as Record<string, unknown>,
      updateProduct: async (productId: number, payload: Record<string, unknown>) => {
        assert.equal(productId, row.id)
        putPayloads.push(payload)
        if (payload.expectedUpdatedAt !== row.updated_at) throw new Error('version conflict')
        for (const [key, value] of Object.entries(payload)) {
          if (key === 'branch_stock') row.branch_stock = clone(value as Row['branch_stock'])
          else if (key in row) (row as Record<string, unknown>)[key] = value
        }
        row.updated_at = `v${++version}`
        return { success: true }
      },
      // Not part of the restore's contract; present so a regression that
      // reaches for it is caught rather than silently unavailable.
      adjustStock: async (payload: unknown) => { adjustCalls.push(payload) },
    },
  }
}

const start: Row = { id: 5, name: 'Lipstick', selling_price_usd: 10, updated_at: 'v1', stock_quantity: 10, branch_stock: [{ branch_id: 1, quantity: 10 }] }

await runTest('edit while 10 on hand, sell 3, undo: stock stays 7 and the fields come back', async () => {
  const server = makeServer(start)
  const before = clone(server.row)
  server.edit({ name: 'Lipstick Red', selling_price_usd: 12 })
  const after = clone(server.row)
  server.sell(1, 3)
  assert.equal(server.stockOnHand(), 7)

  const written = await restoreProductSnapshotFields([before], server.deps)
  assert.equal(written, 1)
  assert.equal(server.stockOnHand(), 7, 'Undo must not put the 3 sold units back')
  assert.equal(server.row.stock_quantity, 7, 'nor rewrite the rollup to the snapshot figure')
  assert.equal(server.row.name, 'Lipstick')
  assert.equal(server.row.selling_price_usd, 10)
  assert.equal(server.adjustCalls.length, 0, 'no stock adjustment is posted')
  for (const key of PRODUCT_RESTORE_STOCK_KEYS) assert.ok(!(key in server.putPayloads[0]), `the PUT carries no ${key}`)

  // Double apply: a second Undo writes the same fields and still no stock.
  await restoreProductSnapshotFields([before], server.deps)
  assert.equal(server.stockOnHand(), 7)
  assert.equal(server.row.name, 'Lipstick')

  // Reversal: Redo brings the edit back; stock is still what the ledger says.
  await restoreProductSnapshotFields([after], server.deps)
  assert.equal(server.row.name, 'Lipstick Red')
  assert.equal(server.row.selling_price_usd, 12)
  assert.equal(server.stockOnHand(), 7)
  assert.equal(server.adjustCalls.length, 0)
})

await runTest('positive control: the retired snapshot-minus-current restore puts 3 phantom units back', async () => {
  // The plausible wrong implementation the fixture must tell apart: what
  // restoreProductBranchStock did before F2.
  const server = makeServer(start)
  const before = clone(server.row)
  server.edit({ name: 'Lipstick Red' })
  server.sell(1, 3)
  const current = (await server.deps.fetchProductsByIds([5]))[0]
  for (const entry of before.branch_stock) {
    const now = current.branch_stock.find((b) => b.branch_id === entry.branch_id)?.quantity ?? 0
    const target = server.row.branch_stock.find((b) => b.branch_id === entry.branch_id)!
    target.quantity += entry.quantity - now
  }
  assert.equal(server.stockOnHand(), 10, 'the old path really did write the old figure back')
})

await runTest('a payload builder that leaks stock keys is stripped before the PUT', async () => {
  const server = makeServer(start)
  const before = clone(server.row)
  server.sell(1, 3)
  const leaky = { ...server.deps, buildPayload: (snapshot: Record<string, unknown>) => ({ name: snapshot.name, stock_quantity: 10, branch_stock: clone(start.branch_stock) }) }
  await restoreProductSnapshotFields([before], leaky)
  assert.equal(server.stockOnHand(), 7)
  assert.equal(server.row.stock_quantity, 7)
  assert.deepEqual(stripProductStockFields({ a: 1, stock_quantity: 4, branch_stock: [], branch_batch_stock: [], rfid_confirmed_qty: 2 }), { a: 1 })
})

await runTest('a product the server no longer returns is skipped, and a failed write is reported', async () => {
  const server = makeServer(start)
  assert.equal(await restoreProductSnapshotFields([{ ...clone(start), id: 99 }], server.deps), 0)
  const failing = { ...server.deps, updateProduct: async () => { throw new Error('boom') } }
  await assert.rejects(() => restoreProductSnapshotFields([clone(start)], failing), /boom/)
  assert.equal(server.stockOnHand(), 10)
})

await runTest('snapshotHoldsStock reads branches first, the rollup only without branch detail', () => {
  assert.equal(snapshotHoldsStock({ branch_stock: [{ branch_id: 1, quantity: 0 }, { branch_id: 2, quantity: 2 }] }), true)
  assert.equal(snapshotHoldsStock({ branch_stock: [{ branch_id: 1, quantity: 0 }], stock_quantity: 5 }), false, 'the branch rows are the truth; a stale rollup does not count')
  assert.equal(snapshotHoldsStock({ stock_quantity: 5 }), true)
  assert.equal(snapshotHoldsStock({ branch_stock: [], stock_quantity: 0 }), false)
  assert.equal(snapshotHoldsStock({ branch_stock: [{ branch_id: 1, quantity: -1 }] }), true, 'negative stock is still stock to account for')
})

await runTest('Products.tsx: no Undo path writes stock; stock-moving actions refuse with WHY + WHERE', () => {
  const src = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /restoreProductBranchStock|buildProductBranchStockAdjustments/, 'the snapshot stock restore is gone')
  const restore = src.slice(src.indexOf('const restoreProductSnapshots = useCallback('), src.indexOf('const replayRecordedRemovals = useCallback('))
  assert.ok(restore.length > 0)
  assert.match(restore, /restoreProductSnapshotFields\(/)
  assert.doesNotMatch(restore, /adjustStock|transferStock/, 'the field restore never reaches a stock route')
  // REVERT-SET: out-of-stock and branch-move Undo replay the RECORDED effect, not a snapshot figure.
  assert.ok(src.includes("undo: () => replayRecordedRemovals(recorded, 'undo'"), 'out_of_stock Undo replays the recorded removal')
  assert.ok(src.includes("undo: () => replayRecordedTransfers(transfers, 'undo'"), 'branch_move Undo replays the recorded transfer')
  const refusal = src.slice(src.indexOf('const refuseStockUndo = useCallback('), src.indexOf('const restoreDeletedProducts = useCallback('))
  assert.match(refusal, /product_undo_where_stock_changes/)
  assert.match(refusal, /product_undo_where_branch_history/)
  assert.match(refusal, /setActiveProductSection\('stock_changes'\)/, 'WHERE is a way there, not only a sentence')
  assert.match(refusal, /navigateTo\('branches'\)/)
  const deleted = src.slice(src.indexOf('const restoreDeletedProducts = useCallback('), src.indexOf('const pushCreatedProductHistory = useCallback('))
  assert.doesNotMatch(deleted, /adjustStock/)
  // E2: a product removed with stock is refused by a flag set when the entry
  // is pushed (never a thrown error that marks the server row failed), for both
  // legacy delete Undos and the create Redo.
  assert.equal((src.match(/undoRefused: removedWithStock,\s*undo: removedWithStock \? \(\) => refuseStockUndo\('removed_with_stock'\)/g) || []).length, 2, 'bulk and single legacy delete Undo')
  assert.match(src, /redoRefused: snapshotHoldsStock\(baseSnapshot\),\s*redo: snapshotHoldsStock\(baseSnapshot\) \? \(\) => refuseStockUndo\('removed_with_stock'\)/, 'create Redo')
  assert.doesNotMatch(deleted, /throw Object\.assign/, 'no thrown refusal')
  assert.match(refusal, /product_undo_refused_removed_with_stock[\s\S]*product_undo_where_remove_history/, 'why and where')
})

await runTest('E2: the removed-with-stock refusal is as short as its siblings', () => {
  const pack = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const sibling = Math.max(pack.product_undo_refused_stock_removed.length, pack.product_undo_refused_stock_moved.length)
  assert.ok(pack.product_undo_refused_removed_with_stock.length <= sibling, `${pack.product_undo_refused_removed_with_stock.length} > ${sibling}`)
})

await runTest('actionHistory: a refused Undo or Redo never touches the server row', () => {
  const src = readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
  const run = src.slice(src.indexOf('const runEntry = useCallback('))
  const refused = run.indexOf("if ((direction === 'undo' && entry.undoRefused) || (direction === 'redo' && entry.redoRefused))")
  const server = run.indexOf('api.undoActionHistory(entry.serverId)')
  assert.ok(refused > 0 && server > refused, 'the refusal returns before the server transition')
  assert.match(run.slice(refused, server), /return false/)
})

for (const lang of ['en', 'km']) {
  await runTest(`${lang}.json carries every F2 refusal key`, () => {
    const pack = JSON.parse(readFileSync(new URL(`../src/lang/${lang}.json`, import.meta.url), 'utf8')) as Record<string, string>
    for (const key of ['product_undo_refused_title', 'product_undo_where_label', 'product_undo_refused_stock_removed', 'product_undo_refused_stock_moved', 'product_undo_where_stock_changes', 'product_undo_where_branch_history', 'product_undo_refused_removed_with_stock', 'product_undo_where_remove_history']) {
      assert.ok(String(pack[key] || '').trim(), `${lang}.json ${key}`)
    }
  })
}

if (failures) { console.error(`${failures} failing`); process.exit(1) }
