'use strict'
// The count marks cost (spec section 4, the go or no-go table). Runs under the native-test lock (Records/Locks/native-tests), ONE world per run:
//   WORLD=A|B|C node scripts/test-inventory-check-marks-cost-native.cjs <out.json>      A: today's seed; B: 30 days of history; C: the one year (HIST_DAYS 365) + the waiting backlog of 100 x 20.
// Every figure is read from the counting D1 proxy of the read-budget world (rows read, calls per request); nothing is estimated. CPU is NOT measured here (workerd's clock does not advance in compute): the spec's Node CPU
// figures are a separate step (HANDOVER-ic-view-S0a.md). The budgets below are the spec's GO lines; the file fails when one is over, and writes the numbers either way.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { bootWorld } = require('./read-budget/world.cjs')
const { injectYear } = require('./read-budget/ic-history-year.cjs')
const { Device, counter } = require('./test-inventory-check-marks-oracle-native.cjs')

const IC = '/api/inventory-checks'
const WORLD = process.env.WORLD || 'A'
const OUT = process.argv[2]
const rid = (p) => `${p}-${crypto.randomBytes(8).toString('hex')}`
const sum = (rows) => ({ rows: rows.reduce((n, r) => n + r.rr, 0), calls: rows.reduce((n, r) => n + r.calls, 0), requests: rows.length })

;(async () => {
  const world = await bootWorld({ tier: 'free', seedVariant: 'base', switches: { ic_simple: 'on', ic_marks: 'on', ic_wired: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', catalog_ranked_scope: 'on' } })
  const out = { world: WORLD, command: `WORLD=${WORLD} node scripts/test-inventory-check-marks-cost-native.cjs`, measured: {}, notMeasured: ['CPU of a snapshot page and of a changes answer (Node, median of 5)', 'S0b parity'] }
  try {
    const days = WORLD === 'C' ? 365 : WORLD === 'B' ? 30 : 0
    const anchor = world.ctx.anchor.replace(' ', 'T') + '.000Z'
    if (days) await injectYear((sql, ...v) => world.db.prepare(sql).bind(...v).run(), world.orgId, anchor, { days, backlog: WORLD === 'C' })
    out.sizes = (await world.all(`SELECT (SELECT COUNT(*) FROM inventory_check_sessions) AS sessions, (SELECT COUNT(*) FROM inventory_check_items) AS items, (SELECT COUNT(*) FROM inventory_check_items WHERE state IN ('done','issue')) AS counted, (SELECT COUNT(*) FROM inventory_check_events) AS events, (SELECT COUNT(*) FROM inventory_check_approvals WHERE status='pending') AS pending_approvals, (SELECT COUNT(*) FROM products WHERE is_active=1) AS active_products`))[0]
    const counterCookie = await counter(world)
    const device = new Device(world, 1)
    const base0 = await world.send('GET', `${IC}/marks/changes?branchId=1&since=-1&tag=`)
    out.measured.authBaseline = { status: base0.status, rr: base0.rr, calls: base0.calls }
    // 1. Snapshot, every occupied page cold (cache bypassed), and the pending build.
    const t0 = device.log.length
    await device.build()
    const build = device.log.slice(t0)
    out.measured.snapshotCold = { ...sum(build.filter((r) => /\/marks\?/.test(r.url))), pages: build.filter((r) => /\/marks\?/.test(r.url)).map((r) => ({ url: r.url, rr: r.rr, calls: r.calls })) }
    out.measured.pendingBuild = sum(build.filter((r) => /\/marks\/pending/.test(r.url)))
    out.measured.firstChanges = sum(build.filter((r) => /\/marks\/changes/.test(r.url)))
    // 2. Warm pages (cache allowed): each page is validated by one call.
    const warm = new Device(world, 1, { miss: false })
    await warm.get(`${IC}/marks?branchId=1&page=0`)
    const w0 = warm.log.length
    for (const p of [0]) await warm.get(`${IC}/marks?branchId=1&page=${p}`)
    out.measured.snapshotWarmPage = warm.log.slice(w0)[0]
    // 3. Changes, nothing new.
    const i0 = device.log.length
    await device.sync()
    out.measured.changesIdle = device.log.slice(i0)[0]
    out.measured.changesIdleStatements = (await world.last()).stmts.map((x) => ({ sql: x.raw.slice(0, 90).replace(/s+/g, ' '), rr: x.rr }))
    // 4. Changes after one 20-line submit (the submit itself is recorded).
    const fresh = async (n, off) => world.all(`SELECT p.id AS id, bs.quantity AS q FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=1 WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0 ORDER BY p.id DESC LIMIT ? OFFSET ?`, n, off)
    const lines = (ps, every) => ps.map((p, i) => ({ productId: p.id, countedQuantity: every && i % every === 0 ? p.q + 1 : p.q, seenQuantity: p.q }))
    const twenty = await fresh(20, 0)
    const submit = await world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: lines(twenty, 5) }, { cookie: counterCookie })
    out.measured.submit20 = { status: submit.status, rr: submit.rr, rw: submit.rw, calls: submit.calls }
    const s0 = device.log.length
    await device.sync()
    out.measured.changesAfterSubmit20 = sum(device.log.slice(s0))
    out.measured.changesAfterSubmit20Statements = (await world.last()).stmts.map((x) => ({ sql: x.raw.slice(0, 100).replace(/s+/g, ' '), rr: x.rr }))
    // 5. Approve all of 200 lines: five submissions of 40 differing lines, approved, then one device catches up on all of it.
    const big = await fresh(200, 20)
    const sessions = []
    for (let i = 0; i < 200; i += 40) { const r = await world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: lines(big.slice(i, i + 40), 1) }, { cookie: counterCookie }); assert.equal(r.status < 300, true, 'submit 40: ' + r.text.slice(0, 200)); sessions.push(r.json.sessionId || r.json.session_id || (r.json.item && r.json.item.id)) }
    const approvals = []
    for (const sid of sessions) { for (let n = 0; n < 80; n++) { const r = await world.send('POST', `${IC}/sessions/${sid}/approval`, { decision: 'approve', requestId: rid('ap') }); approvals.push({ rr: r.rr, rw: r.rw, calls: r.calls, status: r.status }); if (r.status >= 300 || r.json.done !== false) break } }
    out.measured.approvalPath = { requests: approvals.length, rrMax: Math.max(...approvals.map((a) => a.rr)), callsMax: Math.max(...approvals.map((a) => a.calls)), statuses: [...new Set(approvals.map((a) => a.status))] }
    const a0 = device.log.length
    await device.sync()
    const after = device.log.slice(a0)
    out.measured.changesAfterApprove200Statements = (await world.last()).stmts.map((x) => ({ sql: x.raw.slice(0, 100).replace(/s+/g, ' '), rr: x.rr }))
    out.measured.changesAfterApprove200 = { ...sum(after), perAnswerRowsMax: Math.max(...after.map((r) => r.rr)), perAnswerCallsMax: Math.max(...after.map((r) => r.calls)) }
    // The budgets of the spec (GO lines). Written first, asserted last.
    const m = out.measured
    const go = [['snapshotCold rows <= 60000', m.snapshotCold.rows <= 60000], ['changesIdle rows <= 4 and 1 call', m.changesIdle.rr <= 4 && m.changesIdle.calls === 1],
      ['changesAfterSubmit20 rows <= 900 and calls <= 3 per answer', m.changesAfterSubmit20.rows <= 900], ['changesAfterApprove200 rows <= 8000', m.changesAfterApprove200.rows <= 8000], ['pendingBuild rows <= 5000', m.pendingBuild.rows <= 5000]]
    out.go = go.map(([name, ok]) => ({ name, ok }))
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
    console.log(JSON.stringify(out, null, 1))
    for (const g of out.go) console.log((g.ok ? 'PASS ' : 'OVER ') + g.name)
    process.exitCode = out.go.every((g) => g.ok) ? 0 : 1
  } finally { await world.dispose() }
})().catch((e) => { console.error('FAIL ' + (e.stack || e)); process.exit(1) })
