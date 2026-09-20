// Actual restore/parser/drop functions; only bindings are synthetic memory
// SQLite/R2. No business data, workerd, network or persistent DB is involved.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  file = path.resolve(__dirname, '..', 'src', file)
  if (cache.has(file)) return cache.get(file)
  if (file.endsWith(path.sep + 'db.ts')) return { getDb: env => env.legacyDb }
  const mod = { exports: {} }; cache.set(file, mod.exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', 'module', code)(name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name), mod.exports, mod)
  return mod.exports
}
const backup = load('lib/backup.ts')
const { dropAllCustomTables } = load('lib/coreDataInvariants.ts')
const { assertCustomTableName } = load('lib/customTableName.ts')
function fixture(names, chunkSize = 100000, columns = ['id', 'name']) {
  const sql = new DatabaseSync(':memory:')
  sql.exec(`CREATE TABLE custom_tables(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    INSERT INTO custom_tables VALUES(99,'ct_existing');
    CREATE TABLE system_flags(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO system_flags VALUES('dataset_generation','permanent-generation');
    CREATE TABLE transfer_operation_receipts(id TEXT PRIMARY KEY);
    INSERT INTO transfer_operation_receipts VALUES('permanent-retry-id');
    CREATE TABLE transfer_run_retirements(id TEXT PRIMARY KEY);
    INSERT INTO transfer_run_retirements VALUES('permanent-retirement-id');
    CREATE TABLE ct_safe(id INTEGER PRIMARY KEY);
    INSERT INTO ct_safe VALUES(7);`)
  const writes = []
  function prepared(text, values = []) {
    return { bind: (...p) => prepared(text, p),
      first: async () => sql.prepare(text).get(...values) || null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => { writes.push(text); sql.prepare(text).run(...values); return { success: true } },
    }
  }
  const document = JSON.stringify({ format: 'business-os-cloudflare-backup', formatVersion: 1,
    createdAt: '2026-09-20T00:00:00.000Z', source: 'manual', runtime: 'cloudflare-workers',
    tables: { custom_tables: { columns, rows: names.map((name, i) => ({ id: i + 1, name })) } },
    r2: { assets: [] }, summary: { tableCount: 1, rowCount: names.length } })
  const body = () => new ReadableStream({ start(controller) {
    const bytes = new TextEncoder().encode(document)
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
    controller.close()
  } })
  const env = { DB: { prepare: prepared, batch: async stmts => { for (const s of stmts) await s.run() } },
    ASSETS: { get: async key => key === 'backups/cloudflare/probe.json' ? { body: body(), customMetadata: { format: 'business-os-cloudflare-backup' } } : null },
    legacyDb: { prepare: text => ({ all: async () => sql.prepare(text).all(), run: async () => { writes.push(text); sql.prepare(text).run() } }) },
  }
  return { sql, writes, env, body }
}
function preserved(f) {
  assert.equal(f.sql.prepare('SELECT value FROM system_flags').get().value, 'permanent-generation')
  assert.equal(f.sql.prepare('SELECT id FROM transfer_operation_receipts').get().id, 'permanent-retry-id')
  assert.equal(f.sql.prepare('SELECT id FROM transfer_run_retirements').get().id, 'permanent-retirement-id')
  assert.equal(f.sql.prepare('SELECT id FROM ct_safe').get().id, 7)
}
async function run() {
  assert.ok(backup.BACKUP_TABLES.includes('custom_tables'))
  assert.ok(!backup.BACKUP_TABLES.includes('system_flags'))
  let cases = 0
  const valid = ['ct_', 'ct_safe', 'ct_123', 'ct___', 'ct_a_b_9', 'ct_' + 'a'.repeat(40)]
  for (const name of valid) {
    assert.doesNotThrow(() => assertCustomTableName(name))
    const f = fixture([name], 1)
    await backup.validateCloudflareBackup(f.env, 'probe.json')
    await backup.restoreCloudflareBackup(f.env, 'probe.json')
    assert.equal(f.sql.prepare('SELECT name FROM custom_tables').get().name, name)
    // CREATE only synthetic names validated above, never an input system name.
    f.sql.exec(`CREATE TABLE IF NOT EXISTS "${name}"(id INTEGER PRIMARY KEY)`)
    assert.deepEqual(await dropAllCustomTables(f.env), [name])
    assert.equal(f.sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name), undefined)
    assert.ok(f.sql.prepare('SELECT * FROM system_flags').get())
    f.sql.close(); cases++
  }
  for (const bad of ['system_flags', 'transfer_operation_receipts', 'transfer_run_retirements', 'CT_safe', 'ct_Safe', 'ct_x\n', 'ct_x";DROP TABLE system_flags;--', 'ct_' + 'a'.repeat(41), '', null, 3, 'ct_ខ្មែរ']) {
    assert.throws(() => assertCustomTableName(bad), /Invalid custom table metadata/)
    for (const chunkSize of [100000, 1]) {
      const f = fixture(['ct_safe', bad], chunkSize)
      await assert.rejects(backup.inspectCloudflareBackupStream(f.body()), /Invalid custom table metadata/)
      await assert.rejects(backup.validateCloudflareBackup(f.env, 'probe.json'), /Invalid custom table metadata/)
      let progress = 0
      await assert.rejects(backup.restoreCloudflareBackup(f.env, 'probe.json', async () => { progress++ }), /Invalid custom table metadata/)
      assert.equal(progress, 0, 'reject before any progress callback writes')
      assert.deepEqual(f.writes, [], 'reject before any restore DELETE/INSERT')
      assert.equal(f.sql.prepare('SELECT name FROM custom_tables').get().name, 'ct_existing')
      preserved(f)
      // Pre-existing poisoned metadata is independently fenced, even without restore.
      if (typeof bad === 'string') {
        f.sql.exec('DELETE FROM custom_tables')
        f.sql.prepare('INSERT INTO custom_tables VALUES(1,?)').run('ct_safe')
        f.sql.prepare('INSERT INTO custom_tables VALUES(2,?)').run(bad)
        await assert.rejects(dropAllCustomTables(f.env), /Invalid custom table metadata/)
        assert.deepEqual(f.writes, [], 'ALL names checked before first DROP or metadata clear')
        assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM custom_tables').get().n, 2)
        preserved(f)
      }
      f.sql.close(); cases++
    }
  }
  {
    const f = fixture(['ct_safe'], 1, ['id'])
    await assert.rejects(backup.validateCloudflareBackup(f.env, 'probe.json'), /missing name column/)
    await assert.rejects(backup.restoreCloudflareBackup(f.env, 'probe.json'), /missing name column/)
    assert.deepEqual(f.writes, []); preserved(f); f.sql.close(); cases++
  }
  {
    const f = fixture(['ct_safe', 'ct_safe'])
    await backup.restoreCloudflareBackup(f.env, 'probe.json')
    assert.deepEqual(await dropAllCustomTables(f.env), ['ct_safe', 'ct_safe'], 'duplicate valid metadata remains idempotent with IF EXISTS')
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM custom_tables').get().n, 0)
    assert.ok(f.sql.prepare('SELECT * FROM system_flags').get()); f.sql.close(); cases++
  }
  {
    // Discriminating negative control: remove only the added all-name
    // preflight in memory. The same actual drop function must reproduce
    // the original protected-table loss; a fake DB ignoring DDL cannot pass.
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/coreDataInvariants.ts'), 'utf8')
    const ast = ts.createSourceFile('core.ts', source, ts.ScriptTarget.Latest, true)
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'dropAllCustomTables')
    const original = fn.getText(ast)
    const mutant = original.replace('for (const row of rows) assertCustomTableName(row.name)', '')
    assert.notEqual(mutant, original)
    const code = ts.transpileModule(mutant.replace('export ', ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const unsafeDrop = new Function('getDb', code + '; return dropAllCustomTables')(env => env.legacyDb)
    const f = fixture([])
    f.sql.exec("UPDATE custom_tables SET name='system_flags'")
    await unsafeDrop(f.env)
    assert.equal(f.sql.prepare("SELECT 1 FROM sqlite_master WHERE name='system_flags'").get(), undefined)
    f.sql.close(); cases++
  }
  console.log(`PASS ${cases} actual-function custom-table safety scenarios (native SQLite, JSON whole/chunked streams)`)
}
run().catch(error => { console.error(error); process.exitCode = 1 })
