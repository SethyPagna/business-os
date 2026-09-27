// Native workerd/Miniflare D1 boundary for the rule "returned units go back
// into the lot they were sold from, and a lot a live return already refilled
// is not refilled again" (FX-returns D, hunt H-stock #5, forensics S5).
//
// The defect: sale_item_batch_allocations.released_quantity is written only by
// the sale-side flows; returns never touch it. Every return of a multi-lot
// sale line therefore saw the whole line as still out and restocked the
// last-drawn lot again: a line of 4 drawn A:2, B:2 returned 2 + 2 ended
// B=4, A=0. A sale cancel after a partial return did the same.
//
// The fix derives "already back" on read from the live restocked returns
// (return_item_batch_allocations, else return_items.batch_id), so cancel,
// restore and edit of a return change it with no counter to maintain.
//
// Locks:
//   kernel -- spreadReturnedIntoAllocations clamps; planSaleStockTransition's
//             cancel restore skips lots a return refilled, falls back to the
//             plain walk when it must (never loses units), un-cancel re-takes
//             exactly what the cancel released, and a caller that passes no
//             returned_into_quantity keeps the old walk (control);
//   route  -- second return lands in A not B; a POST replay adds nothing;
//             bulk cancel / restore of a return move its recorded lot; an
//             edit re-plans with its own units counted as out; a cancelled
//             return stops counting; an operator pick is kept as picked.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns';
      const app=new Hono(); app.route('/api/returns',returns); export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    plugins: [{ name: 'return-lot-credit-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',role_code:'admin',permissions:raw});return next()}`,
        audit: 'export const audit=async()=>{};export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendTelegramEvent=async()=>{};
          export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[]`,
      }
      b.onResolve({ filter: /(?:lib\/(?:auth|audit|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
        path: args.path.split('/').pop(), namespace: 'return-fixture',
      }))
      b.onLoad({ filter: /.*/, namespace: 'return-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
    } }],
  })
}

async function kernel() {
  const bundle = await build({ stdin: { contents: "export * from './src/lib/saleTransitions'; export { spreadReturnedIntoAllocations } from './src/lib/returnsStock'",
    resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}

function kernelChecks(k) {
  const spread = k.spreadReturnedIntoAllocations
  const allocs = [{ batch_id: 1, quantity: 2, released_quantity: 0 }, { batch_id: 2, quantity: 2, released_quantity: 0 }]
  assert.deepEqual(spread(allocs, new Map([[2, 2]])), [0, 2])
  assert.deepEqual(spread(allocs, new Map([[2, 4]])), [0, 2], 'a lot over-credited before the fix is clamped, never negative')
  assert.deepEqual(spread(allocs, new Map([[9, 3]])), [0, 0], 'a lot the line never drew from (event lot) is ignored')
  assert.deepEqual(spread([{ batch_id: 2, quantity: 2, released_quantity: 1 }], new Map([[2, 2]])), [1], 'capped at the unreleased part')

  // A line of 4 drawn A(1):2 then B(2):2; one live return of 2 went into B.
  const plan = (allocations, oldStatus, newStatus) => k.planSaleStockTransition({ saleId: 1, oldStatus, newStatus,
    items: [{ id: 5, product_id: 1, product_name: 'Serum', quantity: 4, cost_price_usd: 2, cost_price_khr: 0, branch_id: 1, batch_id: null, allocations }],
    returnedByItem: new Map([[5, 2]]), reason: 'test', userId: 7, userName: 'Fixture' })
  const lotMoves = p => p.statements.filter(s => /branch_batch_stock/.test(s.sql)).map(s => [Number(s.params.batchId), Number(s.params.quantity)])
  const releases = p => p.statements.filter(s => /UPDATE sale_item_batch_allocations/.test(s.sql)).map(s => [s.params.id, Number(s.params.give ?? -s.params.take)])
  const withReturn = [{ id: 11, batch_id: 1, quantity: 2, released_quantity: 0, returned_into_quantity: 0 },
    { id: 12, batch_id: 2, quantity: 2, released_quantity: 0, returned_into_quantity: 2 }]
  const cancel = plan(withReturn, 'partial_return', 'cancelled')
  assert.deepEqual(lotMoves(cancel), [[1, 2]], 'a cancel after a partial return refills lot A, not lot B the return already refilled')
  assert.deepEqual(releases(cancel), [[11, 2]])
  const legacyCaller = plan(withReturn.map(({ returned_into_quantity, ...rest }) => rest), 'partial_return', 'cancelled')
  assert.deepEqual(lotMoves(legacyCaller), [[2, 2]], 'control: without returned_into the old last-drawn walk is unchanged')
  const impossible = plan([{ id: 11, batch_id: 1, quantity: 2, released_quantity: 0, returned_into_quantity: 2 },
    { id: 12, batch_id: 2, quantity: 2, released_quantity: 0, returned_into_quantity: 2 }], 'partial_return', 'cancelled')
  assert.equal(lotMoves(impossible).reduce((n, [, q]) => n + q, 0), 2, 'the fallback pass never leaves restored units out of every lot')
  // Reversal: un-cancel re-takes exactly what the cancel released (lot A).
  const uncancel = plan([{ id: 11, batch_id: 1, quantity: 2, released_quantity: 2, returned_into_quantity: 0 },
    { id: 12, batch_id: 2, quantity: 2, released_quantity: 0, returned_into_quantity: 2 }], 'cancelled', 'partial_return')
  assert.deepEqual(releases(uncancel), [[11, -2]], 'un-cancel takes back from lot A only')
}

async function migrate(db) {
  const dir = path.join(root, 'migrations')
  for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8'))) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      try { await db.prepare(statement).run() } catch (error) {
        error.message = `${name}: ${error.message}`
        throw error
      }
    }
  }
}

async function main() {
  kernelChecks(await kernel())
  const bundle = await workerBundle()
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    // One line of 4 (sale item 1) drawn A (lot 1) : 2 then B (lot 2) : 2.
    await db.batch([
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum',1,0,2,5)",
      `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity)
        VALUES(1,1,'A','A','2026-08-01',1,2),(2,1,'B','B','2026-09-01',1,2)`,
      'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,0),(2,1,0)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0)',
      `INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,sale_status,amount_paid_usd)
        VALUES(1,'S-1',1,'Shop',4000,20,20,'completed',20)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(1,1,1,'Serum',4,1,5,20,2,NULL)`,
      'INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(11,1,1,1,2,0),(12,1,2,1,2,0)',
    ].map(sql => db.prepare(sql)))

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: JSON.stringify(body) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${url} returned ${response.status}: ${text}`) }
      return { status: response.status, body: parsed }
    }
    const line = (quantity, extra = {}) => [{ sale_item_id: 1, product_id: 1, quantity, stock_action: 'restock', branch_id: 1, ...extra }]
    const create = async (key, quantity, extra) => {
      const result = await send('POST', '/api/returns', { client_request_id: key, sale_id: 1, reason: 'Changed mind', items: line(quantity, extra) })
      assert.equal(result.status, 200, JSON.stringify(result.body))
      return result.body.id
    }
    const edit = async (id, key, quantity) => {
      const row = await db.prepare('SELECT updated_at FROM returns WHERE id=?').bind(id).first()
      const result = await send('PATCH', `/api/returns/${id}`, { client_request_id: key, expected_updated_at: row.updated_at, items: line(quantity) })
      assert.equal(result.status, 200, JSON.stringify(result.body))
    }
    const bulk = async (key, id, source, target) => {
      const row = await db.prepare('SELECT status,return_type,updated_at FROM returns WHERE id=?').bind(id).first()
      const result = await send('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source, target,
        items: [{ id, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'),
          expected_updated_at: row.updated_at ?? null }] })
      assert.equal(result.status, 200, JSON.stringify(result.body))
    }
    const lots = async () => {
      const rows = (await db.prepare('SELECT batch_id,quantity FROM branch_batch_stock WHERE branch_id=1 AND batch_id IN (1,2) ORDER BY batch_id').all()).results
      const branch = Number((await db.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).q)
      return { A: Number(rows[0].quantity), B: Number(rows[1].quantity), branch }
    }
    const released = async () => (await db.prepare('SELECT released_quantity r FROM sale_item_batch_allocations ORDER BY id').all()).results.map(row => Number(row.r))

    // 1. Two returns of 2: last-drawn lot first, then the other lot.
    const r1 = await create('lot-credit-r1', 2)
    assert.deepEqual(await lots(), { A: 0, B: 2, branch: 2 })
    const r2 = await create('lot-credit-r2', 2)
    assert.deepEqual(await lots(), { A: 2, B: 2, branch: 4 }, 'the second return goes back into lot A, not into lot B again')
    assert.deepEqual(await released(), [0, 0], 'returns do not write the sale-side released counter')

    // 2. Double-apply: replaying R2's request adds nothing.
    const replay = await send('POST', '/api/returns', { client_request_id: 'lot-credit-r2', sale_id: 1, reason: 'Changed mind', items: line(2) })
    assert.equal(replay.body.id, r2, JSON.stringify(replay.body))
    assert.deepEqual(await lots(), { A: 2, B: 2, branch: 4 }, 'a replayed return restocks nothing twice')

    // 3. Reversal: cancel R2 takes its units out of A; restore puts them back in A.
    await bulk('lot-credit-cancel-r2', r2, 'completed', 'cancelled')
    assert.deepEqual(await lots(), { A: 0, B: 2, branch: 2 })
    await bulk('lot-credit-restore-r2', r2, 'cancelled', 'completed')
    assert.deepEqual(await lots(), { A: 2, B: 2, branch: 4 })

    // 4. Edit R2 2 -> 1: its own units count as out, R1's still sit in B, so
    //    the one unit goes back into A (the walk without the fix picks B).
    await edit(r2, 'lot-credit-edit-r2', 1)
    assert.deepEqual(await lots(), { A: 1, B: 2, branch: 3 }, 'an edit re-plans into the lot the other live return did not refill')

    // 5. A cancelled return stops counting: cancel R1 (B -> 0), then a new
    //    return of 1 goes back into B, the last-drawn lot, which is out again.
    await bulk('lot-credit-cancel-r1', r1, 'completed', 'cancelled')
    assert.deepEqual(await lots(), { A: 1, B: 0, branch: 1 })
    await create('lot-credit-r3', 1)
    assert.deepEqual(await lots(), { A: 1, B: 1, branch: 2 }, 'a cancelled return no longer holds its lot as already refilled')

    // 6. Control: an operator pick is authoritative.
    await create('lot-credit-r4-picked', 1, { batch_id: 1 })
    assert.deepEqual(await lots(), { A: 2, B: 1, branch: 3 })

    console.log('PASS native return lot credit: repeated returns fill each lot the line drew from, replay adds nothing, cancel/restore/edit move exactly the recorded lot, cancelled returns stop counting, picks are kept; kernel cancel-after-return refills the right lot and un-cancel reverses it')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
