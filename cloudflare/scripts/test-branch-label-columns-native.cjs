// Companion for cloudflare/migrations/0236_branch_history_label_columns.sql
// (cutover lane LA; design G12-HISTORY-UNDO-DESIGN.md sections 3.4 and 4.2 F7).
//
// Real chain, real SQLite at D1's limits, each file applied in one transaction
// as D1 does. The live database already holds 0001-0226 (+0229 in this
// release), so the populated world is the chain before 0236 plus live-shaped
// rows in every table 0236 touches. Checks:
//   1. text: LF only, exactly four nullable TEXT ADD COLUMNs, *_name never
//      *_branch_id, none of them already added by 0001/0116/0226;
//   2. populated apply: every existing row keeps every value, the four new
//      columns read NULL on every row, no other table or schema object changes,
//      and the header's pre/post queries return what the header says;
//   3. existing readers unchanged: the fees detail query (SELECT f.*, ...,
//      b.name AS branch_name) mapped exactly the way workerd maps a D1 row
//      returns the same object before and after; a control with the alias
//      BEFORE f.* returns NULL after, proving the fixture discriminates; and a
//      source sweep finds no reader that puts a colliding alias before a star;
//   4. no writer inserts positionally into the four tables, and an explicit
//      column insert (every writer's shape) leaves the label NULL;
//   5. cutover capture: still exactly 32 scalar branch references, no
//      unclassified reference, and the new columns are visible to capture;
//   6. re-apply refuses on the first statement with nothing applied (an ADD
//      COLUMN cannot be repeated; D1 never re-runs an applied file);
//   7. the header's recovery statements restore the pre-0236 schema and rows.
//
// Run (from cloudflare/): node scripts/test-branch-label-columns-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const MIGRATION = '0236_branch_history_label_columns.sql'
const migrationsDir = path.join(root, 'migrations')
const chain = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const chainText = (file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8')
const labelSql = chainText(MIGRATION)
const NEW_COLUMNS = [['fees', 'branch_name'], ['product_batches', 'received_branch_name'],
  ['inventory_movements', 'addressed_branch_name'], ['returns', 'addressed_branch_name']]

function modules() {
  const cache = new Map()
  function load(name) {
    name = path.posix.normalize(name.endsWith('.ts') ? name : name + '.ts')
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }; cache.set(name, module)
    const js = ts.transpileModule(fs.readFileSync(path.join(root, 'src', name), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    new Function('require', 'module', 'exports', js)((request) => {
      assert.ok(request.startsWith('.'), request)
      return load(path.posix.join(path.posix.dirname(name), request))
    }, module, module.exports)
    return module.exports
  }
  return load
}

function open() {
  const raw = new DatabaseSync(':memory:')
  raw.limits.exprDepth = 100
  raw.limits.variableNumber = 100
  return raw
}
function applyAtomic(raw, sql) {
  raw.exec('BEGIN')
  try { raw.exec(sql); raw.exec('COMMIT') } catch (error) { raw.exec('ROLLBACK'); throw error }
}
const sqlOnly = (text) => text.replace(/--[^\n]*/g, '')

function populated() {
  const raw = open()
  for (const file of chain.filter((f) => f < MIGRATION)) applyAtomic(raw, chainText(file))
  raw.exec(`
    INSERT INTO branches(id,name,is_default,is_active,created_at) VALUES(1,'Warehouse',0,1,'2025-11-02 09:15:00'),(2,'Shop',1,1,'2025-11-02 09:15:00');
    INSERT INTO products(id,name,barcode,cost_price_usd,stock_quantity,is_active) VALUES(11,'Rose Serum 30ml','8850000000011',4.25,9,1),(12,'Lip Tint ១២','8850000000012',1.5,3,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(11,1,4),(11,2,5),(12,2,3);
    INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,received_quantity,received_branch_id,supplier_name)
      VALUES(101,11,'09202026','2026-09-20',4.25,9,2,'Supplier A'),(102,12,'09212026','2026-09-21',1.5,3,1,NULL);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(101,1,4),(101,2,5),(102,2,3);
    INSERT INTO sales(id,receipt_number,branch_id,branch_name,total_usd,subtotal_usd,sale_status,created_at) VALUES(501,'R-20261005-0001',2,'Shop',12,12,'completed','2026-10-05 10:00:00');
    INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,applied_price_usd,cost_price_usd,total_usd,branch_id,batch_id) VALUES(601,501,11,'Rose Serum 30ml',1,12,4.25,12,2,101);
    INSERT INTO inventory_movements(id,product_id,branch_id,branch_name,movement_type,quantity,reference_id,batch_id,reason,created_at)
      VALUES(701,11,2,'Shop','sale',-1,501,101,NULL,'2026-10-05 10:00:00'),(702,12,1,'','stock_in',3,NULL,102,'Receive ទំនិញ','2026-09-21 08:00:00');
    INSERT INTO returns(id,return_number,sale_id,branch_id,branch_name,total_refund_usd,created_at) VALUES(901,'RT-0001',501,2,'Shop',4.5,'2026-10-05 11:00:00');
    INSERT INTO fees(fee_type,label,amount_usd,amount_khr,fee_date,sale_id,branch_id,notes) VALUES('delivery','Grab',1.5,6000,'2026-10-05',501,2,'ថ្លៃដឹក');
  `)
  return raw
}
function completeState(raw) {
  const quote = (name) => `"${name.replaceAll('"', '""')}"`
  const schema = raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map((r) => ({ ...r }))
  const tables = {}
  for (const { name } of raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    const columns = raw.prepare(`PRAGMA table_info(${quote(name)})`).all().map((c) => c.name)
    if (!columns.length) continue
    tables[name] = raw.prepare(`SELECT ${columns.map((c) => `quote(${quote(c)}) AS ${quote(c)}`).join(',')} FROM ${quote(name)}`).all()
      .map((row) => JSON.stringify(Object.entries(row))).sort()
  }
  return { schema, tables }
}
// workerd's D1 binding (toArrayOfObjects): Object.fromEntries(row.map((cell, i) => [columns[i], cell])).
function d1All(raw, sql, params) {
  const statement = raw.prepare(sql)
  statement.setReturnArrays(true)
  const columns = statement.columns().map((c) => c.name)
  return statement.all(params).map((row) => Object.fromEntries(row.map((cell, i) => [columns[i], cell])))
}

let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.log(`FAIL ${name} - ${error.stack}`) }
}

async function main() {
  await check('text: LF only, exactly four nullable TEXT ADD COLUMNs named *_name, none already present', () => {
    assert.ok(!labelSql.includes('\r'), 'LF only')
    const statements = sqlOnly(labelSql).split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
    assert.deepEqual(statements, NEW_COLUMNS.map(([t, c]) => `ALTER TABLE ${t} ADD COLUMN ${c} TEXT`))
    for (const [, column] of NEW_COLUMNS) assert.ok(column.endsWith('_name') && !/branch_id$/.test(column))
    const raw = open()
    for (const file of chain.filter((f) => f < MIGRATION)) raw.exec(chainText(file))
    for (const [table, column] of NEW_COLUMNS) {
      assert.equal(raw.prepare(`SELECT COUNT(*) n FROM pragma_table_info('${table}') WHERE name = ?`).get(column).n, 0, `${table}.${column} not yet present`)
    }
    for (const [table, column] of [['stock_transfers', 'from_branch_name'], ['stock_transfers', 'to_branch_name'], ['stock_session_members', 'branch_name'],
      ['inventory_movements', 'branch_name'], ['returns', 'branch_name'], ['shift_sessions', 'branch_name']]) {
      assert.equal(raw.prepare(`SELECT COUNT(*) n FROM pragma_table_info('${table}') WHERE name = ?`).get(column).n, 1, `${table}.${column} already exists and is not re-added`)
    }
    raw.close()
  })

  await check('populated apply: existing rows byte-identical, new columns NULL everywhere, nothing else changes; header pre/post hold', () => {
    const raw = populated()
    const header = (expected) => {
      for (const [table, column] of NEW_COLUMNS) assert.equal(raw.prepare(`SELECT COUNT(*) n FROM pragma_table_info('${table}') WHERE name = '${column}'`).get().n, expected, `${table}.${column}`)
    }
    header(0)
    const counts = NEW_COLUMNS.map(([t]) => raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n)
    assert.ok(counts.every((n) => n > 0), 'fixture: every touched table has rows')
    const s0 = completeState(raw)
    applyAtomic(raw, labelSql)
    header(1)
    assert.deepEqual(NEW_COLUMNS.map(([t]) => raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n), counts, 'row counts unchanged')
    for (const [table, column] of NEW_COLUMNS) {
      assert.equal(raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column} IS NOT NULL`).get().n, 0, `${table}.${column} NULL on every row`)
      const info = raw.prepare(`SELECT type, "notnull" nn, dflt_value d FROM pragma_table_info('${table}') WHERE name = ?`).get(column)
      assert.deepEqual({ ...info }, { type: 'TEXT', nn: 0, d: null }, `${table}.${column} is nullable TEXT with no default`)
    }
    const s1 = completeState(raw)
    const touched = new Set(NEW_COLUMNS.map(([t]) => t))
    for (const table of Object.keys(s0.tables)) {
      if (!touched.has(table)) { assert.deepEqual(s1.tables[table], s0.tables[table], `${table} unchanged`); continue }
      const column = NEW_COLUMNS.find(([t]) => t === table)[1]
      const stripped = s1.tables[table].map((row) => {
        const entries = JSON.parse(row)
        const label = entries.find(([key]) => key === column)
        assert.equal(label[1], 'NULL')
        return JSON.stringify(entries.filter(([key]) => key !== column))
      }).sort()
      assert.deepEqual(stripped, s0.tables[table], `${table}: every existing column of every row byte-identical`)
    }
    const changedObjects = s1.schema.filter((o) => !s0.schema.some((p) => JSON.stringify(p) === JSON.stringify(o))).map((o) => o.name)
    assert.deepEqual(changedObjects.sort(), [...touched].sort(), 'only the four tables\' definitions change')
    const mentions = raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('index','trigger','view') AND (sql LIKE '%received_branch_name%' OR sql LIKE '%addressed_branch_name%' OR (tbl_name='fees' AND sql LIKE '%branch_name%'))").all()
    assert.deepEqual(mentions, [], 'no index, trigger or view names the new columns')
    raw.close()
  })

  await check('existing readers unchanged: fees detail as D1 maps it; alias-before-star control discriminates', () => {
    // CUTOVER-LD: the fees reader is snapshot-first (fees.branch_name, else the live name), so it names fees.branch_name.
    // The pre-0236 form of the same reader is the live-name one; the new reader must return the identical object for
    // a row with no label, and prefer the label once there is one.
    const source = fs.readFileSync(path.join(root, 'src/routes/fees.ts'), 'utf8')
    const helper = /const branchHistoryNameSql = \(snapshot: string, fallback: string\): string =>\r?\n\s*`([^`]*)`/.exec(source)
    assert.ok(helper, 'routes/fees.ts carries the snapshot-first expression')
    const feeExpression = helper[1].replaceAll('${snapshot}', 'f.branch_name').replaceAll('${fallback}', 'b.name')
    const detailTemplate = [...source.matchAll(/`(\s*SELECT f\.\*, s\.receipt_number AS sale_receipt_number, \$\{FEE_BRANCH_NAME_SQL\} AS branch_name,[\s\S]*?)`/g)]
      .map((m) => m[1]).find((sql) => /WHERE f\.id = @id\s*$/.test(sql))
    assert.ok(detailTemplate, 'found the fees detail reader in routes/fees.ts')
    const detail = detailTemplate.replace('${FEE_BRANCH_NAME_SQL}', feeExpression)
    const legacy = detailTemplate.replace('${FEE_BRANCH_NAME_SQL}', 'b.name')
    const control = legacy.replace('SELECT f.*, s.receipt_number AS sale_receipt_number, b.name AS branch_name,', 'SELECT b.name AS branch_name, f.*, s.receipt_number AS sale_receipt_number,')
    assert.notEqual(control, legacy)
    const raw = populated()
    const id = raw.prepare('SELECT id FROM fees WHERE notes = ?').get('ថ្លៃដឹក').id
    const [before] = d1All(raw, legacy, { id })
    const [controlBefore] = d1All(raw, control, { id })
    assert.equal(before.branch_name, 'Shop')
    assert.equal(controlBefore.branch_name, 'Shop')
    applyAtomic(raw, labelSql)
    const [afterRow] = d1All(raw, detail, { id })
    assert.deepEqual(afterRow, before, 'the fees reader returns the same object (same keys, same live branch name) for a row with no label')
    assert.equal(d1All(raw, control, { id })[0].branch_name, null, 'control: an alias placed before f.* would now read the NULL label')
    raw.exec("UPDATE fees SET branch_name='Shop (at the time)'")
    raw.exec("UPDATE branches SET name='Old Shop' WHERE name='Shop'")
    assert.equal(d1All(raw, detail, { id })[0].branch_name, 'Shop (at the time)', 'a labelled fee keeps its label after the branch is renamed')
    raw.close()
  })

  await check('source sweep: no SQL puts a colliding alias before a star of the same table; known fees sites found', () => {
    const files = []
    const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full); else if (/\.ts$/.test(entry.name)) files.push(full)
    } }
    walk(path.join(root, 'src'))
    const collide = { fees: 'branch_name', product_batches: 'received_branch_name', inventory_movements: 'addressed_branch_name', returns: 'addressed_branch_name' }
    const safe = [], unsafe = []
    const scan = (file, text) => {
      for (const match of text.matchAll(/SELECT\s+([\s\S]{0,1500}?)\s+FROM\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
        const [, list, table, alias] = match
        const column = collide[table.toLowerCase()]
        if (!column) continue
        const star = new RegExp(`(^|[\\s,])(${alias || table}\\.)?\\*`).exec(list)
        const aliased = new RegExp(`\\bAS\\s+${column}\\b`, 'i').exec(list)
        if (!star || !aliased) continue
        const where = `${path.relative(root, file).replaceAll('\\', '/')}:${text.slice(0, match.index).split('\n').length}`
        ;(aliased.index > star.index ? safe : unsafe).push(where)
      }
    }
    scan(path.join(root, 'src/planted-control.ts'), 'db.prepare(`SELECT b.name AS addressed_branch_name, r.* FROM returns r JOIN branches b ON b.id = r.branch_id`)')
    assert.deepEqual(unsafe, ['src/planted-control.ts:1'], 'negative control: a planted alias-before-star reader is flagged')
    unsafe.length = 0
    for (const file of files) scan(file, fs.readFileSync(file, 'utf8'))
    assert.deepEqual(unsafe, [], 'a colliding alias before the star would be overwritten by the new NULL column')
    assert.ok(safe.filter((s) => s.startsWith('src/routes/fees.ts:')).length >= 2, `positive control: the two fees readers are found (${safe.join(', ')})`)
  })

  await check('writers: no positional insert into the four tables; an explicit-column insert leaves the label NULL', () => {
    const offenders = []
    const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.ts$/.test(entry.name) && /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:fees|product_batches|inventory_movements|returns)\s+(?:VALUES|SELECT)\b/i.test(fs.readFileSync(full, 'utf8'))) offenders.push(full)
    } }
    walk(path.join(root, 'src'))
    assert.deepEqual(offenders, [])
    const raw = populated()
    applyAtomic(raw, labelSql)
    raw.exec(`INSERT INTO inventory_movements(product_id,branch_id,branch_name,movement_type,quantity,batch_id) VALUES(11,1,'Warehouse','adjustment',1,101);
      INSERT INTO fees(fee_type,amount_usd,fee_date,branch_id) VALUES('other',2,'2026-10-06',1);`)
    assert.equal(raw.prepare('SELECT addressed_branch_name v FROM inventory_movements ORDER BY id DESC LIMIT 1').get().v, null)
    assert.equal(raw.prepare('SELECT branch_name v FROM fees ORDER BY id DESC LIMIT 1').get().v, null)
    raw.close()
  })

  await check('cutover capture: still 32 scalar branch references, none unclassified, new columns visible to capture', async () => {
    const load = modules()
    const capture = load('lib/branchCutoverCapture')
    const { D1Compat } = load('lib/db')
    assert.equal(capture.BRANCH_SCALAR_REFERENCES.length, 32)
    const raw = open()
    for (const file of chain) applyAtomic(raw, chainText(file))
    raw.limits.functionArg = 100
    const prepared = (sql, values = []) => ({
      bind: (...v) => prepared(sql, v),
      all: async () => ({ success: true, results: raw.prepare(sql).all(...(/\?\d/.test(sql) ? [Object.fromEntries(values.map((v, i) => [String(i + 1), v]))] : values)), meta: { changes: 0 } }),
    })
    const schema = await capture.readCutoverCaptureSchema(new D1Compat({ prepare: prepared, batch: async () => { throw Error('read only') } }))
    assert.deepEqual(schema.capabilities.filter((c) => c.code === 'unclassified_scalar_reference'), [])
    for (const [table, column] of NEW_COLUMNS) assert.ok(schema.columns[table]?.includes(column), `${table}.${column} is captured with its row`)
    raw.close()
  })

  await check('re-apply refuses at the first statement with nothing applied', () => {
    const raw = populated()
    applyAtomic(raw, labelSql)
    const state = completeState(raw)
    assert.throws(() => applyAtomic(raw, labelSql), /duplicate column name: branch_name/)
    assert.deepEqual(completeState(raw), state)
    raw.close()
  })

  await check("the header's recovery statements restore the pre-0236 schema and every row", () => {
    const recovery = labelSql.split('\n').filter((line) => /^--\s+ALTER TABLE \w+ DROP COLUMN \w+;$/.test(line)).map((line) => line.replace(/^--\s+/, ''))
    assert.equal(recovery.length, 4, 'one DROP COLUMN per added column')
    const raw = populated()
    const s0 = completeState(raw)
    applyAtomic(raw, labelSql)
    applyAtomic(raw, recovery.join('\n'))
    assert.deepEqual(completeState(raw), s0)
    raw.close()
  })

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED: ${failures.join('; ')}` : ''}`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exit(1) })
