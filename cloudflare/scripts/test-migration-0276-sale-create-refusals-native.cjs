'use strict'

// Native SQLite coverage for the durable sale-create refusal barrier.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const Module = require('node:module')
const { createHash, webcrypto } = require('node:crypto')

const root = path.resolve(__dirname,'../..')
const localRequire = createRequire(path.join(root, 'cloudflare/package.json'))
const Database = localRequire('better-sqlite3')
const esbuild = localRequire('esbuild')
const migration = '0276_sale_create_refusals.sql'
const directory = path.join(root, 'cloudflare/migrations')
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const hash = text => createHash('sha256').update(text).digest('hex')
const TABLE = 'sale_create_refusals'
const INSERT = 'sales_create_refusal_insert_0276'
const UPDATE = 'sales_create_refusal_update_0276'
const objects = [TABLE, INSERT, UPDATE]
const epoch = 'legacy-separate-pool-v1'
const refused = /sale_create_terminal_refusal/
const owner = actorId => JSON.stringify({version:1,actor_id:actorId,organization_id:null,authority:'https://fixture.invalid',runtime:'cloudflare-workers'})
const handles = []
let passed = 0

function open(foreignKeys = true) {
  const db = new Database(':memory:')
  handles.push(db)
  db.pragma('foreign_keys = ' + (foreignKeys ? 'ON' : 'OFF'))
  return db
}

function fixture() {
  const db = open()
  db.exec(`CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE sales(id INTEGER PRIMARY KEY,client_request_id TEXT,cashier_id INTEGER,receipt_number TEXT);
    CREATE UNIQUE INDEX sales_fixture_key ON sales(client_request_id) WHERE client_request_id IS NOT NULL AND client_request_id<>'';
    INSERT INTO users VALUES(7,'First actor'),(8,'Second actor');
    INSERT INTO system_flags(key,value) VALUES('stock_schema_epoch','${epoch}');`)
  db.exec(sql)
  return db
}

function fence(db, key = 'retired-key', actor = 7) {
  db.prepare(`INSERT INTO ${TABLE}(client_request_id,actor_id,owner_json,reason) VALUES(?,?,?,'sale_snapshot_too_large')`)
    .run(key, actor, owner(actor))
}

function sale(db, key, actor = 7) {
  return db.prepare('INSERT INTO sales(client_request_id,cashier_id,receipt_number) VALUES(?,?,?)')
    .run(key, actor, '20261029-120000')
}

function control(db, mode, permit, storedEpoch = epoch) {
  db.prepare("UPDATE system_flags SET value=? WHERE key='stock_schema_epoch'").run(storedEpoch)
  db.prepare("DELETE FROM system_flags WHERE key IN('maintenance','stock_transaction_permit')").run()
  if (mode !== null) db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance',?)")
    .run(typeof mode === 'string' ? mode : JSON.stringify(mode))
  if (permit !== null) db.prepare("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit',?)").run(permit)
}

const state = db => ({
  sales: db.prepare('SELECT * FROM sales ORDER BY id').all(),
  fences: db.prepare(`SELECT rowid,* FROM ${TABLE} ORDER BY rowid`).all(),
})

function schemaRows(db) {
  return db.prepare(`SELECT name,sql FROM sqlite_master WHERE name IN(${objects.map(() => '?').join(',')}) ORDER BY name`).all(...objects)
}

async function check(name, run) {
  await run()
  passed++
  console.log('PASS ' + name)
}

function loadSourceModule(relative) {
  globalThis.crypto ||= webcrypto
  const entry = path.join(root, relative)
  const result = esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const mod = new Module(entry, module)
  mod.filename = entry
  mod.paths = Module._nodeModulePaths(path.dirname(entry))
  mod._compile(result.outputFiles[0].text, entry)
  return mod.exports
}

function d1Adapter(raw) {
  return {
    calls: 0,
    prepare(sql) { return { sql, values: [], bind(...values) { return { sql, values } } } },
    async batch(statements) {
      this.calls++
      return raw.transaction(() => statements.map(statement => {
        const result = raw.prepare(statement.sql).run(...statement.values)
        return { success: true, results: [], meta: { changes: result.changes } }
      }))()
    },
  }
}

async function main() {
  const verify = loadSourceModule('cloudflare/src/lib/saleCreateRefusal.ts').assertSaleCreateRefusalSchema
  const stock = loadSourceModule('cloudflare/src/lib/stockTransaction.ts')
  assert.equal(typeof verify, 'function')
  assert.equal(stock.STOCK_SCHEMA_EPOCH, epoch)

  await check('actual migration is LF-only and includes deployment/recovery and PRE/POST notes', () => {
    assert.equal(sql.includes('\r'), false)
    for (const word of ['PRE:', 'POST:', 'RECOVERY:']) assert.ok(sql.includes(word), word)
    assert.ok(!/CREATE\s+(?:TEMP|TEMPORARY)\s+TRIGGER/i.test(sql))
  })

  await check('real prior migration chain accepts0276 without changing existing table data or definitions', async () => {
    const db = open(false)
    for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort())
      db.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
    db.pragma('foreign_keys = ON')
    db.prepare("INSERT INTO users(id,username,name,password) VALUES(900001,'refusal_0276_owner','Fixture','fixture')").run()
    db.prepare("INSERT INTO sales(client_request_id,cashier_id,receipt_number) VALUES('existing-before0276',900001,'20261029-000001')").run()
    const priorSchema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()
    const tables = priorSchema.filter(row => row.type === 'table').map(row => row.name)
    const beforeRows = tables.map(table => [table, db.prepare('SELECT * FROM "' + table.replaceAll('"', '""') + '"').all()])
    db.transaction(() => db.exec(sql))()
    const afterSchema = db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN(${objects.map(() => '?').join(',')}) ORDER BY type,name`).all(...objects)
    assert.deepEqual(afterSchema, priorSchema)
    assert.deepEqual(tables.map(table => [table, db.prepare('SELECT * FROM "' + table.replaceAll('"', '""') + '"').all()]), beforeRows)
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${TABLE}`).get().n, 0)
    await verify(schemaRows(db))
    assert.throws(() => db.transaction(() => db.exec(sql))(), /already exists|0276.*pre|pre.*0276/)
  })

  await check('fresh stored DDL matches application schema hashes; missing definitions fail closed', async () => {
    const db = fixture()
    const rows = schemaRows(db)
    assert.deepEqual(rows.map(row => row.name).sort(), [...objects].sort())
    await verify(rows)
    for (const name of objects) await assert.rejects(verify(rows.filter(row => row.name !== name)), error => error.code === 'sale_create_refusal_schema_not_ready')
  })

  await check('same-named no-op INSERT or UPDATE trigger is rejected after an earlier valid check', async () => {
    for (const [name, operation] of [[INSERT, 'INSERT'], [UPDATE, 'UPDATE OF client_request_id']]) {
      const db = fixture()
      await verify(schemaRows(db))
      db.exec(`DROP TRIGGER ${name}; CREATE TRIGGER ${name} BEFORE ${operation} ON sales BEGIN SELECT 1; END;`)
      assert.equal(schemaRows(db).length, 3)
      await assert.rejects(verify(schemaRows(db)), error => error.code === 'sale_create_refusal_schema_not_ready')
    }
  })

  await check('same-named weakened table DDL fails schema authentication', async () => {
    const db = open()
    db.exec(`CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE sales(id INTEGER PRIMARY KEY,client_request_id TEXT,cashier_id INTEGER,receipt_number TEXT);`)
    const weak = sql.replace('CHECK(actor_id > 0)', 'CHECK(actor_id >= 0)')
    assert.notEqual(weak, sql, 'mutation must alter the actual table check')
    db.exec(weak)
    await assert.rejects(verify(schemaRows(db)), error => error.code === 'sale_create_refusal_schema_not_ready')
  })

  await check('fence is globally keyed, has no owner FK/cascade, and survives physical actor deletion', () => {
    const db = fixture()
    fence(db)
    const before = state(db)
    assert.throws(() => fence(db, 'retired-key', 8), /UNIQUE|PRIMARY/)
    for (const actor of [7, 8]) assert.throws(() => sale(db, 'retired-key', actor), refused)
    assert.deepEqual(state(db), before)
    assert.deepEqual(db.pragma('foreign_key_list(' + TABLE + ')'), [])
    db.prepare('DELETE FROM users WHERE id=7').run()
    assert.deepEqual(state(db), before)
    sale(db, 'new-key', 8)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sales').get().n, 1)
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${TABLE}`).get().n, 1)
  })

  await check('both actual0276 trigger predicates refuse without exact restore mode plus epoch permit', () => {
    const controls = [
      [null, null, epoch], [null, epoch, epoch], [{ mode: 'restore' }, null, epoch],
      [{ mode: 'restore' }, 'wrong-epoch', epoch], [{ mode: 'restore' }, epoch, 'wrong-epoch'],
      [{ mode: 'branch-cutover' }, epoch, epoch], [{ mode: 'reset' }, epoch, epoch],
      [{ mode: 'RESTORE' }, epoch, epoch], [{ mode: null }, epoch, epoch],
      ['not-json', epoch, epoch], ['[]', epoch, epoch], ['null', epoch, epoch],
    ]
    for (const args of controls) {
      const db = fixture()
      fence(db)
      const id = Number(sale(db, 'mutable-key').lastInsertRowid)
      control(db, ...args)
      const before = state(db)
      assert.throws(() => sale(db, 'retired-key', 8), refused, JSON.stringify(args))
      assert.throws(() => db.prepare('UPDATE sales SET client_request_id=? WHERE id=?').run('retired-key', id), refused, JSON.stringify(args))
      assert.deepEqual(state(db), before)
      db.prepare('UPDATE sales SET client_request_id=client_request_id WHERE id=?').run(id)
    }
  })

  await check('exact SQL restore/permit conjunction permits restore insertion and re-enforces after release', () => {
    const db = fixture()
    fence(db)
    const beforeFence = state(db).fences
    control(db, { mode: 'restore', token: 'current-token', backupKey: 'fixture-backup', phase: 'inserting' }, epoch)
    const id = Number(sale(db, 'retired-key', 8).lastInsertRowid)
    assert.deepEqual(state(db).fences, beforeFence)
    db.prepare('DELETE FROM sales WHERE id=?').run(id)
    db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'").run()
    assert.throws(() => sale(db, 'retired-key', 8), refused)
    db.prepare("DELETE FROM system_flags WHERE key='maintenance'").run()
    assert.throws(() => sale(db, 'retired-key', 8), refused)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    assert.deepEqual(state(db).fences, beforeFence)
  })

  await check('actual restore executor refuses invalid/stale authority and accepts only the exact current snapshot', async () => {
    const current = { mode: 'restore', token: 'token-current', backupKey: 'fixture-backup', phase: 'inserting',
      startedAt: '2026-10-29T00:00:00Z', startedBy: '7', updatedAt: '2026-10-29T00:00:01Z', rowsDone: 0 }
    const good = { token: current.token, backupKey: current.backupKey, snapshot: JSON.stringify(current) }
    const invalid = [
      { token: current.token, backupKey: current.backupKey, snapshot: JSON.stringify({ mode: 'restore' }) },
      { ...good, token: 'wrong-token' }, { ...good, backupKey: 'wrong-backup' },
      { ...good, snapshot: JSON.stringify({ ...current, phase: 'unknown' }) },
    ]
    const stale = [
      { ...good, snapshot: JSON.stringify({ ...current, rowsDone: 1 }) },
      { token: 'old-token', backupKey: current.backupKey, snapshot: JSON.stringify({ ...current, token: 'old-token' }) },
    ]
    for (const authority of [...invalid, ...stale]) {
      const raw = fixture(), d1 = d1Adapter(raw)
      fence(raw)
      control(raw, current, null)
      const before = state(raw)
      const statement = d1.prepare("INSERT INTO sales(client_request_id,cashier_id) VALUES('retired-key',8)")
      await assert.rejects(async () => stock.executeRawRestoreStockTransaction(d1, [statement], authority), error => error.code === 'stock_schema_unavailable')
      assert.deepEqual(state(raw), before)
      assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
      assert.equal(d1.calls, invalid.includes(authority) ? 0 : 1, 'invalid authority must stop before dispatch; stale snapshot aborts the transaction')
    }
    const raw = fixture(), d1 = d1Adapter(raw)
    fence(raw)
    control(raw, current, null)
    const beforeFence = state(raw).fences
    await stock.executeRawRestoreStockTransaction(d1, [d1.prepare("INSERT INTO sales(client_request_id,cashier_id) VALUES('retired-key',8)")], good)
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM sales WHERE client_request_id='retired-key'").get().n, 1)
    assert.deepEqual(state(raw).fences, beforeFence)
    assert.equal(raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  })

  await check('bounded table checks reject empty/space/long keys, invalid owner JSON, actor and reason', () => {
    const db = fixture()
    const put = row => db.prepare(`INSERT INTO ${TABLE}(client_request_id,actor_id,owner_json,reason) VALUES(?,?,?,?)`).run(...row)
    for (const row of [
      ['', 7, owner(7), 'sale_snapshot_too_large'], [' key ', 7, owner(7), 'sale_snapshot_too_large'],
      ['k'.repeat(121), 7, owner(7), 'sale_snapshot_too_large'], ['bad-actor', 0, owner(7), 'sale_snapshot_too_large'],
      ['bad-owner', 7, 'not-json', 'sale_snapshot_too_large'], ['large-owner', 7, JSON.stringify({ text: 'ក'.repeat(500) }), 'sale_snapshot_too_large'],
      ['bad-reason', 7, owner(7), 'other'],
    ]) assert.throws(() => put(row), /CHECK|malformed JSON/)
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${TABLE}`).get().n, 0)
  })

  console.log(JSON.stringify({ status: 'PASS', checks: passed, migration, migrationSha256: hash(sql) }))
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  for (const db of handles.reverse()) if (db.open) db.close()
})
