// Native workerd/Miniflare D1 boundary for 6.0.999: Undo / Redo of an old-format return edit keeps each line's
// stock handling -- restock, damaged (with its condition tag) or no restock -- and never guesses one.
//
// The defect (found by lane 992's writer, 27 Oct 2026): the client's Undo/Redo body sent each line as
// `return_to_stock: item.return_to_stock !== false` and nothing else. The server hands the line back as the
// integer 0 or 1 (GET /api/returns/:id is SELECT * FROM return_items), and 0 !== false is true, so a stored
// DAMAGED line and a stored NO-RESTOCK line were both replayed as a plain restock: the units became sellable
// stock and the damaged lot (with its tag) was never re-created. The tag was not even on the snapshot.
//
// This file drives the real routes (GET /:id, POST /, PATCH /:id, POST /bulk) and feeds the REAL client builder
// (frontend returnHistoryPayloadFromSnapshot, bundled from source) into PATCH, so a regression on either side
// turns it red. After every step it reads BOTH stock ledgers (branch_stock + products.stock_quantity, and the
// batch ledger branch_batch_stock), the damaged lots with their tags, and the movement ledger.
//
// Scenarios:
//   A. edit damaged(expired)->restock, UNDO back to damaged(expired), REDO; undo applied twice (new request id)
//      does not stack; the same request id re-sent is a receipt replay, not a second delta
//   B. edit restock->damaged(expired); UNDO then REDO lands on damaged(expired) (the literal report)
//   C. a no-restock line is not turned into a restock by Undo (the 0 !== false half of the bug)
//   D. two damaged lines with different tags keep their own tag through GET /:id and Undo/Redo
//   E. the Worker REFUSES (400 return_stock_action_required, nothing written) a line that names no stock_action
//      where the default would change the stored handling, and a line carrying damaged data without the action;
//      it still accepts the legacy body where the default changes nothing
//   F. a header-only PATCH (items omitted) keeps a tagged lot's tag
//   G. sibling writer: bulk cancel then restore keeps the lot, its tag and both ledgers
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')

async function stockKernel() {
  const bundle = await build({ stdin: { contents: "export { executeRawStockTransaction } from './src/lib/stockTransaction'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

// The browser half, bundled from the frontend source: what Returns.tsx sends for Undo / Redo of a return edit.
async function clientBuilder() {
  const bundle = await build({ stdin: { contents: "export { returnHistoryPayloadFromSnapshot } from '../frontend/src/components/returns/helpers/returnHistoryPayload.ts'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports.returnHistoryPayloadFromSnapshot
}

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns';
      const app=new Hono(); app.route('/api/returns',returns); export default app;`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'],
    plugins: [{ name: 'return-undo-damaged-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',role_code:'admin',permissions:raw});return next()}`,
        audit: 'export const audit=async()=>{};export const changedFields=()=>null;export const auditChangeColumns=()=>({old_value:null,new_value:null});export const isSecretShapedAuditKey=()=>false',
        cache: 'export const bumpVersion=async()=>{};export const bumpVersions=async()=>{};',
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
          export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[]`,
      }
      b.onResolve({ filter: /(?:lib\/(?:auth|audit|cache|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
        path: args.path.split('/').pop(), namespace: 'return-fixture',
      }))
      b.onLoad({ filter: /.*/, namespace: 'return-fixture' }, args => ({ contents: fixtures[args.path], loader: 'ts' }))
    } }],
  })
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

let failed = 0
async function scenario(name, run) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error && error.message ? error.message : error)
  }
}

async function main() {
  const stockAdmission = await stockKernel()
  const returnHistoryPayloadFromSnapshot = await clientBuilder()
  const bundle = await workerBundle()
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'],
    compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    // Lot L1 received 100, 40 sold on two lines of the same sale (30 + 10): 60 on hand in BOTH ledgers.
    await stockAdmission.executeRawStockTransaction(db, [
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum',1,60,2,5)",
      `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity)
        VALUES(1,1,'L1','L1','2026-09-01',1,100)`,
      'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,60)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,60)',
      `INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,sale_status,amount_paid_usd)
        VALUES(1,'S-1',1,'Shop',4000,200,200,'completed',200)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(1,1,1,'Serum',30,1,5,150,2,1)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(2,1,1,'Serum',10,1,5,50,2,1)`,
      'INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,1,1,30,0)',
      'INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(2,1,1,10,0)',
    ].map(sql => db.prepare(sql)))

    const headers = { 'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }) }
    const send = async (method, url, body) => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await response.text()
      let parsed
      try { parsed = JSON.parse(text) } catch { throw new Error(`${url} returned ${response.status}: ${text}`) }
      return { status: response.status, body: parsed }
    }
    let requestCounter = 0
    // The bulk route wants /^[A-Za-z0-9_-]{8,120}$/; one shape serves every route here.
    const requestId = prefix => `${String(prefix).replace(/[^A-Za-z0-9_-]+/g, '-')}-${String(++requestCounter).padStart(4, '0')}`

    const get = async id => {
      const response = await send('GET', `/api/returns/${id}`)
      assert.equal(response.status, 200, JSON.stringify(response.body))
      return response.body
    }
    // sale_item 1 unless told otherwise; the modal's body for one line.
    const line = (quantity, action, tag, saleItemId = 1) => ({
      sale_item_id: saleItemId, product_id: 1, quantity, stock_action: action, return_to_stock: action === 'restock', branch_id: 1,
      ...(action === 'damaged' ? { condition_tag: tag, damaged_disposition: 'keep' } : {}),
    })
    const create = async (items, notes) => {
      const response = await send('POST', '/api/returns', { client_request_id: requestId('create'), sale_id: 1, reason: 'Changed mind', items, ...(notes === undefined ? {} : { notes }) })
      assert.equal(response.status, 200, JSON.stringify(response.body))
      return response.body.id
    }
    // The ordinary edit form: it sends every line with stock_action (and the tag for a damaged one).
    const editLines = async (id, items, fields = {}) => {
      const current = await get(id)
      const response = await send('PATCH', `/api/returns/${id}`, { client_request_id: requestId('edit'), expected_updated_at: current.updated_at, reason: current.reason, items, ...fields })
      assert.equal(response.status, 200, JSON.stringify(response.body))
    }
    // Undo / Redo: the real client builder over a snapshot, as restoreReturnSnapshot sends it.
    const replay = async (id, snapshot, label, key) => {
      const current = await get(id)
      const payload = returnHistoryPayloadFromSnapshot(structuredClone(snapshot))
      assert.ok(payload, `${label}: the client built a replay body`)
      const sent = { ...payload, expected_updated_at: current.updated_at, client_request_id: key || requestId(label) }
      return { ...(await send('PATCH', `/api/returns/${id}`, sent)), sent }
    }

    // -------- the two ledgers, the lots and the movement ledger -----------------------------------------------
    const ledger = async () => ({
      branch: Number((await db.prepare('SELECT quantity q FROM branch_stock WHERE product_id=1 AND branch_id=1').first()).q),
      product: Number((await db.prepare('SELECT stock_quantity q FROM products WHERE id=1').first()).q),
      lot: Number((await db.prepare('SELECT quantity q FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').first()).q),
    })
    const lotsOf = async id => (await db.prepare('SELECT quantity,quantity_remaining,condition_tag,source FROM damaged_stock_lots WHERE return_id=? ORDER BY id').bind(id).all()).results
      .map(row => ({ q: Number(row.quantity), remaining: Number(row.quantity_remaining), tag: row.condition_tag, source: row.source }))
    const linesOf = async id => (await db.prepare('SELECT quantity,stock_action,return_to_stock FROM return_items WHERE return_id=? ORDER BY id').bind(id).all()).results
      .map(row => ({ q: Number(row.quantity), action: row.stock_action, restocked: Number(row.return_to_stock) }))
    const movementNet = async id => {
      const rows = (await db.prepare('SELECT movement_type t, SUM(quantity) q FROM inventory_movements WHERE CAST(reference_id AS TEXT)=? GROUP BY movement_type').bind(String(id)).all()).results
      const by = Object.fromEntries(rows.map(row => [row.t, Number(row.q)]))
      return { restocked: (by.return || 0) + (by.return_reversal || 0), damaged: (by.damage_in || 0) + (by.damage_reversal || 0) }
    }
    const movementCount = async () => Number((await db.prepare('SELECT COUNT(*) n FROM inventory_movements').first()).n)
    // Everything a refused body must leave alone, in one string.
    const fingerprint = async id => JSON.stringify({ ledger: await ledger(), lots: await lotsOf(id), lines: await linesOf(id), movements: await movementCount(), updated: (await get(id)).updated_at })

    // One assertion for "this is exactly the state": both ledgers move by `restockDelta`, lots are as listed, the line
    // rows are as listed, and the movement ledger nets to the same units (nothing stacked, nothing lost).
    const expectState = async (label, id, base, { restockDelta, lots, lines }) => {
      const now = await ledger()
      assert.deepEqual(now, { branch: base.branch + restockDelta, product: base.product + restockDelta, lot: base.lot + restockDelta },
        `${label}: branch_stock, products.stock_quantity and the batch ledger move together by ${restockDelta}`)
      assert.deepEqual(await lotsOf(id), lots, `${label}: damaged lots (units, remaining, tag)`)
      assert.deepEqual(await linesOf(id), lines, `${label}: stored lines`)
      const net = await movementNet(id)
      assert.equal(net.restocked, lines.filter(l => l.action === 'restock').reduce((n, l) => n + l.q, 0), `${label}: restock movements net to the restocked units`)
      assert.equal(net.damaged, lots.reduce((n, l) => n + l.q, 0), `${label}: damage movements net to the held damaged units`)
    }
    const kept = (q, tag) => ({ q, remaining: q, tag, source: 'return' })
    const rowOf = (q, action) => ({ q, action, restocked: action === 'restock' ? 1 : 0 })

    // ======================= A. edit damaged(expired) -> restock, Undo, Redo, double-apply, same id =============
    await scenario('A. Undo of an edit restores the damaged line with its tag, Redo undoes it again, nothing stacks', async () => {
      const base = await ledger()
      const id = await create([line(2, 'damaged', 'expired')], 'abc')
      const notesNow = async () => (await get(id)).notes
      assert.equal(await notesNow(), 'abc', 'A1 notes as created')
      await expectState('A1 created damaged', id, base, { restockDelta: 0, lots: [kept(2, 'expired')], lines: [rowOf(2, 'damaged')] })
      const before = await get(id)
      await editLines(id, [line(2, 'restock')], { notes: 'xyz' })
      assert.equal(await notesNow(), 'xyz', 'A2 notes edited')
      await expectState('A2 edited to restock', id, base, { restockDelta: 2, lots: [], lines: [rowOf(2, 'restock')] })
      const after = await get(id)

      const undo = await replay(id, before, 'Undo return edit')
      assert.equal(undo.status, 200, JSON.stringify(undo.body))
      assert.equal(await notesNow(), 'abc', 'A3 Undo restores the notes as they were (never a history label)')
      await expectState('A3 after Undo', id, base, { restockDelta: 0, lots: [kept(2, 'expired')], lines: [rowOf(2, 'damaged')] })

      const redo = await replay(id, after, 'Redo return edit')
      assert.equal(redo.status, 200, JSON.stringify(redo.body))
      assert.equal(await notesNow(), 'xyz', 'A4 Redo restores the edited notes')
      await expectState('A4 after Redo', id, base, { restockDelta: 2, lots: [], lines: [rowOf(2, 'restock')] })

      // D (double apply): the same Undo again with a NEW request id replaces the state, it does not stack it.
      for (const attempt of [1, 2]) {
        const again = await replay(id, before, 'Undo return edit')
        assert.equal(again.status, 200, JSON.stringify(again.body))
        await expectState(`A5 Undo applied again (#${attempt})`, id, base, { restockDelta: 0, lots: [kept(2, 'expired')], lines: [rowOf(2, 'damaged')] })
      }
      // E (same call twice): the first Undo's stored body re-sent verbatim (a lost acknowledgement) is the stored
      // receipt, not a second delta -- even though the return has moved on since.
      const countBefore = await movementCount()
      const resent = await send('PATCH', `/api/returns/${id}`, undo.sent)
      assert.equal(resent.status, 200, JSON.stringify(resent.body))
      assert.deepEqual(resent.body, undo.body, 'A6 the same receipt comes back')
      assert.equal(await movementCount(), countBefore, 'A6 a re-sent request id writes no movement')
      await expectState('A6 receipt replay', id, base, { restockDelta: 0, lots: [kept(2, 'expired')], lines: [rowOf(2, 'damaged')] })
      // The contract that makes the above possible: the snapshot says what the line was stored with.
      assert.equal(before.items[0].condition_tag, 'expired', 'the snapshot carries the stored tag')
      assert.equal(before.items[0].damaged_disposition, 'keep', 'and the stored disposition')
    })

    // ======================= B. edit restock -> damaged(expired); Undo; Redo ====================================
    await scenario('B. Redo of an edit lands on damaged with its tag, not on a plain restock', async () => {
      const base = await ledger()
      const id = await create([line(2, 'restock')])
      await expectState('B1 created restock', id, base, { restockDelta: 2, lots: [], lines: [rowOf(2, 'restock')] })
      const before = await get(id)
      await editLines(id, [line(2, 'damaged', 'expired')])
      await expectState('B2 edited to damaged', id, base, { restockDelta: 0, lots: [kept(2, 'expired')], lines: [rowOf(2, 'damaged')] })
      const after = await get(id)

      const undo = await replay(id, before, 'Undo return edit')
      assert.equal(undo.status, 200, JSON.stringify(undo.body))
      await expectState('B3 after Undo', id, base, { restockDelta: 2, lots: [], lines: [rowOf(2, 'restock')] })

      const redo = await replay(id, after, 'Redo return edit')
      assert.equal(redo.status, 200, JSON.stringify(redo.body))
      await expectState('B4 after Redo (must be damaged again)', id, base, { restockDelta: 0, lots: [kept(2, 'expired')], lines: [rowOf(2, 'damaged')] })
      assert.equal(after.items[0].condition_tag, 'expired', 'the edited snapshot carries the tag')
    })

    // ======================= C. a no-restock line stays no-restock ==============================================
    await scenario('C. Undo of an edit does not turn a no-restock line into a restock', async () => {
      const base = await ledger()
      const id = await create([line(1, 'none')])
      await expectState('C1 created no-restock', id, base, { restockDelta: 0, lots: [], lines: [rowOf(1, 'none')] })
      const before = await get(id)
      await editLines(id, [line(1, 'restock')])
      await expectState('C2 edited to restock', id, base, { restockDelta: 1, lots: [], lines: [rowOf(1, 'restock')] })
      const after = await get(id)
      const undo = await replay(id, before, 'Undo return edit')
      assert.equal(undo.status, 200, JSON.stringify(undo.body))
      await expectState('C3 after Undo (must be no-restock again)', id, base, { restockDelta: 0, lots: [], lines: [rowOf(1, 'none')] })
      const redo = await replay(id, after, 'Redo return edit')
      assert.equal(redo.status, 200, JSON.stringify(redo.body))
      await expectState('C4 after Redo', id, base, { restockDelta: 1, lots: [], lines: [rowOf(1, 'restock')] })
    })

    // ======================= D. two damaged lines, two tags =====================================================
    await scenario('D. two damaged lines of one product keep their own tag through the snapshot and Undo/Redo', async () => {
      const base = await ledger()
      const id = await create([line(1, 'damaged', 'expired', 1), line(2, 'damaged', 'opened', 2)])
      await expectState('D1 created', id, base, { restockDelta: 0, lots: [kept(1, 'expired'), kept(2, 'opened')], lines: [rowOf(1, 'damaged'), rowOf(2, 'damaged')] })
      const before = await get(id)
      await editLines(id, [line(1, 'restock', undefined, 1), line(2, 'damaged', 'opened', 2)])
      await expectState('D2 first line edited to restock', id, base, { restockDelta: 1, lots: [kept(2, 'opened')], lines: [rowOf(1, 'restock'), rowOf(2, 'damaged')] })
      const after = await get(id)
      const undo = await replay(id, before, 'Undo return edit')
      assert.equal(undo.status, 200, JSON.stringify(undo.body))
      await expectState('D3 after Undo', id, base, { restockDelta: 0, lots: [kept(1, 'expired'), kept(2, 'opened')], lines: [rowOf(1, 'damaged'), rowOf(2, 'damaged')] })
      const redo = await replay(id, after, 'Redo return edit')
      assert.equal(redo.status, 200, JSON.stringify(redo.body))
      await expectState('D4 after Redo', id, base, { restockDelta: 1, lots: [kept(2, 'opened')], lines: [rowOf(1, 'restock'), rowOf(2, 'damaged')] })
      // The snapshot contract behind it: each damaged line says its own tag (matched by order and quantity), a restock line none.
      assert.deepEqual(before.items.map(item => [item.quantity, item.condition_tag, item.damaged_disposition]), [[1, 'expired', 'keep'], [2, 'opened', 'keep']],
        'each line carries its own stored tag')
      assert.deepEqual(after.items.map(item => [item.quantity, item.condition_tag ?? null]), [[1, null], [2, 'opened']], 'the restock line carries no tag; the damaged one keeps its own')
    })

    // ======================= D2. equal quantities, different tags ==================================================
    // Scenario D's lines differ in size (1 and 2), so a matcher that pairs by quantity passes it. Here both lines are 1: only the
    // ORDER rule (the Kth damaged line of a product owns the Kth lot) can tell them apart. Both orders of tags are run, so a
    // matcher that sorts by tag, or hands every line the first lot, fails one of them.
    await scenario('D2. two damaged lines of EQUAL size keep their own tags, in either order, through GET, a form-style edit and Undo/Redo', async () => {
      for (const [first, second] of [['broken', 'opened'], ['opened', 'broken']]) {
        const label = `${first}/${second}`
        const base = await ledger()
        const id = await create([line(1, 'damaged', first, 1), line(1, 'damaged', second, 2)])
        const before = await get(id)
        assert.deepEqual(before.items.map(item => item.condition_tag), [first, second], `${label}: GET pairs each line with its own lot`)
        // The ordinary edit form: lines resent as GET returned them, tag = the line's tag or the default (EditReturnModal's own rule).
        await editLines(id, before.items.map(item => ({
          sale_item_id: item.sale_item_id, product_id: item.product_id, quantity: item.quantity, stock_action: item.stock_action, return_to_stock: item.stock_action === 'restock', branch_id: item.branch_id,
          ...(item.stock_action === 'damaged' ? { condition_tag: item.condition_tag || 'damaged', damaged_disposition: item.damaged_disposition || 'keep' } : {}),
        })))
        await expectState(`D2 ${label} form-style edit changed nothing`, id, base, { restockDelta: 0, lots: [kept(1, first), kept(1, second)], lines: [rowOf(1, 'damaged'), rowOf(1, 'damaged')] })
        await editLines(id, [line(1, 'restock', undefined, 1), line(1, 'damaged', second, 2)])
        const after = await get(id)
        assert.deepEqual(after.items.map(item => item.condition_tag ?? null), [null, second], `${label}: the remaining damaged line keeps ITS tag`)
        const undo = await replay(id, before, 'Undo return edit')
        assert.equal(undo.status, 200, JSON.stringify(undo.body))
        await expectState(`D2 ${label} after Undo`, id, base, { restockDelta: 0, lots: [kept(1, first), kept(1, second)], lines: [rowOf(1, 'damaged'), rowOf(1, 'damaged')] })
        assert.deepEqual((await get(id)).items.map(item => item.condition_tag), [first, second], `${label}: and GET still pairs them after the replay`)
        const redo = await replay(id, after, 'Redo return edit')
        assert.equal(redo.status, 200, JSON.stringify(redo.body))
        await expectState(`D2 ${label} after Redo`, id, base, { restockDelta: 1, lots: [kept(1, second)], lines: [rowOf(1, 'restock'), rowOf(1, 'damaged')] })
      }
    })

    // ======================= E. the Worker refuses to guess ======================================================
    await scenario('E. any line that names no stock_action is refused, whatever the default would have done', async () => {
      const damagedId = await create([line(1, 'damaged', 'expired')])
      const noneId = await create([line(1, 'none')])
      const restockId = await create([line(1, 'restock')])
      // What the pre-6.0.999 client sent for every line: the boolean only.
      const bare = (flag, extra) => [{ sale_item_id: 1, product_id: 1, product_name: 'Serum', quantity: 1, applied_price_usd: 5, applied_price_khr: 20000, return_to_stock: flag, branch_id: 1, ...extra }]
      const patch = async (id, items) => {
        const current = await get(id)
        return send('PATCH', `/api/returns/${id}`, { client_request_id: requestId('legacy'), expected_updated_at: current.updated_at, reason: current.reason, items })
      }
      const expectRefused = async (label, id, items) => {
        const before = await fingerprint(id)
        const response = await patch(id, items)
        assert.equal(response.status, 400, `${label}: ${JSON.stringify(response.body)}`)
        assert.equal(response.body.code, 'return_stock_action_required', `${label}: ${JSON.stringify(response.body)}`)
        assert.equal(response.body.action, 'refresh_required', `${label}: asks for a refresh`)
        assert.equal(await fingerprint(id), before, `${label}: a refused body writes nothing`)
      }
      // Damaged on file: every default (restock, no restock, the integer 0 that `!== false` reads as restock) is a guess.
      await expectRefused('E1 damaged line, return_to_stock true', damagedId, bare(true))
      await expectRefused('E2 damaged line, return_to_stock false', damagedId, bare(false))
      await expectRefused('E3 damaged line, return_to_stock 0', damagedId, bare(0))
      await expectRefused('E4 damaged line, an unknown stock_action', damagedId, bare(true, { stock_action: 'sellable' }))
      // No restock on file: a default restock would put units on the shelf.
      await expectRefused('E5 no-restock line, return_to_stock true', noneId, bare(true))
      await expectRefused('E6 no-restock line, return_to_stock 0', noneId, bare(0))
      // Damaged data without the action is ambiguous, wherever it is sent.
      await expectRefused('E7 a tag without the action', restockId, bare(true, { condition_tag: 'expired' }))
      await expectRefused('E8 a disposition without the action', restockId, bare(true, { damaged_disposition: 'keep' }))
      // Even where the default would change nothing: the body equals what the return holds, so accepting it would be a silent
      // no-op (an old Undo of damaged -> restock looks exactly like this). Every current client names the action.
      await expectRefused('E9 no-restock line, return_to_stock false (default = stored)', noneId, bare(false))
      await expectRefused('E10 restock line, return_to_stock true (default = stored)', restockId, bare(true))
      assert.deepEqual(await linesOf(noneId), [rowOf(1, 'none')])
      assert.deepEqual(await linesOf(restockId), [rowOf(1, 'restock')])
      // A mixed body is refused as a whole when any one line lacks the action.
      const named = line(1, 'restock')
      await expectRefused('E11 one named line and one bare line', restockId, [named, ...bare(true)])
    })

    // ======================= F. a header-only PATCH keeps the tag ===============================================
    await scenario('F. a PATCH that omits items keeps a tagged lot as it was', async () => {
      const base = await ledger()
      const taggedReturnId = await create([line(1, 'damaged', 'expired')])
      const current = await get(taggedReturnId)
      const response = await send('PATCH', `/api/returns/${taggedReturnId}`, { client_request_id: requestId('header'), expected_updated_at: current.updated_at, notes: 'header only' })
      assert.equal(response.status, 200, JSON.stringify(response.body))
      await expectState('F1 header-only edit', taggedReturnId, base, { restockDelta: 0, lots: [kept(1, 'expired')], lines: [rowOf(1, 'damaged')] })
    })

    // ======================= G. sibling writer: bulk cancel / restore ============================================
    await scenario('G. bulk cancel then restore of a return with a tagged lot keeps the lot, the tag and both ledgers', async () => {
      const base = await ledger()
      const taggedReturnId = await create([line(1, 'damaged', 'expired')])
      const bulk = async (source, target) => {
        const row = await db.prepare('SELECT status,return_type,updated_at FROM returns WHERE id=?').bind(taggedReturnId).first()
        return send('POST', '/api/returns/bulk', { client_request_id: requestId('bulk'), field: 'status', source, target,
          items: [{ id: taggedReturnId, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null }] })
      }
      const cancel = await bulk('completed', 'cancelled')
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body))
      assert.deepEqual(await ledger(), base, 'G1 cancelling a damaged return moves no sellable stock')
      assert.deepEqual(await lotsOf(taggedReturnId), [{ q: 1, remaining: 0, tag: 'expired', source: 'return' }], 'G1 the held units leave, the lot row and its tag stay')
      const restore = await bulk('cancelled', 'completed')
      assert.equal(restore.status, 200, JSON.stringify(restore.body))
      assert.deepEqual(await ledger(), base, 'G2 restoring moves no sellable stock either')
      assert.deepEqual(await lotsOf(taggedReturnId), [kept(1, 'expired')], 'G2 the same lot, same tag, units back')
    })

    // ======================= H / I. an OLD build's Undo body (the review's P2 and P3) ============================
    // Verbatim the mapping the client used before 6.0.999: the boolean only, and the integer 0 read as `true`.
    const oldBuildUndo = async (id, snapshot) => {
      const current = await get(id)
      return send('PATCH', `/api/returns/${id}`, {
        reason: snapshot.reason || '', return_type: snapshot.return_type || 'restock', notes: 'Undo return edit',
        total_refund_usd: snapshot.total_refund_usd || 0, total_refund_khr: snapshot.total_refund_khr || 0, branch_id: snapshot.branch_id || null,
        items: snapshot.items.map(item => ({
          sale_item_id: item.sale_item_id || null, product_id: item.product_id || null, product_name: item.product_name || null, quantity: item.quantity || 0,
          applied_price_usd: item.applied_price_usd || 0, applied_price_khr: item.applied_price_khr || 0,
          return_to_stock: item.return_to_stock !== false, branch_id: item.branch_id || snapshot.branch_id || null,
        })),
        expected_updated_at: current.updated_at, client_request_id: requestId('old-undo'),
      })
    }
    const expectOldUndoRefused = async (label, id, snapshot) => {
      const before = await fingerprint(id)
      const response = await oldBuildUndo(id, snapshot)
      assert.equal(response.status, 400, `${label}: ${JSON.stringify(response.body)}`)
      assert.equal(response.body.code, 'return_stock_action_required', `${label}: ${JSON.stringify(response.body)}`)
      assert.equal(await fingerprint(id), before, `${label}: a refused Undo writes nothing`)
    }
    await scenario('H. (P2) an old build\'s Undo of damaged->restock is refused, not accepted as a silent no-op', async () => {
      const id = await create([line(2, 'damaged', 'expired')])
      const before = await get(id)
      await editLines(id, [line(2, 'restock')])
      // The old body for the damaged line says restock, which is exactly what the return holds now: nothing would change
      // while the history reports the edit as undone. The Worker cannot tell that from a real edit, so it refuses.
      await expectOldUndoRefused('H1 damaged->restock', id, before)
    })
    // Lines matched by product (no sale_item_id), as a manual or product-picked return: a removed line then passes the cost lookup
    // through the line that stays, which is how the review reproduced it (Toner 30 -> 31).
    await scenario('I. (P3) an old build\'s Undo after a damaged / no-restock line was removed cannot make that unit sellable', async () => {
      const base = await ledger()
      const damagedId = await create([line(1, 'restock', undefined, null), line(1, 'damaged', 'expired', null)])
      const damagedBefore = await get(damagedId)
      await editLines(damagedId, [line(1, 'restock', undefined, null)])
      const afterDamaged = await ledger()
      await expectOldUndoRefused('I1 a removed damaged line', damagedId, damagedBefore)
      assert.deepEqual(await ledger(), afterDamaged, 'I1 the removed damaged unit did not become sellable')
      assert.deepEqual(await lotsOf(damagedId), [], 'I1 and no lot appeared')
      const noneId = await create([line(1, 'restock', undefined, null), line(1, 'none', undefined, null)])
      const noneBefore = await get(noneId)
      await editLines(noneId, [line(1, 'restock', undefined, null)])
      const afterNone = await ledger()
      await expectOldUndoRefused('I2 a removed no-restock line', noneId, noneBefore)
      assert.deepEqual(await ledger(), afterNone, 'I2 the removed no-restock unit did not become sellable')
      assert.ok(base.branch + 2 === afterNone.branch, 'two restock lines kept: the ledger rose by exactly those two units')
    })

    if (failed) {
      console.error(`${failed} scenario(s) failed`)
      process.exitCode = 1
    } else {
      console.log('PASS native return edit Undo/Redo keeps restock / damaged(tag) / no-restock exactly, never stacks, refuses a guessed stock_action; header-only edit and bulk cancel/restore keep the tag')
    }
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
