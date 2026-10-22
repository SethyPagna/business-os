// The real wrangler agrees with the stamp.
//
// A client database provisioned from the baseline (baseline + d1_migrations stamp, see
// ops/scripts/client/provision-database.mjs) must look, to the installed wrangler's own
// migration runner, like a database that already applied 0001 to 0269. This test provisions a
// Miniflare D1 file, adds a dummy 0270 beside the 215 real files, and runs the actual
// `wrangler d1 migrations list` and `apply --local` against it:
//   - list names only 0270 as unapplied
//   - apply runs only 0270, exits 0, and records it
//   - the schema afterwards equals the full chain + 0270
// Everything happens in a temp directory; it never touches .wrangler/state and binds no port.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Miniflare } = require('miniflare')
const Database = require('better-sqlite3')
const base = require('./harness/client_baseline.cjs')
const { MIGRATIONS_DIR } = require('./harness/migration_sql.cjs')

const DUMMY = {
  name: '0270_client_probe.sql',
  sql: 'CREATE TABLE client_probe_0270 (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT);\nALTER TABLE products ADD COLUMN probe_0270 TEXT;\nCREATE INDEX idx_client_probe_0270 ON client_probe_0270 (note);\n',
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-client-wrangler-'))
  const persist = path.join(root, 'persist')
  const config = path.join(root, 'wrangler.json')
  const id = '00000000-0000-0000-0000-000000000270'
  const wrangler = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js')
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' }
  for (const key of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(key)) delete env[key]
  const run = (...args) => {
    const result = spawnSync(process.execPath, [wrangler, ...args, '--config', config, '--local', '--persist-to', persist], {
      cwd: root, env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
    })
    if (result.error) throw result.error
    return { status: result.status, output: result.stdout + result.stderr }
  }

  try {
    fs.mkdirSync(path.join(root, 'migrations'))
    fs.writeFileSync(config, JSON.stringify({
      name: 'client-baseline-probe', compatibility_date: '2026-09-01', send_metrics: false,
      d1_databases: [{ binding: 'DB', database_name: 'client-probe', database_id: id, migrations_dir: 'migrations' }],
    }))
    for (const name of base.chainFiles()) fs.copyFileSync(path.join(MIGRATIONS_DIR, name), path.join(root, 'migrations', name))
    fs.writeFileSync(path.join(root, 'migrations', DUMMY.name), DUMMY.sql)

    // Let Miniflare create the empty D1 file, then provision it exactly as the script does.
    const mf = new Miniflare({ modules: true, script: '', d1Databases: { DB: id }, d1Persist: path.join(persist, 'v3', 'd1') })
    try { await (await mf.getD1Database('DB')).prepare('SELECT 1').first() } finally { await mf.dispose() }
    const dir = path.join(persist, 'v3', 'd1', 'miniflare-D1DatabaseObject')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    assert.equal(files.length, 1, `expected one D1 file, found ${files.join(', ')}`)
    const file = path.join(dir, files[0])
    const built = base.buildBaseline()
    const db = new Database(file)
    try { base.provision(db, { baselineSql: built.text, stampNames: built.stampNames, expectedFingerprint: built.fingerprint }) } finally { db.close() }
    console.log('PASS Miniflare D1 file provisioned from the baseline (215 stamped, 3 seed rows)')

    const listed = run('d1', 'migrations', 'list', 'client-probe')
    assert.equal(listed.status, 0, listed.output)
    assert.match(listed.output, /0270_client_probe\.sql/)
    assert.doesNotMatch(listed.output, /0001_init\.sql|0243_stock_schema_epoch\.sql|0269_product_cost_mirror_backfill\.sql/, 'wrangler must see 0001 to 0269 as applied')
    console.log('PASS wrangler d1 migrations list names only 0270 as unapplied')

    const applied = run('d1', 'migrations', 'apply', 'client-probe')
    assert.equal(applied.status, 0, applied.output)
    assert.match(applied.output, /0270_client_probe\.sql/)
    assert.doesNotMatch(applied.output, /0001_init\.sql|0269_product_cost_mirror_backfill\.sql/)
    console.log('PASS wrangler d1 migrations apply --local ran 0270 and nothing else')

    const after = new Database(file, { readonly: true })
    const chain = base.replayChain({ extra: [DUMMY] })
    try {
      assert.deepEqual(after.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map((r) => r.name), [...built.stampNames, DUMMY.name])
      assert.equal(base.fingerprint(base.readSchema(after)), base.fingerprint(base.readSchema(chain)), 'schema after wrangler applied 0270 differs from the full chain + 0270')
      const census = base.rowCensus(after)
      for (const table of ['fees', 'organizations', 'user_aliases', 'customers', 'products', 'sales']) assert.equal(census[table] || 0, 0, `${table} must be empty`)
      assert.deepEqual(census, { d1_migrations: 216, system_flags: 3 })
    } finally { after.close(); chain.close() }
    console.log('PASS ledger lists 216 names, the schema equals the full chain + 0270, and no client rows exist')

    const again = run('d1', 'migrations', 'list', 'client-probe')
    assert.match(again.output, /No migrations to apply/i)
    console.log('PASS a second list reports nothing left to apply')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
