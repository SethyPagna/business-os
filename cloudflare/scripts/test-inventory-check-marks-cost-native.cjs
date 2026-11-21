'use strict'
// The count marks cost (spec section 4, amendment 1.1 G.0 and G.3 A1c). Runs under the native-test lock (Records/Locks/native-tests), ONE world per run:
//   WORLD=A|B|C node scripts/test-inventory-check-marks-cost-native.cjs <out.json>      A: today's seed; B: 30 days of history; C: the one year (HIST_DAYS 365) + the waiting backlog of 100 x 20 (2,000 waiting lines).
// Every figure is read from the counting D1 proxy of the read-budget world (rows read, calls per request); nothing is estimated. CPU is NOT measured here (workerd's clock does not advance in compute).
// The pins are GROSS (the auth lookup included) and sit at the C.1 formula + 10 percent; a figure more than 10 percent above its formula means the formula is wrong somewhere, and the run says so.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { bootWorld } = require('./read-budget/world.cjs')
const { injectYear } = require('./read-budget/ic-history-year.cjs')
const { Device, counter, limitsOf } = require('./test-inventory-check-marks-oracle-native.cjs')

const IC = '/api/inventory-checks'
const WORLD = process.env.WORLD || 'A'
const OUT = process.argv[2]
const rid = (p) => `${p}-${crypto.randomBytes(8).toString('hex')}`
const sum = (rows) => ({ rows: rows.reduce((n, r) => n + r.rr, 0), calls: rows.reduce((n, r) => n + r.calls, 0), requests: rows.length })
// C.1: rows = 3 (auth) + 2 (TOP, AT) + e + 2S + g + 7P + L + lambda + 1 (exactness TOP), for one answer that fetched events.
const formulaRows = (t) => 3 + 2 + t.e + 2 * t.S + t.g + 7 * t.P + t.L + t.lambda + 1
// Pins: [name, limit of rows, limit of calls or null]. A pin is within when the figure is at most its limit; the self-check below proves each one turns red one above.
const within = (value, limit) => value <= limit

;(async () => {
  const limits = limitsOf('free')
  const world = await bootWorld({ tier: 'free', seedVariant: 'base', switches: { ic_simple: 'on', ic_marks: 'on', ic_wired: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', catalog_ranked_scope: 'on' } })
  const out = { world: WORLD, command: `WORLD=${WORLD} node scripts/test-inventory-check-marks-cost-native.cjs`, measured: {}, notMeasured: ['CPU of a snapshot page and of a changes answer (Node, median of 5)', 'S0b parity'] }
  try {
    const days = WORLD === 'C' ? 365 : WORLD === 'B' ? 30 : 0
    const anchor = world.ctx.anchor.replace(' ', 'T') + '.000Z'
    if (days) await injectYear((sql, ...v) => world.db.prepare(sql).bind(...v).run(), world.orgId, anchor, { days, backlog: WORLD === 'C' })
    out.sizes = (await world.all(`SELECT (SELECT COUNT(*) FROM inventory_check_sessions) AS sessions, (SELECT COUNT(*) FROM inventory_check_items) AS items, (SELECT COUNT(*) FROM inventory_check_items WHERE state IN ('done','issue')) AS counted, (SELECT COUNT(*) FROM inventory_check_events) AS events, (SELECT COUNT(*) FROM inventory_check_approvals WHERE status='pending') AS pending_approvals, (SELECT COUNT(*) FROM products WHERE is_active=1) AS active_products`))[0]
    out.limits = { pageEvents: limits.inventoryMarksChangesPageEvents, touchedMax: limits.inventoryMarksTouchedMax, pendingPageApprovals: limits.inventoryMarksPendingPageApprovals }
    const counterCookie = await counter(world)
    const device = new Device(world, 1, { trace: true })
    const base0 = await world.send('GET', `${IC}/marks/changes?branchId=1&since=-1&tag=`)
    out.measured.authBaseline = { status: base0.status, rr: base0.rr, calls: base0.calls }
    // The terms of C.1 for one logged changes answer, read back from the event log it fetched (events are immutable, so the log is read after the fact).
    const legacyOf = async (ids) => (ids.length ? (await world.all(`SELECT COUNT(*) AS g, COALESCE(SUM(a.lines), 0) AS l FROM inventory_check_approvals a WHERE a.status='pending' AND a.line_set_json IS NULL AND a.session_id IN (SELECT value FROM json_each(?))`, JSON.stringify(ids)))[0] : { g: 0, l: 0 })
    const termsOf = async (entry) => {
      const fetched = await world.all('SELECT id, session_id, product_id FROM inventory_check_events WHERE id > ? AND id <= ? ORDER BY id LIMIT ?', entry.chg.since, entry.chg.top, limits.inventoryMarksChangesPageEvents)
      if (!fetched.length) return { e: 0, S: 0, P: 0, g: 0, L: 0, lambda: 0, idle: true }
      const sessionsOf = [...new Set(fetched.map((r) => r.session_id))]
      const walked = fetched.filter((r) => r.id <= entry.chg.cursor)
      const legacy = await legacyOf([...new Set(walked.map((r) => r.session_id))])
      return { e: fetched.length, S: sessionsOf.length, P: new Set(walked.filter((r) => r.product_id != null).map((r) => r.product_id)).size, g: Number(legacy.g), L: Number(legacy.l), lambda: 0 }
    }
    const chainOf = async (entries) => {
      const answers = []
      for (const entry of entries.filter((x) => x.chg)) { const t = await termsOf(entry); answers.push({ since: entry.chg.since, cursor: entry.chg.cursor, more: entry.chg.more, rows: entry.rr, calls: entry.calls, ...t, formula: t.idle ? 5 : formulaRows(t) }) }
      const total = sum(entries)
      return { rows: total.rows, calls: total.calls, reads: answers.length, formula: answers.reduce((n, a) => n + a.formula, 0), e: answers.reduce((n, a) => n + a.e, 0), S: answers.reduce((n, a) => n + a.S, 0), P: answers.reduce((n, a) => n + a.P, 0), answers }
    }
    // 1. Snapshot, every occupied page cold (cache bypassed), and the pending build.
    const t0 = device.log.length
    await device.build()
    const build = device.log.slice(t0)
    out.measured.snapshotCold = { ...sum(build.filter((r) => r.url.includes('/marks?'))), pages: build.filter((r) => r.url.includes('/marks?')).map((r) => ({ url: r.url, rr: r.rr, calls: r.calls })) }
    out.measured.pendingBuild = sum(build.filter((r) => r.url.includes('/marks/pending')))
    out.measured.firstChanges = sum(build.filter((r) => r.url.includes('/marks/changes')))
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
    out.measured.changesIdleStatements = (await world.last()).stmts.map((x) => ({ sql: x.raw.slice(0, 90).split(/\s+/).join(' '), rr: x.rr }))
    // 4. Changes after one 20-line submit (the submit itself is recorded).
    const fresh = async (n, off) => world.all(`SELECT p.id AS id, bs.quantity AS q FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=1 WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0 ORDER BY p.id DESC LIMIT ? OFFSET ?`, n, off)
    const lines = (ps, every) => ps.map((p, i) => ({ productId: p.id, countedQuantity: every && i % every === 0 ? p.q + 1 : p.q, seenQuantity: p.q }))
    const twenty = await fresh(20, 0)
    const submit = await world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: lines(twenty, 5) }, { cookie: counterCookie })
    out.measured.submit20 = { status: submit.status, rr: submit.rr, rw: submit.rw, calls: submit.calls }
    const s0 = device.log.length
    await device.sync()
    out.measured.changesAfterSubmit20 = await chainOf(device.log.slice(s0))
    out.measured.changesAfterSubmit20Statements = (await world.last()).stmts.map((x) => ({ sql: x.raw.slice(0, 100).split(/\s+/).join(' '), rr: x.rr }))
    // 5. Approve all of 200 lines: five submissions of 40 differing lines, then the device catches up on them (not measured), then they are approved, then the device catches up on the approvals only (the pin).
    //    A second device that stayed before the submissions answers both at once: the figure the previous slice measured (1,832 rows), which Q-L3 explains.
    const big = await fresh(200, 20)
    const old = Object.assign(new Device(world, 1), { cursor: device.cursor, tag: device.tag })
    const sessions = []
    for (let i = 0; i < 200; i += 40) { const r = await world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: lines(big.slice(i, i + 40), 1) }, { cookie: counterCookie }); assert.equal(r.status < 300, true, 'submit 40: ' + r.text.slice(0, 200)); sessions.push(r.json.sessionId || r.json.session_id || (r.json.item && r.json.item.id)) }
    await device.sync()
    const approvalFrom = Number((await world.all('SELECT COALESCE(MAX(id), 0) AS top FROM inventory_check_events'))[0].top)
    const approvals = []
    for (const sid of sessions) { for (let n = 0; n < 80; n++) { const r = await world.send('POST', `${IC}/sessions/${sid}/approval`, { decision: 'approve', requestId: rid('ap') }); approvals.push({ rr: r.rr, rw: r.rw, calls: r.calls, status: r.status }); if (r.status >= 300 || r.json.done !== false) break } }
    out.measured.approvalPath = { requests: approvals.length, rrMax: Math.max(...approvals.map((a) => a.rr)), callsMax: Math.max(...approvals.map((a) => a.calls)), statuses: [...new Set(approvals.map((a) => a.status))] }
    // Q-L3: the events the approvals wrote, by action and by whether they name a product and what the key looks like.
    const actions = await world.all(`SELECT action, product_id IS NULL AS no_product, CASE WHEN request_id LIKE '%-end' THEN 'key-end' WHEN request_id LIKE '%-takeover' THEN 'key-takeover' ELSE 'key-line' END AS key_kind, COUNT(*) AS n, COUNT(DISTINCT product_id) AS products FROM inventory_check_events WHERE id > ? GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, approvalFrom)
    const wrote = actions.reduce((n, r) => n + Number(r.n), 0)
    out.measured.qL3 = { approvedLines: 200, approvalEvents: wrote, perApprovedLine: wrote / 200, actions: actions.map((r) => ({ action: r.action, noProduct: Number(r.no_product) === 1, keyKind: r.key_kind, events: Number(r.n), products: Number(r.products) })) }
    const a0 = device.log.length
    await device.sync()
    out.measured.changesAfterApprove200 = await chainOf(device.log.slice(a0))
    out.measured.changesAfterApprove200Statements = (await world.last()).stmts.map((x) => ({ sql: x.raw.slice(0, 100).split(/\s+/).join(' '), rr: x.rr }))
    const o0 = old.log.length
    await old.sync()
    out.measured.changesAfterSubmitsAndApprovals200 = await chainOf(old.log.slice(o0))
    // 6. A 500-line plain submission with ic_wired OFF (the plain writer takes 500 lines on Free), then the device catches up. The terms printed are the ones the formula is evaluated with.
    await world.addSwitches([], { without: ['ic_wired'] })
    await world.restart()
    // The restart gives a cold isolate: its first request pays the schema probe (about 824 rows of sqlite_master). That is the harness, not the read, so one idle changes read warms the isolate before the chain and is not counted.
    await world.send('GET', `${IC}/marks/changes?branchId=1&since=${device.cursor}&tag=${device.tag}`)
    const five = await fresh(500, 220)
    assert.equal(five.length, 500, 'products left for the 500-line submission: ' + five.length)
    const plain500 = await world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: five.map((p) => ({ productId: p.id, countedQuantity: p.q + 1, seenQuantity: p.q })) }, { cookie: counterCookie })
    await world.restoreSwitches()
    out.measured.submit500 = { status: plain500.status, rr: plain500.rr, rw: plain500.rw, calls: plain500.calls }
    assert.equal(plain500.status < 300, true, '500-line plain submission: ' + plain500.status + ' ' + plain500.text.slice(0, 300))
    const p0 = device.log.length
    await device.sync()
    out.measured.changesAfterPlain500 = await chainOf(device.log.slice(p0))
    // The proof of the 500-line excess (lead's request): per statement of each read, the events each read fetched by session and product, and the waiting entries each answer sent.
    out.measured.plain500Trace = []
    for (const entry of device.log.slice(p0).filter((x) => x.chg)) {
      const events = await world.all('SELECT session_id, product_id IS NULL AS no_product, action, COUNT(*) AS n FROM inventory_check_events WHERE id > ? AND id <= ? GROUP BY 1, 2, 3 ORDER BY 1, 2, 3', entry.chg.since, Math.min(entry.chg.cursor, entry.chg.since + limits.inventoryMarksChangesPageEvents))
      out.measured.plain500Trace.push({ since: entry.chg.since, cursor: entry.chg.cursor, rows: entry.rr, calls: entry.calls, statements: entry.stmts, waitingEntries: entry.chg.waiting, marks: entry.chg.marks, eventsBySession: events })
    }
    out.measured.plain500Session = (await world.all("SELECT s.id AS id, a.lines AS lines, (SELECT COUNT(*) FROM json_each(a.line_set_json)) AS set_keys, a.status AS status FROM inventory_check_approvals a JOIN inventory_check_sessions s ON s.id = a.session_id ORDER BY s.rowid DESC LIMIT 3"))
    // The budgets (G.3 A1c; gross, auth included, formula + 10 percent). Written first, asserted last.
    const m = out.measured
    const pinOf = (name, value, limit, extra) => ({ name, value, limit, ok: within(value, limit), ...extra })
    const pins = [
      pinOf('changesAfterSubmit20 rows <= 186', m.changesAfterSubmit20.rows, 186), pinOf('changesAfterSubmit20 calls <= 4', m.changesAfterSubmit20.calls, 4),
      pinOf('changesAfterApprove200 rows <= 1784', m.changesAfterApprove200.rows, 1784),
      pinOf('changesIdle rows <= 6', m.changesIdle.rr, 6), pinOf('changesIdle calls <= 2', m.changesIdle.calls, 2),
      pinOf('pendingBuild rows <= 2730', m.pendingBuild.rows, 2730),
      pinOf('plain 500-line submission read in <= 3 reads', m.changesAfterPlain500.reads, 3),
    ]
    for (const pin of pins) assert.equal(within(pin.limit + 1, pin.limit), false, 'MUTANT: a figure one above ' + pin.name + ' must be red')
    const over = (chain, name) => ({ name: name + ' within 10 percent of its formula', ok: chain.rows <= Math.floor(1.1 * chain.formula), value: chain.rows, limit: Math.floor(1.1 * chain.formula) })
    const formulaChecks = [over(m.changesAfterSubmit20, 'changesAfterSubmit20'), over(m.changesAfterApprove200, 'changesAfterApprove200'), over(m.changesAfterSubmitsAndApprovals200, 'changesAfterSubmitsAndApprovals200')]
    const go = [{ name: 'snapshotCold rows <= 60000 (the spike\'s check, left as it is: A4 sets the page size)', ok: m.snapshotCold.rows <= 60000, value: m.snapshotCold.rows, limit: 60000 }, ...pins, ...formulaChecks]
    out.go = go
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
    console.log(JSON.stringify(out, null, 1))
    for (const g of out.go) console.log((g.ok ? 'PASS ' : 'OVER ') + g.name + ' (' + g.value + ' vs ' + g.limit + ')')
    process.exitCode = out.go.every((g) => g.ok) ? 0 : 1
  } finally { await world.dispose() }
})().catch((e) => { console.error('FAIL ' + (e.stack || e)); process.exit(1) })
