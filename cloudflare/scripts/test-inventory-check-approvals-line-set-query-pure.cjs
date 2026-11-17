'use strict'
// ops/queries/inventory-check-approvals-line-set.sql: the postflight / pre-rollback counts of pending approvals with no recorded set of lines (line_set_json IS NULL) and with a per-line decision
// (line_decisions_json <> '{}'). Pure: a minimal table of the three columns it reads, every case through the real guard and the real Ops verdict, and wrong variants that must disagree.
// Run: node scripts/test-inventory-check-approvals-line-set-query-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '../..')
// [name, rows [status, line_set_json, line_decisions_json], pending_without_line_set, pending_with_line_decisions]
const cases = [
  ['no approvals', [], 0, 0],
  ['pending with a set and no decision', [['pending', '{"1":1}', '{}']], 0, 0],
  ['pending without a set (made by a Worker that does not know the column)', [['pending', null, '{}']], 1, 0],
  ['pending with a set and a rejected line', [['pending', '{"1":1,"2":1}', '{"2":{"decision":"reject"}}']], 0, 1],
  ['pending without a set and a modified line', [['pending', null, '{"1":{"decision":"modify","counted":3}}']], 1, 1],
  ['decided rows never count: approved without a set', [['approved', null, '{}']], 0, 0],
  ['decided rows never count: rejected with a decision', [['rejected', '{"1":1}', '{"1":{"decision":"reject"}}']], 0, 0],
  ['several pending rows are summed', [['pending', null, '{}'], ['pending', null, '{}'], ['pending', '{"1":1}', '{"1":{"decision":"reject"}}'], ['approved', null, '{"1":{"decision":"reject"}}']], 2, 1],
]

;(async () => {
  const { loadQuery, guardSql } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')))
  const { interpretD1Output } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-d1-export.mjs')))
  const query = loadQuery('inventory-check-approvals-line-set')
  assert.deepEqual(query.rules, { minRows: 1, maxRows: 1, expectZero: ['pending_without_line_set', 'pending_with_line_decisions'] })
  assert.equal(query.maxRowsRead, 50)
  const file = fs.readFileSync(query.file, 'utf8')
  assert.equal(file.includes('\r'), false, 'LF only')
  assert.deepEqual(guardSql(file.replace(/\r?\n/g, '\r\n')), { sql: query.sql, rules: query.rules }, 'a CRLF checkout runs the same canonical text')
  assert.match(query.sql, /^SELECT /); assert.doesNotMatch(query.sql, /UNION|INSERT|UPDATE|DELETE/i)
  // Wrong variants: each must give a different answer on at least one case (a query that cannot be told from these proves nothing).
  const wrong = [
    "SELECT COALESCE(SUM(CASE WHEN line_set_json IS NULL THEN 1 ELSE 0 END),0) AS pending_without_line_set, COALESCE(SUM(CASE WHEN line_decisions_json <> '{}' THEN 1 ELSE 0 END),0) AS pending_with_line_decisions FROM inventory_check_approvals",
    "SELECT COALESCE(SUM(CASE WHEN line_set_json IS NULL THEN 1 ELSE 0 END),0) AS pending_without_line_set, COALESCE(SUM(CASE WHEN line_decisions_json IS NOT NULL THEN 1 ELSE 0 END),0) AS pending_with_line_decisions FROM inventory_check_approvals WHERE status='pending'",
    "SELECT COALESCE(SUM(CASE WHEN line_set_json = '{}' THEN 1 ELSE 0 END),0) AS pending_without_line_set, COALESCE(SUM(CASE WHEN line_decisions_json <> '{}' THEN 1 ELSE 0 END),0) AS pending_with_line_decisions FROM inventory_check_approvals WHERE status='pending'",
  ]
  const detected = wrong.map(() => false)
  for (const [name, rows, withoutSet, withDecisions] of cases) {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec("CREATE TABLE inventory_check_approvals(status TEXT NOT NULL, line_set_json TEXT, line_decisions_json TEXT NOT NULL DEFAULT '{}')")
      for (const row of rows) db.prepare('INSERT INTO inventory_check_approvals(status,line_set_json,line_decisions_json) VALUES(?,?,?)').run(...row)
      const observed = { ...db.prepare(query.sql).get() }
      const expected = { pending_without_line_set: withoutSet, pending_with_line_decisions: withDecisions }
      assert.deepEqual(observed, expected, name)
      const verdict = interpretD1Output(JSON.stringify([{ success: true, results: [observed], meta: { rows_written: 0, changes: 0, changed_db: false } }]), query.rules)
      const clean = withoutSet === 0 && withDecisions === 0
      assert.equal(verdict.ok, clean, `${name}: the Ops verdict`)
      assert.deepEqual(verdict.problems, clean ? [] : ['expect-zero-failed'], name)
      wrong.forEach((sql, i) => { if (JSON.stringify({ ...db.prepare(sql).get() }) !== JSON.stringify(expected)) detected[i] = true })
    } finally { db.close() }
  }
  assert.deepEqual(detected, wrong.map(() => true), 'every wrong variant disagrees with the query on at least one case')
  console.log('PASS test-inventory-check-approvals-line-set-query-pure (' + cases.length + ' cases)')
})().catch(error => { console.error(error); process.exit(1) })
