'use strict'

// Native SQLite decisions, acknowledgement loss, ownership and maintenance.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { createRequire } = require('node:module')
const { createHash, webcrypto } = require('node:crypto')

const root = path.resolve(__dirname,'../..')
const localRequire = createRequire(path.join(root, 'cloudflare/package.json'))
const Database = localRequire('better-sqlite3')
const esbuild = localRequire('esbuild')
const sourcePath = path.join(root, 'cloudflare/src/lib/saleCreateRefusal.ts')
const migrationPath = path.join(root, 'cloudflare/migrations/0276_sale_create_refusals.sql')
const migration = fs.readFileSync(migrationPath, 'utf8')
const source = fs.readFileSync(sourcePath, 'utf8')
const readGuardMutant = process.argv.includes('--mutant=read-without-maintenance')
let effectiveSource = source
if (readGuardMutant) {
  const start = source.indexOf('export async function readSaleCreateRefusal(')
  const end = source.indexOf('export async function certifySaleCreateRefusal(', start)
  assert.ok(start >= 0 && end > start, 'mutation must find only the read helper')
  const section = source.slice(start, end)
  const guard = /,\s*ordinaryBusinessMaintenanceGuard(?=\s*\])/g
  assert.equal([...section.matchAll(guard)].length, 1, 'mutation must remove exactly one read guard')
  effectiveSource = source.slice(0, start) + section.replace(guard, '') + source.slice(end)
}
globalThis.crypto ||= webcrypto
const compiled = esbuild.buildSync({ stdin: { contents: effectiveSource, sourcefile: sourcePath, resolveDir: path.dirname(sourcePath), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
const loaded = new Module(sourcePath, module)
loaded.filename = sourcePath
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath))
loaded._compile(compiled.outputFiles[0].text, sourcePath)
const { readSaleCreateRefusal: read, certifySaleCreateRefusal: certify } = loaded.exports
assert.equal(typeof read, 'function')
assert.equal(typeof certify, 'function')

const owner = (patch = {}) => ({ version: 1, actor_id: 7, organization_id: 3,
  authority: 'https://fixture.invalid', runtime: 'cloudflare-workers', ...patch })
const unavailable = error => error?.code === 'sale_create_refusal_schema_not_ready'
const handles = []
let passed = 0

function fixture() {
  const raw = new Database(':memory:')
  handles.push(raw)
  raw.pragma('foreign_keys = ON')
  raw.exec(`CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT);
    CREATE TABLE sales(id INTEGER PRIMARY KEY,client_request_id TEXT,cashier_id INTEGER,receipt_number TEXT,total_usd REAL DEFAULT 0);
    CREATE UNIQUE INDEX sales_fixture_key ON sales(client_request_id) WHERE client_request_id IS NOT NULL AND client_request_id<>'';
    CREATE TABLE sale_items(id INTEGER PRIMARY KEY,sale_id INTEGER NOT NULL,product_id INTEGER,quantity REAL);
    CREATE TABLE branch_stock(product_id INTEGER PRIMARY KEY,quantity REAL NOT NULL);
    CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,product_id INTEGER,quantity REAL);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,details TEXT);
    INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch','legacy-separate-pool-v1');
    INSERT INTO sales VALUES(900,'unrelated-sale',8,'20261029-010000',25);
    INSERT INTO sale_items VALUES(900,900,1,2);
    INSERT INTO branch_stock VALUES(1,100);
    INSERT INTO inventory_movements VALUES(1,1,2);
    INSERT INTO audit_logs VALUES(1,'existing unrelated audit');`)
  raw.exec(migration)
  const db = {
    calls: 0,
    loseAfterCommit: 0,
    async batch(statements) {
      this.calls++
      const results = raw.transaction(() => statements.map(statement => {
        const prepared = raw.prepare(statement.sql)
        const values = statement.params
        const args = Array.isArray(values) ? values : values && Object.keys(values).length ? [values] : []
        if (prepared.reader) return { success: true, results: prepared.all(...args), meta: { changes: 0 } }
        const result = prepared.run(...args)
        return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
      if (this.loseAfterCommit > 0) {
        this.loseAfterCommit--
        throw new Error('fixture: acknowledgement lost after real SQLite commit')
      }
      return results
    },
  }
  return { raw, db }
}

function business(raw) {
  return Object.fromEntries(['sales', 'sale_items', 'branch_stock', 'inventory_movements', 'audit_logs']
    .map(table => [table, raw.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]))
}

const fences = raw => raw.prepare('SELECT rowid,* FROM sale_create_refusals ORDER BY rowid').all()

function committed(raw, key, actor = 7, count = 2) {
  const id = Number(raw.prepare('INSERT INTO sales(client_request_id,cashier_id,receipt_number,total_usd) VALUES(?,?,?,?)')
    .run(key, actor, '20261029-020000', 10 * count).lastInsertRowid)
  for (let index = 0; index < count; index++) raw.prepare('INSERT INTO sale_items(sale_id,product_id,quantity) VALUES(?,?,1)').run(id, index + 1)
  return id
}

async function check(name, run) {
  await run()
  passed++
  console.log('PASS ' + name)
}

async function main() {
  await check('missing is read-only, and certification/read retry permanently retire the same key', async () => {
    const { raw, db } = fixture()
    const before = business(raw)
    assert.deepEqual(await read(db, 'K', owner()), { kind: 'missing' })
    assert.deepEqual(fences(raw), [])
    assert.deepEqual(await certify(db, 'K', owner()), { kind: 'refused' })
    const captured = fences(raw)
    assert.equal(captured.length, 1)
    assert.deepEqual(JSON.parse(captured[0].owner_json), owner())
    for (const request of [{ key: 'K', items: [1, 2, 3] }, { key: 'K', items: [1] }]) {
      // The module takes key/owner only; body parity belongs to the parent route test.
      assert.deepEqual(await certify(db, request.key, owner()), { kind: 'refused' })
      assert.deepEqual(await read(db, request.key, owner()), { kind: 'refused' })
      assert.deepEqual(fences(raw), captured)
      assert.throws(() => committed(raw, request.key), /sale_create_terminal_refusal/)
    }
    assert.deepEqual(business(raw), before)
    assert.deepEqual(await read(db, 'K2', owner()), { kind: 'missing' })
  })

  await check('existing fence actor, organization and authority mismatches never alter or claim the key', async () => {
    const { raw, db } = fixture()
    await certify(db, 'owned-K', owner())
    const captured = fences(raw), before = business(raw)
    for (const patch of [{ actor_id: 8 }, { organization_id: 4 }, { organization_id: null }, { authority: 'https://other.invalid' }]) {
      const mismatch = owner(patch)
      assert.deepEqual(await read(db, 'owned-K', mismatch), { kind: 'owner_mismatch' })
      assert.deepEqual(await certify(db, 'owned-K', mismatch), { kind: 'owner_mismatch' })
      assert.deepEqual(fences(raw), captured)
      assert.deepEqual(business(raw), before)
    }
  })

  await check('invalid recorded owner structure or actor/JSON disagreement gives no terminal proof', async () => {
    for (const corrupt of ['{}', 'null', '[]', JSON.stringify(owner({ version: 2 })), JSON.stringify(owner({ actor_id: 8 }))]) {
      const { raw, db } = fixture()
      await certify(db, 'corrupt-K', owner())
      raw.prepare('UPDATE sale_create_refusals SET owner_json=? WHERE client_request_id=?').run(corrupt, 'corrupt-K')
      const captured = fences(raw), before = business(raw)
      assert.deepEqual(await read(db, 'corrupt-K', owner()), { kind: 'owner_mismatch' })
      assert.deepEqual(await certify(db, 'corrupt-K', owner()), { kind: 'owner_mismatch' })
      assert.deepEqual(fences(raw), captured)
      assert.deepEqual(business(raw), before)
    }
  })

  await check('committed same-cashier sale wins, exact line count survives, and no refusal is inserted', async () => {
    for (const count of [0, 3]) {
      const { raw, db } = fixture()
      const id = committed(raw, 'committed-K', 7, count)
      const before = business(raw)
      for (const decide of [read, certify]) {
        const result = await decide(db, 'committed-K', owner())
        assert.equal(result.kind, 'committed')
        assert.deepEqual(result.sale, { id, receipt_number: '20261029-020000', cashier_id: 7, item_count: count })
        assert.deepEqual(fences(raw), [])
        assert.deepEqual(business(raw), before)
      }
      // A header-only result stays committed-kind/count0 here; the route must preserve sale_incomplete.
    }
  })

  await check('foreign-cashier committed sale is not disclosed or replaced with a refusal', async () => {
    const { raw, db } = fixture()
    committed(raw, 'foreign-K', 8)
    const before = business(raw)
    assert.deepEqual(await read(db, 'foreign-K', owner()), { kind: 'owner_mismatch' })
    assert.deepEqual(await certify(db, 'foreign-K', owner()), { kind: 'owner_mismatch' })
    assert.deepEqual(fences(raw), [])
    assert.deepEqual(business(raw), before)
  })

  await check('missing table and same-named no-op trigger yield unavailable and no business changes/proof', async () => {
    for (const mutate of [
      raw => raw.exec('DROP TABLE sale_create_refusals'),
      raw => raw.exec('DROP TRIGGER sales_create_refusal_insert_0276; CREATE TRIGGER sales_create_refusal_insert_0276 BEFORE INSERT ON sales BEGIN SELECT 1; END;'),
      raw => raw.exec('DROP TRIGGER sales_create_refusal_update_0276; CREATE TRIGGER sales_create_refusal_update_0276 BEFORE UPDATE OF client_request_id ON sales BEGIN SELECT 1; END;'),
    ]) {
      const { raw, db } = fixture()
      mutate(raw)
      const before = business(raw)
      await assert.rejects(read(db, 'schema-K', owner()), unavailable)
      await assert.rejects(certify(db, 'schema-K', owner()), unavailable)
      assert.deepEqual(business(raw), before)
      // Certification may have inserted only a control row before its post-batch hash check.
    }
  })

  await check('malformed same-named table definition is not accepted as ready', async () => {
    const { raw, db } = fixture()
    raw.exec('DROP TRIGGER sales_create_refusal_insert_0276; DROP TRIGGER sales_create_refusal_update_0276; DROP TABLE sale_create_refusals;')
    const weak = migration.replace('CHECK(actor_id > 0)', 'CHECK(actor_id >= 0)')
    assert.notEqual(weak, migration)
    raw.exec(weak)
    const before = business(raw)
    await assert.rejects(read(db, 'weak-schema-K', owner()), unavailable)
    await assert.rejects(certify(db, 'weak-schema-K', owner()), unavailable)
    assert.deepEqual(business(raw), before)
  })

  await check('any maintenance row rolls back the whole refusal batch, even if mode is malformed', async () => {
    for (const value of ['{"mode":"restore"}', '{"mode":"branch-cutover"}', 'not-json']) {
      const { raw, db } = fixture()
      raw.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(value)
      const before = business(raw), captured = fences(raw)
      await assert.rejects(certify(db, 'maintenance-K', owner()), unavailable)
      assert.deepEqual(fences(raw), captured)
      assert.deepEqual(business(raw), before)
      assert.equal(raw.prepare("SELECT value FROM system_flags WHERE key='maintenance'").get().value, value)
      raw.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
      assert.deepEqual(await read(db, 'maintenance-K', owner()), { kind: 'missing' })
    }
  })

  await check('terminal read proof is unavailable during active maintenance; real restore carveout can materialize that key', async () => {
    for (const value of ['{"mode":"restore"}', '{"mode":"branch-cutover"}', 'not-json']) {
      const { raw, db } = fixture()
      await certify(db, 'read-maintenance-K', owner())
      const captured = fences(raw), before = business(raw)
      raw.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)").run(value)
      await assert.rejects(read(db, 'read-maintenance-K', owner()), unavailable)
      await assert.rejects(read(db, 'no-refusal-K', owner()), unavailable)
      assert.deepEqual(fences(raw), captured)
      assert.deepEqual(business(raw), before)
      if (value === '{"mode":"restore"}') {
        raw.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'").run()
        const restoredId = committed(raw, 'read-maintenance-K')
        assert.ok(restoredId > 0, 'the actual0276 restore carveout is the competing writer witness')
        raw.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
        assert.deepEqual(fences(raw), captured)
        await assert.rejects(read(db, 'read-maintenance-K', owner()), unavailable)
        raw.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
        const result = await read(db, 'read-maintenance-K', owner())
        assert.equal(result.kind, 'committed')
        assert.equal(result.sale.id, restoredId)
      } else {
        raw.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
        assert.deepEqual(await read(db, 'read-maintenance-K', owner()), { kind: 'refused' })
      }
      assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    }
  })

  await check('lost acknowledgement after real fence commit remains unknown until later read converges terminally', async () => {
    const { raw, db } = fixture()
    const before = business(raw)
    db.loseAfterCommit = 1
    await assert.rejects(certify(db, 'lost-ack-K', owner()), error => unavailable(error) && /acknowledgement lost/.test(String(error.cause)))
    const captured = fences(raw)
    assert.equal(captured.length, 1, 'fixture must lose acknowledgement after actual commit')
    assert.deepEqual(business(raw), before)
    assert.throws(() => committed(raw, 'lost-ack-K'), /sale_create_terminal_refusal/)
    assert.deepEqual(await read(db, 'lost-ack-K', owner()), { kind: 'refused' })
    assert.deepEqual(await certify(db, 'lost-ack-K', owner()), { kind: 'refused' })
    assert.deepEqual(fences(raw), captured)
    assert.deepEqual(business(raw), before)
  })

  await check('invalid identity fails before dispatch and never inserts a fence', async () => {
    for (const key of ['', ' K ', 'K'.repeat(121)]) {
      const { raw, db } = fixture()
      const before = business(raw)
      await assert.rejects(certify(db, key, owner()), unavailable)
      assert.equal(db.calls, 0)
      assert.deepEqual(fences(raw), [])
      assert.deepEqual(business(raw), before)
    }
  })

  console.log(JSON.stringify({ status: 'PASS', checks: passed, readGuardMutant,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    migrationSha256: createHash('sha256').update(migration).digest('hex') }))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  for (const raw of handles.reverse()) if (raw.open) raw.close()
})
