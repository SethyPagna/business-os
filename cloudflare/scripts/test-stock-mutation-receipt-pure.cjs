// Per-line stock idempotency: the companion for
// cloudflare/migrations/0192_stock_mutation_receipts.sql and the guard that
// uses it, cloudflare/src/lib/stockMutationReceipt.ts.
//
// The defect this pins: runAdjustAction and runReceiveBatchAction -- the only
// two kernels behind the fast stock-in commit, the ReceiveBatchModal receipt
// and the StockAdjustModal add/remove/set -- had no dedup identity. A line
// whose response never reached the client (crashed render, killed tab, dropped
// connection) is re-sent by the retry, and the delta landed twice:
// branch_stock is an accumulating upsert and inventory_movements has no
// uniqueness at all.
//
// Same harness as test-fast-stock-in-commit-pure.cjs: the REAL route/lib
// files transpiled and run against a real in-memory SQLite database with the
// real migrations applied, through the flat db.prepare()/db.batch() shape
// lib/db.ts's D1Compat produces.
//
// Run (from cloudflare/): node scripts/test-stock-mutation-receipt-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')

function autoStub() {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === '__esModule') return true
      if (typeof prop === 'symbol') return undefined
      return () => undefined
    },
  })
}

const moduleCache = new Map()
function loadReal(relPath, overrides = {}) {
  const cacheKey = relPath + '::' + Object.keys(overrides).sort().join(',')
  if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey)
  const sourcePath = path.join(root, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  const patchedLoad = function (request, parent, isMain) {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) return autoStub()
    Module._load = originalLoad
    try {
      return originalLoad.call(this, request, parent, isMain)
    } finally {
      Module._load = patchedLoad
    }
  }
  Module._load = patchedLoad
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  moduleCache.set(cacheKey, moduleObj.exports)
  return moduleObj.exports
}

function wrapFlat(rawDb) {
  return {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params) ?? [],
        run: (params) => {
          const r = stmt.run(params)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    async batch(items) { return rawDb.batch(items) },
    async transaction(fn) { return fn(this) },
    raw: rawDb,
  }
}

let currentDb = null
const dbOverride = { getDb: () => currentDb }

const moneyMod = loadReal('lib/moneyPrecision.ts')
const batchCodeMod = loadReal('lib/batchCode.ts')
const sqlBindingMod = loadReal('lib/sqlBinding.ts')
const stockConditionMod = loadReal('lib/stockCondition.ts')
const stockReceiptGateMod = loadReal('lib/stockReceiptGate.ts')
const stockReasonMod = loadReal('lib/stockReason.ts')
const actorSnapshotMod = loadReal('lib/actorSnapshot.ts')
const permissionsMod = loadReal('lib/permissions.ts')
const productDetailRuleMod = loadReal('lib/productDetailRule.ts', { './moneyPrecision': moneyMod })
const productIdentityMod = loadReal('lib/productIdentity.ts', {
  './db': dbOverride, './sqlBinding': sqlBindingMod, './productDetailRule': productDetailRuleMod,
})
const movementCostSnapshotMod = loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyMod })
const productBatchesMod = loadReal('lib/productBatches.ts', {
  './db': dbOverride, './batchCode': batchCodeMod, './moneyPrecision': moneyMod, './sqlBinding': sqlBindingMod,
})
// The module under test, loaded ONCE and shared with both kernels so the
// isolate-level schema probe inside it is the same object the routes see.
const receiptMod = loadReal('lib/stockMutationReceipt.ts')

let auditCalls = []
const auditStub = { audit: async (...args) => { auditCalls.push(args) } }
const cacheStub = { bumpVersion: async () => {} }
const broadcastStub = { broadcast: async () => {} }
const authStub = { requireAuth: async (c, next) => { await next() } }

const inventoryMod = loadReal('routes/inventory.ts', {
  '../lib/db': dbOverride,
  '../lib/auth': authStub,
  '../lib/audit': auditStub,
  '../lib/permissions': permissionsMod,
  '../lib/stockReason': stockReasonMod,
  '../lib/cache': cacheStub,
  '../durable-objects/broadcastHub': broadcastStub,
  '../lib/productBatches': productBatchesMod,
  '../lib/batchCode': batchCodeMod,
  '../lib/stockReceiptGate': stockReceiptGateMod,
  '../lib/productIdentity': productIdentityMod,
  '../lib/movementCostSnapshot': movementCostSnapshotMod,
  '../lib/actorSnapshot': actorSnapshotMod,
  '../lib/moneyPrecision': moneyMod,
  '../lib/stockCondition': stockConditionMod,
  '../lib/stockMutationReceipt': receiptMod,
})

const batchesMod = loadReal('routes/batches.ts', {
  '../lib/db': dbOverride,
  '../lib/auth': authStub,
  '../lib/audit': auditStub,
  '../lib/permissions': permissionsMod,
  '../durable-objects/broadcastHub': broadcastStub,
  '../lib/cache': cacheStub,
  '../lib/productBatches': productBatchesMod,
  '../lib/batchCode': batchCodeMod,
  '../lib/stockReceiptGate': stockReceiptGateMod,
  '../lib/stockReason': stockReasonMod,
  '../lib/actorSnapshot': actorSnapshotMod,
  '../lib/moneyPrecision': moneyMod,
  '../lib/stockMutationReceipt': receiptMod,
})

const stockInCommitMod = loadReal('routes/stockInCommit.ts', {
  '../lib/auth': authStub,
  '../lib/permissions': permissionsMod,
  './inventory': inventoryMod,
  './batches': batchesMod,
})

const { runStockInCommit } = stockInCommitMod
const { runAdjustAction } = inventoryMod
const { runReceiveBatchAction } = batchesMod
assert.equal(typeof receiptMod.withStockMutationReceipt, 'function', 'lib/stockMutationReceipt.ts exports withStockMutationReceipt')
assert.equal(typeof receiptMod.resetStockMutationReceiptSchemaProbe, 'function', 'the schema probe is resettable for tests')

function freshDb() {
  const rawDb = openDb(loadAll())
  rawDb.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active)
      VALUES(1, 'Serum', 'SER-1', 2, 0, 0, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(1, 1, 0);
  `)
  receiptMod.resetStockMutationReceiptSchemaProbe()
  return wrapFlat(rawDb)
}

const ADMIN_USER = { id: 1, username: 'admin', name: 'Admin', permissions: '{}' }

function makeContext(db, user = ADMIN_USER) {
  currentDb = db
  return {
    env: { DB: {} },
    executionCtx: { waitUntil: (p) => { Promise.resolve(p).catch(() => {}) } },
    get(key) { return key === 'user' ? user : undefined },
    set() {},
    json(obj, status = 200) {
      return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
    },
  }
}

function branchStock(db, productId = 1) {
  const row = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @productId AND branch_id = 1').get({ productId })
  return row ? row.quantity : 0
}

function movementCount(db, productId = 1) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id = @productId').get({ productId })
  return Number(row?.n ?? 0)
}

function receiptCount(db) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM stock_mutation_receipts').get({})
  return Number(row?.n ?? 0)
}

function receiptRow(db) {
  return db.prepare('SELECT written, response_status, completed_at FROM stock_mutation_receipts').get({})
}

// A database that fails one specific statement, so a kernel can be made to
// die exactly where a real one does: AFTER the stock write, not before it.
function faultyDb(db, match) {
  return {
    prepare(sql) {
      if (sql.includes(match)) {
        const boom = () => { throw new Error(`injected failure on ${match}`) }
        return { get: boom, all: boom, run: boom }
      }
      return db.prepare(sql)
    },
    batch: (items) => db.batch(items),
    transaction: (fn) => db.transaction(fn),
    raw: db.raw,
  }
}

// A database whose claim RELEASE silently does nothing -- the only way to
// produce, through the real code path, the row a hard crash leaves behind:
// claimed, written = 0, never completed.
function noReleaseDb(db) {
  return {
    prepare(sql) {
      if (sql.startsWith('DELETE FROM stock_mutation_receipts')) {
        return { get: () => undefined, all: () => [], run: () => ({ changes: 0 }) }
      }
      return db.prepare(sql)
    },
    batch: (items) => db.batch(items),
    transaction: (fn) => db.transaction(fn),
    raw: db.raw,
  }
}

function backdateClaim(db, seconds = 300) {
  db.raw.exec(`UPDATE stock_mutation_receipts SET created_at = datetime('now', '-${seconds} seconds')`)
}

// The real 0192 text, so the re-probe case re-applies exactly what the owner would.
function migration0192Sql() {
  const file = path.join(root, 'migrations', '0192_stock_mutation_receipts.sql')
  return fs.readFileSync(file, 'utf8')
}

const addBody = (requestId, quantity = 5) => ({
  client_request_id: requestId,
  productId: 1, type: 'add', quantity, branchId: 1, reason: 'stock in',
  supplierName: 'Acme', unitCostUsd: 2, paymentStatus: 'paid',
})

async function jsonOf(res) {
  return res.json()
}

async function run() {
  // 0) The migration really is in the chain the harness applies.
  {
    const db = freshDb()
    const row = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='stock_mutation_receipts'").get({})
    assert.equal(Number(row.n), 1, '0192_stock_mutation_receipts.sql must create stock_mutation_receipts')
    console.log('PASS 0192_stock_mutation_receipts.sql creates stock_mutation_receipts')
  }

  // 1) THE DOUBLE-APPLY CASE. The same line, sent twice with the same id --
  //    what a retry after a lost response actually sends. Stock must move
  //    exactly once and the SECOND call must return the FIRST result.
  {
    const db = freshDb()
    const c = makeContext(db)
    const first = await runAdjustAction(c, addBody('stockline_aaaaaaaa-1111'))
    const firstJson = await jsonOf(first)
    assert.equal(first.status, 200, 'first add succeeds')
    assert.equal(branchStock(db), 5, 'first add moves stock')
    assert.equal(movementCount(db), 1, 'first add writes one movement')

    const second = await runAdjustAction(c, addBody('stockline_aaaaaaaa-1111'))
    const secondJson = await jsonOf(second)
    assert.equal(second.status, 200, 'the replay answers 200, not an error')
    assert.equal(secondJson.replayed, true, 'the replay is labelled')
    assert.equal(branchStock(db), 5, 'THE FIX: the repeat does not move stock again')
    assert.equal(movementCount(db), 1, 'THE FIX: the repeat writes no second movement')
    assert.equal(secondJson.productId, firstJson.productId, 'the replay returns the ORIGINAL result')
    assert.equal(secondJson.batchId, firstJson.batchId, 'including the lot the first call landed in')
    assert.equal(secondJson.quantity, firstJson.quantity, 'including the quantity the first call applied')
    console.log('PASS a repeated adjust id is a no-op that returns the first result')
  }

  // 2) CONTROL. A different id on the same line data is a genuinely new
  //    movement -- without this the test above would also pass if dedup
  //    simply refused everything.
  {
    const db = freshDb()
    const c = makeContext(db)
    await runAdjustAction(c, addBody('stockline_aaaaaaaa-1111'))
    const other = await runAdjustAction(c, addBody('stockline_bbbbbbbb-2222'))
    assert.equal(other.status, 200, 'a new id is accepted')
    assert.equal((await jsonOf(other)).replayed, undefined, 'a new id is not a replay')
    assert.equal(branchStock(db), 10, 'CONTROL: a different id writes a second time')
    assert.equal(movementCount(db), 2, 'CONTROL: a different id writes a second movement')
    console.log('PASS a different id still writes (control)')
  }

  // 3) CONTROL. No id at all is exactly the pre-0192 behaviour -- the double
  //    apply this lane exists to stop. Pinned so nobody "fixes" the absent-id
  //    path into a silent refusal.
  {
    const db = freshDb()
    const c = makeContext(db)
    const bodyWithoutId = addBody('stockline_cccccccc-3333')
    delete bodyWithoutId.client_request_id
    await runAdjustAction(c, bodyWithoutId)
    await runAdjustAction(c, bodyWithoutId)
    assert.equal(branchStock(db), 10, 'CONTROL: an unidentified line still applies twice')
    assert.equal(receiptCount(db), 0, 'an unidentified line writes no receipt')
    console.log('PASS an unidentified line keeps the pre-0192 behaviour (control)')
  }

  // 4) REVERSAL / retry after a refusal. A rejected line moved no stock, so
  //    its claim is released and the SAME id must be usable once the operator
  //    fixes the problem. (Without the release, a typo would lock the line's
  //    id out for good.)
  {
    const db = freshDb()
    const c = makeContext(db)
    const refused = await runAdjustAction(c, { ...addBody('stockline_dddddddd-4444'), reason: '' })
    assert.equal(refused.status, 400, 'a reasonless adjust is still refused')
    assert.equal(receiptCount(db), 0, 'the refused claim is released, not kept')
    const fixed = await runAdjustAction(c, addBody('stockline_dddddddd-4444'))
    assert.equal(fixed.status, 200, 'the same id retries cleanly after a refusal')
    assert.equal(branchStock(db), 5, 'the fixed retry applies exactly once')
    assert.equal(movementCount(db), 1, 'and writes exactly one movement')
    console.log('PASS a refused line releases its claim so the same id can retry')
  }

  // 5) The id is an identity, not a rubber stamp: reusing it for DIFFERENT
  //    stock data is refused rather than silently replayed as the old result.
  {
    const db = freshDb()
    const c = makeContext(db)
    await runAdjustAction(c, addBody('stockline_eeeeeeee-5555', 5))
    const conflict = await runAdjustAction(c, addBody('stockline_eeeeeeee-5555', 9))
    assert.equal(conflict.status, 409, 'a reused id with different data is a conflict')
    assert.equal((await jsonOf(conflict)).code, 'idempotency_conflict', 'and names itself')
    assert.equal(branchStock(db), 5, 'the conflicting retry moves no stock')
    assert.equal(movementCount(db), 1, 'and writes no movement')
    console.log('PASS a reused id with different data is refused, not replayed')
  }

  // 6) The receive wire (POST /api/batches -- ReceiveBatchModal and the
  //    ordinary fast stock-in add line) carries the same contract.
  {
    const db = freshDb()
    const c = makeContext(db)
    const body = {
      client_request_id: 'receive_ffffffff-6666',
      product_id: 1, branch_id: 1, quantity: 7, unit_cost_usd: 2,
      supplier_name: 'Acme', payment_status: 'paid',
    }
    const first = await runReceiveBatchAction(c, body)
    assert.equal(first.status, 200, 'first receive succeeds')
    const firstJson = await jsonOf(first)
    assert.equal(branchStock(db), 7, 'first receive moves stock')
    const second = await runReceiveBatchAction(c, body)
    const secondJson = await jsonOf(second)
    assert.equal(secondJson.replayed, true, 'the repeated receive is a replay')
    assert.equal(secondJson.batchId, firstJson.batchId, 'returning the ORIGINAL lot')
    assert.equal(secondJson.lotCode, firstJson.lotCode, 'and the original lot code')
    assert.equal(branchStock(db), 7, 'THE FIX: the lot is not topped up a second time')
    assert.equal(movementCount(db), 1, 'THE FIX: no second receipt movement')
    console.log('PASS a repeated receive id replays instead of topping the lot up again')
  }

  // 7) The whole fast stock-in session, re-sent. This is the shape the modal
  //    actually posts when a render crash loses every line's "saved" status:
  //    the same lines, the same per-line ids, one more time.
  {
    const db = freshDb()
    const c = makeContext(db)
    const lines = [
      { key: 'a', wire: 'receive', body: {
        client_request_id: 'stockline_11111111-aaaa',
        product_id: 1, branch_id: 1, quantity: 5, unit_cost_usd: 2, supplier_name: 'Acme', payment_status: 'paid',
      } },
      { key: 'b', wire: 'adjust', body: addBody('stockline_22222222-bbbb', 3) },
    ]
    auditCalls = []
    const first = await runStockInCommit(c, lines)
    assert.ok(first.every((r) => r.ok), 'every line of the first commit succeeds')
    assert.equal(branchStock(db), 8, 'the session applies 5 + 3')
    assert.equal(movementCount(db), 2, 'two movements for two lines')

    const replay = await runStockInCommit(c, lines)
    assert.ok(replay.every((r) => r.ok), 'the re-sent session still answers ok per line')
    assert.ok(replay.every((r) => r.replayed === true), 'every re-sent line is labelled a replay')
    assert.equal(branchStock(db), 8, 'THE FIX: the re-sent session moves no further stock')
    assert.equal(movementCount(db), 2, 'THE FIX: and writes no further movements')
    console.log('PASS a whole re-sent fast stock-in session is a no-op')
  }

  // 8) Schema fallback. 0192 is append-only and is applied by the owner, not
  //    by the deploy, so the Worker must run on a database that does not have
  //    the table yet -- with the exact pre-0192 behaviour, never a refusal.
  {
    const db = freshDb()
    db.raw.exec('DROP TABLE stock_mutation_receipts;')
    receiptMod.resetStockMutationReceiptSchemaProbe()
    const c = makeContext(db)
    const first = await runAdjustAction(c, addBody('stockline_99999999-9999'))
    assert.equal(first.status, 200, 'a stock write is never refused for a missing receipt table')
    assert.equal(branchStock(db), 5, 'and applies normally')
    console.log('PASS a database without migration 0192 keeps writing stock')
  }

  // E3 -- THE PROBE MUST NOT LATCH OFF. An isolate that probed while 0192 was
  //    not yet applied used to run unprotected for its whole life, with no
  //    signal anywhere. Only the POSITIVE result is memoised now, so the guard
  //    starts working the moment the table exists.
  {
    const db = freshDb()
    db.raw.exec('DROP TABLE stock_mutation_receipts;')
    receiptMod.resetStockMutationReceiptSchemaProbe()
    await runAdjustAction(makeContext(db), addBody('stockline_cccc0000-probe'))
    assert.equal(branchStock(db), 5, 'the unprotected write still lands')

    // The owner applies 0192. No deploy, no isolate restart.
    db.raw.exec(migration0192Sql())
    const after = await runAdjustAction(makeContext(db), addBody('stockline_dddd0000-probe'))
    assert.equal(after.status, 200, 'the next line still writes')
    assert.equal(branchStock(db), 10, 'and applies')
    assert.equal(receiptCount(db), 1, 'THE FIX: protection resumed without recycling the isolate')
    const repeat = await runAdjustAction(makeContext(db), addBody('stockline_dddd0000-probe'))
    assert.equal((await jsonOf(repeat)).replayed, true, 'and the very next repeat is deduped')
    assert.equal(branchStock(db), 10, 'THE FIX: stock stays at 10 -- before this it went to 15')
    console.log('PASS the schema probe re-checks after a miss')
  }

  // E8 -- an id that was SENT but is not usable is refused. Running it
  //    unprotected is the worst of the three options: the client believes it
  //    is deduped and it is not.
  {
    const db = freshDb()
    const c = makeContext(db)
    const short = await runAdjustAction(c, addBody('abc'))
    assert.equal(short.status, 400, 'a too-short id is refused')
    assert.equal((await jsonOf(short)).code, 'invalid_client_request_id', 'and says why')
    assert.equal(branchStock(db), 0, 'no stock moved')
    assert.equal(receiptCount(db), 0, 'and no receipt was written')
    const empty = await runAdjustAction(c, { ...addBody('ignored'), client_request_id: '' })
    assert.equal(empty.status, 200, 'CONTROL: an EMPTY id means "no id", the pre-0192 path')
    assert.equal(branchStock(db), 5, 'CONTROL: and writes')
    console.log('PASS an unusable client_request_id is a 400, never silently unprotected')
  }

  // E1 -- THE KERNEL THAT WRITES AND THEN FAILS. runAdjustAction moves
  //    stock and only afterwards writes the movement row, recomputes the
  //    catalog cost and (for a tagged restock) holds the units. A failure
  //    there used to RELEASE the claim, so the retry applied the delta a
  //    second time -- the guard looked green and the shelf was still wrong.
  {
    const db = freshDb()
    const c = makeContext(faultyDb(db, 'INSERT INTO inventory_movements'))
    let threw = false
    try { await runAdjustAction(c, addBody('stockline_77777777-dead')) } catch { threw = true }
    assert.equal(threw, true, 'the kernel really did die after its write')
    assert.equal(branchStock(db), 5, 'and the stock write really did land')
    const stranded = receiptRow(db)
    assert.equal(Number(stranded.written), 1, 'the receipt records that stock moved')
    assert.ok(stranded.completed_at, 'and is completed rather than released')

    const retry = await runAdjustAction(makeContext(db), addBody('stockline_77777777-dead'))
    assert.equal(retry.status, 409, 'THE FIX: the retry is refused, not re-applied')
    assert.equal((await jsonOf(retry)).code, 'stock_request_partially_applied', 'and names what happened')
    assert.equal(branchStock(db), 5, 'THE FIX: stock stays at 5 -- before this it went to 10')
    console.log('PASS a kernel that wrote stock and then failed refuses the retry')
  }

  // CONTROL for the case above. A failure BEFORE the write must still release,
  //    or the ordinary fix-and-retry loop would be broken by the fix.
  {
    const db = freshDb()
    const c = makeContext(faultyDb(db, 'SELECT id, name FROM branches'))
    let threw = false
    try { await runAdjustAction(c, addBody('stockline_77777777-beef')) } catch { threw = true }
    assert.equal(threw, true, 'the kernel died before writing')
    assert.equal(branchStock(db), 0, 'CONTROL: nothing was written')
    assert.equal(receiptCount(db), 0, 'CONTROL: the claim was released')
    const retry = await runAdjustAction(makeContext(db), addBody('stockline_77777777-beef'))
    assert.equal(retry.status, 200, 'CONTROL: the same id retries cleanly')
    assert.equal(branchStock(db), 5, 'CONTROL: and applies exactly once')
    console.log('PASS a failure before the write still releases the claim (control)')
  }

  // E2 -- A STALE CLAIM IS NOT A LIFE SENTENCE. A crash between the claim
  //    and the completion used to strand the id in 409 forever, with nothing
  //    to prune it. A claim that wrote nothing and is older than the window
  //    is taken over by the retry.
  {
    const db = freshDb()
    // A crash mid-kernel, BEFORE any write, whose release never ran: exactly
    // the row a killed isolate leaves behind. Same body as the retry below,
    // so this is a stale claim and not a conflict.
    const crashedCtx = makeContext(noReleaseDb(faultyDb(db, 'SELECT id, name FROM branches')))
    let crashed = false
    try { await runAdjustAction(crashedCtx, addBody('stockline_88888888-stale')) } catch { crashed = true }
    assert.equal(crashed, true, 'the first attempt died mid-kernel')
    assert.equal(receiptCount(db), 1, 'and its claim was stranded (release suppressed)')
    assert.equal(Number(receiptRow(db).written), 0, 'having written nothing')

    const tooSoon = await runAdjustAction(makeContext(db), addBody('stockline_88888888-stale'))
    assert.equal(tooSoon.status, 409, 'a FRESH claim is still protected from takeover')
    assert.equal((await jsonOf(tooSoon)).code, 'stock_request_in_flight', 'with the honest wait-and-retry code')
    assert.equal(branchStock(db), 0, 'and moves nothing')

    backdateClaim(db)
    const reclaimed = await runAdjustAction(makeContext(db), addBody('stockline_88888888-stale'))
    assert.equal(reclaimed.status, 200, 'THE FIX: a stale write-nothing claim is taken over')
    assert.equal(branchStock(db), 5, 'and the line finally applies -- exactly once')
    assert.equal(movementCount(db), 1, 'one movement, not two')
    assert.equal(receiptCount(db), 1, 'still one receipt, now completed')
    console.log('PASS a stale unwritten claim is re-claimed and runs once')
  }

  // CONTROL. A stale claim that DID write is never taken over -- that is the
  //    whole point of the written flag.
  {
    const db = freshDb()
    const c = makeContext(faultyDb(db, 'INSERT INTO inventory_movements'))
    try { await runAdjustAction(c, addBody('stockline_88888888-wrote')) } catch { /* expected */ }
    assert.equal(branchStock(db), 5, 'stock moved before the crash')
    // A crash so hard the completion never ran, then left to go stale.
    db.raw.exec('UPDATE stock_mutation_receipts SET completed_at=NULL, response_status=NULL, response_json=NULL')
    backdateClaim(db)
    const retry = await runAdjustAction(makeContext(db), addBody('stockline_88888888-wrote'))
    assert.equal(retry.status, 409, 'CONTROL: a stale claim that wrote is NOT re-claimed')
    assert.equal((await jsonOf(retry)).code, 'stock_request_partially_applied', 'it is reported as partially applied')
    assert.equal(branchStock(db), 5, 'CONTROL: stock unchanged')
    assert.equal(movementCount(db), 0, 'CONTROL: and no movement was ever written')
    console.log('PASS a stale claim that already wrote stock is never re-claimed (control)')
  }

  // E2 -- two calls racing on ONE id. Whatever the interleaving, the shelf
  //    moves once; the loser either replays the winner or is told to wait.
  {
    const db = freshDb()
    const c = makeContext(db)
    const [a, b] = await Promise.all([
      runAdjustAction(c, addBody('stockline_aaaa0000-race')),
      runAdjustAction(c, addBody('stockline_aaaa0000-race')),
    ])
    assert.equal(branchStock(db), 5, 'THE FIX: a concurrent double-submit moves stock once')
    assert.equal(movementCount(db), 1, 'and writes one movement')
    assert.equal(receiptCount(db), 1, 'under one receipt')
    const statuses = [a.status, b.status].sort()
    assert.equal(statuses[0], 200, 'one of the two wrote')
    assert.ok(statuses[1] === 200 || statuses[1] === 409, 'the other replayed or was told to wait')
    console.log('PASS two calls racing on one id still move stock once')
  }

  // E2 -- the losing racer whose winner has already vanished. The claim
  //    INSERT fails, the re-read finds nothing, and the honest answer is a
  //    409, never the 500 this branch used to throw.
  {
    const db = freshDb()
    const c = makeContext(faultyDb(db, 'INSERT INTO stock_mutation_receipts'))
    const answer = await runAdjustAction(c, addBody('stockline_bbbb0000-race'))
    assert.equal(answer.status, 409, 'THE FIX: a vanished race answers 409, not 500')
    assert.equal((await jsonOf(answer)).code, 'stock_request_in_flight', 'with a code the UI can translate')
    assert.equal(branchStock(db), 0, 'and moves no stock')
    console.log('PASS a lost claim race answers a clean 409')
  }

  console.log('\nAll stock mutation receipt assertions passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
