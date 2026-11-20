'use strict'
// Spike probe (S0a): Node CPU (median of 5) of a cold snapshot page of 2,000 ids and of a changes answer of 500 events, on a local node:sqlite copy of the one-year world.
// The world is built in workerd under the lock, disposed, and its sqlite file is copied and opened by node:sqlite; nothing else runs in the hold. No ANALYZE.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { DatabaseSync } = require('node:sqlite')
const { bootWorld } = require('./read-budget/world.cjs')
const { injectYear } = require('./read-budget/ic-history-year.cjs')
const waiting = require('./ic-marks-waiting-sql.cjs')
const T = (col) => `CAST(round((julianday(${col}) - 2440587.5) * 86400000) AS INTEGER)`
const markOf = (pid) => `(SELECT x.rowid FROM inventory_check_items x INDEXED BY inventory_check_items_product_latest CROSS JOIN inventory_check_sessions sx ON sx.id = x.session_id
    WHERE x.product_id = ${pid} AND x.branch_id = @branchId AND x.state IN ('done','issue') AND sx.organization_id IS @organization AND sx.branch_id = x.branch_id ORDER BY x.updated_at DESC, x.session_id DESC LIMIT 1)`
const SNAP = `SELECT p.id AS id, ${T('i.updated_at')} AS t, CASE i.state WHEN 'issue' THEN 2 ELSE 1 END AS s FROM products p JOIN inventory_check_items i ON i.rowid = ${markOf('p.id')} WHERE p.id >= @lo AND p.id < @hi ORDER BY p.id`
const BYIDS = `SELECT CAST(w.value AS INTEGER) AS id, ${T('i.updated_at')} AS t, CASE WHEN i.rowid IS NULL THEN 0 WHEN i.state = 'issue' THEN 2 ELSE 1 END AS s FROM json_each(@ids) w LEFT JOIN inventory_check_items i ON i.rowid = ${markOf('w.value')}`
const EVENTS = 'SELECT id, session_id, product_id, actor_id, request_id, created_at FROM inventory_check_events WHERE id > @since ORDER BY id LIMIT @pageEvents'
const SCOPE = `SELECT s.id AS id, EXISTS (SELECT 1 FROM inventory_check_approvals a WHERE a.session_id = s.id) AS approval FROM json_each(@sessions) w CROSS JOIN inventory_check_sessions s ON s.id = w.value WHERE s.organization_id IS @organization AND s.branch_id = @branchId`
const SESSION_PRODUCTS = 'SELECT DISTINCT session_id, product_id FROM inventory_check_items WHERE session_id IN (SELECT value FROM json_each(@sessions))'
const PENDING = `SELECT product_id, session_id FROM (
  SELECT CAST(je.key AS INTEGER) AS product_id, a.session_id AS session_id FROM inventory_check_approvals a INDEXED BY inventory_check_approvals_pending, json_each(a.line_set_json) je
    WHERE a.organization_id IS @organization AND a.status = 'pending' AND a.branch_id = @branchId AND a.line_set_json IS NOT NULL AND CAST(je.key AS INTEGER) IN (SELECT value FROM json_each(@ids))
      AND json_extract(a.applied_json, '$.lines."' || je.key || '"') IS NULL AND json_extract(a.superseded_json, '$."' || je.key || '"') IS NULL
      AND json_extract(a.line_decisions_json, '$."' || je.key || '".decision') IS NOT 'reject'
      AND EXISTS (SELECT 1 FROM inventory_check_items i WHERE i.session_id = a.session_id AND i.product_id = CAST(je.key AS INTEGER) AND i.branch_id = @branchId)
  UNION
  SELECT i.product_id AS product_id, a.session_id AS session_id FROM inventory_check_approvals a INDEXED BY inventory_check_approvals_pending JOIN inventory_check_items i ON i.session_id = a.session_id
    WHERE a.organization_id IS @organization AND a.status = 'pending' AND a.branch_id = @branchId AND a.line_set_json IS NULL AND i.branch_id = @branchId AND i.product_id IN (SELECT value FROM json_each(@ids)) AND ${waiting('a', 'i')})`
const REPS = 40
const cpu = (fn) => { const a = process.cpuUsage(), t = process.hrtime.bigint(); for (let i = 0; i < REPS; i++) fn(); const b = process.cpuUsage(a); const wall = Number(process.hrtime.bigint() - t) / 1e6; return { cpuMs: (b.user + b.system) / 1000 / REPS, wallMs: wall / REPS } }
const median = (xs) => [...xs].sort((p, q) => p.wallMs - q.wallMs)[Math.floor(xs.length / 2)]
;(async () => {
  const world = await bootWorld({ tier: 'free', seedVariant: 'base', switches: { ic_simple: 'on', ic_marks: 'on', ic_fix_stock: 'on' } })
  const anchor = world.ctx.anchor.replace(' ', 'T') + '.000Z'
  await injectYear((sql, ...v) => world.db.prepare(sql).bind(...v).run(), world.orgId, anchor, { days: 365, backlog: true })
  const org = world.orgId, persist = world.persist
  const found = []
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/.sqlite(-wal|-shm)?$/.test(e.name)) found.push(p) } }
  walk(path.join(persist, 'd1'))
  const dir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'icv-cpu-'))
  let copy = null
  for (const f of found.filter((p) => p.endsWith('.sqlite'))) {
    const target = path.join(dir, path.basename(f))
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(f + ext)) fs.copyFileSync(f + ext, target + ext)
    try { const d = new DatabaseSync(target, { readOnly: true }); const has = d.prepare("SELECT 1 FROM sqlite_master WHERE name='inventory_check_items'").get(); d.close(); if (has) copy = target } catch { /* not it */ }
  }
  await world.dispose()
  if (!copy) throw new Error('no D1 file found: ' + found.join(','))
  const db = new DatabaseSync(copy)
  const stat = db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'sqlite_stat%'").all()
  const scope = { organization: org, branchId: 1 }
  const out = { stat: stat.map((s) => s.name) }
  const run = (sql, p) => db.prepare(sql).all(p)
  run(SNAP, { ...scope, lo: 2000, hi: 4000 })
  const snap = [], rows = []
  for (let i = 0; i < 5; i++) snap.push(cpu(() => { rows.push(run(SNAP, { ...scope, lo: 2000, hi: 4000 }).length) }))
  out.snapshotPage2000Ids = { median: median(snap), runs: snap, rows: rows[0] }
  const top = db.prepare('SELECT MAX(id) AS m FROM inventory_check_events').get().m
  const changes = []
  let info = null
  for (let i = 0; i < 5; i++) changes.push(cpu(() => {
    const events = run(EVENTS, { since: top - 500, pageEvents: 500 })
    const sessions = [...new Set(events.map((e) => String(e.session_id)))]
    const nullSessions = [...new Set(events.filter((e) => e.product_id == null).map((e) => String(e.session_id)))]
    const sc = run(SCOPE, { ...scope, sessions: JSON.stringify(sessions) })
    const sp = nullSessions.length ? run(SESSION_PRODUCTS, { sessions: JSON.stringify(nullSessions) }) : []
    const appr = new Map(sc.map((r) => [String(r.id), Number(r.approval) === 1]))
    const touched = new Set()
    for (const e of events) { const a = appr.get(String(e.session_id)); if (a === undefined) continue; if (e.product_id != null) touched.add(Number(e.product_id)); else if (a) for (const r of sp) if (r.session_id === e.session_id) touched.add(Number(r.product_id)) }
    const ids = JSON.stringify([...touched])
    const by = run(BYIDS, { ...scope, ids }), pe = run(PENDING, { ...scope, ids })
    info = { events: events.length, touched: touched.size, marks: by.length, waiting: pe.length }
  }))
  out.changes500Events = { median: median(changes), runs: changes, ...info }
  db.close(); fs.rmSync(dir, { recursive: true, force: true })
  console.log(JSON.stringify(out, null, 1))
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1))
})().catch((e) => { console.error('FAIL ' + (e.stack || e)); process.exit(1) })
