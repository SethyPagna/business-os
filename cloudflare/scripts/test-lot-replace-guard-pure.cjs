// The Worker refuses any statement that would replace a product_batches row (lib/db.ts guardD1), at zero reads.
// Why: REPLACE's implicit delete fires no delete trigger and can orphan positive branch stock; migration 0320 drops the
// per-insert orphan scan of 0155 and this guard takes its place.
//
// Checks, and the wrong implementation each rejects:
//  1. The matcher: every spelling refused (case, spacing, newlines, tabs, schema prefix, quoted names, a CTE-led statement)
//     and no innocent statement refused (INSERT, OR IGNORE, upsert, replace() the function, other tables, product_batches_x,
//     text inside a string literal or comment). A guard matching only upper case, or only "REPLACE INTO", fails here.
//  2. Through the real D1Compat over a SQLite-backed D1 double: prepare().run/get/all, batch, batchOnce, staging: refused,
//     NOTHING written, the lot and its stock untouched; the replacing statement is never sent to the database.
//  3. The raw binding path (env.DB.prepare / batch / exec, withSession) is refused once the entry points wrap env.
//  4. Normal writers still work through the guard: INSERT, INSERT OR IGNORE on an existing lot, upsert, UPDATE, other tables'
//     INSERT OR REPLACE (settings, system_flags).
//  5. The entry points of src/index.ts wrap env (fetch, queue, scheduled).
// Mutation hooks: DB_SOURCE points the loader at another copy of db.ts; INDEX_SOURCE likewise for index.ts.
// Run: node scripts/test-lot-replace-guard-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const SRC = path.join(__dirname, '../src')
const dbFile = process.env.DB_SOURCE || path.join(SRC, 'lib/db.ts')
const mod = { exports: {} }
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(dbFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText)((name) => (name === './importMaintenanceFence' ? {} : require(name)), mod, mod.exports)
const { D1Compat, replacesProductBatchesRow, guardD1, guardEnvDatabases, ProductBatchesReplaceRefusedError } = mod.exports
assert.equal(typeof replacesProductBatchesRow, 'function', 'db.ts exports replacesProductBatchesRow')

let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`) }

// A D1 double over node:sqlite; it records every statement actually sent.
function d1Double() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE product_batches(id INTEGER PRIMARY KEY, variant_product_id INTEGER, batch_key TEXT, is_active INTEGER DEFAULT 1, UNIQUE(variant_product_id, batch_key));
    CREATE TABLE branch_batch_stock(id INTEGER PRIMARY KEY, batch_id INTEGER, branch_id INTEGER, quantity REAL);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(1,10,'a'),(2,10,'b');
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(1,1,5)`)
  const sent = []
  const stmt = (sql, values = []) => ({
    sql,
    bind: (...v) => stmt(sql, v),
    async all() { return { results: db.prepare(sql).all(...values), meta: {} } },
    async run() { const r = db.prepare(sql).run(...values); return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
    async first() { return db.prepare(sql).get(...values) ?? null },
  })
  const d1 = {
    prepare(sql) { sent.push(sql); return stmt(sql) },
    async exec(sql) { sent.push(sql); db.exec(sql); return { count: 1 } },
    async batch(statements) {
      db.exec('BEGIN')
      try { const out = []; for (const s of statements) out.push(await s.run()); db.exec('COMMIT'); return out } catch (e) { db.exec('ROLLBACK'); throw e }
    },
    withSession() { return { prepare: (sql) => { sent.push(sql); return stmt(sql) } } },
  }
  const lots = () => db.prepare('SELECT id,variant_product_id,batch_key FROM product_batches ORDER BY id').all().map((r) => ({ ...r }))
  return { db, d1, sent, lots, stockRows: () => db.prepare('SELECT batch_id,quantity FROM branch_batch_stock').all().map((r) => ({ ...r })) }
}
const REPLACING = [
  "REPLACE INTO product_batches(id,variant_product_id,batch_key) VALUES(3,10,'a')",
  "INSERT OR REPLACE INTO product_batches(id,variant_product_id,batch_key) VALUES(3,10,'a')",
  "replace into product_batches(id,variant_product_id,batch_key) values(3,10,'a')",
  "insert or replace into product_batches(id,variant_product_id,batch_key) values(3,10,'a')",
  "Insert  Or\tReplace\nInto\r\n  product_batches (id) VALUES(3)",
  'INSERT OR REPLACE INTO main.product_batches(id) VALUES(3)',
  'INSERT OR REPLACE INTO main . product_batches(id) VALUES(3)',
  'INSERT OR REPLACE INTO "product_batches"(id) VALUES(3)',
  'INSERT OR REPLACE INTO `product_batches`(id) VALUES(3)',
  'INSERT OR REPLACE INTO [product_batches](id) VALUES(3)',
  'INSERT OR REPLACE INTO "main"."product_batches"(id) VALUES(3)',
  'REPLACE INTO PRODUCT_BATCHES(id) VALUES(3)',
  '-- note\nINSERT OR REPLACE INTO product_batches(id) VALUES(3)',
  'WITH s AS (SELECT 3 AS id) INSERT OR REPLACE INTO product_batches(id) SELECT id FROM s',
  'INSERT OR REPLACE INTO product_batches SELECT * FROM product_batches',
  "UPDATE OR REPLACE product_batches SET batch_key='a' WHERE id=2",
]
const INNOCENT = [
  "INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(3,10,'c')",
  "INSERT OR IGNORE INTO product_batches(variant_product_id,batch_key) VALUES(10,'a')",
  "INSERT INTO product_batches(variant_product_id,batch_key) VALUES(10,'a') ON CONFLICT(variant_product_id,batch_key) DO UPDATE SET is_active=1",
  'UPDATE product_batches SET is_active=0 WHERE id=2',
  'DELETE FROM product_batches WHERE id=2',
  "INSERT OR REPLACE INTO settings(key,value) VALUES('a','b')",
  "INSERT OR REPLACE INTO system_flags(key,value) VALUES('a','b')",
  'REPLACE INTO product_batches_archive(id) VALUES(3)',
  'INSERT OR REPLACE INTO my_product_batches(id) VALUES(3)',
  "SELECT replace(batch_key, 'a', 'b') FROM product_batches",
  "UPDATE product_batches SET batch_key=replace(batch_key,'a','b') WHERE id=1",
  "INSERT INTO audit_logs(note) VALUES('REPLACE INTO product_batches was refused')",
  "INSERT INTO audit_logs(note) VALUES('it''s INSERT OR REPLACE INTO product_batches')",
  '-- REPLACE INTO product_batches\nSELECT 1',
  '/* INSERT OR REPLACE INTO product_batches */ SELECT 1',
  'INSERT INTO notes(text) VALUES("REPLACE INTO product_batches")',
  'SELECT * FROM product_batches WHERE batch_key = ?1',
]

;(async () => {
  await check('every spelling of a replacing write to product_batches is recognised', () => {
    for (const sql of REPLACING) assert.equal(replacesProductBatchesRow(sql), true, sql)
  })
  await check('no innocent statement is refused (INSERT, OR IGNORE, upsert, replace() function, other tables, strings, comments)', () => {
    for (const sql of INNOCENT) assert.equal(replacesProductBatchesRow(sql), false, sql)
  })
  await check('D1Compat refuses a replace through prepare, batch, batchOnce and staging, writes nothing and sends nothing', async () => {
    for (const sql of REPLACING) {
      const w = d1Double()
      const db = new D1Compat(w.d1)
      const beforeLots = w.lots(), beforeStock = w.stockRows()
      await assert.rejects(() => db.prepare(sql).run(), ProductBatchesReplaceRefusedError, sql)
      await assert.rejects(() => db.prepare(sql).all(), ProductBatchesReplaceRefusedError)
      await assert.rejects(() => db.prepare(sql).get(), ProductBatchesReplaceRefusedError)
      await assert.rejects(() => db.batch([{ sql: 'UPDATE settings SET value=1' }, { sql }]), ProductBatchesReplaceRefusedError)
      await assert.rejects(() => db.batchOnce([{ sql }]), ProductBatchesReplaceRefusedError)
      await assert.rejects(() => db.staging.prepare(sql).run(), ProductBatchesReplaceRefusedError)
      assert.deepEqual(w.lots(), beforeLots, 'lots untouched')
      assert.deepEqual(w.stockRows(), beforeStock, 'stock untouched')
      assert.deepEqual(w.sent.filter((q) => replacesProductBatchesRow(q)), [], 'the replacing statement was never sent to the database')
    }
  })
  await check('the error is a plain refusal: named, readable, and never classed as a retryable database fault', () => {
    const e = new ProductBatchesReplaceRefusedError()
    assert.equal(e.name, 'ProductBatchesReplaceRefusedError')
    assert.match(e.message, /Nothing was written/)
    assert.doesNotMatch(e.message, /network|timeout|timed out|internal error|too many requests|busy|reset|D1_ERROR/i)
  })
  await check('the raw binding (prepare, exec, withSession) is refused once env is wrapped', async () => {
    for (const sql of REPLACING) {
      const w = d1Double()
      const env = guardEnvDatabases({ DB: w.d1, IMPORT_DB: d1Double().d1, OTHER: 'x' })
      assert.throws(() => env.DB.prepare(sql), ProductBatchesReplaceRefusedError, sql)
      assert.throws(() => env.IMPORT_DB.prepare(sql), ProductBatchesReplaceRefusedError)
      assert.throws(() => env.DB.exec(sql), ProductBatchesReplaceRefusedError)
      assert.throws(() => env.DB.withSession().prepare(sql), ProductBatchesReplaceRefusedError)
      assert.equal(w.sent.length, 0)
      assert.equal(env.OTHER, 'x')
    }
  })
  await check('a raw batch built from the guarded binding cannot carry a replace in', () => {
    const w = d1Double(), env = guardEnvDatabases({ DB: w.d1 })
    assert.throws(() => env.DB.batch([env.DB.prepare('UPDATE settings SET value=1'), env.DB.prepare('REPLACE INTO product_batches(id) VALUES(1)')]), ProductBatchesReplaceRefusedError)
    assert.deepEqual(w.lots().map((l) => l.id), [1, 2])
  })
  await check('wrapping is idempotent and a missing database passes through', () => {
    const w = d1Double(), once = guardD1(w.d1)
    assert.equal(guardD1(once), once)
    assert.equal(guardD1(undefined), undefined)
    const env = { DB: w.d1 }
    assert.equal(guardEnvDatabases(env), guardEnvDatabases(env))
    assert.deepEqual(Object.keys(guardEnvDatabases({ DB: w.d1, X: 1 })).sort(), ['DB', 'X'])
    assert.equal(guardEnvDatabases({ X: 1 }).DB, undefined)
  })
  await check('ordinary lot writers still work: INSERT, INSERT OR IGNORE on an existing lot, upsert, UPDATE, other tables REPLACE', async () => {
    const w = d1Double(), db = new D1Compat(w.d1)
    await db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key) VALUES(3,10,'c')").run()
    const ignored = await db.prepare("INSERT OR IGNORE INTO product_batches(variant_product_id,batch_key) VALUES(10,'a')").run()
    assert.equal(ignored.changes, 0)
    await db.prepare("INSERT INTO product_batches(variant_product_id,batch_key,is_active) VALUES(10,'a',0) ON CONFLICT(variant_product_id,batch_key) DO UPDATE SET is_active=excluded.is_active").run()
    await db.prepare('UPDATE product_batches SET batch_key=@k WHERE id=2').run({ k: 'b2' })
    await db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('a','b')").run()
    await db.batch([{ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES(@k,@v)', params: { k: 'c', v: 'd' } }, { sql: 'DELETE FROM product_batches WHERE id=3' }])
    assert.deepEqual(w.lots(), [{ id: 1, variant_product_id: 10, batch_key: 'a' }, { id: 2, variant_product_id: 10, batch_key: 'b2' }])
    assert.equal(w.db.prepare('SELECT is_active FROM product_batches WHERE id=1').get().is_active, 0)
    const env = guardEnvDatabases({ DB: w.d1 })
    await env.DB.prepare("INSERT OR IGNORE INTO product_batches(variant_product_id,batch_key) VALUES(10,'a')").run()
  })
  await check('the Worker entry points wrap env before any route or job sees it', () => {
    const file = process.env.INDEX_SOURCE || path.join(SRC, 'index.ts')
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const body = text.slice(text.indexOf('export default {'))
    assert.match(body, /fetch: \([^)]*\) => app\.fetch\(request, guardEnvDatabases\(env\), ctx\)/, 'fetch wraps env')
    assert.match(body, /async queue\(batch: MessageBatch<unknown>, rawEnv: Env\)[^\n]*\n\s*const env = guardEnvDatabases\(rawEnv\)/, 'queue wraps env')
    assert.match(body, /async scheduled\(controller: ScheduledController, rawEnv: Env, ctx: ExecutionContext\)[^\n]*\n\s*const env = guardEnvDatabases\(rawEnv\)/, 'scheduled wraps env')
    assert.match(text, /import \{ guardEnvDatabases \} from '\.\/lib\/db'/)
  })
  console.log(`${passed} lot replace guard checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
