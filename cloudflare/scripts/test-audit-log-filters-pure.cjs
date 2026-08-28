// Audit-log filtering (I2) -- lib/auditLogQuery.ts + the compat.ts wiring.
//
// The bug this closes: AuditLog.tsx has been sending search/action/userId/
// startDate/endDate since its filters were built, and GET /system/audit-logs
// read only page/pageSize -- with no client-side filtering either, every
// filter control on the page was DEAD. Independently confirmed by a second
// session before the fix.
//
// Behavioral checks run the REAL compiled clause builder against the REAL
// audit_logs schema (lifted from 0001_init.sql) in better-sqlite3, through
// the same SELECT shape compat.ts executes. Source pins hold the wiring:
// COUNT shares the WHERE (pagination agrees with the filtered set), the
// vocabularies are whole-table, and the old silent-empty catch (db error ->
// empty 200 that read as "no logs") is gone.
//
// Run: node scripts/test-audit-log-filters-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const cloudflareRoot = path.join(__dirname, '..')
let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// ---- compile the real module ----------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-query-'))
const tsPath = path.join(tmpDir, 'auditLogQuery.ts')
fs.writeFileSync(tsPath, fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'auditLogQuery.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { buildAuditLogFilters } = require(path.join(tmpDir, 'auditLogQuery.js'))

// ---- real schema ----------------------------------------------------------
const initSql = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0001_init.sql'), 'utf8')
const createStart = initSql.indexOf('CREATE TABLE audit_logs')
assert.ok(createStart > 0, 'audit_logs CREATE TABLE found in 0001_init.sql')
const createAuditLogs = initSql.slice(createStart, initSql.indexOf(';', createStart) + 1)
const db = new Database(':memory:')
db.exec(createAuditLogs)

const insert = db.prepare(`
  INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, new_value, device_name, created_at)
  VALUES (@user_id, @user_name, @action, @entity, @entity_id, @details, @table_name, @record_id, @new_value, @device_name, @created_at)
`)
const rows = [
  { user_id: 1, user_name: 'Meng', action: 'create', entity: 'product', entity_id: '10', details: 'Dior 999', table_name: 'product', record_id: '10', new_value: '{"name":"Dior 999"}', device_name: 'POS 1', created_at: '2026-08-01T09:00:00.000Z' },
  { user_id: 1, user_name: 'Meng', action: 'update', entity: 'product', entity_id: '10', details: 'price 100% adjusted', table_name: 'product', record_id: '10', new_value: '{"price":12}', device_name: 'POS 1', created_at: '2026-08-10T09:00:00.000Z' },
  { user_id: 2, user_name: 'Sok', action: 'delete', entity: 'fee', entity_id: '7', details: null, table_name: 'fee', record_id: '7', new_value: null, device_name: 'Office', created_at: '2026-08-15T09:00:00.000Z' },
  { user_id: 2, user_name: 'Sok', action: 'restore', entity: null, entity_id: null, details: 'backup restore', table_name: 'backup', record_id: 'b-1', new_value: null, device_name: 'Office', created_at: '2026-08-20T09:00:00.000Z' },
  { user_id: 3, user_name: 'សុភា', action: 'CREATE', entity: 'sale', entity_id: '55', details: 'receipt 001', table_name: 'sale', record_id: '55', new_value: null, device_name: 'POS 2', created_at: '2026-08-28T09:00:00.000Z' },
]
for (const row of rows) insert.run(row)

// The exact production SELECT shape (compat.ts) with the built clause.
function run(input, page = 1, pageSize = 50) {
  const { where, params } = buildAuditLogFilters(input)
  const items = db.prepare(`
    SELECT id, user_id, user_name, action, entity, table_name, created_at
    FROM audit_logs
    ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT @pageSize OFFSET @offset
  `).all({ ...params, pageSize, offset: (page - 1) * pageSize })
  const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get(params).count
  return { items, total }
}

// ---- behavior -------------------------------------------------------------
{
  const { items, total } = run({})
  ok(items.length === 5 && total === 5, 'no filters -> everything, count agrees')
}
{
  const { items, total } = run({ action: 'create' })
  ok(total === 2 && items.every((r) => r.action.toLowerCase() === 'create'),
    "action filter is case-insensitive ('create' matches the uppercase legacy row too)")
}
{
  const { total } = run({ action: 'create,delete' })
  ok(total === 3, 'comma-joined multi action (toggleMultiValue shape) ORs the values')
}
{
  const { items, total } = run({ entity: 'backup' })
  ok(total === 1 && items[0].action === 'restore',
    'entity filter falls back to table_name when the entity column is NULL (legacy rows)')
}
{
  const { total } = run({ entity: 'product,sale' })
  ok(total === 3, 'multi entity filters across entity/table_name')
}
{
  const { total } = run({ userId: '1,3' })
  ok(total === 3, 'multi userId filters by user_id')
}
{
  const { total } = run({ userId: 'abc,-4' })
  ok(total === 5, 'garbage userIds are dropped, not turned into an impossible filter')
}
{
  const { items, total } = run({ startDate: '2026-08-10', endDate: '2026-08-20' })
  ok(total === 3 && items.every((r) => r.created_at >= '2026-08-10' && r.created_at <= '2026-08-21'),
    'date range is inclusive on both ends against date(created_at)')
}
{
  const { items, total } = run({ search: '100%' })
  ok(total === 1 && items[0].action === 'update',
    "search escapes LIKE wildcards -- a literal '100%' matches only the row containing it")
}
{
  const { total } = run({ search: 'សុភា' })
  ok(total === 1, 'search finds Khmer user names')
}
{
  const { total } = run({ search: 'receipt' })
  ok(total === 1, 'search reaches the details payload')
}
{
  const { total } = run({ action: 'create', userId: '1', startDate: '2026-08-01', endDate: '2026-08-05' })
  ok(total === 1, 'filters combine with AND')
}
{
  const { items, total } = run({ action: 'create' }, 2, 1)
  ok(total === 2 && items.length === 1 && items[0].created_at === '2026-08-01T09:00:00.000Z',
    'pagination pages within the FILTERED set (count stays the filtered total)')
}

// ---- wiring pins ----------------------------------------------------------
const compatSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'compat.ts'), 'utf8')
ok(compatSrc.includes('buildAuditLogFilters({'), 'compat.ts builds the clause from the request')
ok(/SELECT COUNT\(\*\) AS count FROM audit_logs \$\{where\}/.test(compatSrc),
  'the COUNT shares the WHERE -- pagination cannot disagree with the rows')
ok(/DISTINCT LOWER\(action\)/.test(compatSrc) && /DISTINCT LOWER\(COALESCE\(entity, table_name\)\)/.test(compatSrc),
  'filter vocabularies are whole-table (actions + entities)')
const auditHandler = compatSrc.slice(compatSrc.indexOf("app.get('/system/audit-logs'"), compatSrc.indexOf("app.delete('/system/audit-logs/retention'"))
ok(!/catch \(_\)/.test(auditHandler) && /}, 500\)/.test(auditHandler),
  'the silent-empty catch is gone -- a db error is a 500, never an empty 200 pretending to be "no logs"')

console.log(`\nAll ${checks} audit-log filter checks passed.`)
