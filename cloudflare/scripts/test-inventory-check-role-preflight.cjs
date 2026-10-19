const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '../..')
const migration = fs.readFileSync(path.join(root, 'cloudflare/migrations/0259_inventory_check_sessions.sql'), 'utf8')
const cases = [
  ['no Employee', [], 0, 0],
  ['malformed custom only', [['custom', '{bad']], 0, 0],
  ['empty object', [['employee', '{}']], 1, 0],
  ['explicit denial', [['employee', '{"inventory_checks":false}']], 1, 0],
  ['SQL null', [['employee', null]], 1, 1],
  ['empty text', [['employee', '']], 1, 1],
  ['malformed JSON', [['employee', '{bad']], 1, 1],
  ['array', [['employee', '[]']], 1, 1],
  ['JSON null', [['employee', 'null']], 1, 1],
  ['boolean', [['employee', 'false']], 1, 1],
  ['number', [['employee', '7']], 1, 1],
  ['string', [['employee', '"object"']], 1, 1],
  ['object with null field', [['employee', '{"inventory_checks":null}']], 1, 0],
  ['later invalid Employee', [['employee', '{}'], ['employee', '[]']], 2, 1],
  ['two invalid Employee rows', [['employee', '{bad'], ['employee', null]], 2, 2],
  ['malformed unrelated role', [['custom', '[]'], ['employee', '{}']], 1, 0],
  ['exact canonical role code', [['Employee', '{bad']], 0, 0]
]

;(async () => {
  const { loadQuery, guardSql } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')))
  const { interpretD1Output } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-d1-export.mjs')))
  const query = loadQuery('inventory-check-role-preflight')
  assert.deepEqual(query.rules, { minRows: 1, maxRows: 1, expectZero: ['invalid_employee_permissions'] })
  assert.deepEqual(guardSql(fs.readFileSync(query.file, 'utf8').replace(/\r?\n/g, '\r\n')), { sql: query.sql, rules: query.rules })
  const wrong = [
    "SELECT COUNT(*) employee_roles, COALESCE(SUM(CASE WHEN json_valid(permissions)=1 THEN 0 ELSE 1 END),0) invalid_employee_permissions FROM roles WHERE code='employee'",
    "SELECT COUNT(*) employee_roles, COALESCE(SUM(CASE WHEN json_valid(permissions)=1 THEN CASE WHEN json_type(permissions)='object' THEN 0 ELSE 1 END ELSE 1 END),0) invalid_employee_permissions FROM roles"
  ]
  const detected = wrong.map(() => false)
  for (const [name, rows, total, invalid] of cases) {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('CREATE TABLE roles(code TEXT,permissions TEXT)')
      for (const row of rows) db.prepare('INSERT INTO roles(code,permissions) VALUES(?,?)').run(...row)
      const observed = { ...db.prepare(query.sql).get() }
      const expected = { employee_roles: total, invalid_employee_permissions: invalid }
      assert.deepEqual(observed, expected, name)
      assert.deepEqual(Object.keys(observed).sort(), ['employee_roles', 'invalid_employee_permissions'])
      const verdict = interpretD1Output(JSON.stringify([{ success: true, results: [observed], meta: { rows_written: 0, changes: 0, changed_db: false } }]), query.rules)
      assert.equal(verdict.ok, invalid === 0, `${name}: actual Ops refusal`)
      assert.deepEqual(verdict.problems, invalid ? ['expect-zero-failed'] : [])
      wrong.forEach((sql, i) => { if (JSON.stringify({ ...db.prepare(sql).get() }) !== JSON.stringify(expected)) detected[i] = true })
      db.exec('BEGIN')
      let applies = false
      try { db.exec(migration); applies = true } catch (error) { assert.ok(error instanceof Error, name) }
      finally { db.exec('ROLLBACK') }
      assert.equal(applies, invalid === 0, `${name}: actual0259 admission`)
      assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name LIKE 'inventory_check_%'").get().n, 0)
    } finally { db.close() }
  }
  assert.deepEqual(detected, [true, true], 'plausible wrong preflights must fail fixtures')
  console.log(`PASS ${cases.length} actual0259 preflight fixtures; two wrong implementations rejected`)
})().catch(error => { console.error(error); process.exitCode = 1 })
