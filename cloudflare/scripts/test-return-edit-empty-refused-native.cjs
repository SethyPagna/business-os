// Native workerd/Miniflare D1 boundary for the rule "an edit never empties a
// customer return".
//
// The defect (OPUS-REVIEW-RETURN-EDIT-7077 finding 2, 12 Oct 2026): PATCH
// /api/returns/:id took `newItems = Array.isArray(body.items) ? body.items :
// existingItems`, so an explicit `items: []` passed every check. The edit
// batch then reversed every restocked line, deleted all return_items, inserted
// none and rewrote the refund as 0: a 2-line return became a 0-line return,
// its refund vanished and its restocked units left the shelf. The client sent
// exactly that body whenever the edit form or the Undo builder was built from
// a list row whose lines had not been loaded.
//
// Rule: an explicit empty `items` array is refused with 400 return_edit_empty
// and writes nothing. Omitting `items` still means "keep the lines". Undoing a
// whole return is a cancel, not an edit.
//
// Locks (every case runs on the Free and the Paid plan binding, and every
// request's D1 statements are counted -- each statement of a batch counts, as
// lib/planTier.ts's conservative d1QueriesPerInvocation assumes). Refusals and
// the replay are held to 50 / 1000. A SUCCESSFUL two-line edit is held to the
// Paid 1000 only: it already ran 61-62 statements on the base (the reversal and
// re-apply batch), over the conservative Free 50 -- a pre-existing cost this
// guard neither adds to nor fixes. Its counts are printed as KNOWN so the
// overrun stays visible instead of being asserted away.
//   1. items [] -> 400 return_edit_empty; the full state hash (returns,
//      return_items, allocations, movements, branch and lot stock, product
//      totals, sale status, damaged lots, receipts, revisions, audit rows) is
//      byte-identical before and after.
//   2. control: every line at quantity 0 -> refused (assertReturnableItems
//      already refused this on the base) and writes nothing.
//   3. control: items omitted -> 200, the same two lines and refund, and the
//      stock is where it was (reverse + re-restock nets to zero).
//   4. control: a real edit still moves stock and refund by the exact delta,
//      and editing back restores them.
//   5. ordering: a committed edit's own receipt still replays (200, nothing
//      written) even when that committed body was items [] -- a lost
//      acknowledgement from before this rule must not be reported as a
//      refusal of something that already happened.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const BUDGET = { free: 50, paid: 1000 }

// The test Worker wraps env.DB so every statement the invocation runs is
// counted: a prepared statement's first/all/run/raw is one, a batch of N is N.
// waitUntil work is awaited before the tally is returned, so background writes
// (cache versions) are counted with the request that caused them.
const COUNTING_ENTRY = `
function countingD1(db, tally) {
  const wrap = (statement) => ({
    __d1: statement,
    bind: (...values) => wrap(statement.bind(...values)),
    first: (...args) => { tally.statements += 1; tally.calls += 1; return statement.first(...args) },
    all: () => { tally.statements += 1; tally.calls += 1; return statement.all() },
    run: () => { tally.statements += 1; tally.calls += 1; return statement.run() },
    raw: (...args) => { tally.statements += 1; tally.calls += 1; return statement.raw(...args) },
  })
  return {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: (statements) => { tally.statements += statements.length; tally.calls += 1; return db.batch(statements.map((s) => s.__d1 || s)) },
    exec: (sql) => { tally.statements += 1; tally.calls += 1; return db.exec(sql) },
    dump: () => db.dump(),
  }
}
export default {
  async fetch(request, env) {
    const tally = { statements: 0, calls: 0 }
    const pending = []
    const plan = request.headers.get('x-test-plan') || 'free'
    const response = await app.fetch(request, { ...env, PLAN_TIER: plan, DB: countingD1(env.DB, tally) },
      { waitUntil: (promise) => { pending.push(promise) }, passThroughOnException() {} })
    const text = await response.text()
    tally.foreground = tally.statements
    const settled = await Promise.allSettled(pending)
    tally.background = settled.map((outcome) => outcome.status === 'rejected' ? 'rejected: ' + String((outcome.reason && outcome.reason.message) || outcome.reason) : 'ok')
    return new Response(JSON.stringify({ status: response.status, text, tally }), { headers: { 'content-type': 'application/json' } })
  },
}`

async function stockKernel() {
  const bundle = await build({ stdin: { contents: "export { executeRawStockTransaction } from './src/lib/stockTransaction'", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }
  new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  return mod.exports
}

async function workerBundle() {
  return build({ stdin: { contents: `import { Hono } from 'hono'; import returns from './src/routes/returns';
      const app=new Hono(); app.route('/api/returns',returns);${COUNTING_ENTRY}`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'],
    plugins: [{ name: 'return-edit-empty-fixtures', setup(b) {
      const fixtures = {
        auth: `export const requireAuth=async(c,next)=>{const raw=c.req.header('x-test-permissions');
          if(!raw)return c.json({error:'Unauthorized'},401);c.set('user',{id:7,username:'fixture',name:'Fixture',role_code:'admin',permissions:raw});return next()}`,
        broadcastHub: 'export const broadcast=async()=>{}',
        telegram: `export const sendReturnTelegramEvent=async()=>{};export const sendReturnStatusTelegramEvents=async()=>{};export const sendTelegramEvent=async()=>{};
          export const formatSaleTelegramLines=()=>[];export const formatSaleStatusTelegramLines=()=>[]`,
      }
      b.onResolve({ filter: /(?:lib\/(?:auth|telegram)|durable-objects\/broadcastHub)$/ }, args => ({
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

async function main() {
  const stockAdmission = await stockKernel()
  const bundle = await workerBundle()
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, d1Databases: ['DB'], kvNamespaces: ['CACHE'],
    compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await migrate(db)
    // Two products, one lot each: 10 received, 2 sold (8 on hand). One legacy
    // (v0) sale of 2 + 2 at $5.
    await stockAdmission.executeRawStockTransaction(db, [
      "INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)",
      "INSERT INTO users(id,username,name,password,is_active) VALUES(7,'fixture','Fixture','x',1)",
      "INSERT INTO products(id,name,is_active,stock_quantity,cost_price_usd,selling_price_usd) VALUES(1,'Serum',1,8,2,5),(2,'Toner',1,8,2,5)",
      `INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,received_quantity)
        VALUES(1,1,'L1','L1','2026-09-01',1,10),(2,2,'L2','L2','2026-09-01',1,10)`,
      'INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,8),(2,1,8)',
      'INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,8),(2,1,8)',
      `INSERT INTO sales(id,receipt_number,branch_id,branch_name,exchange_rate,subtotal_usd,total_usd,sale_status,amount_paid_usd)
        VALUES(1,'S-1',1,'Shop',4000,20,20,'completed',20)`,
      `INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id,applied_price_usd,total_usd,cost_price_usd,batch_id)
        VALUES(1,1,1,'Serum',2,1,5,10,2,1),(2,1,2,'Toner',2,1,5,10,2,2)`,
      'INSERT INTO sale_item_batch_allocations(sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,1,1,2,0),(2,2,1,2,0)',
    ].map(sql => db.prepare(sql)))
    assert.deepEqual((await db.prepare("SELECT value FROM system_flags WHERE key='stock_transaction_permit'").all()).results, [], 'synthetic stock setup releases its permit')
    const stockState = async () => Object.fromEntries(await Promise.all(['products','branch_stock','product_batches','branch_batch_stock','damaged_stock_lots','system_flags'].map(async table => [table,(await db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results])))
    const beforeRawMutation = await stockState()
    await assert.rejects(db.prepare('UPDATE products SET stock_quantity=stock_quantity+1').run(), /stock_transaction_required/)
    assert.deepEqual(await stockState(), beforeRawMutation, 'ordinary unadmitted stock writes remain refused without changing any ledger or flag')

    const send = async (method, url, body, plan = 'free') => {
      const response = await mf.dispatchFetch(`http://local${url}`, { method, body: JSON.stringify(body), headers: {
        'content-type': 'application/json', 'x-test-permissions': JSON.stringify({ all: true }), 'x-test-plan': plan } })
      const wrapper = await response.json()
      let parsed
      try { parsed = JSON.parse(wrapper.text) } catch { throw new Error(`${method} ${url} returned ${wrapper.status}: ${wrapper.text}`) }
      return { status: wrapper.status, body: parsed, tally: wrapper.tally }
    }
    const measured = []
    const measure = (label, plan, result) => {
      const { statements, foreground, calls } = result.tally
      measured.push(`${label}/${plan}=${statements} statements (${foreground} before the response, ${statements - foreground} in waitUntil [${result.tally.background.join(',')}]) in ${calls} D1 calls`)
      return statements
    }
    const withinBudget = (label, plan, result) => {
      const statements = measure(label, plan, result)
      assert.ok(statements <= BUDGET[plan], `${label} on ${plan} ran ${statements} D1 statements, over the ${BUDGET[plan]} per-invocation budget`)
    }
    // A successful edit: Paid budget asserted; a Free overrun is recorded, not hidden.
    const knownOverFree = []
    const successCost = (label, plan, result) => {
      const statements = measure(label, plan, result)
      if (plan === 'paid') assert.ok(statements <= BUDGET.paid, `${label} on paid ran ${statements} D1 statements, over ${BUDGET.paid}`)
      else if (statements > BUDGET.free) knownOverFree.push(`${label}=${statements}`)
    }
    const lines = (serum, toner) => [
      { sale_item_id: 1, product_id: 1, product_name: 'Serum', quantity: serum, applied_price_usd: 5, return_to_stock: true, stock_action: 'restock', branch_id: 1 },
      { sale_item_id: 2, product_id: 2, product_name: 'Toner', quantity: toner, applied_price_usd: 5, return_to_stock: true, stock_action: 'restock', branch_id: 1 },
    ]
    const updatedAt = async (id) => (await db.prepare('SELECT updated_at FROM returns WHERE id=?').bind(id).first()).updated_at
    let requestSeq = 0
    const edit = async (id, fields, plan) => send('PATCH', `/api/returns/${id}`,
      { client_request_id: `empty-guard-${++requestSeq}`, expected_updated_at: await updatedAt(id), ...fields }, plan)
    const stock = async () => {
      const read = async (sql) => Number(Object.values(await db.prepare(sql).first())[0])
      return {
        serum: { branch: await read('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1'),
          lot: await read('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1'),
          product: await read('SELECT stock_quantity FROM products WHERE id=1') },
        toner: { branch: await read('SELECT quantity FROM branch_stock WHERE product_id=2 AND branch_id=1'),
          lot: await read('SELECT quantity FROM branch_batch_stock WHERE batch_id=2 AND branch_id=1'),
          product: await read('SELECT stock_quantity FROM products WHERE id=2') },
      }
    }
    const shelf = (serum, toner) => ({ serum: { branch: serum, lot: serum, product: serum }, toner: { branch: toner, lot: toner, product: toner } })
    const returnLines = async (id) => (await db.prepare(`SELECT sale_item_id,product_id,quantity,stock_action,return_to_stock,total_usd
      FROM return_items WHERE return_id=? ORDER BY sale_item_id`).bind(id).all()).results
    const refund = async (id) => (await db.prepare('SELECT total_refund_usd,total_refund_khr FROM returns WHERE id=?').bind(id).first())
    // Every row any return edit can touch, hashed: a refused edit must leave
    // all of it byte-identical.
    const STATE_SQL = [
      'SELECT * FROM returns ORDER BY id',
      'SELECT * FROM return_items ORDER BY id',
      'SELECT * FROM return_item_batch_allocations ORDER BY id',
      'SELECT * FROM inventory_movements ORDER BY id',
      'SELECT * FROM branch_stock ORDER BY product_id,branch_id',
      'SELECT * FROM branch_batch_stock ORDER BY batch_id,branch_id',
      'SELECT id,stock_quantity,updated_at FROM products ORDER BY id',
      'SELECT * FROM product_batches ORDER BY id',
      'SELECT id,sale_status,status_before_return,updated_at FROM sales ORDER BY id',
      'SELECT * FROM damaged_stock_lots ORDER BY id',
      'SELECT * FROM return_mutation_receipts ORDER BY id',
      'SELECT * FROM return_write_revisions ORDER BY return_id',
      'SELECT * FROM sale_write_revisions ORDER BY sale_id',
      'SELECT * FROM sale_record_events ORDER BY id',
      'SELECT COUNT(*) AS n FROM audit_logs',
    ]
    const stateHash = async () => {
      const rows = []
      for (const sql of STATE_SQL) rows.push((await db.prepare(sql).all()).results)
      return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
    }

    // Setup: one return of both lines, 1 + 1 restocked, $10 refund. Created on
    // the Paid binding: the create path's own conservative estimate refuses a
    // two-line legacy return on Free (customer_return_over_plan_budget), which
    // is that route's rule and not what this file measures.
    const created = await send('POST', '/api/returns', { client_request_id: 'empty-guard-create', sale_id: 1, reason: 'Changed mind',
      items: lines(1, 1).map(({ sale_item_id, product_id, quantity, stock_action, branch_id }) => ({ sale_item_id, product_id, quantity, stock_action, branch_id })) }, 'paid')
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const id = created.body.id
    assert.deepEqual(await stock(), shelf(9, 9))
    assert.equal((await returnLines(id)).length, 2)
    assert.equal(Number((await refund(id)).total_refund_usd), 10)

    for (const plan of ['free', 'paid']) {
      // 1. The defect: items [] -- the exact body the edit form and the Undo
      //    builder sent for a list row with no loaded lines.
      const beforeEmpty = await stateHash()
      const emptied = await edit(id, { reason: 'Changed mind', return_type: 'restock', notes: '', total_refund_usd: 0, total_refund_khr: 0, branch_id: 1, items: [] }, plan)
      if (emptied.status !== 400) {
        const damage = { lines: (await returnLines(id)).length, refund: await refund(id), stock: await stock() }
        assert.fail(`items [] must be refused on ${plan}, got ${emptied.status} ${JSON.stringify(emptied.body)}; `
          + `before: 2 lines, refund 10, serum/toner 9/9; after: ${JSON.stringify(damage)}`)
      }
      assert.equal(emptied.body.code, 'return_edit_empty', JSON.stringify(emptied.body))
      assert.equal(emptied.body.error, 'A return must keep at least one line. To undo the whole return, cancel it instead.')
      assert.equal(await stateHash(), beforeEmpty, `a refused empty edit writes nothing on ${plan}`)
      assert.deepEqual(await stock(), shelf(9, 9))
      assert.equal((await returnLines(id)).length, 2)
      withinBudget('items[]', plan, emptied)

      // 2. Control: every line at quantity 0 is refused before any write.
      const beforeZero = await stateHash()
      const zeroed = await edit(id, { reason: 'Changed mind', items: lines(0, 0) }, plan)
      assert.equal(zeroed.status, 400, JSON.stringify(zeroed.body))
      assert.equal(await stateHash(), beforeZero, `an all-zero edit writes nothing on ${plan}`)
      withinBudget('all-zero', plan, zeroed)

      // 3. Control: omitting items keeps the lines, the refund and the shelf.
      const linesBefore = await returnLines(id)
      const refundBefore = await refund(id)
      const kept = await edit(id, { reason: `Reason only (${plan})` }, plan)
      assert.equal(kept.status, 200, JSON.stringify(kept.body))
      assert.deepEqual(await returnLines(id), linesBefore, 'items omitted keeps every line as it was')
      assert.deepEqual(await refund(id), refundBefore, 'items omitted keeps the refund')
      assert.deepEqual(await stock(), shelf(9, 9), 'items omitted nets the restock to zero')
      assert.equal((await db.prepare('SELECT reason FROM returns WHERE id=?').bind(id).first()).reason, `Reason only (${plan})`)
      successCost('items-omitted', plan, kept)

      // 4. Control: a real edit moves stock and refund by the delta, and back.
      const raised = await edit(id, { reason: 'Changed mind', items: lines(2, 1) }, plan)
      assert.equal(raised.status, 200, JSON.stringify(raised.body))
      assert.deepEqual(await stock(), shelf(10, 9))
      assert.equal(Number((await refund(id)).total_refund_usd), 15)
      successCost('valid-edit', plan, raised)
      const lowered = await edit(id, { reason: 'Changed mind', items: lines(1, 1) }, plan)
      assert.equal(lowered.status, 200, JSON.stringify(lowered.body))
      assert.deepEqual(await stock(), shelf(9, 9))
      assert.equal(Number((await refund(id)).total_refund_usd), 10)
      assert.equal((await returnLines(id)).length, 2)
    }

    // 5. A receipt a pre-rule server committed for an items [] edit still
    //    replays as the success it was (the guard sits after the receipt
    //    lookup), and the replay writes nothing.
    const replayAt = await updatedAt(id)
    const committedBody = { client_request_id: 'pre-rule-empty-edit', expected_updated_at: replayAt, items: [] }
    const absent = { present: false }
    const intent = JSON.stringify({ return_id: id, expected_updated_at: replayAt, items: { present: true, value: [] },
      reason: absent, return_type: absent, notes: absent, total_refund_usd: absent, total_refund_khr: absent, branch_id: absent })
    const committedResponse = { id, updated_at: replayAt }
    await db.prepare(`INSERT INTO return_mutation_receipts(id,actor_id,return_id,sale_id,mutation_kind,request_id,request_digest,request_json,response_json,occurred_at)
      VALUES(?,7,?,1,'edit','pre-rule-empty-edit',?,?,?,?)`)
      .bind(crypto.randomUUID(), id, crypto.createHash('sha256').update(intent).digest('hex'), intent, JSON.stringify(committedResponse), replayAt).run()
    const beforeReplay = await stateHash()
    const replayed = await send('PATCH', `/api/returns/${id}`, committedBody, 'free')
    assert.equal(replayed.status, 200, JSON.stringify(replayed.body))
    assert.deepEqual(replayed.body, committedResponse, 'the stored response is replayed as it was committed')
    assert.equal(await stateHash(), beforeReplay, 'a replay writes nothing')
    withinBudget('receipt-replay', 'free', replayed)

    console.log(`MEASURE ${measured.join('; ')}`)
    if (knownOverFree.length) {
      console.log(`KNOWN pre-existing: a successful two-line return edit exceeds the conservative Free 50 (${knownOverFree.join(', ')}); refusals are unaffected`)
    }
    console.log('PASS native return edit: items [] refused 400 return_edit_empty with no write (Free and Paid); all-zero refused; items omitted keeps lines/refund/shelf; real edits move exact deltas; a committed receipt still replays; refusals and replay within 50 / 1000 D1 statements, successful edits within Paid 1000')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
