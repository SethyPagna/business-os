'use strict'
// Spike probe (S0a): rows read and plans of the SCOPE and pending-lines statements, first draft vs rewrites, on world A, B or C. WORLD=A|B|C node scripts/ic-marks-sql-probe.cjs <out.json>
// Run under the native-test lock. No ANALYZE, no PRAGMA optimize, no stat tables (checked below).
const fs = require('node:fs')
const { bootWorld } = require('./read-budget/world.cjs')
const { injectYear } = require('./read-budget/ic-history-year.cjs')
const waitingLine = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/lib/inventoryCheckSessions.ts'), 'utf8')
const WORLD = process.env.WORLD || 'A'
const marks = fs.readFileSync(require('node:path').join(__dirname, '../src/lib/inventoryCheckMarks.ts'), 'utf8')
const grab = (name) => { const m = new RegExp('export const ' + name + ' = `([^`]*)`').exec(marks); if (!m) throw new Error(name); return m[1] }
const T = (col) => `CAST(round((julianday(${col}) - 2440587.5) * 86400000) AS INTEGER)`
const markOf = (pid) => `(SELECT x.rowid FROM inventory_check_items x INDEXED BY inventory_check_items_product_latest
    CROSS JOIN inventory_check_sessions sx ON sx.id = x.session_id
    WHERE x.product_id = ${pid} AND x.branch_id = @branchId AND x.state IN ('done','issue')
      AND sx.organization_id IS @organization AND sx.branch_id = x.branch_id
    ORDER BY x.updated_at DESC, x.session_id DESC LIMIT 1)`
const SNAPSHOT = `SELECT p.id AS id, ${T('i.updated_at')} AS t, CASE i.state WHEN 'issue' THEN 2 ELSE 1 END AS s
  FROM products p JOIN inventory_check_items i ON i.rowid = ${markOf('p.id')}
  WHERE p.id >= @lo AND p.id < @hi ORDER BY p.id`
// waitingLineSql copied through the compiled text of the first draft: take it from the SQL the Worker sends.
;(async () => {
  const world = await bootWorld({ tier: 'free', seedVariant: 'base', switches: { ic_simple: 'on', ic_marks: 'on', ic_wired: 'on', ic_fix_stock: 'on' } })
  const out = { world: WORLD, rows: {}, plans: {} }
  try {
    const days = WORLD === 'C' ? 365 : WORLD === 'B' ? 30 : 0
    const anchor = world.ctx.anchor.replace(' ', 'T') + '.000Z'
    if (days) await injectYear((sql, ...v) => world.db.prepare(sql).bind(...v).run(), world.orgId, anchor, { days, backlog: WORLD === 'C' })
    out.stat = (await world.all("SELECT name FROM sqlite_master WHERE name LIKE 'sqlite_stat%'")).map((r) => r.name)
    // the first draft's texts, with named params turned into numbered ones; the waiting-line rule is read from a real request below
    await world.send('GET', '/api/inventory-checks/marks/changes?branchId=1&since=0&tag=')
    const sessionsAll = (await world.all("SELECT id FROM inventory_check_sessions WHERE branch_id=1 ORDER BY started_at DESC LIMIT 5")).map((r) => r.id)
    const idsAll = (await world.all('SELECT id FROM products WHERE is_active=1 ORDER BY id DESC LIMIT 200')).map((r) => r.id)
    const waiting = require('./ic-marks-waiting-sql.cjs')
    const SC1 = `SELECT s.id AS id, EXISTS (SELECT 1 FROM inventory_check_approvals a WHERE a.session_id = s.id) AS approval FROM inventory_check_sessions s WHERE s.id IN (SELECT value FROM json_each(?3)) AND s.organization_id IS ?1 AND s.branch_id = ?2`
    const SC2 = `SELECT s.id AS id, EXISTS (SELECT 1 FROM inventory_check_approvals a WHERE a.session_id = s.id) AS approval FROM json_each(?3) w CROSS JOIN inventory_check_sessions s ON s.id = w.value WHERE s.organization_id IS ?1 AND s.branch_id = ?2`
    const PL1 = `SELECT DISTINCT i.product_id AS product_id, a.session_id AS session_id FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id = a.session_id WHERE a.organization_id IS ?1 AND i.branch_id = ?2 AND i.product_id IN (SELECT value FROM json_each(?3)) AND ${waiting('a', 'i')}`
    const PL2 = `SELECT DISTINCT i.product_id AS product_id, a.session_id AS session_id FROM json_each(?3) w CROSS JOIN inventory_check_items i INDEXED BY inventory_check_items_product_latest ON i.product_id = w.value AND i.branch_id = ?2 CROSS JOIN inventory_check_approvals a ON a.session_id = i.session_id WHERE a.organization_id IS ?1 AND ${waiting('a', 'i')}`
    const PL3 = `SELECT product_id, session_id FROM (
      SELECT CAST(je.key AS INTEGER) AS product_id, a.session_id AS session_id FROM inventory_check_approvals a INDEXED BY inventory_check_approvals_pending, json_each(a.line_set_json) je
        WHERE a.organization_id IS ?1 AND a.status = 'pending' AND a.branch_id = ?2 AND a.line_set_json IS NOT NULL AND CAST(je.key AS INTEGER) IN (SELECT value FROM json_each(?3))
          AND json_extract(a.applied_json, '$.lines."' || je.key || '"') IS NULL AND json_extract(a.superseded_json, '$."' || je.key || '"') IS NULL
          AND json_extract(a.line_decisions_json, '$."' || je.key || '".decision') IS NOT 'reject'
          AND EXISTS (SELECT 1 FROM inventory_check_items i WHERE i.session_id = a.session_id AND i.product_id = CAST(je.key AS INTEGER) AND i.branch_id = ?2)
      UNION
      SELECT i.product_id AS product_id, a.session_id AS session_id FROM inventory_check_approvals a INDEXED BY inventory_check_approvals_pending JOIN inventory_check_items i ON i.session_id = a.session_id
        WHERE a.organization_id IS ?1 AND a.status = 'pending' AND a.branch_id = ?2 AND a.line_set_json IS NULL AND i.branch_id = ?2 AND i.product_id IN (SELECT value FROM json_each(?3)) AND ${waiting('a', 'i')})`
    const run = async (name, sql, ...v) => {
      const r = await world.db.prepare(sql).bind(...v).all()
      const plan = (await world.db.prepare('EXPLAIN QUERY PLAN ' + sql).bind(...v).all()).results.map((p) => p.detail)
      return { name, rr: r.meta.rows_read, n: r.results.length, key: JSON.stringify(r.results.map((x) => JSON.stringify(x)).sort()), plan }
    }
    const res = {}
    for (const [ns, nIds] of [[1, 20], [5, 200]]) {
      const S = JSON.stringify(sessionsAll.slice(0, ns)), I = JSON.stringify(idsAll.slice(0, nIds))
      const hw = (await world.all("SELECT session_id FROM inventory_check_approvals WHERE status='pending' LIMIT 3")).map((r) => r.session_id)
      const I2 = JSON.stringify([...idsAll.slice(0, nIds), ...(await world.all(`SELECT product_id FROM inventory_check_items WHERE session_id IN (${hw.map(() => '?').join(',') || "''"}) LIMIT 40`, ...hw)).map((r) => r.product_id)])
      const S2 = JSON.stringify([...sessionsAll.slice(0, ns), ...hw])
      const case_ = `${ns}s-${nIds}i`
      const a = await run('scope1', SC1, world.orgId, 1, S2), b = await run('scope2', SC2, world.orgId, 1, S2)
      const c = await run('pend1', PL1, world.orgId, 1, I2), d = await run('pend2', PL2, world.orgId, 1, I2), e3 = await run('pend3', PL3, world.orgId, 1, I2)
      res[case_] = { scope1: { rr: a.rr, n: a.n }, scope2: { rr: b.rr, n: b.n, same: a.key === b.key }, pend1: { rr: c.rr, n: c.n }, pend2: { rr: d.rr, n: d.n, same: c.key === d.key }, pend3: { rr: e3.rr, n: e3.n, same: c.key === e3.key } }
      out.plans = { scope1: a.plan, scope2: b.plan, pend1: c.plan, pend2: d.plan, pend3: e3.plan }
    }
    // Legacy approvals (line_set_json NULL: the waiting rule falls back to the count-differs test). The immutability trigger forbids editing, so five new ones are inserted.
    const anchor2 = anchor
    await world.db.prepare("WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k < 4) INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) SELECT 'hl-'||k, ?, 1, 1, 'Legacy', 'closed', 0, '{}', ?, ?, ? FROM s").bind(world.orgId, anchor2, anchor2, anchor2).run()
    await world.db.prepare("WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x < 99) INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) SELECT 'hl-'||(x/20), 9000 + x, 1, '{}', 5, '{}', 'done', CASE WHEN x%2=0 THEN 4 ELSE 5 END, 1, 1, ? FROM n").bind(anchor2).run()
    await world.db.prepare("INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json,line_set_json) SELECT id, organization_id, 1, 'pending', 20, 1, started_at, '{}', NULL FROM inventory_check_sessions WHERE id LIKE 'hl-%'").run()
    {
      const ids = JSON.stringify(Array.from({ length: 100 }, (_, x) => 9000 + x).concat(idsAll.slice(0, 100)))
      const c = await run("pend1", PL1, world.orgId, 1, ids), e3 = await run("pend3", PL3, world.orgId, 1, ids)
      res.legacyNullLineSet = { pend1: { rr: c.rr, n: c.n }, pend3: { rr: e3.rr, n: e3.n, same: c.key === e3.key } }
    }
    out.rows = res
    // snapshot pages: rows per statement, page 0 and a middle page
    const snap = SNAPSHOT.replace(/@branchId/g, '?1').replace(/@organization/g, '?2').replace(/@lo/g, '?3').replace(/@hi/g, '?4')
    const mx = (await world.all('SELECT MAX(id) AS m, MIN(id) AS n FROM products'))[0]
    out.snapshot = {}
    for (const [label, lo] of [['page0', 0], ['page1', 2000], ['page2', 4000]]) {
      const r = await world.db.prepare(snap).bind(1, world.orgId, lo, lo + 2000).all()
      out.snapshot[label] = { rr: r.meta.rows_read, rows: r.results.length }
    }
    out.snapshot.range = mx
    out.snapshot.plan = (await world.db.prepare('EXPLAIN QUERY PLAN ' + snap).bind(1, world.orgId, 2000, 4000).all()).results.map((p) => p.detail)
    out.snapshot.countedProducts = (await world.all("SELECT COUNT(DISTINCT product_id) AS n FROM inventory_check_items WHERE branch_id=1 AND state IN ('done','issue')"))[0].n
    out.snapshot.productsInPage1 = (await world.all('SELECT COUNT(*) AS n FROM products WHERE id>=2000 AND id<4000'))[0].n
    if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1))
    console.log(JSON.stringify(out, null, 1))
  } finally { await world.dispose() }
})().catch((e) => { console.error('FAIL ' + (e.stack || e)); process.exit(1) })
