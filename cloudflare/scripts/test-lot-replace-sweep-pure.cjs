// The gate refuses, in code, any statement that replaces a product_batches row (REPLACE INTO, INSERT OR REPLACE INTO,
// UPDATE OR REPLACE), and any generic builder that could. Why: REPLACE's implicit delete fires no delete trigger and can orphan
// positive branch stock; migration 0320 drops the per-insert orphan scan of 0155, so the Worker refuses the statement
// (lib/db.ts guardD1, scripts/test-lot-replace-guard-pure.cjs) and this test refuses it in the repository.
//
// Scans cloudflare/src, cloudflare/migrations (from 0320 on: earlier files are frozen), ops/ and cloudflare/scripts for
//   A. a literal replacing write to product_batches (any case, spacing, schema prefix, quoting);
//   B. a generic builder with a variable table or a variable conflict clause: REPLACE INTO ${...}, OR REPLACE INTO ${...},
//      UPDATE OR REPLACE ${...}, INSERT ${...}, INSERT OR ${...}.
// A hit is only allowed in a file listed below with its reason, and a listed file must still hit (a stale entry is red).
// The one generic builder that can reach product_batches (the held-0200 oracle fixture emitter) is excluded with its own test.
// Mutation hook: SWEEP_EXTRA_FILE adds one more file to the scan (the mutant tests write a file with a replacing builder).
// Run: node scripts/test-lot-replace-sweep-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const ROOT = path.join(__dirname, '../..')
const FIRST_SCANNED_MIGRATION = '0320'
const EXT = /\.(?:ts|cjs|mjs|js|sql|sh|ps1)$/
const SKIP_DIR = new Set(['node_modules', '.wrangler', 'dist', '.git'])

const TABLE = String.raw`(?:["'\`\[]?\w+["'\`\]]?\s*\.\s*)?["'\`\[]?product_batches\b`
const LITERAL = new RegExp(String.raw`\b(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO\s+` + TABLE + String.raw`|\bUPDATE\s+OR\s+REPLACE\s+` + TABLE, 'i')
const BUILDERS = [
  ['REPLACE INTO <variable>', new RegExp(String.raw`\bREPLACE\s+INTO\s+["'\`]?\$\{`, 'i')],
  ['UPDATE OR REPLACE <variable>', new RegExp(String.raw`\bUPDATE\s+OR\s+REPLACE\s+["'\`]?\$\{`, 'i')],
  ['INSERT <variable conflict clause>', new RegExp(String.raw`\bINSERT\s+(?:OR\s+)?\$\{`, 'i')],
  ['INSERT OR REPLACE INTO <variable>', new RegExp(String.raw`\bOR\s+REPLACE\s+INTO\s+["'\`]?\$\{`, 'i')],
]

// file (relative to the repository root) -> why a hit is acceptable. Each runs on a local SQLite database, never through the Worker.
const ALLOWED = {
  'cloudflare/scripts/test-lot-replace-guard-pure.cjs': { literal: true, why: 'the guard test: its fixtures are the statements the Worker must refuse' },
  'cloudflare/scripts/test-lot-replace-sweep-pure.cjs': { literal: true, builder: true, why: 'this test: its fixtures and patterns' },
  'cloudflare/scripts/test-positive-lot-parent-identity-guard-pure.cjs': { literal: true, why: 'raw SQLite proof of what 0155 did before 0320 (applies 0155 alone on the pre-0155 schema)' },
  'cloudflare/scripts/test-positive-lot-activation-invariant-pure.cjs': { literal: true, why: 'raw SQLite proof that the 0154 triggers refuse a replacing write' },
  'cloudflare/scripts/test-product-active-stock-invariant-sqlite.cjs': { literal: true, why: 'raw SQLite proof that the 0154 triggers refuse a replacing write' },
  'cloudflare/scripts/test-migration-0320-lot-insert-guard-pure.cjs': { literal: true, why: 'raw SQLite proof that the update-orphan trigger kept by 0320 still refuses UPDATE OR REPLACE' },
  'cloudflare/scripts/test-held-0200-sale-cost-oracle-pure.cjs': { builder: true, why: 'fixture emitter: INSERT OR REPLACE INTO ${t} over a fixed list of tables; product_batches takes an upsert (exclusion test below)' },
  'cloudflare/scripts/test-branch-cutover-journal-native.cjs': { builder: true, why: "INSERT ${replace ? 'OR REPLACE ' : ''}INTO branch_cutovers: a fixed table in a local database" },
  'cloudflare/scripts/test-lot-replace-migration-native.cjs': { literal: true, why: 'the migration test: proves the Worker guard, not the database, is what stops a replace after 0320' },
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (EXT.test(entry.name)) out.push(full)
  }
  return out
}
function scannedFiles() {
  const files = []
  for (const dir of ['cloudflare/src', 'ops', 'cloudflare/scripts']) files.push(...walk(path.join(ROOT, dir)))
  for (const name of fs.readdirSync(path.join(ROOT, 'cloudflare/migrations'))) {
    if (EXT.test(name) && name.slice(0, 4) >= FIRST_SCANNED_MIGRATION) files.push(path.join(ROOT, 'cloudflare/migrations', name))
  }
  if (process.env.SWEEP_EXTRA_FILE) files.push(path.resolve(process.env.SWEEP_EXTRA_FILE))
  return files
}
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/')
function hits(file) {
  const text = fs.readFileSync(file, 'utf8')
  return { literal: LITERAL.test(text), builder: BUILDERS.filter(([, re]) => re.test(text)).map(([name]) => name) }
}

let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }

const found = scannedFiles().map((file) => ({ file, name: rel(file), ...hits(file) }))

check('the scan covers the source, scripts, ops and the new migrations', () => {
  const names = found.map((f) => f.name)
  for (const must of ['cloudflare/src/lib/db.ts', 'cloudflare/src/lib/backup.ts', 'cloudflare/src/lib/importEngine.ts', 'ops/scripts/migration/held/revert_set_sk2_cleanser_repair.sql',
    'cloudflare/scripts/test-lot-replace-sweep-pure.cjs']) assert(names.includes(must), `not scanned: ${must}`)
  assert(found.length > 1500, `only ${found.length} files scanned`)
  assert(!names.some((n) => /^cloudflare\/migrations\/0(?:0|1|2|30|31[0-9])/.test(n)), 'frozen migrations are not scanned')
})
check('no file replaces a product_batches row, except the listed fixtures', () => {
  const bad = found.filter((f) => f.literal && !(ALLOWED[f.name] && ALLOWED[f.name].literal))
  assert.deepEqual(bad.map((f) => f.name), [], 'a replacing write to product_batches')
})
check('no generic builder can replace a row of any table, except the listed fixtures', () => {
  const bad = found.filter((f) => f.builder.length && !(ALLOWED[f.name] && ALLOWED[f.name].builder))
  assert.deepEqual(bad.map((f) => `${f.name}: ${f.builder.join(', ')}`), [], 'a REPLACE or variable conflict clause with a variable table')
})
check('every allowed entry still hits (no stale exclusions) and Worker, migration and ops sources never appear in it', () => {
  for (const [name, entry] of Object.entries(ALLOWED)) {
    assert(!/^cloudflare\/(?:src|migrations)\//.test(name) && !name.startsWith('ops/'), `${name}: the Worker, migrations and ops have no exclusions`)
    const f = found.find((x) => x.name === name)
    if (!f) { assert(name.endsWith('test-lot-replace-migration-native.cjs'), `${name} no longer exists`); continue }
    if (entry.literal) assert(f.literal, `${name}: listed for a literal replace it no longer has`)
    if (entry.builder) assert(f.builder.length > 0 || name.endsWith('sweep-pure.cjs'), `${name}: listed for a builder it no longer has`)
  }
})
check('the generic writers of the Worker are plain INSERT only (backup restore, product writes, import, stock session, contacts, lookups)', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
  const generic = [
    ['cloudflare/src/lib/backup.ts', /insertSql = `INSERT INTO \$\{qid\(ev\.table\)\}/],
    ['cloudflare/src/lib/productWrites.ts', /sql: `INSERT INTO "\$\{table\}"/],
    ['cloudflare/src/lib/importEngine.ts', /sql: `INSERT INTO "\$\{table\}"/],
    ['cloudflare/src/lib/stockSession.ts', /sql: `INSERT INTO \$\{table\}\(/],
    ['cloudflare/src/lib/contactDuplicates.ts', /sql: `INSERT INTO \$\{table\} \(id, name\)/],
    ['cloudflare/src/routes/contacts.ts', /sql: `INSERT INTO \$\{config\.table\}/],
    ['cloudflare/src/routes/lookups.ts', /INSERT INTO \$\{table\} \(name, color, updated_at\)/],
  ]
  for (const [file, re] of generic) assert(re.test(read(file)), `${file}: the generic insert is no longer the plain INSERT this test pins`)
})
check('exclusion: the held-0200 fixture emitter writes product_batches by upsert, never REPLACE, and the rows land the same', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lot-sweep-'))
  try {
    const run = spawnSync(process.execPath, [path.join(__dirname, 'test-held-0200-sale-cost-oracle-pure.cjs'), '--emit', dir], { encoding: 'utf8', timeout: 120000 })
    assert.equal(run.status, 0, run.stderr)
    const sql = fs.readFileSync(path.join(dir, 'fixture.sql'), 'utf8')
    const lines = sql.split('\n').filter((l) => /\bproduct_batches\b/.test(l))
    assert(lines.length > 0, 'the fixture has lots')
    for (const line of lines) {
      assert(!/REPLACE/i.test(line), `a REPLACE reached product_batches: ${line.slice(0, 120)}`)
      assert(/^INSERT INTO product_batches\(.*\) ON CONFLICT\(id\) DO UPDATE SET /.test(line), line.slice(0, 120))
    }
    assert(/INSERT OR REPLACE INTO products\(/.test(sql), 'the other tables keep their original statement')
    // The upsert is idempotent and keeps one row per id.
    const db = new DatabaseSync(':memory:')
    const cols = [...lines[0].matchAll(/^INSERT INTO product_batches\(([^)]*)\)/g)][0][1].split(',').map((c) => c.trim())
    db.exec(`CREATE TABLE product_batches(${cols.map((c) => (c === 'id' ? 'id INTEGER PRIMARY KEY' : c)).join(', ')})`)
    for (let pass = 0; pass < 2; pass++) for (const line of lines) db.exec(line)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM product_batches').get().n, lines.length)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
check('the matchers see every spelling, and ignore the neighbours', () => {
  for (const sql of ['REPLACE INTO product_batches(id) VALUES(1)', 'insert  or\treplace\ninto main.product_batches(id)', 'INSERT OR REPLACE INTO "main"."product_batches"(id)',
    'INSERT OR REPLACE INTO `product_batches`(id)', 'INSERT OR REPLACE INTO [product_batches](id)', 'UPDATE OR REPLACE product_batches SET x=1']) assert(LITERAL.test(sql), sql)
  for (const sql of ['INSERT OR IGNORE INTO product_batches(id)', 'INSERT INTO product_batches(id) VALUES(1) ON CONFLICT(id) DO UPDATE SET x=1', 'INSERT OR REPLACE INTO settings(key)',
    'REPLACE INTO product_batches_archive(id)', 'replace(batch_key, 1, 2) FROM product_batches']) assert(!LITERAL.test(sql), sql)
  for (const text of ['`INSERT OR REPLACE INTO ${t}(a)`', 'REPLACE INTO "${table}"(a)', 'UPDATE OR REPLACE ${t} SET', '`INSERT ${verb} INTO x`', '`INSERT OR ${verb} INTO x`']) {
    assert(BUILDERS.some(([, re]) => re.test(text)), text)
  }
  for (const text of ['`INSERT INTO ${t}(a)`', '`INSERT OR IGNORE INTO ${t}(a)`', '`SELECT replace(${x}, 1, 2)`']) assert(!BUILDERS.some(([, re]) => re.test(text)), text)
})
console.log(`${passed} lot replace sweep checks passed`)
