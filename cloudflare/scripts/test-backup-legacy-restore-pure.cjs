// Actual streaming backup/restore + actual bulk/replay handlers on SQLite.
// Reuse existing memory R2/KV adapters only; no network or persistent fixtures.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
function fixturePrefix(name, boundary, expose) {
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8')
  const end = source.indexOf(boundary)
  assert.ok(end > 0, `fixture boundary: ${name}`)
  return new Function('require', '__dirname', source.slice(0, end) + '\nreturn ' + expose)(require, __dirname)
}
const bulk = fixturePrefix('test-sale-bulk-status-pure.cjs', 'async function run() {', '{fixture,seed,request,replay,sales}')
const { backup, makeFakeR2, makeFakeKV } = fixturePrefix('test-backup-pure.cjs', 'let passed = 0', '{backup:backupModuleObj.exports,makeFakeR2,makeFakeKV}')
function binding(sql, writes) {
  function statement(text, params = []) {
    return {
      text, params, bind: (...values) => statement(text, values),
      async first() { return sql.prepare(text).get(...params) || null },
      async all() { return { results: sql.prepare(text).all(...params) } },
      async run() {
        writes.push(text)
        const result = sql.prepare(text).run(...params)
        return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      },
    }
  }
  return { prepare: text => statement(text), async batch(items) {
    return sql.transaction(() => items.map(s => {
      writes.push(s.text)
      const result = sql.prepare(s.text).run(...s.params)
      return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    }))()
  } }
}
async function main() {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Network forbidden in backup fixture') }
  const f = bulk.fixture()
  try {
    // Simulate append-only 0127 without taking ownership of its migration.
    // The backup implementation discovers live columns, so this exercises the
    // exact full-row stream and legacy-default restore behavior.
    const existingSaleColumns = new Set(f.sql.prepare('PRAGMA table_info(sales)').all().map(column => column.name))
    if (!existingSaleColumns.has('change_is_actual')) f.sql.exec(`ALTER TABLE sales ADD COLUMN change_is_actual INTEGER NOT NULL DEFAULT 0 CHECK (change_is_actual IN (0,1))`)
    if (!existingSaleColumns.has('change_exchange_rate')) f.sql.exec('ALTER TABLE sales ADD COLUMN change_exchange_rate REAL')
    bulk.seed(f, 3)
    f.sql.exec("INSERT INTO users(id,username,name,password) VALUES(1,'synthetic-review','Synthetic','unused')")
    f.sql.pragma('foreign_keys = ON')
    f.sql.exec(`
      INSERT INTO customers(id,name) VALUES(1,'Synthetic Customer');
      INSERT INTO suppliers(id,name) VALUES(1,'Synthetic Supplier');
      INSERT INTO sale_amendments(sale_id,kind) VALUES(1,'delivery_fee_changed');
      INSERT INTO customer_receivables(legacy_id,customer_id,customer_name,invoice_date,total_amount_usd,outstanding_balance_usd,status,source_file,source_row)
        VALUES(1,1,'Synthetic Customer','2026-09-05',15,5,'unpaid','synthetic-only',1);
      INSERT INTO supplier_invoices(source_branch,branch_id,legacy_id,supplier_id,supplier_name,invoice_date,total_amount_usd,outstanding_balance_usd,status,source_file,source_row)
        VALUES('Shop',1,1,1,'Synthetic Supplier','2026-09-05',25,10,'unpaid','synthetic-only',1);
    `)
    const writes = []
    f.env.DB = binding(f.sql, writes)
    f.env.ASSETS = makeFakeR2()
    f.env.CACHE = makeFakeKV()
    f.sql.prepare('UPDATE sales SET change_is_actual=1,change_exchange_rate=3950 WHERE id=1').run()
    for (const id of [1, 2]) {
      const req = bulk.request(f, 'cancelled', `request-roundtrip-${id}`)
      req.items = req.items.filter(item => item.id === id)
      const result = await f.call(bulk.sales, '/bulk-status', req)
      assert.equal(result.status, 200, JSON.stringify(result))
      if (id === 2) assert.equal((await bulk.replay(f, result.body.actionHistoryId)).status, 200)
    }
    const mutationHistory = f.sql.prepare('SELECT id FROM action_history ORDER BY id LIMIT 1').get().id
    f.sql.prepare(`INSERT INTO sale_mutation_receipts(
      id,actor_id,sale_id,mutation_kind,request_id,request_digest,request_json,
      before_json,after_json,response_json,history_id,generation,sale_revision
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'mutation-fixture', 1, 1, 'settlement', 'mutation-request', 'digest', '{}',
      '{"header":null,"lines":[null]}', '{"header":0,"lines":[0]}', '{"success":true}', mutationHistory, 0, 1,
    )
    f.sql.prepare('INSERT INTO sale_mutation_members(operation_id,entity_kind,entity_id,ordinal) VALUES(?,?,?,?)')
      .run('mutation-fixture', 'sale_item', 1, 0)
    const snap = (tables = f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(t => t.name)) =>
      Object.fromEntries(tables.map(t => [t, f.sql.prepare(`SELECT * FROM "${t.replaceAll('"', '""')}"`).all()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
    const before = snap(backup.BACKUP_TABLES)
    const created = await backup.createCloudflareBackup(f.env, 'manual')
    const document = JSON.parse(f.env.ASSETS._store.get(created.key).body)
    assert.equal(Object.keys(document.tables).length, 69)
    assert.deepEqual(Object.keys(document.tables), [...backup.BACKUP_TABLES], 'full backup must include every table in exact dependency order')
    for (const table of ['return_write_revisions', 'return_bulk_operations', 'return_bulk_members', 'stock_session_revisions', 'stock_session_operations', 'stock_session_members', 'sale_mutation_receipts', 'sale_mutation_members']) {
      assert.ok(Object.hasOwn(document.tables, table), `backup includes durable replay table ${table}`)
    }
    assert.equal((await backup.validateCloudflareBackup(f.env, created.key)).restorable, true)
    f.sql.exec(`INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
    await backup.restoreCloudflareBackup(f.env, created.key)
    assert.deepEqual(snap(backup.BACKUP_TABLES), before)
    assert.deepEqual(
      f.sql.prepare('SELECT change_is_actual,change_exchange_rate FROM sales WHERE id=1').get(),
      { change_is_actual: 1, change_exchange_rate: 3950 },
      'full backup preserves explicit native-change provenance exactly',
    )
    assert.deepEqual(f.sql.pragma('foreign_key_check'), [])
    f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
    const operations = f.sql.prepare('SELECT * FROM sale_bulk_operations ORDER BY request_id').all()
    assert.equal((await bulk.replay(f, operations[0].history_id, 'undo', 0)).status, 200)
    assert.equal((await bulk.replay(f, operations[1].history_id, 'redo', 1)).status, 200)
    console.log('PASS actual FK-on streaming full 69-table roundtrip, sale/Returns/stock replay tables, and restored-generation undo/redo')

    const pre0127 = structuredClone(document)
    const salesColumns = pre0127.tables.sales.columns
    for (const column of ['change_is_actual', 'change_exchange_rate']) {
      const index = salesColumns.indexOf(column)
      assert.ok(index >= 0, `full backup records ${column}`)
      salesColumns.splice(index, 1)
      for (const row of pre0127.tables.sales.rows) delete row[column]
    }
    const pre0127Key = 'backups/cloudflare/pre-0127-sales-columns.json'
    await f.env.ASSETS.put(pre0127Key, JSON.stringify(pre0127), { customMetadata: { format: document.format } })
    assert.equal((await backup.validateCloudflareBackup(f.env, pre0127Key)).restorable, true)
    f.sql.prepare('UPDATE sales SET change_is_actual=1,change_exchange_rate=4200 WHERE id=1').run()
    f.sql.exec(`INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
    await backup.restoreCloudflareBackup(f.env, pre0127Key)
    assert.deepEqual(
      f.sql.prepare('SELECT change_is_actual,change_exchange_rate FROM sales WHERE id=1').get(),
      { change_is_actual: 0, change_exchange_rate: null },
      'legacy backup omits 0127 columns so schema defaults restore 0/NULL without inference',
    )
    f.sql.exec("DELETE FROM system_flags WHERE key='maintenance'")
    console.log('PASS native-change provenance roundtrips, while pre-0127 sales rows restore marker/rate defaults without inference')

    f.sql.exec(`INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}')`)
    async function variant(label, omit) {
      const legacy = structuredClone(document)
      for (const table of omit) delete legacy.tables[table]
      legacy.summary.tableCount = Object.keys(legacy.tables).length
      legacy.summary.rowCount = Object.values(legacy.tables).reduce((n, t) => n + t.rows.length, 0)
      const key = `backups/cloudflare/${label}.json`
      await f.env.ASSETS.put(key, JSON.stringify(legacy), { customMetadata: { format: document.format } })
      return key
    }
    async function refused(key, missing) {
      const allRows = snap()
      writes.length = 0
      const validation = await backup.validateCloudflareBackup(f.env, key)
      assert.equal(validation.restorable, false, 'unsafe valid-count document must fail validation')
      assert.match(validation.restoreError, /missing.*dependenc/i)
      for (const table of missing) assert.ok(validation.restoreError.includes(table), table)
      let progress = 0
      await assert.rejects(() => backup.restoreCloudflareBackup(f.env, key, async () => { progress++ }), /missing.*dependenc/i)
      assert.equal(progress, 0, 'refuse before deletion progress callbacks')
      assert.deepEqual(writes, [], 'no DELETE, INSERT or UPDATE submitted')
      assert.deepEqual(snap(), allRows, 'every DB table, including unbacked state and sequences, is unchanged')
      assert.deepEqual(f.sql.pragma('foreign_key_check'), [])
    }
    const omitted = ['customer_receivables', 'supplier_invoices', 'undo_snapshots', 'sale_amendments', 'sale_write_revisions', 'sale_mutation_receipts', 'sale_mutation_members', 'sale_bulk_operations', 'sale_bulk_members']
    await refused(await variant('legacy-nine-missing', omitted), ['sale_bulk_operations', 'sale_bulk_members', 'sale_mutation_receipts', 'sale_mutation_members', 'undo_snapshots'])
    console.log('PASS valid legacy nine-table omission refuses before any write; every DB row preserved')
    for (const table of ['sale_bulk_operations', 'sale_bulk_members', 'sale_mutation_receipts', 'sale_mutation_members', 'undo_snapshots', 'sale_write_revisions', 'sale_amendments']) {
      await refused(await variant(`missing-${table}`, [table]), [table])
    }
    console.log('PASS individually incomplete replay bundles fail validation and direct restore without writes')
    // A missing FK child is unsafe even outside the replay bundle.
    f.sql.exec("INSERT INTO user_notes(user_id,title,content) VALUES(1,'Preserve','Unbacked note')")
    await refused(await variant('missing-user-notes', ['user_notes']), ['user_notes'])
    console.log('PASS missing FK-dependent table is rejected before deletion')
    const scoped = await variant('settings-only', Object.keys(document.tables).filter(t => t !== 'settings'))
    assert.equal((await backup.validateCloudflareBackup(f.env, scoped)).restorable, true)
    const otherRows = snap(backup.BACKUP_TABLES.filter(t => t !== 'settings'))
    await backup.restoreCloudflareBackup(f.env, scoped)
    assert.deepEqual(snap(backup.BACKUP_TABLES.filter(t => t !== 'settings')), otherRows)
    console.log('PASS unrelated scoped settings restore remains usable')
  } finally { f.sql.close(); globalThis.fetch = originalFetch }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
