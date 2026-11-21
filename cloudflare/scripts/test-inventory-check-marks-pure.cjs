// The count marks routes (read switch ic_marks, lib/inventoryCheckMarks.ts, routes/inventoryChecks.ts): the facts the source must keep, each pinned by a text check with a mutant proving it red.
//   I5  the cursor read and the page read are ONE db.batch call (never two), so a page is exactly the state at its cursor.
//   I9  Waiting is computed for every viewer and stripped at serve time by the route unless the viewer has the stock field and Fix stock; /marks/pending is 403 otherwise; the snapshot never holds Waiting.
//   OFF the three routes answer 404 (marksStart returns null first thing) and capabilities.marks is absent.
//   No plan-sized number is written in the marks files (every limit comes from getPlanLimits).
//   The waiting-lines text is the overlay's, byte for byte (one rule for a waiting line).
//   A.3 the changes read is by session: no statement driven from the pending approvals, the last batch ends with TOP_SQL (exactness), legacy sessions cost their items in the walk.
//   A1d the changes read walks a pending session's line set only when the answer's events include one that can change it (a submission, or an approval write whose after_json carries "approval"); the registry test keeps every writer of a waiting set paired with such an event.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const ROOT = path.resolve(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const lib = read('src/lib/inventoryCheckMarks.ts')
const route = read('src/routes/inventoryChecks.ts')
const overlay = read('src/lib/inventoryCheckOverlay.ts')
const norm = (s) => s.replace(/\s+/g, ' ').trim()
let failed = 0
const check = (name, fn) => { try { fn(); console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ' - ' + e.message.split('\n')[0]) } }

const fn = (src, head, next) => { const a = src.indexOf(head); assert.ok(a >= 0, 'missing ' + head); const b = src.indexOf(next, a + head.length); return src.slice(a, b < 0 ? undefined : b) }
const marksRoutes = (src) => src.slice(src.indexOf('// ---- ic_marks:'), src.indexOf("app.get('/sessions'"))

// The marks file compiled and run against a stub database: the statements it sends and the answers it builds are observed, not read from the source.
const loadLib = (libText) => {
  const js = ts.transpileModule(libText, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const stubs = { './inventoryCheckSessions': { waitingLineSql: (a, i) => `WAITING_LINE(${a},${i})`, waitingKeySql: (a, k) => `WAITING_KEY(${a},${k})` }, './productIdBuckets': { PRODUCT_ID_BUCKETS_SQL: 'BUCKETS' } }
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', js)(mod.exports, (id) => { assert.ok(stubs[id], 'unexpected import ' + id); return stubs[id] }, mod)
  return mod.exports
}
const ev = (id, session, product, over = {}) => ({ id, session_id: session, product_id: product, actor_id: 1, request_id: 'r' + id, created_at: 't' + id, action: 'observe', decides: 1, ...over })
const plainEv = (id, session, product) => ev(id, session, product, { decides: 0 })
const createEv = (id, session, product) => ev(id, session, product, { action: 'create', decides: 0 })
const topRow = (id) => [{ id, actor_id: 1, request_id: 'r' + id, created_at: 't' + id }]
const stubRun = (lib, plan) => {
  const batches = []
  const tops = [...plan.tops]
  const db = { async batch(statements) {
    batches.push(statements.map((s) => ({ sql: s.sql, params: s.params })))
    return statements.map((s) => ({ results: (() => {
      if (s.sql === lib.TOP_SQL) return topRow(tops.shift())
      if (s.sql === lib.AT_SQL) return []
      if (s.sql === lib.EVENTS_SQL) return plan.events
      if (s.sql === lib.SCOPE_WAITING_SQL) return plan.scope
      if (s.sql === lib.MARKS_BY_IDS_SQL) return plan.marks ?? []
      if (s.sql === lib.LEGACY_WAITING_SQL) return plan.legacy ?? []
      throw new Error('unexpected statement: ' + String(s.sql).slice(0, 80))
    })() }))
  } }
  return { batches, db }
}
const SCOPE = { organization: 1, branchId: 1 }
const scopeRow = (id, over = {}) => ({ id, approval: 1, status: 'pending', lines: 1, legacy: 0, items: null, waiting: '[]', ...over })
const changes = async (libText, plan, limits = { pageEvents: 50, touchedMax: 50 }) => {
  const lib = loadLib(libText), run = stubRun(lib, plan)
  const answer = await lib.readChanges(run.db, SCOPE, 0, '', limits)
  return { lib, answer, batches: run.batches }
}
const sqlOf = (batches) => batches.flat().map((s) => s.sql)

function suite(libText, routeText) {
  const results = []
  const pending = []
  const t = (name, f) => { try { const r = f(); if (r && typeof r.then === 'function') pending.push(r.then(() => results.push([name, null]), (e) => results.push([name, e.message.split('\n')[0]]))); else results.push([name, null]) } catch (e) { results.push([name, e.message.split('\n')[0]]) } }
  t('I5: the snapshot reads the cursor and the page in ONE batch call', () => {
    const body = fn(libText, 'export async function readSnapshotPage', '/** The validation read')
    assert.equal(body.split('db.batch(').length - 1, 1, 'exactly one batch call')
    assert.ok(/db\.batch\(\[[\s\S]*TOP_SQL[\s\S]*SNAPSHOT_PAGE_SQL[\s\S]*\]\)/.test(body), 'TOP_SQL and SNAPSHOT_PAGE_SQL in the same batch')
    assert.ok(!/\.prepare\(/.test(libText), 'no unbatched prepare in the marks reader')
  })
  t('I5: the changes feed reads top, the cursor event and the events in one batch', () => {
    const body = fn(libText, 'export async function readChanges', 'export type PendingAnswer')
    assert.ok(/db\.batch\(\[\{ sql: TOP_SQL \}, \{ sql: AT_SQL[^\]]*EVENTS_SQL/.test(body))
  })
  t('OFF: every marks route starts at marksStart and answers 404 when it returns null', () => {
    const routes = marksRoutes(routeText)
    assert.equal((routes.match(/const start = await marksStart\(c\)\n  if \(!start\) return notWired\(c\)/g) || []).length, 3, 'three routes')
    assert.ok(/async function marksStart[\s\S]{0,200}if \(!await readSwitch\(c\.env, 'ic_marks'\)\) return null/.test(routes), 'the switch is the first read')
    assert.ok(/marksCapability[\s\S]{0,200}if \(!await readSwitch\(c\.env, 'ic_marks'\)\) return \{\}/.test(routes), 'capabilities.marks absent while OFF')
  })
  t('I9: Waiting only behind the stock field and Fix stock', () => {
    const routes = marksRoutes(routeText)
    assert.ok(/permitted: access\.fields\.stock && await fixStockOn\(c\)/.test(routes))
    assert.ok(/if \(!start\.permitted\) throw new InventoryCheckQueryError\(403/.test(routes), '/marks/pending refuses an unpermitted viewer')
    const changesRoute = fn(routes, "app.get('/marks/changes'", "app.get('/marks/pending'")
    assert.ok(/start\.permitted \? answer : withoutWaiting\(answer\)/.test(changesRoute), 'the changes route strips waiting for a viewer who is not permitted, at serve time')
    assert.ok(/const withoutWaiting = /.test(routes) && /k !== 'waiting'/.test(routes), 'the strip removes the waiting key')
    assert.ok(!/permitted/.test(fn(libText, 'export async function readChanges', 'export type PendingAnswer')), 'readChanges does not depend on the permitted flag')
    assert.ok(!/SCOPE_WAITING_SQL|LEGACY_WAITING_SQL|PENDING_PAGE_SQL|waitingLineSql/.test(fn(libText, 'export const SNAPSHOT_PAGE_SQL', 'export const MARKS_BY_IDS_SQL')), 'the snapshot never holds Waiting')
  })
  t('no plan-sized literal in the marks files', () => {
    const code = (libText + marksRoutes(routeText)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/'[^'\n]*'|`[^`\n]*`/g, '""')
    const numbers = [...code.matchAll(/(?<![\w.$])(\d[\d_]*(?:\.\d+)?)(?![\w])/g)].map((m) => m[1]).filter((n) => !['0', '1', '2', '8', '15', '16', '0.5'].includes(n) && !/^0x/.test(n))
    assert.deepEqual([...new Set(numbers)].filter((n) => !['2440587.5', '86400000', '9', '400', '403', '40', '128'].includes(n)), [], 'literals ' + [...new Set(numbers)])
  })
  t('A1b: the marks file and the route name none of SCOPE_SQL, SESSION_PRODUCTS_SQL, PENDING_LINES_SQL', () => {
    const named = [...new Set((libText + '\n' + routeText).match(/\b(SCOPE_SQL|SESSION_PRODUCTS_SQL|PENDING_LINES_SQL)\b/g) || [])]
    assert.deepEqual(named, [], 'still named: ' + named)
  })
  t('A1b: readChanges runs no statement driven from the pending approvals', () => {
    const body = fn(libText, 'export async function readChanges', 'export type PendingAnswer')
    assert.ok(!body.includes('inventory_check_approvals_pending'), 'the function names the pending index')
    for (const name of new Set(body.match(/\b[A-Z][A-Z_]*_SQL\b/g) || [])) {
      const a = libText.indexOf('export const ' + name + ' = '); assert.ok(a >= 0, name + ' is not a constant of the marks file')
      const b = libText.indexOf('\nexport ', a + 1)
      assert.ok(!libText.slice(a, b < 0 ? undefined : b).includes('inventory_check_approvals_pending'), name + ' reads through the pending index')
    }
  })
  t('A.3: the scope read is by session, with legacy and items; legacy needs a pending approval', () => {
    const a = libText.indexOf('export const SCOPE_WAITING_SQL = '); assert.ok(a >= 0, 'SCOPE_WAITING_SQL is not exported')
    const sql = norm(libText.slice(a, libText.indexOf('\nexport ', a + 1)))
    assert.ok(sql.includes('FROM json_each(@sessions) w CROSS JOIN inventory_check_sessions s ON s.id = w.value'), 'driven from the touched session ids')
    assert.ok(sql.includes("a.line_set_json IS NULL AND a.session_id IS NOT NULL AND a.status = 'pending' AS legacy"), "legacy requires a.status = 'pending'")
    assert.ok(/AS items/.test(sql) && /json_extract\(e\.after_json,'\$\.members'\)/.test(sql), 'items comes from the create event')
    assert.ok(/\$\{waitingKeySql\('a', 'j\.key'\)\}/.test(libText.slice(a, libText.indexOf('\nexport ', a + 1))), 'the waiting list is built on waitingKeySql, the one copy of the line rule')
    assert.ok(/export const LEGACY_WAITING_SQL = /.test(libText), 'LEGACY_WAITING_SQL is exported')
  })
  t('A.3: the last batch of the changes read ends with TOP_SQL, so the answer is exact only when no event was written meanwhile', async () => {
    const named = await changes(libText, { tops: [10, 10], events: [ev(1, 'S1', 7), ev(2, 'S1', 8)], scope: [scopeRow('S1', { lines: 2, waiting: '[7,8]' })], marks: [{ id: 7, t: 1, s: 1 }, { id: 8, t: 1, s: 2 }] })
    assert.equal(named.batches.length, 3, 'calls: ' + named.batches.length)
    assert.equal(named.batches[2][named.batches[2].length - 1].sql, named.lib.TOP_SQL, 'the last statement of the last batch')
    assert.deepEqual(sqlOf(named.batches).filter((s) => s === named.lib.TOP_SQL).length, 2, 'TOP_SQL: call 1 and the last batch only')
    assert.deepEqual(named.answer, { cursor: 2, tag: named.lib.eventTag(ev(2, 'S1', 8)), top: 10, more: false, exact: true, marks: [[7, 1, 1], [8, 1, 2]], waiting: [['S1', [7, 8]]] })
    const moved = await changes(libText, { tops: [10, 11], events: [ev(1, 'S1', 7)], scope: [scopeRow('S1', { waiting: '[7]' })], marks: [{ id: 7, t: 1, s: 1 }] })
    assert.equal(moved.answer.exact, false, 'a write between call 1 and the last batch is not exact')
    assert.equal(moved.answer.more, true, 'and the answer says more')
    const none = await changes(libText, { tops: [10, 10], events: [ev(1, 'S2', null)], scope: [scopeRow('S2', { status: 'rejected', waiting: '[]' })] })
    assert.equal(none.batches.length, 2, 'no touched product and no legacy session: no third call')
    assert.equal(none.batches[1][none.batches[1].length - 1].sql, none.lib.TOP_SQL, 'then TOP_SQL ends call 2')
    assert.deepEqual(none.answer.waiting, [['S2', []]], 'a decided approval answers an empty list')
  })
  t('A.3: a legacy session is charged its items in the walk, answered by LEGACY_WAITING_SQL for every viewer', async () => {
    const r = await changes(libText, { tops: [2, 2, 2], events: [ev(1, 'L1', null), ev(2, 'L2', null)], scope: [scopeRow('L1', { legacy: 1, items: 3 }), scopeRow('L2', { legacy: 1, items: 3 })], legacy: [{ session_id: 'L1', product_id: 4 }, { session_id: 'L1', product_id: 5 }] }, { pageEvents: 50, touchedMax: 5 })
    assert.equal(r.answer.cursor, 1, 'the second legacy session would push the walk over the limit')
    assert.equal(r.answer.more, true)
    assert.deepEqual(r.answer.waiting, [['L1', [4, 5]]])
    const last = r.batches[r.batches.length - 1]
    assert.deepEqual(last.map((s) => s.sql), [r.lib.LEGACY_WAITING_SQL, r.lib.TOP_SQL], 'only the walked legacy session is read, then TOP_SQL')
    assert.equal(last[0].params.legacy, JSON.stringify(['L1']))
    const unknown = await changes(libText, { tops: [2, 2, 2], events: [ev(1, 'L1', null), ev(2, 'L2', null)], scope: [scopeRow('L1', { legacy: 1, items: null }), scopeRow('L2', { legacy: 1, items: null })] }, { pageEvents: 50, touchedMax: 5 })
    assert.equal(unknown.answer.cursor, 1, 'a legacy session without a member count is charged the whole limit and walked alone')
  })
  t('A1d: a session named only by plain observes is not walked and sends no list', async () => {
    const r = await changes(libText, { tops: [5, 5], events: [plainEv(1, 'S1', 7), plainEv(2, 'S1', 8)], scope: [scopeRow('S1', { waiting: '[7,8]' })], marks: [{ id: 7, t: 1, s: 1 }, { id: 8, t: 1, s: 1 }] })
    assert.equal(r.batches[1][0].params.walk, 0, 'no session is walked')
    assert.deepEqual(r.answer.waiting, [], 'no list is sent')
    assert.deepEqual(r.answer.marks, [[7, 1, 1], [8, 1, 1]], 'the marks are still answered')
  })
  t('A1d: only a submission or an approval write walks; the walked sessions come first in the list', async () => {
    const events = [plainEv(1, 'S1', 7), createEv(2, 'S2', null), plainEv(3, 'S2', 8), ev(4, 'S3', 9), plainEv(5, 'S4', 10)]
    const scope = ['S1', 'S2', 'S3', 'S4'].map((id, k) => scopeRow(id, { waiting: '[' + (7 + k) + ']' }))
    const r = await changes(libText, { tops: [9, 9], events, scope, marks: [{ id: 8, t: 1, s: 1 }, { id: 9, t: 1, s: 1 }] })
    assert.deepEqual(JSON.parse(r.batches[1][0].params.sessions), ['S2', 'S3', 'S1', 'S4'])
    assert.equal(r.batches[1][0].params.walk, 2)
    assert.deepEqual(r.answer.waiting, [['S2', [8]], ['S3', [9]]], 'a list for the two walked sessions only')
  })
  t('A1d: close and resume events never walk', async () => {
    const r = await changes(libText, { tops: [4, 4], events: [ev(1, 'S1', null, { action: 'close', decides: 0 }), ev(2, 'S2', null, { action: 'resume', decides: 0 })], scope: [scopeRow('S1', { waiting: '[1]' }), scopeRow('S2', { waiting: '[2]' })] })
    assert.equal(r.batches[1][0].params.walk, 0)
    assert.deepEqual(r.answer.waiting, [])
  })
  t('A1d: a deciding event past the cursor sends no list in this answer', async () => {
    const r = await changes(libText, { tops: [4, 4], events: [plainEv(1, 'S1', 1), plainEv(2, 'S1', 2), ev(3, 'S1', null)], scope: [scopeRow('S1', { waiting: '[1,2]' })], marks: [{ id: 1, t: 1, s: 1 }] }, { pageEvents: 50, touchedMax: 1 })
    assert.equal(r.answer.cursor, 1, 'the walk stopped before the second product')
    assert.equal(r.answer.more, true)
    assert.deepEqual(r.answer.waiting, [], 'the list comes with the answer that walks the deciding event')
  })
  t('A1d: a legacy session is charged and listed only when a deciding event names it', async () => {
    const r = await changes(libText, { tops: [2, 2], events: [plainEv(1, 'L1', null)], scope: [scopeRow('L1', { legacy: 1, items: 3 })] })
    assert.equal(r.batches.length, 2, 'no legacy read')
    assert.deepEqual(r.answer.waiting, [])
    const walked = await changes(libText, { tops: [2, 2, 2], events: [createEv(1, 'L1', null)], scope: [scopeRow('L1', { legacy: 1, items: 3 })], legacy: [{ session_id: 'L1', product_id: 4 }] })
    assert.deepEqual(walked.answer.waiting, [['L1', [4]]])
  })
  t('A1d: the scope read walks the line set only under @walk, and the events read marks deciding rows', () => {
    const a = libText.indexOf('export const SCOPE_WAITING_SQL = '), sql = norm(libText.slice(a, libText.indexOf('\nexport ', a + 1)))
    assert.ok(sql.includes("CASE WHEN a.status = 'pending' AND a.line_set_json IS NOT NULL AND w.key < @walk THEN"), 'the waiting walk is gated by @walk')
    const b = libText.indexOf('export const EVENTS_SQL = '), events = norm(libText.slice(b, libText.indexOf('\nexport ', b + 1)))
    assert.ok(events.includes("SELECT id, session_id, product_id, actor_id, request_id, created_at, action, CASE WHEN json_valid(after_json) THEN json_extract(after_json,'$.approval') IS NOT NULL ELSE 1 END AS decides FROM inventory_check_events WHERE id > @since ORDER BY id LIMIT @pageEvents"), 'EVENTS_SQL')
  })
  t('A.4: the pending page answers by session, not as a flat id list', async () => {
    const lib = loadLib(libText)
    const rows = [{ session_id: 'A', submitted_at: 't2', product_id: 1 }, { session_id: 'A', submitted_at: 't2', product_id: 2 }, { session_id: 'B', submitted_at: 't1', product_id: null }, { session_id: 'C', submitted_at: 't0', product_id: 5 }]
    const db = { async batch(statements) { return statements.map((s) => ({ results: s.sql === lib.TOP_SQL ? topRow(9) : s.sql === lib.PENDING_PAGE_SQL ? rows : (() => { throw new Error('unexpected statement') })() })) } }
    const answer = await lib.readPendingPage(db, SCOPE, null, 2)
    assert.equal('ids' in answer, false, 'no flat ids list')
    assert.deepEqual(answer.sessions, [['A', [1, 2]], ['B', []]])
    assert.deepEqual(answer.next, { afterAt: 't1', afterId: 'B' })
  })
  return Promise.all(pending).then(() => results)
}

;(async () => {
  const base = await suite(lib, route)
  for (const [name, err] of base) { if (err) { failed++; console.log('FAIL ' + name + ' - ' + err) } else console.log('PASS ' + name) }

  check('the session read and the pending page are driven from session ids and pending approvals by key', () => {
    assert.ok(lib.includes('FROM json_each(@sessions) w CROSS JOIN inventory_check_sessions s ON s.id = w.value'), 'SCOPE_WAITING_SQL drives from the touched session ids')
    assert.ok(lib.includes('FROM json_each(@legacy) w CROSS JOIN inventory_check_approvals a ON a.session_id = w.value'), 'LEGACY_WAITING_SQL drives from the legacy session ids')
    assert.ok(lib.includes('inventory_check_approvals a INDEXED BY inventory_check_approvals_pending'), 'the cold pending build reads the pending approvals by their index')
  })

  // Mutants: each must turn exactly its named check red.
  const mutate = async (name, which, from, to, expectRed) => {
    const L = which === 'lib' ? lib.replace(from, to) : lib, R = which === 'route' ? route.replace(from, to) : route
    if ((which === 'lib' ? L : R) === (which === 'lib' ? lib : route)) { failed++; console.log('FAIL mutant ' + name + ' did not apply'); return }
    const red = (await suite(L, R)).filter(([, err]) => err).map(([n]) => n)
    check('mutant ' + name + ' turns "' + expectRed + '" red', () => assert.ok(red.some((n) => n.startsWith(expectRed)), 'red: ' + red.join(' | ')))
  }
  await mutate('split the cursor read from the page read', 'lib', '    { sql: SNAPSHOT_PAGE_SQL, params: { ...scope, lo, hi: lo + pageIds } },\n  ])', '  ])\n  await db.batch([{ sql: SNAPSHOT_PAGE_SQL, params: { ...scope, lo, hi: lo + pageIds } }])', 'I5: the snapshot')
  await mutate('switch not checked', 'route', "if (!await readSwitch(c.env, 'ic_marks')) return null", 'if (false) return null', 'OFF')
  await mutate('waiting for every viewer', 'route', 'permitted: access.fields.stock && await fixStockOn(c)', 'permitted: true', 'I9')
  await mutate('waiting not stripped at serve time', 'route', 'start.permitted ? answer : withoutWaiting(answer)', 'answer', 'I9')
  await mutate('a plan number written in the reader', 'lib', 'export const MARKS_FORMAT = 1', 'export const MARKS_FORMAT = 1\nexport const PAGE = 2000', 'no plan-sized literal')
  await mutate('legacy without a pending approval', 'lib', "AND a.status = 'pending' AS legacy", 'AS legacy', 'A.3: the scope read')
  await mutate('no exactness read in the last batch', 'lib', '{ sql: TOP_SQL }])\n  }\n  const lastTop', '])\n  }\n  const lastTop', 'A.3: the last batch')
  await mutate('a plain observe walks', 'lib', "row.action === 'create' || Number(row.decides) === 1", 'true', 'A1d: a session named only by plain')
  await mutate('a create event does not walk', 'lib', "row.action === 'create' || Number(row.decides) === 1", 'Number(row.decides) === 1', 'A1d: only a submission or an approval write walks')
  await mutate('close and resume walk', 'lib', "row.action === 'create' || Number(row.decides) === 1", "row.action !== 'observe' || Number(row.decides) === 1", 'A1d: close and resume')
  await mutate('the sessions are listed in event order, not walked-first', 'lib', '...sessionIds.filter((sid) => changing.has(sid)), ...sessionIds.filter((sid) => !changing.has(sid))', '...sessionIds', 'A1d: only a submission or an approval write walks')
  await mutate('the waiting walk is not gated', 'lib', ' AND w.key < @walk THEN', ' THEN', 'A1d: the scope read')
  await mutate('a legacy session is charged without a deciding event', 'lib', 'Number(known.legacy) === 1 && changing.has(sid) && !charged.has(sid)', 'Number(known.legacy) === 1 && !charged.has(sid)', 'A1d: a legacy session')
  await mutate('legacy sessions cost nothing in the walk', 'lib', 'const items = freshSession ?', 'const items = false ?', 'A.3: a legacy session')

  // A1d: decides, evaluated by SQLite on the real text of EVENTS_SQL: approval present 1, malformed or missing json 1 (over-walks), other json 0.
  check('A1d: decides is 1 for an after_json with approval and for malformed or missing json, 0 otherwise', () => {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE inventory_check_events(id INTEGER PRIMARY KEY, session_id TEXT, product_id INTEGER, actor_id INTEGER, request_id TEXT, created_at TEXT, action TEXT, after_json TEXT)')
    const afters = ['{"approval":"pending"}', '{"state":"done"}', 'not json', null, '{"approval":null}', '{"state":"done","approval":"applied"}']
    afters.forEach((a, k) => db.prepare('INSERT INTO inventory_check_events(session_id,product_id,actor_id,request_id,created_at,action,after_json) VALUES(?,?,?,?,?,?,?)').run('S', 1, 1, 'r' + k, 't', 'observe', a))
    const got = db.prepare(loadLib(lib).EVENTS_SQL).all({ since: 0, pageEvents: 50 }).map((r) => Number(r.decides))
    assert.deepEqual(got, [1, 0, 1, 1, 0, 1])
  })

  // A1d registry: every statement of src that can change a waiting set (an INSERT into inventory_check_approvals, an UPDATE of its line_set_json, status, applied_json, superseded_json or line_decisions_json) is paired with an event
  // the changes read treats as set-changing: a create event, or an event whose after_json carries "approval". The unit is the top-level function or constant that holds the statement. A statement builder (a unit that sends nothing)
  // is paired through every unit that uses it. Event SQL kept in an UPPER_CASE constant counts for the units that name it. The unit is the grain: one marked event in a unit covers its other writers (the oracle steps are the finer proof).
  const srcFiles = () => {
    const out = new Map()
    const walkDir = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkDir(p); else if (p.endsWith('.ts')) out.set(path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n')) } }
    walkDir(path.join(ROOT, 'src'))
    return out
  }
  const unitsOf = (file, text) => {
    const heads = [...text.matchAll(/^(?:export )?(?:async )?(?:function\s+(\w+)|const\s+(\w+)\b)/gm)]
    return heads.map((m, i) => ({ file, name: m[1] || m[2], text: text.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : undefined) }))
  }
  const WRITES_SET = /\b(?:line_set_json|status|applied_json|superseded_json|line_decisions_json)\s*=/
  const writerSites = (u) => {
    const sites = []
    for (const m of u.text.matchAll(/INSERT\s+INTO\s+inventory_check_approvals\b/g)) sites.push({ id: 'INSERT', anyEvent: true })
    for (const m of u.text.matchAll(/UPDATE\s+(?:inventory_check_approvals|\$\{A\})\s+SET\s+([\s\S]*?)\bWHERE\b/g)) if (WRITES_SET.test(m[1])) sites.push({ id: 'UPDATE ' + m[1].trim().slice(0, 36).replace(/\s+/g, ' '), anyEvent: false })
    return sites
  }
  // An INSERT is paired by a create event of the new session (or an approval event); an UPDATE changes a session that already exists, so only an event whose after_json carries "approval" pairs it.
  const eventMarker = (text, anyEvent) => (anyEvent && /action:\s*'create'/.test(text)) || /after:\s*\{[^\n]*\bapproval\s*:/.test(text) || /json_object\('approval',\s*[^'\s]/.test(text)
  const named = (u, name) => new RegExp('\\b' + name + '\\b').test(u.text)
  const covered = (u, units, anyEvent) => eventMarker(u.text, anyEvent) || units.some((v) => v !== u && /^[A-Z][A-Z0-9_]*$/.test(v.name) && eventMarker(v.text, anyEvent) && named(u, v.name))
  const sends = (u) => /\b(?:record|commit)\(|\.batch\(|batchOnce\(/.test(u.text)
  const paired = (u, units, anyEvent, depth = 0) => {
    if (covered(u, units, anyEvent)) return true
    if (sends(u) || depth > 2) return false
    const callers = units.filter((v) => v !== u && named(v, u.name))
    return callers.length > 0 && callers.every((c) => paired(c, units, anyEvent, depth + 1))
  }
  const registry = (files) => {
    const units = [...files].flatMap(([f, text]) => unitsOf(f, text))
    const sites = [], failures = []
    for (const u of units) for (const s of writerSites(u)) { const id = u.file + ' ' + u.name + ': ' + s.id; sites.push(id); if (!paired(u, units, s.anyEvent)) failures.push(id) }
    return { sites, failures }
  }
  const files = srcFiles()
  const reg = registry(files)
  check('A1d registry: every writer of a waiting set is paired with a set-changing event', () => {
    assert.deepEqual(reg.failures, [], 'unpaired writers')
    for (const known of ['createInventoryCheckSubmission: INSERT', 'createInventoryCheckLotSubmission: INSERT', 'supersedeStatements: UPDATE superseded_json', 'closeApproval: UPDATE status', 'takeOver: UPDATE applying_request_id', 'decidedUpdate: UPDATE status', 'replacedUpdate: UPDATE status']) assert.ok(reg.sites.some((s) => s.includes(known)), 'the registry did not find ' + known + ' in ' + reg.sites.join(' | '))
    assert.ok(reg.sites.length >= 11, 'sites found: ' + reg.sites.length + ' ' + reg.sites.join(' | '))
  })
  check('A1d registry: both submission writers insert the create event in the batch that inserts the approval and supersede in it', () => {
    const sessionsUnits = unitsOf('x', files.get('src/lib/inventoryCheckSessions.ts'))
    for (const name of ['createInventoryCheckSubmission', 'createInventoryCheckLotSubmission']) {
      const u = sessionsUnits.find((x) => x.name === name)
      assert.ok(u, name + ' not found')
      assert.ok(/INSERT\s+INTO\s+inventory_check_approvals/.test(u.text), name + ' inserts the approval')
      assert.ok(/eventStatement\(actor, \{ sessionId: id, action: 'create'/.test(u.text), name + ' records the create event of the session in the same statements')
      assert.ok(/supersedeStatements\(/.test(u.text), name + ' supersedes through supersedeStatements, whose events carry approval')
    }
    const supersedeEvents = sessionsUnits.find((x) => x.name === 'SUPERSEDE_EVENTS_SQL')
    assert.ok(supersedeEvents && /json_object\('approval',a\.status/.test(supersedeEvents.text), 'the supersede events carry approval in after_json')
  })
  const regMutant = (name, file, from, to) => check('A1d registry: mutant ' + name + ' turns the registry red', () => {
    const copy = new Map(files), text = copy.get(file)
    assert.ok(text && text.includes(from), 'the mutant anchor is missing in ' + file)
    copy.set(file, text.replace(from, () => to))
    assert.ok(registry(copy).failures.length > 0, 'the registry stayed green')
  })
  regMutant('closeApproval event without approval', 'src/lib/inventoryCheckApprovals.ts', "after: { approval: status, closed: true,", "after: { status, closed: true,")
  regMutant('supersede events without approval', 'src/lib/inventoryCheckSessions.ts', "json_object('approval',a.status,'superseded_by',@id)", "json_object('state',a.status,'superseded_by',@id)")
  regMutant('plain submission without the create event', 'src/lib/inventoryCheckSessions.ts', "eventStatement(actor, { sessionId: id, action: 'create', key, hash, before: null, after: { status: 'closed', revision: 0, members: productIds.length }, result: { sessionRevision: 0 }, now }),\n    { sql: `INSERT INTO inventory_check_events", "eventStatement(actor, { sessionId: id, action: 'observe', key, hash, before: null, after: { status: 'closed', revision: 0, members: productIds.length }, result: { sessionRevision: 0 }, now }),\n    { sql: `INSERT INTO inventory_check_events")
  check('A1d registry: a new writer of a waiting set with no marked event turns the registry red', () => {
    const copy = new Map(files)
    copy.set('src/lib/newWriter.ts', "export async function newWriter(db: D1Compat) {\n  await db.batch([{ sql: `UPDATE inventory_check_approvals SET status='rejected' WHERE session_id=@id` }])\n}\n")
    assert.deepEqual(registry(copy).failures, ["src/lib/newWriter.ts newWriter: UPDATE status='rejected'"])
    copy.set('src/lib/newWriter.ts', "export async function newWriter(db: D1Compat) {\n  await db.batch([{ sql: `UPDATE inventory_check_approvals SET status='rejected' WHERE session_id=@id` }, eventStatement(actor, { sessionId, action: 'observe', after: { approval: 'rejected' } })])\n}\n")
    assert.deepEqual(registry(copy).failures, [])
  })

  // F.5: the waiting-line rule has ONE copy (waitingKeySql), and the text waitingLineSql generates is byte-identical to production's (git show b6b54c73f:cloudflare/src/lib/inventoryCheckSessions.ts).
  const sessionsText = read('src/lib/inventoryCheckSessions.ts')
  const PRODUCTION_WAITING_LINE_SQL = (a, i, countDiffers) => `${a}.status='pending' AND CASE WHEN ${a}.line_set_json IS NULL THEN ${countDiffers(i, '0.000000001')}
    ELSE json_extract(${a}.line_set_json,'$."'||${i}.product_id||'"') IS NOT NULL END
  AND json_extract(${a}.applied_json,'$.lines."'||${i}.product_id||'"') IS NULL AND json_extract(${a}.superseded_json,'$."'||${i}.product_id||'"') IS NULL
  AND json_extract(${a}.line_decisions_json,'$."'||${i}.product_id||'".decision') IS NOT 'reject'`
  const exprOf = (src, name, until) => { const a = src.indexOf('export const ' + name + ' = '); assert.ok(a >= 0, name + ' is not exported'); const b = src.indexOf(until, a); assert.ok(b > a, 'end of ' + name + ' not found'); return src.slice(a, b) }
  const loadRule = (src) => {
    const parts = [exprOf(src, 'countDiffersSql', '/**')]
    if (src.includes('export const waitingKeySql')) parts.push(exprOf(src, 'waitingKeySql', 'export const waitingLineSql'))
    parts.push(exprOf(src, 'waitingLineSql', 'const WAITING_LINE_SQL'))
    const js = parts.join('\n').replace(/export const /g, 'const ').replace(/: (string|boolean)\b/g, '')
    return new Function(js + '\nreturn { countDiffersSql, waitingLineSql }')()
  }
  const waitingCallPairs = () => {
    const pairs = new Map()
    const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) collect(p) } }
    const collect = (p) => {
      const text = fs.readFileSync(p, 'utf8')
      for (const m of text.matchAll(/waitingLineSql\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/g)) {
        const arg = (raw) => { const lit = /^'([^']*)'$/.exec(raw); if (lit) return lit[1]; const c = new RegExp('const ' + raw + " = '([^']*)'").exec(text); assert.ok(c, 'argument ' + raw + ' of waitingLineSql in ' + p + ' is neither a literal nor a const literal'); return c[1] }
        const a = arg(m[1]), i = arg(m[2])
        pairs.set(a + '|' + i, [a, i])
      }
    }
    walk(path.join(ROOT, 'src'))
    return [...pairs.values()]
  }
  const bytePin = (src) => {
    const rule = loadRule(src)
    const pairs = waitingCallPairs()
    assert.ok(pairs.some(([a, i]) => a === 'a' && i === 'i') && pairs.some(([a]) => a === 'inventory_check_approvals'), 'the walk must find the call sites (found ' + JSON.stringify(pairs) + ')')
    for (const [a, i] of pairs) assert.equal(rule.waitingLineSql(a, i), PRODUCTION_WAITING_LINE_SQL(a, i, rule.countDiffersSql), 'waitingLineSql(' + a + ', ' + i + ') differs from production')
  }
  check('F.5: waitingKeySql is exported and waitingLineSql is built on it', () => {
    assert.ok(/export const waitingKeySql = \(a: string, key: string\): string =>/.test(sessionsText), 'waitingKeySql(a, key) is not exported')
    const line = exprOf(sessionsText, 'waitingLineSql', 'const WAITING_LINE_SQL')
    assert.ok(line.includes('waitingKeySql(a, `${i}.product_id`)'), 'waitingLineSql must call waitingKeySql(a, `${i}.product_id`)')
    assert.ok(!/json_extract\(\$\{a\}\.(applied|superseded|line_decisions)_json/.test(line), 'waitingLineSql must not carry its own copy of the three line conditions')
    assert.equal((sessionsText.match(/\$\.lines\."'\|\|/g) || []).length, 1, 'the applied_json line condition is written once in the file')
  })
  check('F.5: waitingLineSql generates the production text byte for byte for every call site pair', () => bytePin(sessionsText))
  check('F.5: the pin turns red on a scratch copy with one space changed', () => {
    const changed = sessionsText.replace("'$.lines.\"'||${key}||'\"') IS NULL", "'$.lines.\"'||${key}||'\"')  IS NULL")
    assert.notEqual(changed, sessionsText, 'the scratch copy must differ')
    assert.throws(() => bytePin(changed), /differs from production/)
  })
  check('F.5: countDiffersSql keeps its arguments (the NULL line set fallback uses eps 0.000000001)', () => {
    assert.ok(exprOf(sessionsText, 'waitingLineSql', 'const WAITING_LINE_SQL').includes("countDiffersSql(i, '0.000000001')"))
  })

  console.log(failed ? 'SOME CHECKS FAILED' : 'all checks passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('FAIL ' + (e.stack || e)); process.exit(1) })
