// A new client database = the schema baseline + the ledger stamp, never the chain.
//
// Proves, on real SQLite (the engine D1 runs):
//   1. cloudflare/baseline/schema-0269.sql is exactly what the current chain would
//      produce, minus data (rebuild + byte compare), LF only, with no row but the seeds
//   2. ops/scripts/client/provision-database.mjs --local provisions an empty file,
//      stamps d1_migrations, and the schema fingerprint equals a schema-only replay of
//      the chain; it refuses anything that is not empty, a stale baseline, and any
//      extra row; a failed run leaves the database empty
//   3. baseline + stamp, then a dummy 0270 applied the way wrangler applies a pending
//      migration, ends with the SAME schema as the full chain plus that 0270, and holds
//      zero rows in fees, organizations, user_aliases, customers, products and sales
//   4. --remote only prints; the file imports nothing that can run a command or reach the
//      network; --verify-schema-json accepts a matching export and rejects a tampered one
//
// Why: docs/setup/migrations-multi-client.md. The chain's own leftovers:
// test-migration-fresh-chain-rows-pure.cjs.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const Database = require('better-sqlite3')
const base = require('./harness/client_baseline.cjs')
const { splitStatements, MIGRATIONS_DIR } = require('./harness/migration_sql.cjs')
const { lintMigration } = require('./harness/migration_lint.cjs')

const ROOT = path.join(__dirname, '..', '..')
const PROVISION = path.join(ROOT, 'ops', 'scripts', 'client', 'provision-database.mjs')
const BUILD = path.join(ROOT, 'ops', 'scripts', 'client', 'build-baseline.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-baseline-'))
let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 120000, cwd: tmp })

const built = base.buildBaseline()
const baselineOnDisk = fs.readFileSync(base.baselinePath(), 'utf8')
const BUSINESS_ZERO = ['fees', 'organizations', 'organization_groups', 'user_aliases', 'customers', 'products', 'sales', 'settings', 'audit_logs', 'loyalty_points_reset_log']

// A conforming 0270: DDL only. The lint must accept it, or this proof proves nothing.
const DUMMY_0270 = {
  name: '0270_client_probe.sql',
  sql: 'CREATE TABLE client_probe_0270 (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT);\nALTER TABLE products ADD COLUMN probe_0270 TEXT;\nCREATE INDEX idx_client_probe_0270 ON client_probe_0270 (note);\n',
}

// ---------------------------------------------------------------- 1. the baseline file

check('the baseline on disk equals a fresh build from the current chain, byte for byte', () => {
  assert.equal(baselineOnDisk, built.text, 'cloudflare/baseline/schema-0269.sql is stale: node ops/scripts/client/build-baseline.mjs')
  const result = run(BUILD, ['--check'])
  assert.equal(result.status, 0, result.stderr)
})

check('the baseline is LF only and covers the whole schema through 0269', () => {
  assert.equal(base.DEFAULT_THROUGH, JSON.parse(fs.readFileSync(base.MANIFEST_PATH, 'utf8')).baselineThrough, 'the manifest and the builder must name the same baseline')
  assert.ok(!baselineOnDisk.includes('\r'), 'trigger SQL must stay LF (.gitattributes covers cloudflare/baseline/*.sql)')
  const attrs = fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8')
  assert.match(attrs, /^cloudflare\/baseline\/\*\.sql text eol=lf\s*$/m)
  assert.deepEqual(base.schemaCounts(built.objects), { table: 159, index: 208, view: 0, trigger: 220 })
  assert.match(baselineOnDisk, new RegExp(`schema-fingerprint: ${built.fingerprint}`))
})

check('the baseline contains CREATE statements and the seed rows and nothing else', () => {
  const statements = splitStatements(baselineOnDisk)
  const inserts = statements.filter((s) => s.kind === 'insert')
  const others = statements.filter((s) => s.kind !== 'insert').map((s) => s.kind)
  assert.equal(inserts.length, base.SEED_ROWS.length)
  for (const s of inserts) assert.match(s.text, /^INSERT INTO system_flags \(key, value, updated_at\) VALUES \('(stock_schema_epoch|stock_schema_receipt_boundary|multilot_revert_watermark)'/)
  assert.deepEqual([...new Set(others)].sort(), ['create_index', 'create_table', 'create_trigger', 'create_vtable'])
  assert.equal(statements.length, 159 + 208 + 220 + base.SEED_ROWS.length)
  for (const table of ['organizations', 'fees', 'user_aliases', 'customers', 'products', 'sales', 'settings', 'loyalty_points_reset_log']) {
    assert.ok(!new RegExp(`INSERT\\s+(OR\\s+\\w+\\s+)?INTO\\s+${table}\\b`, 'i').test(baselineOnDisk), `the baseline must not insert into ${table}`)
  }
})

check('the schema query that defines the fingerprint drops exactly the FTS shadow tables', () => {
  const db = base.replayChain({ through: base.DEFAULT_THROUGH })
  try {
    const shadow = db.prepare("SELECT name FROM pragma_table_list WHERE type = 'shadow'").all().map((r) => r.name).sort()
    const all = db.prepare("SELECT name FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all().map((r) => r.name)
    const kept = new Set(base.readSchema(db).map((r) => r.name))
    assert.equal(shadow.length, 36)
    assert.deepEqual(all.filter((n) => !kept.has(n)).sort(), shadow)
  } finally { db.close() }
})

check('the first client\'s residue in the baseline DDL is pinned: one trigger writes the literal Old system, two tables CHECK pinned sale ids', () => {
  const holders = (needle) => built.objects.filter((o) => o.sql.includes(needle)).map((o) => `${o.type} ${o.name}`).sort()
  assert.deepEqual(holders("'Old system'"), ['trigger trg_legacy_inventory_effect_apply'])
  assert.deepEqual(holders('16951'), ['table sale_incident_recovery_members'])
  assert.deepEqual(holders('16954'), ['table sale_incident_recovery_members', 'table sale_not_paid_stock_recovery_members'])
  // The identity migration 0030 seeds must not appear in any schema object.
  const chain = base.replayChain({ through: 30 })
  const org = chain.prepare('SELECT name, slug FROM organizations').get()
  chain.close()
  for (const term of [org.name, org.slug]) assert.deepEqual(holders(term), [], `${term} appears in baseline DDL`)
})

// ---------------------------------------------------------------- 2. the provisioner

const chainDb = base.replayChain({ through: base.DEFAULT_THROUGH })
const chainFingerprint = base.fingerprint(base.readSchema(chainDb))
chainDb.close()

check('provision-database.mjs --local provisions an empty file: fingerprint equals a schema-only replay, stamp is complete, rows are the seeds', () => {
  assert.equal(chainFingerprint, built.fingerprint)
  const file = path.join(tmp, 'client-a.sqlite')
  const result = run(PROVISION, ['--local', file])
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /equals a schema-only replay of the chain through 0269/)
  const db = new Database(file, { readonly: true })
  try {
    assert.equal(base.fingerprint(base.readSchema(db)), chainFingerprint)
    assert.deepEqual(db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map((r) => r.name), base.chainFiles({ through: 269 }))
    assert.equal(db.prepare('SELECT COUNT(*) n FROM d1_migrations').get().n, 215)
    assert.deepEqual(base.rowCensus(db), { d1_migrations: 215, system_flags: 3 })
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { db.close() }
})

check('it refuses to provision the same file twice, and a database with any object or any ledger row', () => {
  const file = path.join(tmp, 'client-a.sqlite')
  const before = fs.readFileSync(file)
  const again = run(PROVISION, ['--local', file])
  assert.notEqual(again.status, 0)
  assert.match(again.stderr, /refusing to provision: the database is not empty/)
  assert.ok(fs.readFileSync(file).equals(before), 'a refused run must not change the file')

  const stray = path.join(tmp, 'stray.sqlite')
  let db = new Database(stray)
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)')
  db.close()
  const strayRun = run(PROVISION, ['--local', stray])
  assert.notEqual(strayRun.status, 0)
  assert.match(strayRun.stderr, /not empty \(1 schema object\(s\), first: table notes\)/)
  db = new Database(stray)
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name), ['notes'])
  db.close()

  const ledger = path.join(tmp, 'ledger.sqlite')
  db = new Database(ledger)
  db.exec(base.D1_MIGRATIONS_DDL)
  db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run('0001_init.sql')
  db.close()
  const ledgerRun = run(PROVISION, ['--local', ledger])
  assert.notEqual(ledgerRun.status, 0)
  assert.match(ledgerRun.stderr, /d1_migrations holds 1 row/)
})

check('a database that wrangler already touched (an EMPTY d1_migrations table) is still empty and is provisioned', () => {
  const file = path.join(tmp, 'wrangler-touched.sqlite')
  let db = new Database(file)
  db.exec(base.D1_MIGRATIONS_DDL)
  db.close()
  const result = run(PROVISION, ['--local', file])
  assert.equal(result.status, 0, result.stderr)
  db = new Database(file, { readonly: true })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM d1_migrations').get().n, 215)
  db.close()
})

check('a stale baseline is refused before anything is written', () => {
  const stale = path.join(tmp, 'stale.sql')
  fs.writeFileSync(stale, baselineOnDisk.replace(/CREATE INDEX [^\n]+\n\n/, ''))
  const file = path.join(tmp, 'client-stale.sqlite')
  const result = run(PROVISION, ['--local', file, '--baseline', stale])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /baseline is stale against the migration chain/)
  assert.ok(!fs.existsSync(file), 'no database file is created for a refused run')
})

check('provision() asserts the rows: an extra business row smuggled into the baseline is refused and rolled back', () => {
  const db = new Database(':memory:')
  try {
    const tainted = `${built.text}\nINSERT INTO fees (fee_type, label, amount_usd, fee_date, created_by_name) VALUES ('expense', 'x', 1, '2025-01-01', 'Old system');\n`
    assert.throws(() => base.provision(db, { baselineSql: tainted, stampNames: built.stampNames, expectedFingerprint: built.fingerprint }), /provisioned rows differ from the seed allowlist/)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").get().n, 0, 'rollback leaves the database empty')
  } finally { db.close() }
})

check('provision() asserts the schema: a baseline missing one index is refused and rolled back', () => {
  const db = new Database(':memory:')
  try {
    const broken = built.text.replace(/CREATE INDEX [^\n]+\n\n/, '')
    assert.throws(() => base.provision(db, { baselineSql: broken, stampNames: built.stampNames, expectedFingerprint: built.fingerprint }), /schema fingerprint mismatch/)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").get().n, 0)
  } finally { db.close() }
})

// ---------------------------------------------------------------- 3. baseline + stamp + 0270 == chain + 0270

check('the dummy 0270 passes the client-neutral lint as a SCHEMA migration', () => {
  assert.deepEqual(lintMigration({ name: DUMMY_0270.name, sql: DUMMY_0270.sql, cls: 'SCHEMA' }), [])
})

check('baseline + stamp + 0270 ends with the same schema as the full chain + 0270, and no client rows', () => {
  const files = [...base.chainFiles({ through: 269 }).map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') })), DUMMY_0270]

  const viaChain = base.replayChain({ extra: [DUMMY_0270] })
  const viaBaseline = new Database(':memory:')
  try {
    base.provision(viaBaseline, { baselineSql: built.text, stampNames: built.stampNames, expectedFingerprint: built.fingerprint })
    // What `wrangler d1 migrations apply` does next: only the files not in the ledger.
    const ran = base.applyPending(viaBaseline, files)
    assert.deepEqual(ran, [DUMMY_0270.name], 'only 0270 is pending after the stamp')

    assert.equal(base.fingerprint(base.readSchema(viaBaseline)), base.fingerprint(base.readSchema(viaChain)), 'schema differs from the full chain + 0270')
    assert.ok(base.readSchema(viaBaseline).some((o) => o.name === 'client_probe_0270'))
    assert.deepEqual(viaBaseline.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map((r) => r.name), files.map((f) => f.name))
    const census = base.rowCensus(viaBaseline)
    for (const table of BUSINESS_ZERO) assert.equal(census[table] || 0, 0, `${table} must hold zero rows`)
    for (const table of ['fees', 'organizations', 'user_aliases', 'customers', 'products', 'sales']) assert.equal(viaBaseline.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0)
    assert.deepEqual(census, { d1_migrations: 216, system_flags: 3 })

    // The chain route, for contrast, is not empty (see test-migration-fresh-chain-rows-pure.cjs).
    assert.equal(viaChain.prepare('SELECT COUNT(*) n FROM fees').get().n, 4240)
    assert.equal(viaChain.prepare('SELECT COUNT(*) n FROM organizations').get().n, 1)
  } finally { viaBaseline.close(); viaChain.close() }
})

check('the stock triggers work on the provisioned database: the seed epoch lets a permitted stock write through and still refuses a bare one', () => {
  const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
  const db = new Database(':memory:')
  try {
    base.provision(db, { baselineSql: built.text, stampNames: built.stampNames, expectedFingerprint: built.fingerprint })
    db.exec("INSERT INTO branches (name) VALUES ('Probe Branch')")
    const branchId = db.prepare('SELECT last_insert_rowid() AS id').get().id
    seedStockFixture(db, () => db.exec("INSERT INTO products (name) VALUES ('Probe Product')"))
    const productId = db.prepare('SELECT last_insert_rowid() AS id').get().id
    assert.throws(() => db.prepare('INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES (?, ?, 1)').run(branchId, productId), /stock_transaction_required/)
    seedStockFixture(db, () => db.prepare('INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES (?, ?, 1)').run(branchId, productId))
    assert.equal(db.prepare('SELECT quantity FROM branch_stock WHERE branch_id = ? AND product_id = ?').get(branchId, productId).quantity, 1)
  } finally { db.close() }
})

check('without the epoch seed even a permitted stock write is refused, which is why the three constants are seeded', () => {
  const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
  const db = new Database(':memory:')
  try {
    base.provision(db, { baselineSql: built.text, stampNames: built.stampNames, expectedFingerprint: built.fingerprint })
    db.exec("INSERT INTO branches (name) VALUES ('Probe Branch')")
    const branchId = db.prepare('SELECT last_insert_rowid() AS id').get().id
    seedStockFixture(db, () => db.exec("INSERT INTO products (name) VALUES ('Probe Product')"))
    const productId = db.prepare('SELECT last_insert_rowid() AS id').get().id
    db.exec("DELETE FROM system_flags WHERE key = 'stock_schema_epoch'")
    db.exec("INSERT INTO system_flags (key, value) VALUES ('stock_transaction_permit', 'legacy-separate-pool-v1')")
    assert.throws(() => db.prepare('INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES (?, ?, 1)').run(branchId, productId), /stock_transaction_required/)
  } finally { db.close() }
})

// ---------------------------------------------------------------- 4. remote plan, verification

check('--remote prints a plan and runs nothing: the script imports no process or network module', () => {
  const source = fs.readFileSync(PROVISION, 'utf8')
  const imports = [...source.matchAll(/\bfrom '([^']+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(imports, ['node:fs', 'node:module', 'node:path', 'node:url'], 'only file, path and module-resolution imports')
  const required = [...source.matchAll(/\brequire\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' '))
  assert.equal(required.length, 2, 'the only require calls load the baseline harness and better-sqlite3')
  assert.ok(required.every((r) => /client_baseline\.cjs|better-sqlite3/.test(r)), required.join(' | '))
  assert.ok(!/\bfetch\s*\(|child_process|\bexec(Sync)?\s*\(|process\.binding/.test(source))
  const result = run(PROVISION, ['--remote', '--database', 'client-two', '--config', 'wrangler.client-two.toml'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /^PLAN ONLY\. Nothing below has been run\./)
  assert.match(result.stdout, /WRITE  apply the schema baseline/)
  assert.match(result.stdout, /wrangler d1 execute client-two --remote --config wrangler\.client-two\.toml --file baseline\/schema-0269\.sql/)
  assert.match(result.stdout, /stamp the ledger with 215 migration names/)
  assert.match(result.stdout, /d1 migrations apply client-two --remote` applies 0270 and later only/)
  assert.equal(fs.readdirSync(tmp).includes('client-two'), false)
  assert.notEqual(run(PROVISION, ['--remote']).status, 0, '--remote without --database is refused')
})

check('--emit-stamp-sql prints the ledger DDL and one INSERT per migration', () => {
  const result = run(PROVISION, ['--emit-stamp-sql'])
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split('\n')
  assert.equal(lines[0], `${base.D1_MIGRATIONS_DDL};`)
  assert.equal(lines.length, 216)
  const db = new Database(':memory:')
  db.exec(result.stdout)
  assert.deepEqual(db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map((r) => r.name), base.chainFiles({ through: 269 }))
  db.close()
})

check('--verify-schema-json accepts a D1-shaped export of the right schema and rejects a tampered one', () => {
  const db = base.replayChain({ through: 269 })
  const rows = db.prepare(base.SCHEMA_SELECT_SQL).all()
  db.close()
  const good = path.join(tmp, 'schema-good.json')
  fs.writeFileSync(good, JSON.stringify([{ results: rows, success: true, meta: {} }]))
  const ok = run(PROVISION, ['--verify-schema-json', good])
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, new RegExp(`^MATCH ${built.fingerprint}`))

  const tampered = rows.slice()
  const target = tampered.findIndex((r) => r.type === 'trigger')
  tampered[target] = { ...tampered[target], sql: tampered[target].sql.replace('BEGIN', 'BEGIN SELECT 1;') }
  const bad = path.join(tmp, 'schema-bad.json')
  fs.writeFileSync(bad, JSON.stringify([{ results: tampered, success: true }]))
  const refused = run(PROVISION, ['--verify-schema-json', bad])
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /MISMATCH/)
  assert.match(refused.stderr, /differing 1:/)

  const empty = path.join(tmp, 'schema-empty.json')
  fs.writeFileSync(empty, JSON.stringify([{ results: [], success: true }]))
  assert.notEqual(run(PROVISION, ['--verify-schema-json', empty]).status, 0)
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${passed} checks passed`)
