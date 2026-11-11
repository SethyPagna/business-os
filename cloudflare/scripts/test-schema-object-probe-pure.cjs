// lib/schemaObjectProbe.ts: one exact sqlite_master scan answers every "does this table / trigger exist" question of an
// isolate. It must give exactly the answer of the per-object probe it replaces, for a present object, a missing table,
// a missing trigger, a wrong kind and a case variant; it must scan once for many objects; a miss must be re-probed.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { D1Compat } = require('./harness/d1compat.cjs')

const SRC = path.join(__dirname, '..', 'src')
function loadProbe() {
  const file = path.join(SRC, 'lib', 'schemaObjectProbe.ts')
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const mod = { exports: {} }
  new Function('exports', 'module', out)(mod.exports, mod)
  return mod.exports
}

function world() {
  const raw = new DatabaseSync(':memory:')
  raw.exec(`
    CREATE TABLE system_flags (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE fee_operation_receipts (id INTEGER PRIMARY KEY);
    CREATE TABLE sales (id INTEGER PRIMARY KEY, total REAL);
    CREATE TRIGGER sales_money_precision_update_0161 AFTER UPDATE ON sales BEGIN SELECT 1; END;
    CREATE INDEX idx_inventory_check_items ON sales (total);
  `)
  let scans = 0
  const db = new D1Compat(raw)
  const prepare = db.prepare.bind(db)
  db.prepare = (sql) => { if (sql.includes('sqlite_master')) scans += 1; return prepare(sql) }
  return { raw, db, scans: () => scans }
}

const oldAnswer = (raw, object) => {
  const sql = object.kind === 'any' ? 'SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?' : 'SELECT COUNT(*) AS n FROM sqlite_master WHERE type = ? AND name = ?'
  const row = object.kind === 'any' ? raw.prepare(sql).get(object.name) : raw.prepare(sql).get(object.kind, object.name)
  return row.n > 0
}

async function main() {
  const probe = loadProbe()

  const cases = [
    { kind: 'table', name: 'system_flags' },
    { kind: 'table', name: 'telegram_scheduled_sends' },
    { kind: 'table', name: 'SYSTEM_FLAGS' },
    { kind: 'table', name: 'Sales' },
    { kind: 'trigger', name: 'sales_money_precision_update_0161' },
    { kind: 'trigger', name: 'transfer_receipts_require_provenance_insert' },
    { kind: 'trigger', name: 'SALES_MONEY_PRECISION_UPDATE_0161' },
    { kind: 'table', name: 'sales_money_precision_update_0161' },
    { kind: 'trigger', name: 'sales' },
    { kind: 'table', name: 'idx_inventory_check_items' },
    { kind: 'any', name: 'idx_inventory_check_items' },
    { kind: 'any', name: 'inventory_check_sessions' },
  ]
  for (const object of cases) {
    const w = world()
    probe.resetSchemaObjectProbeForTests()
    assert.equal(await probe.schemaObjectPresent(w.db, object), oldAnswer(w.raw, object), `same answer as the per-object probe: ${JSON.stringify(object)}`)
  }

  {
    const w = world()
    probe.resetSchemaObjectProbeForTests()
    const fees = [{ kind: 'table', name: 'fee_operation_receipts' }, { kind: 'trigger', name: 'transfer_receipts_require_provenance_insert' }]
    assert.equal(await probe.schemaObjectsPresent(w.db, fees), false, 'one of two missing is not ready (the old count === 2)')
    w.raw.exec('CREATE TABLE transfer_receipts (id INTEGER); CREATE TRIGGER transfer_receipts_require_provenance_insert BEFORE INSERT ON transfer_receipts BEGIN SELECT 1; END;')
    assert.equal(await probe.schemaObjectsPresent(w.db, fees), true, 'a miss is re-probed, so a migration that lands later is seen')
  }

  {
    const w = world()
    probe.resetSchemaObjectProbeForTests()
    assert.equal(await probe.schemaObjectPresent(w.db, { kind: 'table', name: 'system_flags' }), true)
    const afterFirst = w.scans()
    assert.equal(afterFirst, 1)
    assert.equal(await probe.schemaObjectPresent(w.db, { kind: 'trigger', name: 'sales_money_precision_update_0161' }), true, 'a different declared object is already answered by the first scan')
    assert.equal(await probe.schemaObjectPresent(w.db, { kind: 'table', name: 'fee_operation_receipts' }), true)
    assert.equal(w.scans(), afterFirst, 'positive answers cost no further scan')
    assert.equal(await probe.schemaObjectPresent(w.db, { kind: 'table', name: 'telegram_scheduled_sends' }), false)
    assert.equal(await probe.schemaObjectPresent(w.db, { kind: 'table', name: 'telegram_scheduled_sends' }), false)
    assert.equal(w.scans(), afterFirst + 2, 'a missing object is probed again every time')
    probe.forgetSchemaNames(['system_flags'])
    w.raw.exec('DROP TABLE system_flags')
    assert.equal(await probe.schemaObjectPresent(w.db, { kind: 'table', name: 'system_flags' }), false, 'a forgotten answer is re-read')
  }

  {
    const w = world()
    probe.resetSchemaObjectProbeForTests()
    const seen = []
    const prepare = w.db.prepare
    w.db.prepare = (sql) => { seen.push(sql); return prepare(sql) }
    await probe.schemaObjectPresent(w.db, { kind: 'table', name: 'system_flags' })
    assert.equal(seen.length, 1)
    assert.match(seen[0], /name IN \(SELECT value FROM json_each\(@names\)\)/, 'the exact combined form already used by coreDataInvariants')
    assert.doesNotMatch(seen[0], /pragma_table_list/i, 'pragma_table_list is undocumented on D1 and case-insensitive')
  }

  {
    const w = world()
    probe.resetSchemaObjectProbeForTests()
    let once = 0
    const db = { prepare: (sql) => { const s = w.db.prepare(sql); return { all: (p) => s.all(p), allOnce: (p) => { once += 1; return s.all(p) } } } }
    await probe.schemaObjectPresent(db, { kind: 'table', name: 'system_flags' }, { once: true })
    assert.equal(once, 1, 'the import fence keeps its no-retry read')
  }

  const files = []
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) { if (entry.name !== 'migrations') walk(p) } else if (p.endsWith('.ts')) files.push(p) } }
  walk(SRC)
  const known = new Set(loadProbe().KNOWN_SCHEMA_OBJECT_NAMES)
  const OWNED_ELSEWHERE = new Set(['lib/stockSession.ts'])
  const used = new Set()
  const leftovers = []
  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/')
    if (rel === 'lib/schemaObjectProbe.ts') continue
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/kind: '(?:table|trigger|any)', name: '([a-z0-9_]+)'/g)) used.add(m[1])
    const anyList = text.match(/anyObjects\(\[([^\]]*)\]\)/g) || []
    for (const list of anyList) for (const m of list.matchAll(/'([a-z0-9_]+)'/g)) used.add(m[1])
    if (/FROM sqlite_master\s+WHERE[^`"]*\bname\s*=\s*(?:'|@|\?)/.test(text) && !OWNED_ELSEWHERE.has(rel)) leftovers.push(rel)
  }
  for (const name of used) assert.ok(known.has(name), `${name} is asked about by a probe site but missing from KNOWN_SCHEMA_OBJECT_NAMES (its probe would cost its own scan)`)
  assert.ok(used.size >= 20, 'the sites were found')
  assert.deepEqual(leftovers, [], 'no per-object sqlite_master probe remains outside the files another lane owns')

  console.log('PASS schemaObjectProbe: exact per-object answers (present, missing table, missing trigger, wrong kind, case variants), one scan for many objects, misses re-probed, every site declared')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
