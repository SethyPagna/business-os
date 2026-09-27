// applyReturnBulkActionOutcome's `wrote` flag (R-telegram E1, 27 Sep 2026):
// the route announces a grouped Returns status change to Telegram only when
// `wrote` is true, so the flag must be true for exactly the call whose OWN
// batch committed -- never for a replay, and not lost when the commit landed
// but the batch call still threw.
//
// Actual kernel + the real D1 adapter over real SQLite transactions (all
// migrations), the same harness shape as test-returns-bulk-pure.cjs. Cases,
// each discriminating one plausible wrong implementation:
//   1. first write                      -> wrote: true
//   2. sequential retry, same id        -> wrote: false, same receipt (not "early replay = true")
//   3. forced overtake: a same-id retry commits inside the original's batch
//      window -> the retry wrote, the original did not (not "catch path = true")
//   4. the batch commits, then the call throws (a lost response) -> wrote: true,
//      because the stored receipt carries THIS call's operationId
//      (not "catch path = false")
//
// Run (from cloudflare/): node scripts/test-returns-bulk-wrote-flag-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const cache = new Map()
const actual = new Set(['saleStatusResolution', 'actorSnapshot', 'movementBranchName', 'db', 'permissions', 'saleRecords', 'saleRecordEvents',
  'moneyPrecision', 'saleMoneyPrecision', 'refundMoneyPrecision', 'promotionRules', 'saleItemPricing',
  'customerReturnEntitlement', 'returnBulkAction', 'returnCreateAction'])

function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const source = fs.readFileSync(path.join(root, 'src', rel), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = (name) => {
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {} }
    if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
    if (name.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts'
      if (actual.has(path.posix.basename(name))) return load(target)
      return {}
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}

const kernel = load('lib/returnBulkAction.ts')
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  let commits = 0
  let beforeBatch = null
  let throwAfterCommit = false
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        return {
          text, params,
          async first() { return sql.prepare(text).get(...params) || null },
          async all() { return { results: sql.prepare(text).all(...params) } },
          async run() { const result = sql.prepare(text).run(...params); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } } },
        }
      } }
    },
    async batch(statements) {
      if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; await hook() }
      const results = sql.transaction(() => statements.map((statement) => {
        const result = sql.prepare(statement.text).run(...statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
      commits += 1
      if (throwAfterCommit) { throwAfterCommit = false; throw new Error('network: the response was lost after the commit') }
      return results
    },
  } }
  sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO products(id,name,stock_quantity) VALUES(1,'Customer product',12);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,12);
    INSERT INTO returns(id,return_number,sale_id,return_scope,status,return_type,supplier_settlement,branch_id,updated_at)
      VALUES(1,'RET-1',NULL,'customer','completed','refund','none',1,'v1');
    INSERT INTO return_items(id,return_id,product_id,product_name,quantity,cost_price_usd,return_to_stock,stock_action,branch_id,batch_id)
      VALUES(1,1,1,'Customer product',1,4,0,'none',1,NULL);
  `)
  return { sql, env, commits: () => commits, beforeBatch: (hook) => { beforeBatch = hook }, throwAfterCommit: () => { throwAfterCommit = true } }
}

function request(f, key) {
  const row = f.sql.prepare(`SELECT id,COALESCE(status,'completed') expected_status,COALESCE(return_type,'restock') expected_method,
    updated_at expected_updated_at FROM returns WHERE id=1`).get()
  const target = row.expected_status === 'completed' ? 'cancelled' : 'completed'
  return { client_request_id: key, field: 'status', source: row.expected_status, target, items: [row] }
}
const statusOf = (f) => f.sql.prepare('SELECT status FROM returns WHERE id=1').get().status
const opsFor = (f, key) => f.sql.prepare('SELECT COUNT(1) AS n FROM return_bulk_operations WHERE request_id=?').get(key).n

async function run() {
  assert.equal(typeof kernel.applyReturnBulkActionOutcome, 'function', 'the kernel exports the outcome form')
  let checks = 0
  const f = fixture()

  // 1 + 2. first write, then a sequential retry of the same id.
  const req1 = request(f, 'wrote-first')
  const first = await kernel.applyReturnBulkActionOutcome(f.env, user, req1)
  assert.equal(first.wrote, true, 'the call that committed wrote')
  assert.deepEqual(first.receipt.changedIds, [1])
  assert.equal(statusOf(f), 'cancelled')
  const commitsAfterFirst = f.commits()
  const again = await kernel.applyReturnBulkActionOutcome(f.env, user, req1)
  assert.equal(again.wrote, false, 'a sequential retry is a replay')
  assert.equal(again.receipt.operationId, first.receipt.operationId, 'same stored receipt')
  assert.deepEqual(again.receipt.changedIds, [1], 'the receipt still names what changed -- which is why the flag, not changedIds, decides')
  assert.equal(f.commits(), commitsAfterFirst, 'the replay wrote nothing')
  assert.equal(typeof (await kernel.applyReturnBulkAction(f.env, user, req1)).operationId, 'string', 'applyReturnBulkAction keeps returning the bare receipt')
  checks += 2
  console.log('PASS first write -> wrote; sequential retry -> replay, not wrote, same receipt')

  // 3. forced overtake: the retry runs to completion INSIDE the original's
  // batch window (after the original's own replay read saw nothing), so the
  // original's batch loses and it takes the catch path.
  const req3 = request(f, 'wrote-overtake')
  let retry = null
  f.beforeBatch(async () => { retry = await kernel.applyReturnBulkActionOutcome(f.env, user, req3) })
  const original = await kernel.applyReturnBulkActionOutcome(f.env, user, req3)
  assert.ok(retry, 'the overtaking retry ran')
  assert.equal(retry.wrote, true, 'the retry committed first, so it wrote')
  assert.equal(original.wrote, false, 'the overtaken original must not claim the write (it would announce it a second time)')
  assert.equal(original.receipt.operationId, retry.receipt.operationId, 'both answer with the one stored receipt')
  assert.equal(opsFor(f, 'wrote-overtake'), 1, 'one write')
  assert.equal(statusOf(f), 'completed')
  checks += 1
  console.log('PASS forced overtake -> exactly one of the two calls wrote (the retry); the original replays')

  // 4. the batch commits and then the call throws: the write is this call's,
  // so it still counts as written (one announcement, not zero).
  const req4 = request(f, 'wrote-lost-response')
  f.throwAfterCommit()
  const lost = await kernel.applyReturnBulkActionOutcome(f.env, user, req4)
  assert.equal(lost.wrote, true, 'a commit whose response was lost is still this call\'s write')
  assert.equal(opsFor(f, 'wrote-lost-response'), 1)
  assert.equal(statusOf(f), 'cancelled')
  const lostRetry = await kernel.applyReturnBulkActionOutcome(f.env, user, req4)
  assert.equal(lostRetry.wrote, false, 'and its retry is a replay')
  assert.equal(lostRetry.receipt.operationId, lost.receipt.operationId)
  checks += 1
  console.log('PASS commit then throw -> still wrote (own operationId in the stored receipt); its retry replays')

  console.log(`test-returns-bulk-wrote-flag-pure: ${checks} checks ok`)
}

run().catch((error) => { console.error(error); process.exit(1) })
