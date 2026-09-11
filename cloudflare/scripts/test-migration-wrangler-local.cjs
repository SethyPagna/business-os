// Exercise the installed Wrangler parser AND `d1 migrations apply --local`.
// better-sqlite3.exec alone cannot detect Wrangler's whitespace-sensitive CASE
// stack. Bootstrap the pre-0153 schema directly so unrelated historical data
// migrations (including 0098's compound SELECT limit) do not mask this test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Miniflare } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const { seeded, snapshot } = require('./test-received-date-saleability-repair-pure.cjs')

const dir = path.join(__dirname, '../migrations')
const files = fs.readdirSync(dir).filter(f => /^015[345]_.*\.sql$/.test(f)).sort()
assert.equal(files.length, 3)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-wrangler-migrations-'))
const persist = path.join(root, 'persist')
const config = path.join(root, 'wrangler.json')
const id = '00000000-0000-0000-0000-000000000153'
const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }
for (const key of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(key)) delete env[key]
const run = (...args) => {
  const result = spawnSync(process.execPath, [wrangler, ...args, '--config', config, '--local', '--persist-to', persist], {
    cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}
const local = () => new Miniflare({ modules: true, script: '', d1Databases: { DB: id }, d1Persist: path.join(persist, 'v3/d1') })

async function main() {
  fs.mkdirSync(path.join(root, 'migrations'))
  fs.writeFileSync(config, JSON.stringify({
    name: 'migration-parser-test', compatibility_date: '2026-09-01', send_metrics: false,
    d1_databases: [{ binding: 'DB', database_name: 'migration-parser-test', database_id: id, migrations_dir: 'migrations' }],
  }))
  for (const file of files) fs.copyFileSync(path.join(dir, file), path.join(root, 'migrations', file))
  const sqlite = seeded()
  for (const product of [1244, 4758]) {
    sqlite.prepare("INSERT INTO product_batches(variant_product_id,batch_key,batch_number,is_active) VALUES(?,'native-legacy-text','RECON-20260903',0),(?,'native-numeric',8,0)").run(product, product)
  }
  const schema = sqlite.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN (SELECT name FROM pragma_table_list WHERE type='shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid").all()
  const seed = { branches: sqlite.prepare('SELECT * FROM branches ORDER BY id').all(), ...snapshot(sqlite) }
  for (const file of files) sqlite.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
  const expected = snapshot(sqlite)
  // Generated correction/audit timestamps differ between the two runtimes;
  // the pure repair suite separately verifies every existing timestamp.
  const normalize = rows => rows.map(({ created_at, updated_at, ...row }) => row)
  sqlite.close()
  let mf = local()
  try {
    const db = await mf.getD1Database('DB')
    await db.batch(schema.map(row => db.prepare(row.sql)))
    await db.batch(Object.entries(seed).flatMap(([table, rows]) => rows.map(row =>
      db.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row)),
    )))
  } finally { await mf.dispose() }

  const applied = run('d1', 'migrations', 'apply', 'migration-parser-test')
  assert.equal(applied.status, 0, applied.output)

  mf = local()
  try {
    const db = await mf.getD1Database('DB')
    const names = (await db.prepare('SELECT name FROM d1_migrations ORDER BY name').all()).results.map(row => row.name)
    assert.deepEqual(names, files)
    console.log('PASS actual Wrangler local migration runner applies and records 0153, 0154 and 0155')
    for (const [index, count] of [11, 7, 5].entries()) {
      const sql = fs.readFileSync(path.join(dir, files[index]), 'utf8')
      const chunks = split(sql)
      assert.equal(chunks.length, count, `${files[index]} must retain complete trigger statements`)
      // Installed buildMigrationQuery appends this ledger INSERT to the file.
      const withLedger = `${sql}\nINSERT INTO d1_migrations (name)\nvalues ('${files[index]}');`
      assert.equal(split(withLedger).length, count + 1, `${files[index]} ledger must remain a separate final statement`)
    }
    console.log('PASS installed Wrangler splitter: raw 11 / 7 / 5; with migration ledger 12 / 8 / 6 statements')
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND (name LIKE '%0154' OR name LIKE '%0155')").first()).n, 8)
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%0153%'").first()).n, 0)
    for (const [table, rows] of Object.entries(expected)) {
      const actual = (await db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results
      assert.deepEqual(normalize(actual), normalize(rows), `${table}: native D1 repair must match verified SQLite fixture`)
    }
    console.log('PASS actual Wrangler native D1 repair matches all 12 business-table snapshots')
    const repairedOrdinals = (await db.prepare("SELECT batch_number FROM product_batches WHERE id=61020 OR batch_key='repair-0153-return-1-item-3'").all()).results
    assert.deepEqual(repairedOrdinals, [{ batch_number: 9 }, { batch_number: 9 }])
    await db.batch([
      db.prepare("INSERT INTO branches(id,name) VALUES(900001,'Local Shop')"),
      db.prepare("INSERT INTO products(id,name) VALUES(900001,'Local product')"),
      db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(900001,900001,'local-lot',0)"),
    ])
    await assert.rejects(db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,900001,1)').run(), /active received lot/)
    await db.batch([
      db.prepare('UPDATE product_batches SET is_active=1 WHERE id=900001'),
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,900001,1)'),
    ])
    await assert.rejects(db.prepare('UPDATE product_batches SET is_active=0 WHERE id=900001').run(), /Cannot deactivate/)
    await assert.rejects(db.prepare('DELETE FROM product_batches WHERE id=900001').run(), /Cannot delete/)
    assert.equal((await db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=900001').first()).quantity, 1)
    console.log('PASS migration ledger, helper cleanup and native D1 activation/parent guards')

    // A partial incident must reach 0153's guard (not a parser error), roll
    // back helper DDL/data and omit its ledger entry through the real runner.
    await db.prepare('DELETE FROM d1_migrations WHERE name=?').bind(files[0]).run()
    await db.prepare("DELETE FROM audit_logs WHERE action='received_date_saleability_repair' AND entity_id='0153'").run()
    await db.prepare("UPDATE branches SET name='Changed Shop' WHERE id=2").run()
  } finally { await mf.dispose() }
  const rejected = run('d1', 'migrations', 'apply', 'migration-parser-test')
  assert.notEqual(rejected.status, 0, rejected.output)
  assert.match(rejected.output, /0153: Shop identity changed/)
  mf = local()
  try {
    const db = await mf.getD1Database('DB')
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM d1_migrations').first()).n, 2)
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%0153%'").first()).n, 0)
    assert.equal((await db.prepare('SELECT stock_quantity FROM products WHERE id=165').first()).stock_quantity, 10)
  } finally { await mf.dispose() }
  console.log('PASS actual local migration runner rejects a partial incident atomically without recording 0153')
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  // Only the unique temporary directory allocated above is ever removed.
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()))
  assert(path.basename(root).startsWith('bos-wrangler-migrations-'))
  fs.rmSync(root, { recursive: true, force: true })
})
