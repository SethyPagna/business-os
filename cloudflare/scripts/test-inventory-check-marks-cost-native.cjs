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
const { Device, counter, limitsOf, numbered, loadMarksLib } = require('./test-inventory-check-marks-oracle-native.cjs')

const IC = '/api/inventory-checks'
const WORLD = process.env.WORLD || 'A'
const OUT = process.argv[2]
const rid = (p) => `${p}-${crypto.randomBytes(8).toString('hex')}`
const sum = (rows) => ({ rows: rows.reduce((n, r) => n + r.rr, 0), calls: rows.reduce((n, r) => n + r.calls, 0), requests: rows.length })
// C.1 as corrected by the A1d ruling: rows = 3 (auth) + 2 (TOP, AT) + e + 2S + g + 7P + L + lambda + 1 (exactness TOP) + K, for one answer that fetched events.
// K = the line-set keys of the pending sessions the answer walks: a session is walked only when a fetched event of it can change its waiting set (a create event, or an after_json that carries "approval").
const formulaRows = (t) => 3 + 2 + t.e + 2 * t.S + t.g + 7 * t.P + t.L + t.lambda + 1 + t.K
// A1d mutants, applied to the Worker source of this run (MUTANT=walk-on-observe: every observe walks, as the tip did): the 500-line pin must turn red.
const PATCHES = { 'walk-on-observe': { name: 'walk on observe', file: 'src/lib/inventoryCheckMarks.ts', from: "row.action === 'create' || Number(row.decides) === 1", to: "row.action !== 'close'" } }
const MUTANT = process.env.MUTANT || ''
if (MUTANT && !PATCHES[MUTANT]) throw new Error('unknown MUTANT ' + MUTANT)
// Pins: [name, limit of rows, limit of calls or null]. A pin is within when the figure is at most its limit; the self-check below proves each one turns red one above.
const within = (value, limit) => value <= limit
// The D1 time of SCOPE_WAITING_SQL over 500 pending sessions of 20 lines (lead ruling 2, 24 Nov): D1 query time is I/O wait, not Worker CPU, so this is a regression guard, not a CPU limit.
const SCOPE_READ_MEDIAN_MS = 100

;(async () => {
  const limits = limitsOf('free')
  const world = await bootWorld({ tier: 'free', seedVariant: 'base', patches: MUTANT ? [PATCHES[MUTANT]] : [], switches: { ic_simple: 'on', ic_marks: 'on', ic_wired: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', catalog_ranked_scope: 'on' } })
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
    const keysOf = async (ids) => (ids.length ? Number((await world.all("SELECT COALESCE(SUM((SELECT COUNT(*) FROM json_each(a.line_set_json))), 0) AS k FROM inventory_check_approvals a WHERE a.status='pending' AND a.line_set_json IS NOT NULL AND a.session_id IN (SELECT value FROM json_each(?))", JSON.stringify(ids)))[0].k) : 0)
    const termsOf = async (entry) => {
      const fetched = await world.all("SELECT id, session_id, product_id, action, CASE WHEN json_valid(after_json) THEN json_extract(after_json,'$.approval') IS NOT NULL ELSE 1 END AS decides FROM inventory_check_events WHERE id > ? AND id <= ? ORDER BY id LIMIT ?", entry.chg.since, entry.chg.top, limits.inventoryMarksChangesPageEvents)
      if (!fetched.length) return { e: 0, S: 0, P: 0, g: 0, L: 0, lambda: 0, K: 0, idle: true }
      const sessionsOf = [...new Set(fetched.map((r) => r.session_id))]
      const changing = [...new Set(fetched.filter((r) => r.action === 'create' || Number(r.decides) === 1).map((r) => r.session_id))]
      const walked = fetched.filter((r) => r.id <= entry.chg.cursor)
      const legacy = await legacyOf([...new Set(walked.map((r) => r.session_id))])
      return { e: fetched.length, S: sessionsOf.length, P: new Set(walked.filter((r) => r.product_id != null).map((r) => r.product_id)).size, g: Number(legacy.g), L: Number(legacy.l), lambda: 0, K: await keysOf(changing) }
    }
    const chainOf = async (entries) => {
      const answers = []
      for (const entry of entries.filter((x) => x.chg)) { const t = await termsOf(entry); answers.push({ since: entry.chg.since, cursor: entry.chg.cursor, more: entry.chg.more, rows: entry.rr, calls: entry.calls, ...t, formula: t.idle ? 5 : formulaRows(t) }) }
      const total = sum(entries)
      return { rows: total.rows, calls: total.calls, reads: answers.length, formula: answers.reduce((n, a) => n + a.formula, 0), e: answers.reduce((n, a) => n + a.e, 0), S: answers.reduce((n, a) => n + a.S, 0), P: answers.reduce((n, a) => n + a.P, 0), K: answers.reduce((n, a) => n + a.K, 0), answers }
    }
    // 1. Snapshot, every occupied page cold (cache bypassed), and the pending build.
    const t0 = device.log.length
    await device.build()
    const build = device.log.slice(t0)
    out.measured.snapshotCold = { ...sum(build.filter((r) => r.url.includes('/marks?'))), pages: build.filter((r) => r.url.includes('/marks?')).map((r) => ({ url: r.url, rr: r.rr, calls: r.calls })) }
    // The cold snapshot formula (C.1, snapshot part; lead ruling 1 of 24 Nov): rows = 7 x P + pages x (4 + bucket probes). P = the products of the world (every product id of a page range is seeked, active or not), pages = the cold page requests of the build,
    // 4 = 3 (auth) + 1 (TOP) per page request, bucket probes = the occupied id ranges (one MIN(id) primary-key probe each), counted here by SQL on the products table, not by the route's statement.
    const coldTerms = (await world.all('SELECT COUNT(*) AS p, COUNT(DISTINCT CAST(id AS INTEGER) / CAST(? AS INTEGER)) AS buckets FROM products WHERE id >= 0', limits.inventoryMarksPageIds))[0]
    out.measured.snapshotColdTerms = { P: Number(coldTerms.p), pages: out.measured.snapshotCold.pages.length, bucketProbes: Number(coldTerms.buckets) }
    out.measured.snapshotColdTerms.formula = 7 * out.measured.snapshotColdTerms.P + out.measured.snapshotColdTerms.pages * (4 + out.measured.snapshotColdTerms.bucketProbes)
    out.measured.snapshotColdTerms.pin = Math.ceil(1.1 * out.measured.snapshotColdTerms.formula)
    out.measured.snapshotColdTerms.pinWithoutPageOverhead = Math.ceil(1.1 * 7 * out.measured.snapshotColdTerms.P)
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
    // A second device that holds the same cursor reads after the first one computed: the shared answer (B.5, A3). Its first changes read is served from the stored answer after ONE validation call (TOP_SQL, AT_SQL for since, AT_SQL for the stored cursor).
    const twin = Object.assign(new Device(world, 1, { miss: false }), { cursor: device.cursor, tag: device.tag })
    const s0 = device.log.length
    await device.sync()
    out.measured.changesAfterSubmit20 = await chainOf(device.log.slice(s0))
    const t0twin = twin.log.length
    await twin.sync()
    out.measured.changesCacheHit = twin.log.slice(t0twin).find((x) => x.chg)
    out.measured.changesCacheHitComputedBy = { rows: out.measured.changesAfterSubmit20.answers[0].rows, calls: out.measured.changesAfterSubmit20.answers[0].calls }
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
    out.measured.plain500Reads = out.measured.changesAfterPlain500.answers.map((a, k) => 'READ ' + (k + 1) + ' (' + MUTANT + ' world ' + WORLD + '): rows ' + a.rows + ', calls ' + a.calls + ', K ' + a.K + ', formula ' + a.formula + ' = 5 + e ' + a.e + ' + 2S ' + 2 * a.S + ' + 7P ' + 7 * a.P + ' + 1 + K ' + a.K + ' (g ' + a.g + ', L ' + a.L + ', lambda ' + a.lambda + '), 1.1 x formula ' + Math.floor(1.1 * a.formula) + ', more ' + a.more)
    // The proof of the 500-line excess (lead's request): per statement of each read, the events each read fetched by session and product, and the waiting entries each answer sent.
    out.measured.plain500Trace = []
    for (const entry of device.log.slice(p0).filter((x) => x.chg)) {
      const events = await world.all('SELECT session_id, product_id IS NULL AS no_product, action, COUNT(*) AS n FROM inventory_check_events WHERE id > ? AND id <= ? GROUP BY 1, 2, 3 ORDER BY 1, 2, 3', entry.chg.since, Math.min(entry.chg.cursor, entry.chg.since + limits.inventoryMarksChangesPageEvents))
      out.measured.plain500Trace.push({ since: entry.chg.since, cursor: entry.chg.cursor, rows: entry.rr, calls: entry.calls, statements: entry.stmts, waitingEntries: entry.chg.waiting, marks: entry.chg.marks, eventsBySession: events })
    }
    out.measured.plain500Session = (await world.all("SELECT s.id AS id, a.lines AS lines, (SELECT COUNT(*) FROM json_each(a.line_set_json)) AS set_keys, a.status AS status FROM inventory_check_approvals a JOIN inventory_check_sessions s ON s.id = a.session_id ORDER BY s.rowid DESC LIMIT 3"))
    // 7. A4 (amendment 1.1 D.2): the rows D1 returned for the JavaScript probe, and the D1 time of the scope read. The statements run through the marks library itself, on a database that wraps the world's D1 and keeps each batch's results.
    //    Synthetic world: ids, numbers, UUID-like session ids and timestamps only.
    const lib = await loadMarksLib([])
    const recording = () => { const batches = [], times = []; return { batches, times, async batch(statements) {
      const started = process.hrtime.bigint()
      const result = await world.db.batch(statements.map((s) => { const q = numbered(s.sql, s.params ?? {}); return world.db.prepare(q.sql).bind(...q.values) }))
      times.push({ wallMs: Number(process.hrtime.bigint() - started) / 1e6, statements: result.map((r, k) => ({ head: statements[k].sql.slice(0, 60).split(' ').join(' '), durationMs: r.meta ? r.meta.duration : null, rowsRead: r.meta ? r.meta.rows_read : null })) })
      batches.push(result.map((r) => r.results))
      return result } } }
    const scope = { organization: world.orgId, branchId: 1 }
    // D.2.1: one cold page of 2,000 ids (ids 2000..3999) whatever the pinned page size is: the probe slices it to 1,000 and 500 for D.3.
    const recordedPageIds = 2000
    const snap = recording(); await lib.readSnapshotPage(snap, scope, 1, recordedPageIds)
    const first = out.measured.changesAfterPlain500.answers[0]
    const atRow = (await world.all('SELECT id, actor_id, request_id, created_at FROM inventory_check_events WHERE id = ?', first.since))[0]
    const atTag = atRow ? lib.eventTag(atRow) : ''
    const chg = recording(); const chgAnswer = await lib.readChanges(chg, scope, first.since, atTag, { pageEvents: limits.inventoryMarksChangesPageEvents, touchedMax: limits.inventoryMarksTouchedMax })
    const pend = recording(); await lib.readPendingPage(pend, scope, null, limits.inventoryMarksPendingPageApprovals)
    const recorded = { format: 1, world: 'C', note: 'The rows D1 returned (local world C): one cold snapshot page, one changes answer and one pending page; ids, numbers, session ids and timestamps only.',
      limits: { pageIds: recordedPageIds, pageEvents: limits.inventoryMarksChangesPageEvents, touchedMax: limits.inventoryMarksTouchedMax, pageApprovals: limits.inventoryMarksPendingPageApprovals },
      scope, snapshot: { page: 1, batches: snap.batches }, changes: { since: first.since, tag: atTag, batches: chg.batches }, pending: { batches: pend.batches } }
    if (WORLD === 'C' && process.env.RECORD_FIXTURE) fs.writeFileSync(process.env.RECORD_FIXTURE, JSON.stringify(recorded))
    out.measured.recorded = { snapshotRows: snap.batches[0][2].length, changesEvents: chg.batches[0][2].length, changesBatches: chg.batches.length, changesMarks: chgAnswer.marks ? chgAnswer.marks.length : 0, changesWaitingEntries: chgAnswer.waiting ? chgAnswer.waiting.length : 0, pendingRows: pend.batches[0][1].length, fixtureBytes: JSON.stringify(recorded).length }
    // D.2.6: SCOPE_WAITING_SQL over 500 pending sessions of 20 lines each, applied_json and line_decisions_json filled. World C holds 100 such sessions (hw-, line set only); 400 more (hx-, all three columns filled) are written to this local database only, after every pin above was read. World A and B hold no such backlog: the timing is world C only.
    if (WORLD === 'C') {
      const extra = 400
      await world.db.prepare("WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k < " + (extra - 1) + ") INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) SELECT 'hx-'||k, ?, 1, 1, 'Scope '||k, 'closed', 0, '{\"membership\":\"submission\"}', strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(k + 200)||' minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(k + 200)||' minutes'), strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-'||(k + 200)||' minutes') FROM s").bind(world.orgId, anchor, anchor, anchor).run()
      const line = "json_object('decision', 'approve', 'by', 1, 'at', '2026-11-24T00:00:00.000Z', 'note', 'synthetic line decision of the scope read timing')"
      const lineSet = "(SELECT json_group_object(CAST(100000 + ?1 * 20 + x AS TEXT), 1) FROM (WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x < 19) SELECT x FROM n))"
      const decided = "(SELECT json_group_object(CAST(100000 + ?1 * 20 + x AS TEXT), " + line + ") FROM (WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x < 19) SELECT x FROM n))"
      const applied = "(SELECT json_object('lines', json_group_object(CAST(100000 + ?1 * 20 + x AS TEXT), " + line + ")) FROM (WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x < 3) SELECT x FROM n))"
      for (let k = 0; k < extra; k++) {
        await world.db.prepare("INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json,line_set_json,applied_json,line_decisions_json) SELECT 'hx-'||?1, ?2, 1, 'pending', 20, 1, s.started_at, '{}', " + lineSet + ", " + applied + ", " + decided + " FROM inventory_check_sessions s WHERE s.id = 'hx-'||?1").bind(String(k), world.orgId).run()
      }
      const sessionIds = (await world.all("SELECT s.id AS id FROM inventory_check_sessions s JOIN inventory_check_approvals a ON a.session_id = s.id WHERE a.status = 'pending' AND (s.id LIKE 'hw-%' OR s.id LIKE 'hx-%') ORDER BY s.id")).map((r) => r.id)
      assert.equal(sessionIds.length, 500, 'pending sessions for the scope read: ' + sessionIds.length)
      const bytes = (await world.all("SELECT AVG(length(applied_json)) AS applied, AVG(length(line_decisions_json)) AS decisions, AVG(length(line_set_json)) AS line_set FROM inventory_check_approvals WHERE session_id LIKE 'hx-%'"))[0]
      const scopeProbe = recording(); const walls = [], durations = []
      for (let rep = 0; rep < 9; rep++) {
        await scopeProbe.batch([{ sql: lib.SCOPE_WAITING_SQL, params: { ...scope, sessions: JSON.stringify(sessionIds), walk: sessionIds.length } }])
        const t = scopeProbe.times[scopeProbe.times.length - 1]; walls.push(t.wallMs); durations.push(t.statements[0].durationMs)
      }
      const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
      out.measured.scopeRead = { sessions: sessionIds.length, linesEach: 20, rowsRead: scopeProbe.times[0].statements[0].rowsRead, bytesAverage: { lineSet: Math.round(Number(bytes.line_set)), applied: Math.round(Number(bytes.applied)), decisions: Math.round(Number(bytes.decisions)) },
        metaDurationMs: durations, wallMs: walls, medianMetaDurationMs: median(durations), medianWallMs: median(walls), passLineMs: SCOPE_READ_MEDIAN_MS,
        note: 'local miniflare D1 on the laptop: the SQL engine time of the statement, as the spike measured it; not production D1' }
    }
    // The budgets (G.3 A1c; gross, auth included, formula + 10 percent). Written first, asserted last.
    const m = out.measured
    const pinOf = (name, value, limit, extra) => ({ name, value, limit, ok: within(value, limit), ...extra })
    const pins = [
      pinOf('changesAfterSubmit20 rows <= 186', m.changesAfterSubmit20.rows, 186), pinOf('changesAfterSubmit20 calls <= 4', m.changesAfterSubmit20.calls, 4),
      pinOf('changesAfterApprove200 rows <= 1784', m.changesAfterApprove200.rows, 1784),
      pinOf('changesIdle rows <= 6', m.changesIdle.rr, 6), pinOf('changesIdle calls <= 2', m.changesIdle.calls, 2),
      // A3 (G.3): a cache hit at most 8 gross rows and 2 calls = the estimate of B.5 (7 gross: 3 auth + TOP + two AT rows + the closing row of the answer's own check) + 10 percent; A5 replaces the estimate by the measured figure + 10 percent.
      pinOf('changes cache hit rows <= 8', m.changesCacheHit.rr, 8, { computedBy: m.changesCacheHitComputedBy }), pinOf('changes cache hit calls <= 2', m.changesCacheHit.calls, 2),
      pinOf('pendingBuild rows <= 2730', m.pendingBuild.rows, 2730),
      pinOf('snapshotCold rows <= ceil(1.1 x (7 x P + pages x (4 + bucket probes)))', m.snapshotCold.rows, m.snapshotColdTerms.pin),
      pinOf('plain 500-line submission read in <= 3 reads', m.changesAfterPlain500.reads, 3),
    ]
    for (const pin of pins) assert.equal(within(pin.limit + 1, pin.limit), false, 'MUTANT: a figure one above ' + pin.name + ' must be red')
    const over = (chain, name) => ({ name: name + ' within 10 percent of its formula', ok: chain.rows <= Math.floor(1.1 * chain.formula), value: chain.rows, limit: Math.floor(1.1 * chain.formula) })
    // The 500-line chain (A1d): the whole chain and each read within 1.1 x its formula (K included), and read 2 walks no line set: its scope statement reads 3 rows for its one session (session row, approval row, one key of the session list).
    const scopeRows = (trace) => (trace.statements || []).filter((x) => x.sql.includes('AS approval')).reduce((n, x) => n + x.rr, 0)
    const plainReads = m.changesAfterPlain500.answers.map((a, k) => ({ name: 'changesAfterPlain500 read ' + (k + 1) + ' within 10 percent of its formula', ok: a.rows <= Math.floor(1.1 * a.formula), value: a.rows, limit: Math.floor(1.1 * a.formula) }))
    const secondScope = m.plain500Trace.length > 1 ? scopeRows(m.plain500Trace[1]) : 0
    const secondS = m.changesAfterPlain500.answers.length > 1 ? m.changesAfterPlain500.answers[1].S : 0
    const formulaChecks = [over(m.changesAfterSubmit20, 'changesAfterSubmit20'), over(m.changesAfterApprove200, 'changesAfterApprove200'), over(m.changesAfterSubmitsAndApprovals200, 'changesAfterSubmitsAndApprovals200'),
      over(m.changesAfterPlain500, 'changesAfterPlain500'), ...plainReads,
      { name: 'changesAfterPlain500 read 2 scope statement rows <= 1.1 x (3 x S)', ok: secondScope <= Math.floor(1.1 * 3 * secondS), value: secondScope, limit: Math.floor(1.1 * 3 * secondS) }]
    const go = [...pins, ...formulaChecks, ...(m.scopeRead ? [{ name: 'SCOPE_WAITING_SQL over 500 pending sessions: median D1 time <= ' + SCOPE_READ_MEDIAN_MS + ' ms (regression guard, lead ruling 2; D1 time is I/O wait, not Worker CPU)', ok: m.scopeRead.medianMetaDurationMs <= SCOPE_READ_MEDIAN_MS, value: m.scopeRead.medianMetaDurationMs, limit: SCOPE_READ_MEDIAN_MS }] : [])]
    out.go = go
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
    console.log(JSON.stringify(out, null, 1))
    for (const line of m.plain500Reads) console.log(line)
    const ct = m.snapshotColdTerms
    console.log('SNAPSHOT COLD (world ' + WORLD + '): measured ' + m.snapshotCold.rows + ' rows, formula 7 x P ' + ct.P + ' + pages ' + ct.pages + ' x (4 + bucket probes ' + ct.bucketProbes + ') = ' + ct.formula + ', pin ceil(1.1 x formula) = ' + ct.pin + '; measured / formula = ' + (m.snapshotCold.rows / ct.formula).toFixed(4) + '; pin without the page overhead term = ' + ct.pinWithoutPageOverhead + ', measured over it: ' + (m.snapshotCold.rows > ct.pinWithoutPageOverhead))
    console.log('CACHE HIT (world ' + WORLD + '): the second device read ' + m.changesCacheHit.rr + ' rows in ' + m.changesCacheHit.calls + ' calls (gross, auth included; estimate 7 rows, 2 calls; pin 8 rows, 2 calls); the first device computing the same answer read ' + m.changesCacheHitComputedBy.rows + ' rows in ' + m.changesCacheHitComputedBy.calls + ' calls')
    if (m.scopeRead) console.log('SCOPE READ (world ' + WORLD + '): median D1 time ' + m.scopeRead.medianMetaDurationMs + ' ms over ' + m.scopeRead.metaDurationMs.length + ' reps (' + m.scopeRead.metaDurationMs.join(', ') + '), rows read ' + m.scopeRead.rowsRead + ', guard ' + SCOPE_READ_MEDIAN_MS + ' ms')
    for (const g of out.go) console.log((g.ok ? 'PASS ' : 'OVER ') + g.name + ' (' + g.value + ' vs ' + g.limit + ')')
    process.exitCode = out.go.every((g) => g.ok) ? 0 : 1
  } finally { await world.dispose() }
})().catch((e) => { console.error('FAIL ' + (e.stack || e)); process.exit(1) })
