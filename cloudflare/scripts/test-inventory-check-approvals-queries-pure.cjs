'use strict'
// ops/queries/inventory-check-approvals-postflight.sql (pending approvals with no recorded set of lines, and Done items of an approval's session whose time is not their session's count time: an item the old
// approval flip rewrote) and ops/queries/inventory-check-approvals-pre-rollback.sql (pending approvals with a per-line decision, line_decisions_json <> '{}'): the two halves of the former single query, split
// so the rollback-only count (non-zero in normal use) never sits in a routine postflight.
// Pure: a minimal schema of the columns they read, every case through the real guard and the real Ops verdict, and wrong variants that must disagree.
// Run: node scripts/test-inventory-check-approvals-queries-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')

const root = path.resolve(__dirname, '../..')
const T0 = '2026-11-12T03:00:00.000Z', T1 = '2026-11-17T04:00:00.000Z'
// approvals: [session, status, line_set_json, line_decisions_json]; items: [session, product, state, updated_at]. Sessions are started at T0.
// Expected counts: [pending_without_line_set, pending_with_line_decisions, items_with_approval_time].
const cases = [
  ['no approvals', { approvals: [], items: [] }, [0, 0, 0]],
  ['pending with a set and no decision', { approvals: [['a', 'pending', '{"1":1}', '{}']], items: [['a', 1, 'issue', T0]] }, [0, 0, 0]],
  ['pending without a set (made by a Worker that does not know the column)', { approvals: [['a', 'pending', null, '{}']], items: [['a', 1, 'issue', T0]] }, [1, 0, 0]],
  ['pending with a set and a rejected line', { approvals: [['a', 'pending', '{"1":1,"2":1}', '{"2":{"decision":"reject"}}']], items: [['a', 1, 'issue', T0]] }, [0, 1, 0]],
  ['pending without a set and a modified line', { approvals: [['a', 'pending', null, '{"1":{"decision":"modify","counted":3}}']], items: [['a', 1, 'issue', T0]] }, [1, 1, 0]],
  ['decided approvals never count in the first two: approved without a set, rejected with a decision', { approvals: [['a', 'approved', null, '{}'], ['b', 'rejected', '{"1":1}', '{"1":{"decision":"reject"}}']], items: [['a', 1, 'done', T0], ['b', 1, 'issue', T0]] }, [0, 0, 0]],
  ['several pending rows are summed', { approvals: [['a', 'pending', null, '{}'], ['b', 'pending', null, '{}'], ['c', 'pending', '{"1":1}', '{"1":{"decision":"reject"}}'], ['d', 'approved', null, '{"1":{"decision":"reject"}}']], items: [] }, [2, 1, 0]],
  ['an item the old flip rewrote (Done, time is the approval\'s)', { approvals: [['a', 'approved', null, '{}']], items: [['a', 1, 'done', T1], ['a', 2, 'done', T0]] }, [0, 0, 1]],
  ['a pending approval with a flipped line counts too', { approvals: [['a', 'pending', '{"1":1,"2":1}', '{}']], items: [['a', 1, 'done', T1], ['a', 2, 'issue', T1]] }, [0, 0, 1]],
  ['an item with another time in a session with no approval (an observation made later) is not counted', { approvals: [['a', 'approved', null, '{}']], items: [['a', 1, 'done', T0], ['open', 1, 'done', T1]] }, [0, 0, 0]],
]

;(async () => {
  const { loadQuery, guardSql } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')))
  const { interpretD1Output } = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-d1-export.mjs')))
  assert.equal(fs.existsSync(path.join(root, 'ops/queries/inventory-check-approvals-line-set.sql')), false, 'the combined query is retired')
  const loaded = {}
  for (const [name, expectZero] of [['postflight', ['pending_without_line_set', 'items_with_approval_time']], ['pre-rollback', ['pending_with_line_decisions']]]) {
    const query = loadQuery('inventory-check-approvals-' + name)
    assert.deepEqual(query.rules, { minRows: 1, maxRows: 1, expectZero }, name)
    assert.equal(query.maxRowsRead, 100, name)
    // No LF-only assertion on the file: ops/queries has no eol=lf attribute, so a CI checkout is CRLF. The CRLF-equivalence check is the right one.
    const file = fs.readFileSync(query.file, 'utf8')
    assert.deepEqual(guardSql(file.replace(/\r?\n/g, '\r\n')), { sql: query.sql, rules: query.rules }, name + ': a CRLF checkout runs the same canonical text')
    assert.match(query.sql, /^SELECT /); assert.doesNotMatch(query.sql, /\b(UNION|INSERT|UPDATE|DELETE)\b/i)
    loaded[name] = query
  }
  assert.match(fs.readFileSync(loaded['pre-rollback'].file, 'utf8'), /^-- inventory-check-approvals-pre-rollback: run ONLY before deploy-rollback\.yml/, 'the header says when to run it')
  assert.doesNotMatch(loaded.postflight.sql, /line_decisions_json/, 'the rollback-only count is not in the postflight')
  assert.doesNotMatch(loaded['pre-rollback'].sql, /line_set_json|inventory_check_items/, 'the postflight counts are not in the pre-rollback query')
  // Wrong variants: each must give a different answer on at least one case (a query that cannot be told from these proves nothing).
  const col = (name, expr) => `(${expr}) AS ${name}`
  const A = 'SELECT COUNT(*) FROM inventory_check_approvals'
  const item = "SELECT COUNT(*) FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id = i.session_id WHERE i.state = 'done' AND i.session_id IN (SELECT a.session_id FROM inventory_check_approvals a) AND i.updated_at <> s.started_at"
  const post = (a, c) => `SELECT ${col('pending_without_line_set', a)}, ${col('items_with_approval_time', c)}`
  const pre = b => `SELECT ${col('pending_with_line_decisions', b)}`
  const good = [`${A} WHERE status = 'pending' AND line_set_json IS NULL`, `${A} WHERE status = 'pending' AND line_decisions_json <> '{}'`, item]
  const wrong = [
    ['postflight', post(`${A} WHERE line_set_json IS NULL`, good[2])], // counts decided approvals
    ['pre-rollback', pre(`${A} WHERE line_decisions_json <> '{}'`)], // counts decided approvals
    ['postflight', post(`${A} WHERE status = 'pending' AND line_set_json = '{}'`, good[2])], // an empty set is not a missing set
    ['pre-rollback', pre(`${A} WHERE status = 'pending' AND line_decisions_json IS NOT NULL`)], // every row has a decision column
    ['postflight', post(good[0], item.replace("i.state = 'done' AND ", ''))], // counts items that were never flipped
    ['postflight', post(good[0], item.replace('i.session_id IN (SELECT a.session_id FROM inventory_check_approvals a)', '1'))], // counts open-session observations
  ]
  const detected = wrong.map(() => false)
  for (const [name, { approvals, items }, [withoutSet, withDecisions, withTime]] of cases) {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec("CREATE TABLE inventory_check_approvals(session_id TEXT PRIMARY KEY, status TEXT NOT NULL, line_set_json TEXT, line_decisions_json TEXT NOT NULL DEFAULT '{}')")
      db.exec('CREATE TABLE inventory_check_sessions(id TEXT PRIMARY KEY, started_at TEXT NOT NULL)')
      db.exec('CREATE TABLE inventory_check_items(session_id TEXT NOT NULL, product_id INTEGER NOT NULL, state TEXT NOT NULL, updated_at TEXT, PRIMARY KEY(session_id, product_id))')
      for (const id of new Set([...approvals.map(row => row[0]), ...items.map(row => row[0])])) db.prepare('INSERT INTO inventory_check_sessions(id,started_at) VALUES(?,?)').run(id, T0)
      for (const row of approvals) db.prepare('INSERT INTO inventory_check_approvals(session_id,status,line_set_json,line_decisions_json) VALUES(?,?,?,?)').run(...row)
      for (const row of items) db.prepare('INSERT INTO inventory_check_items(session_id,product_id,state,updated_at) VALUES(?,?,?,?)').run(...row)
      const expectedBy = {
        postflight: { pending_without_line_set: withoutSet, items_with_approval_time: withTime },
        'pre-rollback': { pending_with_line_decisions: withDecisions },
      }
      for (const which of ['postflight', 'pre-rollback']) {
        const query = loaded[which], expected = expectedBy[which]
        const observed = { ...db.prepare(query.sql).get() }
        assert.deepEqual(observed, expected, `${name} (${which})`)
        const verdict = interpretD1Output(JSON.stringify([{ success: true, results: [observed], meta: { rows_written: 0, changes: 0, changed_db: false } }]), query.rules)
        const clean = Object.values(expected).every(value => value === 0)
        assert.equal(verdict.ok, clean, `${name} (${which}): the Ops verdict`)
        assert.deepEqual(verdict.problems, clean ? [] : ['expect-zero-failed'], `${name} (${which})`)
      }
      wrong.forEach(([which, sql], i) => { if (JSON.stringify({ ...db.prepare(sql).get() }) !== JSON.stringify(expectedBy[which])) detected[i] = true })
    } finally { db.close() }
  }
  assert.deepEqual(detected, wrong.map(() => true), 'every wrong variant disagrees with the query on at least one case')
  console.log('PASS test-inventory-check-approvals-queries-pure (' + cases.length + ' cases, two queries)')
})().catch(error => { console.error(error); process.exit(1) })
