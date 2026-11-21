'use strict'
// The count marks oracle (invariants I6, I7, I8, I10; spec section 3, S0a; amendment 1.1 F.1, F.2, F.4). Runs under the native-test lock (Records/Locks/native-tests).
//   node scripts/test-inventory-check-marks-oracle-native.cjs [--mutants [--skip-base] [--only=m1,mw3]] [--runner-fixture]
//   --skip-base: only the mutants, when the base run was its own invocation; --only: the mutants whose name starts with one of the words; --runner-fixture: only the runner's own self-check (no world).
// A simulated device builds its map from /marks pages (+ /marks/pending), then follows /marks/changes; after every writer step the device must equal the oracle: the latest count of each product by the rule
// of LATEST_ITEMS_SQL (text copied below so it survives the deletion of the old reader), and the waiting lists by session must equal PENDING_ITEMS_SQL grouped by session. A device that has not seen the step cannot pass: the oracle changes with every writer.
// The device model follows A.4: it holds waitingBySession, builds it ONLY from /marks/pending and the `waiting` field of changes answers, applies the answers of one chain to a STAGED copy and publishes only when the chain ends with more = false.
// F.1 (a): the oracle is evaluated right after every write the harness makes and kept by the event top after it (the history); a published state with top T must equal history[T].
// F.4 the runner rule: each mutant is run on a Worker with one line mutated (or on the device model) and records the label of the FIRST step that turns red; it is killed only when that label starts with the label its row names.
//   A step whose writer throws is `skipped`, NOT red: a mutant run with a skipped step is "not killed (skipped: <label>)", and the base run must have no skipped step and no red.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const bcrypt = require('bcryptjs')
const { bootWorld } = require('./read-budget/world.cjs')

const ROOT = path.join(__dirname, '..')
const IC = '/api/inventory-checks'
// The plan limits of a tier, from lib/planTier.ts itself (getPlanLimits), never retyped here.
function limitsOf(tier) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'))
  const source = path.join(ROOT, 'src', 'lib', 'planTier.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: 'planTier.ts' })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, () => { throw new Error('planTier.ts has no runtime imports') }, moduleObj, source, path.dirname(source))
  moduleObj.exports.__resetPlanTierCacheForTests()
  return moduleObj.exports.getPlanLimits({ PLAN_TIER: tier })
}
const rid = (p) => `${p}-${crypto.randomBytes(8).toString('hex')}`
const T = (col) => `CAST(round((julianday(${col}) - 2440587.5) * 86400000) AS INTEGER)`
// Copied from lib/inventoryCheckList.ts (LATEST_ITEMS_SQL, PENDING_ITEMS_SQL) and lib/inventoryCheckSessions.ts waitingLineSql: the oracle's own rule.
const LATEST = `WITH latest AS (SELECT i.product_id AS product_id, i.state AS state, i.updated_at AS updated_at,
    ROW_NUMBER() OVER (PARTITION BY i.product_id ORDER BY i.updated_at DESC, i.session_id DESC) AS rn
  FROM inventory_check_sessions s JOIN inventory_check_items i ON i.session_id = s.id AND i.branch_id = s.branch_id
  WHERE s.organization_id IS ?1 AND s.branch_id = ?2 AND i.state IN ('done', 'issue'))
  SELECT product_id, CASE state WHEN 'issue' THEN 2 ELSE 1 END AS s, ${T('updated_at')} AS t FROM latest WHERE rn = 1`
const countDiffers = (i) => `(${i}.baseline_quantity IS NOT NULL AND (abs(${i}.baseline_quantity-${i}.counted_quantity)>0.000000001 OR EXISTS(SELECT 1 FROM inventory_check_lot_lines l WHERE l.session_id=${i}.session_id AND l.product_id=${i}.product_id AND abs(l.seen_quantity-l.counted_quantity)>0.000000001)))`
const waiting = (a, i) => `${a}.status='pending' AND CASE WHEN ${a}.line_set_json IS NULL THEN ${countDiffers(i)} ELSE json_extract(${a}.line_set_json,'$."'||${i}.product_id||'"') IS NOT NULL END
  AND json_extract(${a}.applied_json,'$.lines."'||${i}.product_id||'"') IS NULL AND json_extract(${a}.superseded_json,'$."'||${i}.product_id||'"') IS NULL
  AND json_extract(${a}.line_decisions_json,'$."'||${i}.product_id||'".decision') IS NOT 'reject'`
const PENDING = `SELECT DISTINCT a.session_id AS session_id, i.product_id AS product_id FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id = a.session_id AND i.branch_id = a.branch_id
  WHERE a.organization_id IS ?1 AND a.branch_id = ?2 AND ${waiting('a', 'i')}`

async function counter(world) {
  await world.db.prepare("INSERT OR IGNORE INTO roles(id,name,code,permissions,is_system) VALUES(902,'Counter','employee',?,0)").bind(JSON.stringify({ inventory_checks: true, inventory_check_show_stock: true })).run()
  await world.db.prepare("INSERT OR IGNORE INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(902,'budget_counter','budget_counter',?,902,'{}',1,?,0)").bind(bcrypt.hashSync('budget-password-1', 4), world.orgId).run()
  await world.db.prepare("INSERT OR IGNORE INTO trusted_devices(user_id, device_id, device_name, status, decided_at) VALUES(902,'budget-device','budget device','approved',datetime('now'))").run()
  const login = await world.send('POST', '/api/auth/login', { username: 'budget_counter', password: 'budget-password-1', organizationId: world.orgId, deviceId: 'budget-device' }, { cookie: null })
  if (!login.setCookie) throw new Error('the counter could not sign in: ' + login.text.slice(0, 200))
  return login.setCookie.split(';')[0]
}

// The oracle: the marks, and the waiting lists by session (only sessions with a waiting line), sorted.
async function oracle(world, branch) {
  const marks = new Map((await world.all(LATEST, world.orgId, branch)).map((r) => [Number(r.product_id), [Number(r.t), Number(r.s)]]))
  const bySession = new Map()
  for (const r of await world.all(PENDING, world.orgId, branch)) { const k = String(r.session_id); bySession.set(k, [...bySession.get(k) ?? [], Number(r.product_id)]) }
  for (const [k, ids] of bySession) bySession.set(k, ids.sort((x, y) => x - y))
  return { marks, bySession, pending: new Set([...bySession.values()].flat()) }
}

// Mutants of the device model (mw3, mw12): set by run() for the devices of one run.
const MODEL = { union: false, publishEach: false }
// The device model of A.4. `marks` and `waitingBySession` are what the view reads (PUBLISHED); every chain of answers is applied to `staged` and published only when it ends with more = false.
class Device {
  constructor(world, branch, opts = {}) { Object.assign(this, { world, branch, marks: new Map(), waitingBySession: new Map(), staged: null, cursor: 0, tag: '', top: 0, answers: 0, rebuilds: 0, pagesFetched: 0, log: [], miss: opts.miss !== false, caps: null, maxMarks: 0, trace: !!opts.trace, union: opts.union ?? MODEL.union, publishEach: opts.publishEach ?? MODEL.publishEach }) }
  get pending() { return new Set([...this.waitingBySession.values()].flat()) }
  begin() { this.staged = { marks: new Map(this.marks), waiting: new Map([...this.waitingBySession].map(([k, v]) => [k, [...v]])) } }
  putWaiting(entries) {
    for (const [sid, ids] of entries) {
      const old = this.staged.waiting.get(sid)
      const next = this.union && old ? [...new Set([...old, ...ids])] : ids
      if (next.length) this.staged.waiting.set(sid, [...next]); else this.staged.waiting.delete(sid)
    }
  }
  publish() { this.marks = this.staged.marks; this.waitingBySession = this.staged.waiting; this.staged = null }
  async get(url) {
    const r = await this.world.send('GET', url, undefined, { miss: this.miss }); this.answers++
    const stmts = this.trace && url.includes('/marks/changes') ? (await this.world.last()).stmts.map((x) => ({ sql: x.raw.slice(0, 110).split(' ').filter(Boolean).join(' '), rr: x.rr })) : undefined
    this.log.push({ stmts, url: url.replace(IC, ''), status: r.status, calls: r.calls, rr: r.rr, ...(r.json && url.includes('/marks/changes') ? { chg: { since: Number(new URL('http://x' + url).searchParams.get('since')), top: r.json.top, cursor: r.json.cursor, more: r.json.more, exact: r.json.exact, waiting: (r.json.waiting || []).map(([sid, ids]) => [sid, ids.length]), marks: (r.json.marks || []).length } } : {}) })
    return r
  }
  async build() {
    this.staged = { marks: new Map(), waiting: new Map() }; this.rebuilds += 1
    const first = await this.get(`${IC}/marks?branchId=${this.branch}&page=0`)
    assert.equal(first.status, 200, 'marks page 0: ' + first.text.slice(0, 200))
    const answers = [first.json]
    for (const page of first.json.buckets) if (page !== 0) { const r = await this.get(`${IC}/marks?branchId=${this.branch}&page=${page}`); assert.equal(r.status, 200, 'marks page ' + page); answers.push(r.json) }
    const cursors = []
    for (const a of answers) { this.pagesFetched++; cursors.push([a.cursor, a.tag]); for (const [id, t, s] of a.rows ?? []) this.staged.marks.set(id, [t, s]) }
    let after = ''
    for (;;) {
      const r = await this.get(`${IC}/marks/pending?branchId=${this.branch}${after}`)
      if (r.status === 403) break
      assert.equal(r.status, 200, 'pending: ' + r.text.slice(0, 200))
      assert.ok(Array.isArray(r.json.sessions) && r.json.ids === undefined, 'the pending page answers by session')
      cursors.push([r.json.cursor, r.json.tag]); this.putWaiting(r.json.sessions)
      if (!r.json.next) break
      after = `&afterAt=${encodeURIComponent(r.json.next.afterAt)}&afterId=${encodeURIComponent(r.json.next.afterId)}`
    }
    const min = cursors.reduce((a, b) => (b[0] < a[0] ? b : a))
    this.cursor = min[0]; this.tag = min[1]
    await this.sync()
  }
  // One answer of the chain, taken from the server (pull) or handed in (take: the stub reads of R1 and L2).
  take(j) {
    assert.equal(typeof j.exact, 'boolean', 'the answer says whether it is exact')
    assert.equal(j.pending, undefined, 'the answer carries waiting by session, not a pending list')
    if (!this.staged) this.begin()
    this.maxMarks = Math.max(this.maxMarks, j.marks.length)
    for (const [id, t, s] of j.marks) { if (s === 0) this.staged.marks.delete(id); else this.staged.marks.set(id, [t, s]) }
    this.putWaiting(j.waiting)
    this.cursor = j.cursor; this.tag = j.tag; this.top = j.top
    if (!j.more) { assert.equal(j.exact, true, 'a chain ends only with an exact answer'); this.publish() } else if (this.publishEach) { this.publish(); this.begin() }
  }
  async pull() {
    if (!this.staged) this.begin()
    const r = await this.get(`${IC}/marks/changes?branchId=${this.branch}&since=${this.cursor}&tag=${this.tag}`)
    assert.equal(r.status, 200, 'changes: ' + r.text.slice(0, 200))
    if (r.json.rebuild || (this.catchUp && r.json.top - this.cursor > this.catchUp)) return { rebuild: true }
    this.take(r.json)
    return r.json
  }
  async sync(limit = 200) {
    if (!this.staged) this.begin()
    for (let n = 0; n < limit; n++) {
      const j = await this.pull()
      if (j.rebuild) { this.staged = null; return this.build() }
      if (!j.more) return
    }
    throw new Error('the change feed did not finish')
  }
}

const diff = (a, b) => { const out = []; for (const [k, v] of a) if (!b.has(k) || JSON.stringify(b.get(k)) !== JSON.stringify(v)) out.push(`${k}: ${JSON.stringify(v)} vs ${JSON.stringify(b.get(k))}`); for (const k of b.keys()) if (!a.has(k)) out.push(`${k}: missing vs ${JSON.stringify(b.get(k))}`); return out }
const sortedLists = (m) => new Map([...m].map(([k, v]) => [k, [...v].sort((x, y) => x - y)]))
const stateDiff = (device, o) => ({ marks: diff(device.marks, o.marks), waiting: diff(sortedLists(device.waitingBySession), o.bySession), pending: diff(new Map([...device.pending].map((x) => [x, 1])), new Map([...o.pending].map((x) => [x, 1]))) })
async function same(world, device, label) {
  const o = await oracle(world, device.branch)
  const d = stateDiff(device, o)
  assert.deepEqual([d.marks.slice(0, 5), d.waiting.slice(0, 5), d.pending.slice(0, 5)], [[], [], []], `${label}: device vs oracle (${d.marks.length} mark, ${d.waiting.length} waiting list and ${d.pending.length} waiting product differences)`)
  const kept = world.history && world.history.get(device.top)
  if (kept) { const h = stateDiff(device, kept); assert.deepEqual([h.marks.slice(0, 5), h.waiting.slice(0, 5)], [[], []], `${label}: the published state is not the database at its top ${device.top} (F.1 a)`) }
  return o
}

// The marks library as the Worker runs it (esbuild bundle of src/lib/inventoryCheckMarks.ts with the run's source patches), called here with a database that wraps the world's D1, so a test can
// record the statements or commit a write between two of its calls (R1, L2). Statements use @name parameters: they become numbered ones.
async function loadMarksLib(patches) {
  const { build } = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const plugin = { name: 'patches', setup(b) {
    b.onLoad({ filter: /\.ts$/ }, (args) => {
      let text = fs.readFileSync(args.path, 'utf8')
      const rel = path.relative(ROOT, args.path).split(path.sep).join('/')
      for (const p of patches.filter((x) => x.file === rel)) { if (text.split(p.from).length !== 2) throw new Error('patch ' + p.name + ': anchor must occur exactly once in ' + rel); text = text.replace(p.from, () => p.to) }
      return { contents: text, loader: 'ts' }
    })
  } }
  const out = await build({ plugins: [plugin], entryPoints: [path.join(ROOT, 'src', 'lib', 'inventoryCheckMarks.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', external: ['node:*', 'cloudflare:*'], logLevel: 'error', nodePaths: [path.join(ROOT, 'node_modules')] })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}
const isWord = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_'
function numbered(sql, params) {
  const index = new Map(); const values = []; let text = ''
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] !== '@' || !isWord(sql[i + 1] ?? '')) { text += sql[i]; continue }
    let j = i + 1; while (j < sql.length && isWord(sql[j])) j++
    const name = sql.slice(i + 1, j)
    if (!index.has(name)) { assert.ok(name in params, 'no value for @' + name); index.set(name, index.size + 1); values.push(params[name] === undefined ? null : params[name]) }
    text += '?' + index.get(name); i = j - 1
  }
  return { sql: text, values }
}
function databaseOf(world, hooks = {}) {
  let calls = 0
  return { calls: () => calls, async batch(statements) {
    calls += 1
    if (hooks.seen) hooks.seen(statements)
    const result = await world.db.batch(statements.map((s) => { const q = numbered(s.sql, s.params ?? {}); return world.db.prepare(q.sql).bind(...q.values) }))
    if (hooks.after) await hooks.after(calls)
    return result
  } }
}

async function scenario(world, report, patches) {
  const limits = limitsOf('free')
  const lib = await loadMarksLib(patches)
  const at = (label) => { report.at = label }
  const must = async (p, what) => { const r = await p; if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 300)}`); return r }
  let offset = 0
  const fresh = async (n) => { const rows = await world.all(`SELECT p.id AS id, bs.quantity AS q FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=1 WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0 AND p.id NOT IN (SELECT product_id FROM inventory_check_items) ORDER BY p.id LIMIT ? OFFSET ?`, n, offset); offset += n; assert.equal(rows.length, n, 'products left'); return rows }
  // The steps added by A1c take their products from the top of the id range, so the kept steps keep the products they always had (a product with transfer provenance cannot be deactivated by I10).
  const freshHigh = async (n) => { const rows = await world.all(`SELECT p.id AS id, bs.quantity AS q FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=1 WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0 AND p.id NOT IN (SELECT product_id FROM inventory_check_items) ORDER BY p.id DESC LIMIT ?`, n); assert.equal(rows.length, n, 'products left (high)'); return rows }
  const plain = (ps, diffEvery = 0) => ps.map((p, i) => ({ productId: p.id, countedQuantity: diffEvery && i % diffEvery === 0 ? p.q + 1 : p.q, seenQuantity: p.q }))
  const submit = (ps, diffEvery, extra = {}) => must(world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: plain(ps, diffEvery), ...extra }, { cookie: counterCookie }), 'submit')
  const approval = async (sid, decision, extra = {}) => { for (let n = 0; n < 60; n++) { const r = await must(world.send('POST', `${IC}/sessions/${sid}/approval`, { decision, requestId: rid('ap'), ...extra }), 'approval ' + decision); if (r.json.done !== false) return r } throw new Error('approval did not finish') }
  const sessionOf = async (pid) => (await world.all('SELECT i.session_id AS s FROM inventory_check_items i JOIN inventory_check_approvals a ON a.session_id=i.session_id WHERE i.product_id=? ORDER BY i.updated_at DESC LIMIT 1', pid))[0].s
  world.history = new Map()
  const snap = async () => { const top = Number((await world.all('SELECT COALESCE(MAX(id), 0) AS top FROM inventory_check_events'))[0].top); world.history.set(top, await oracle(world, 1)) }
  const counterCookie = await counter(world)
  const device = new Device(world, 1)
  await device.build()
  const scope = { organization: world.orgId, branchId: 1 }
  const limitsOfMarks = { pageEvents: limits.inventoryMarksChangesPageEvents, touchedMax: limits.inventoryMarksTouchedMax }
  // A step: the WRITER makes the change (a throw there is `skipped`, never red); the CHECKER (default: the device catches up and equals the oracle, and so does a freshly built device) is what can turn red.
  const step = async (label, writer, checker) => {
    at(label)
    try { await writer() } catch (e) { report.skipped.push(`${label}: ${String(e.message).slice(0, 120)}`); return }
    if (checker) await checker(); else { await snap(); await device.sync(); await same(world, device, label) }
    const built = new Device(world, 1); await built.build(); await same(world, built, label + ' (fresh build)'); report.steps.push(label)
  }
  const insertSession = (id, branch, when, status = 'closed') => world.db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,?,?,1,'oracle fixture',?,0,'{}',?,?,?)").bind(id, world.orgId, branch, status, when, when, when).run()
  // A session made by a Worker that did not know line_set_json: a pending approval with NULL set, every member counted 2 against a baseline of 1 (so every member waits by the engine's own rule), events as the real writer records them.
  const legacySession = async (lid, products, when) => {
    const mine = JSON.stringify(products.map((p) => p.id))
    await insertSession(lid, 1, when)
    await world.db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) SELECT ?, value, 1, '{}', 1, '{}', 'done', 2, 1, 1, ? FROM json_each(?)").bind(lid, when, mine).run()
    await world.db.prepare("INSERT INTO inventory_check_approvals(session_id,organization_id,branch_id,status,lines,submitted_by,submitted_at,baselines_json,line_set_json) VALUES(?,?,1,'pending',?,1,?,'{}',NULL)").bind(lid, world.orgId, products.length, when).run()
    await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES(?,NULL,1,NULL,'create',?,'h','{}',?,'{}',?)").bind(lid, rid('lc'), JSON.stringify({ status: 'closed', revision: 0, members: products.length }), when).run()
    await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) SELECT ?, value, 1, NULL, 'observe', ?||'-'||value, 'h','{}','{}','{}', ? FROM json_each(?)").bind(lid, rid('lo'), when, mine).run()
  }
  const nullEvent = (sid, when) => world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES(?,NULL,1,NULL,'observe',?,'h','{}','{}','{}',?)").bind(sid, rid('ne'), when).run()
  await snap()
  at('empty world')
  const empty = await same(world, device, 'empty world'); report.steps.push('empty world (' + empty.marks.size + ' marks)')
  // W1 plain submission (some lines differ: an approval waits)
  const a = await fresh(12)
  await step('W1 plain submission with differing lines', () => submit(a, 3))
  // W3b supersede across sessions: P is counted again while Q of the old session still waits. The old session's list must lose exactly P (replacing by union keeps it).
  at('W3b supersede across sessions')
  const [p3, q3] = await freshHigh(2)
  await submit([p3, q3], 1); await device.sync()
  await step('W3b supersede across sessions', () => submit([p3], 1))
  // W3 supersede: a newer count of a product whose line waits
  await step('W3 supersede a waiting line', async () => { await submit([a[0]], 1) })
  // W3c split supersede: the device's cursor is placed so one page of the feed ends right after the supersede event and before the new session's events. The device must publish nothing until the chain ends.
  at('W3c split supersede')
  const [p4, q4] = await freshHigh(2)
  const first = await submit([p4, q4], 1)
  await device.sync()
  const before = await oracle(world, 1)
  await step('W3c split supersede', async () => {
    await insertSession('w3c-fill', 2, '2026-11-04T00:00:00.000Z')
    await world.db.prepare(`WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k < ${limits.inventoryMarksChangesPageEvents - 2}) INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at) SELECT 'w3c-fill', NULL, 1, 'observe', 'w3-'||hex(randomblob(6))||k, 'h', '{}','{}','{}','2026-11-04T00:00:00.000Z' FROM s`).run()
    await submit([p4], 1)
  }, async () => {
    device.begin()
    const answer = await device.pull()
    assert.equal(answer.more, true, 'W3c: the first answer ends at the page boundary')
    assert.deepEqual(answer.waiting.map((w) => w[0]), [first.json.item.id], 'W3c: the first page holds the supersede events of the old session only')
    const mid = stateDiff(device, before)
    assert.deepEqual([mid.marks, mid.waiting, mid.pending], [[], [], []], 'W3c: nothing is published before the chain ends (the earlier instant stays)')
    await snap(); await device.sync(); await same(world, device, 'W3c split supersede')
  })
  // W6 approve whole / W7 line decisions / W8 reject / W9 close
  const b = await fresh(9)
  await submit(b, 3); const bs = await sessionOf(b[0].id)
  await step('W7 line reject', async () => { await must(world.send('POST', `${IC}/sessions/${bs}/approval/lines`, { requestId: rid('ln'), productId: b[0].id, action: 'reject' }), 'line reject') })
  await step('W7 line reopen', async () => { await must(world.send('POST', `${IC}/sessions/${bs}/approval/lines`, { requestId: rid('ln'), productId: b[0].id, action: 'reopen' }), 'line reopen') })
  await step('W6 approve whole', () => approval(bs, 'approve'))
  // W8b reject whole, 3 lines: the device already holds the 3 waiting lines; the reject's only event names no product.
  at('W8b reject whole, 3 lines')
  const w8 = await freshHigh(3); await submit(w8, 1); const w8s = await sessionOf(w8[0].id); await device.sync()
  await step('W8b reject whole, 3 lines', () => approval(w8s, 'reject', { note: 'no' }))
  const c = await fresh(6); await submit(c, 2); const cs = await sessionOf(c[0].id)
  await step('W8 reject whole', () => approval(cs, 'reject', { note: 'no' }))
  const d = await fresh(6); await submit(d, 2); const ds = await sessionOf(d[0].id)
  await step('W9 close the approval', () => approval(ds, 'close', { note: 'closed' }))
  // W4 observe in an open session, W5 close and resume
  const e = await fresh(5)
  let sid = null
  await step('W4 observe in an open session', async () => {
    const s = await must(world.send('POST', `${IC}/sessions`, { branchId: 1, title: 'oracle', productIds: e.map((p) => p.id), scope: {}, requestId: rid('se') }), 'session'); sid = s.json.item.id
    for (const p of e.slice(0, 3)) await must(world.send('PATCH', `${IC}/sessions/${sid}/items/${p.id}`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: rid('ob'), state: 'done', counted_quantity: p.q }), 'observe')
  })
  await step('W5 close the session', async () => { const s = (await world.all('SELECT revision FROM inventory_check_sessions WHERE id=?', sid))[0]; await must(world.send('PATCH', `${IC}/sessions/${sid}`, { expectedRevision: Number(s.revision), requestId: rid('ck'), action: 'close' }), 'close') })
  await step('W5 resume the session', async () => { const s = (await world.all('SELECT revision FROM inventory_check_sessions WHERE id=?', sid))[0]; await must(world.send('PATCH', `${IC}/sessions/${sid}`, { expectedRevision: Number(s.revision), requestId: rid('rs'), action: 'resume' }), 'resume') })
  // W12 a task issued, picked up and closed
  const f = await fresh(8)
  await step('W12 task issue, pickup, release', async () => {
    const t = await must(world.send('POST', `${IC}/tasks`, { branchId: 1, requestId: rid('is'), title: 'oracle task', productIds: f.map((p) => p.id) }), 'issue')
    const id = t.json.item ? t.json.item.id : t.json.id
    const p = await must(world.send('POST', `${IC}/tasks/${id}/pickup`, { requestId: rid('pk') }), 'pickup')
    await submit(f.slice(0, 4), 0, { taskId: id })
    await must(world.send('POST', `${IC}/tasks/${id}/release`, { requestId: rid('rl'), expectedRevision: p.json.item ? p.json.item.revision : undefined }), 'release')
  })
  // L1 legacy NULL line set: five approvals with no stored line set; one line is decided (rejected) and one approval is closed. Dropping the fallback (mw6) shows the legacy lines as not waiting.
  at('L1 legacy NULL line set')
  const pool1 = await freshHigh(30), when1 = '2026-11-06T01:00:00.000Z'
  for (let k = 0; k < 5; k++) await legacySession('l1-' + k, pool1.slice(k * 6, k * 6 + 6), when1)
  await device.sync()
  await step('L1 legacy NULL line set', async () => {
    await world.db.prepare("UPDATE inventory_check_approvals SET line_decisions_json=json_object(?,json_object('decision','reject')) WHERE session_id='l1-0'").bind(String(pool1[0].id)).run()
    await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES('l1-0',?,1,NULL,'observe',?,'h','{}','{}','{}',?)").bind(pool1[0].id, rid('l1d'), when1).run()
    await world.db.prepare("UPDATE inventory_check_approvals SET status='rejected',decided_by=1,decided_at=?,decision_request_id=?,decision_note='closed' WHERE session_id='l1-1'").bind(when1, rid('l1c')).run()
    await nullEvent('l1-1', when1)
  })
  // L2 decided legacy approval: a NULL-set approval that is not pending is named by an event. The answer is [] and LEGACY_WAITING_SQL does not run (mw14 runs it).
  at('L2 decided legacy approval')
  const pool2 = await freshHigh(6), when2 = '2026-11-06T02:00:00.000Z'
  await device.sync()
  await step('L2 decided legacy approval', async () => {
    await legacySession('l2-0', pool2, when2)
    await world.db.prepare("UPDATE inventory_check_approvals SET status='rejected',decided_by=1,decided_at=?,decision_request_id=?,decision_note='closed' WHERE session_id='l2-0'").bind(when2, rid('l2c')).run()
    await nullEvent('l2-0', when2)
  }, async () => {
    const seen = []
    const answer = await lib.readChanges(databaseOf(world, { seen: (s) => seen.push(...s.map((x) => x.sql)) }), scope, device.cursor, device.tag, limitsOfMarks)
    assert.ok(!seen.includes(lib.LEGACY_WAITING_SQL), 'L2: a decided NULL-set approval must not run LEGACY_WAITING_SQL')
    assert.deepEqual((answer.waiting.find((w) => w[0] === 'l2-0') || [null, null])[1], [], 'L2: the decided legacy session answers an empty list')
    await snap(); await device.sync(); await same(world, device, 'L2 decided legacy approval')
  })
  // W13 a product deactivated, counted, reactivated (I10), a header, another organisation's count, the inactive branch's count, a count whose item branch differs from its session's (m6), equal updated_at (m1)
  const g = await fresh(4)
  const permit = () => world.db.prepare("INSERT OR REPLACE INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'").run()
  const unpermit = () => world.db.prepare("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'").run()
  await step('I10 deactivate, count, reactivate', async () => {
    await permit()
    await world.db.prepare('UPDATE products SET is_active=0 WHERE id=?').bind(g[0].id).run()
    await world.db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('or-1',?,1,1,'inactive count','closed',0,'{}','2026-11-01T01:00:00.000Z','2026-11-01T01:00:00.000Z','2026-11-01T01:00:00.000Z')").bind(world.orgId).run()
    await world.db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) VALUES('or-1',?,1,'{}',1,'{}','done',1,1,1,'2026-11-01T01:00:00.000Z')").bind(g[0].id).run()
    await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES('or-1',?,1,'observe',?, 'h','{}','{}','{}','2026-11-01T01:00:00.000Z')").bind(g[0].id, rid('or')).run()
    await unpermit()
  })
  await step('I10 reactivate', async () => { await permit(); await world.db.prepare('UPDATE products SET is_active=1 WHERE id=?').bind(g[0].id).run(); await unpermit() })
  await step('ties on updated_at broken by session id (m1)', async () => {
    for (const s of ['tie-b', 'tie-a']) {
      await world.db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES(?,?,1,1,'tie','closed',0,'{}','2026-11-02T01:00:00.000Z','2026-11-02T01:00:00.000Z','2026-11-02T01:00:00.000Z')").bind(s, world.orgId).run()
      await world.db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,revision,updated_by,updated_at) VALUES(?,?,1,'{}',1,'{}',?,?,?,1,1,'2026-11-02T01:00:00.000Z')").bind(s, g[1].id, s === 'tie-a' ? 'done' : 'issue', 1, s === 'tie-a' ? null : 'short').run()
      await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES(?,?,1,'observe',?, 'h','{}','{}','{}','2026-11-02T01:00:00.000Z')").bind(s, g[1].id, rid('tie')).run()
    }
  })
  await step('an item whose branch differs from its session (m6)', async () => {
    await world.db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,revision,scope_json,started_at,updated_at,closed_at) VALUES('bx-1',?,2,1,'other branch','closed',0,'{}','2026-11-03T01:00:00.000Z','2026-11-03T01:00:00.000Z','2026-11-03T01:00:00.000Z')").bind(world.orgId).run()
    await world.db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,revision,updated_by,updated_at) VALUES('bx-1',?,1,'{}',1,'{}','done',1,1,1,'2026-11-03T01:00:00.000Z')").bind(g[2].id).run()
    await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES('bx-1',?,1,'observe',?, 'h','{}','{}','{}','2026-11-03T01:00:00.000Z')").bind(g[2].id, rid('bx')).run()
  })
  // The touched cap: more events in the log than one page holds, every one naming its product (a count changes under a PRODUCT event: a NULL-product event changes no mark). The feed pages without skipping an event.
  const cap = (await world.send('GET', `${IC}/list?branchId=1&page=1&pageSize=1`)).json.capabilities.marks
  report.caps = cap
  device.catchUp = cap.catchUpMaxEvents
  await step('touched cap: the feed pages without skipping events', async () => {
    const many = await fresh(560), sids = []
    for (let i = 0; i < many.length; i += 40) sids.push((await submit(many.slice(i, i + 40), 1)).json.item.id)
    await device.sync()
    for (const sid of sids) {
      await world.db.prepare("UPDATE inventory_check_items SET state = CASE state WHEN 'done' THEN 'issue' ELSE 'done' END, reason = CASE state WHEN 'done' THEN 'short' ELSE NULL END WHERE session_id=?").bind(sid).run()
      await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at) SELECT session_id, product_id, 1, 'observe', ?||'-'||product_id, 'h','{}','{}','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM inventory_check_items WHERE session_id=?").bind(rid('ap'), sid).run()
    }
  })
  // The walk's limit on legacy sessions (A.3): two pending approvals with no stored line set, 251 members each, so the second one pushes the walk over the limit (500 on Free): the feed answers them in more than one read and every answer stays within it.
  const legacyBefore = device.answers
  await step('legacy sessions are charged their members: the feed walks them a few at a time', async () => {
    const members = 251, pool = await fresh(members * 2), when = '2026-11-05T01:00:00.000Z'
    for (const [k, lid] of ['lg-a', 'lg-b'].entries()) await legacySession(lid, pool.slice(k * members, (k + 1) * members), when)
  })
  report.legacyAnswers = device.answers - legacyBefore
  assert.ok(report.legacyAnswers >= 2, 'the legacy walk needed more than one read (' + report.legacyAnswers + ')')
  // R1 a write injected between call 1 and the last batch of a read: a supersede of P (S1 to S2) commits after call 1 and before the closing batch, which reads a newer state than call 1 did.
  // Right: the answer is not exact, `more` is true, nothing is published and the next read is exact. Without the guard (mw11) the device publishes S1 without P and no S2 entry: a state no instant had.
  at('R1 write injected between call 1 and the last batch')
  await device.sync()
  const [p5, q5] = await freshHigh(2)
  const before5 = await oracle(world, 1)
  await step('R1 write injected between call 1 and the last batch', () => submit([p5, q5], 1), async () => {
    const db = databaseOf(world, { after: async (n) => { if (n === 1) await submit([p5], 1) } })
    const answer = await lib.readChanges(db, scope, device.cursor, device.tag, limitsOfMarks)
    assert.equal(answer.exact, false, 'R1: a write landed after call 1, so the answer is not exact')
    assert.equal(answer.more, true, 'R1: an answer that is not exact says more')
    device.begin(); device.take(answer)
    const mid = stateDiff(device, before5)
    assert.deepEqual([mid.marks, mid.waiting, mid.pending], [[], [], []], 'R1: nothing is published from an answer that is not exact')
    await snap(); await device.sync(); await same(world, device, 'R1 write injected between call 1 and the last batch')
  })
  // I7: a rolled-back database. The device cursor is past the restored log: its events are replaced by others with the same ids.
  await step('I7 rolled-back database forces a rebuild', async () => {
    const before = device.rebuilds
    const n = device.cursor
    await world.db.prepare('DROP TRIGGER IF EXISTS inventory_check_events_no_delete').run()
    await world.db.prepare('DELETE FROM inventory_check_events WHERE id > ?').bind(n - 5).run()
    await world.db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name='inventory_check_events'").bind(n - 5).run()
    const h = await fresh(10); await submit(h, 0)
    report.i7 = { cursor: n, rebuiltBefore: before }
  })
  assert.ok(device.rebuilds > report.i7.rebuiltBefore, 'I7: the device was told to rebuild')
  // I8: a device that sleeps. Events added past the catch-up threshold force one rebuild; within it the feed pages with no rebuild.
  const insertEvents = async (n) => world.db.prepare(`WITH RECURSIVE s(k) AS (SELECT 0 UNION ALL SELECT k+1 FROM s WHERE k < ${n - 1}) INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at) SELECT 'bx-1', NULL, 1, 'observe', 'sl-'||hex(randomblob(6))||k, 'h', '{}','{}','{}','2026-11-04T00:00:00.000Z' FROM s`).run()
  const within = Math.floor(cap.catchUpMaxEvents * 0.75)
  const r0 = device.rebuilds, a0 = device.answers
  at('I8 within the threshold')
  await insertEvents(within); await snap(); await device.sync(); await same(world, device, 'I8 within the threshold')
  report.i8 = { within: { events: within, answers: device.answers - a0, rebuilds: device.rebuilds - r0 } }
  assert.equal(device.rebuilds, r0, 'I8: no rebuild within the threshold')
  const r1 = device.rebuilds
  at('I8 beyond the threshold')
  await insertEvents(cap.catchUpMaxEvents * 2 + 500); await snap(); await device.sync(); await same(world, device, 'I8 beyond the threshold')
  report.i8.beyond = { events: cap.catchUpMaxEvents * 2 + 500, rebuilds: device.rebuilds - r1 }
  assert.equal(device.rebuilds - r1, 1, 'I8: beyond the threshold the device rebuilds exactly once')
  assert.ok(device.top - device.cursor <= cap.catchUpMaxEvents / 2, 'I8: the lag after the rebuild is within half the threshold')
  // The cached snapshot page obeys the lag rule (m7): a warm page is never served further behind than half the threshold.
  at('I8 lag rule on the cached page')
  const warm = new Device(world, 1, { miss: false }); await warm.build()
  await insertEvents(Math.floor(cap.catchUpMaxEvents * 0.75))
  const page = (await world.send('GET', `${IC}/marks?branchId=1&page=0`)).json
  assert.ok(page.top - page.cursor <= cap.catchUpMaxEvents / 2, `the lag rule: a page served ${page.top - page.cursor} events behind`)
  report.steps.push('I8 lag rule on the cached page')
}

// R4 throughput: a 500-line submission (every line differing, superseding 10 older lines) is followed by the device in at most 3 reads, and every answer keeps its touched products within the walk's limit.
//   R4a: Paid profile, production switches (ic_wired ON: the lot writer takes the lines). R4b: Free profile, ic_wired OFF (the plain writer takes 500 lines on Free; mw10 counted waiting ids against the limit).
async function throughput(world, report, label, tier) {
  const limits = limitsOf(tier)
  at0(report, label)
  const counterCookie = await counter(world)
  const device = new Device(world, 1)
  await device.build()
  const rows = await world.all('SELECT p.id AS id, bs.quantity AS q FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=1 WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0 ORDER BY p.id LIMIT 500')
  try {
    assert.equal(rows.length, 500, 'products for the 500-line submission')
    const send = async (ps) => { const r = await world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: ps.map((p) => ({ productId: p.id, countedQuantity: p.q + 1, seenQuantity: p.q })) }, { cookie: counterCookie }); if (r.status >= 300) throw new Error('submit ' + ps.length + ': ' + r.status + ' ' + r.text.slice(0, 200)); return r }
    await send(rows.slice(0, 10)); await device.sync()
    await send(rows)
  } catch (e) { report.skipped.push(`${label}: ${String(e.message).slice(0, 120)}`); return }
  const reads0 = device.log.length
  await device.sync(3)
  const reads = device.log.slice(reads0).filter((x) => x.chg).length
  assert.ok(reads <= 3, `${label}: the device reached more = false in ${reads} reads (at most 3)`)
  assert.ok(device.maxMarks <= limits.inventoryMarksTouchedMax, `${label}: an answer touched ${device.maxMarks} products (limit ${limits.inventoryMarksTouchedMax})`)
  await same(world, device, label)
  const built = new Device(world, 1); await built.build(); await same(world, built, label + ' (fresh build)')
  report.steps.push(label + ' (' + reads + ' reads)')
}
const at0 = (report, label) => { report.at = label }

// The mutants. `file`/`from`/`to`: one line of the Worker source (applied at bundle time); `model`: a mutant of the device model; `worlds`: which worlds the run needs; `red`: the step label it must turn red at.
const LIB = 'src/lib/inventoryCheckMarks.ts'
const MUTANTS = [
  { name: 'm1 drop the session id tie-break', file: LIB, from: 'ORDER BY x.updated_at DESC, x.session_id DESC LIMIT 1)', to: 'ORDER BY x.updated_at DESC LIMIT 1)', red: 'ties on updated_at' },
  { name: 'm2 seek only active products', file: LIB, from: 'WHERE p.id >= @lo AND p.id < @hi ORDER BY p.id', to: 'WHERE p.id >= @lo AND p.id < @hi AND p.is_active = 1 ORDER BY p.id', red: 'I10 deactivate' },
  { name: 'm4 cursor = the last event of the page, not the last walked', file: LIB, from: 'const cursorRow = last as Row', to: 'const cursorRow = list[list.length - 1]', red: 'legacy sessions are charged' },
  { name: 'm5 skip the tag check', file: LIB, from: '(since > 0 && (!atEvent || eventTag(atEvent) !== tag))', to: 'false', red: 'I7' },
  { name: 'm6 drop the session branch match', file: LIB, from: 'AND sx.organization_id IS @organization AND sx.branch_id = x.branch_id', to: 'AND sx.organization_id IS @organization', red: 'an item whose branch differs' },
  { name: 'm7 drop the cached page lag rule', file: 'src/routes/inventoryChecks.ts', from: ' && check.top - cached.cursor <= limits.inventoryMarksCatchUpMaxEvents / 2', to: '', red: 'I8 lag rule' },
  { name: 'mw1 scope only the sessions a product event names', file: LIB, from: '[...new Set(list.map((row) => String(row.session_id)))]', to: '[...new Set(list.filter((row) => row.product_id != null).map((row) => String(row.session_id)))]', red: 'W8b' },
  { name: 'mw2 waitingKeySql without the superseded_json term', file: 'src/lib/inventoryCheckSessions.ts', from: " AND json_extract(${a}.superseded_json,'$.\"'||${key}||'\"') IS NULL", to: '', red: 'W3b' },
  { name: 'mw3 the device unions a session list with its old one', model: { union: true }, red: 'W3b' },
  { name: 'mw6 no legacy waiting lists (legacy sessions answer [])', file: LIB, from: 'const legacyAt = legacyIds.length ? (marksAt === 0 ? 1 : 0) : -1', to: 'const legacyAt = -1', red: 'L1' },
  { name: 'mw10 the walk counts waiting ids against the limit', worlds: ['r4b'], file: LIB, from: 'if (touched.size + legacyCost + freshProduct + items > limits.touchedMax && last !== null)', to: 'if (touched.size + legacyCost + freshProduct + items + (known !== undefined ? JSON.parse(String(known.waiting)).length : 0) > limits.touchedMax && last !== null)', red: 'R4b' },
  { name: 'mw11 no exactness re-read (exact always true)', file: LIB, from: 'const exact = lastTop === topId', to: 'const exact = true', red: 'R1' },
  { name: 'mw12 the device publishes each answer as it arrives', model: { publishEach: true }, red: 'W3c' },
  { name: 'mw14 legacy without a.status = pending', file: LIB, from: "a.line_set_json IS NULL AND a.session_id IS NOT NULL AND a.status = 'pending' AS legacy", to: 'a.line_set_json IS NULL AND a.session_id IS NOT NULL AS legacy', red: 'L2' },
]
const SWITCHES = { ic_simple: 'on', ic_marks: 'on', ic_wired: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', catalog_ranked_scope: 'on' }
const PLAIN_SWITCHES = { ic_simple: 'on', ic_marks: 'on', ic_fix_stock: 'on' }

// F.4: the verdict of one mutant run, from the report of that run.
function verdict(report, expected) {
  if (report.skipped.length) return { killed: false, text: `not killed (skipped: ${report.skipped[0].split(':')[0]})` }
  if (!report.red) return { killed: false, text: 'not killed (stayed green)' }
  if (!report.red.label.startsWith(expected)) return { killed: false, text: `not killed (red at "${report.red.label}", expected "${expected}")` }
  return { killed: true, text: `killed at "${report.red.label}": ${report.red.message}` }
}
// The runner's own fixture: reports as a mutant that throws in a writer, or turns red at the wrong step, would leave them. Run first on every invocation; it needs no world.
function runnerSelfCheck(v = verdict) {
  const rep = (extra) => ({ steps: [], skipped: [], red: null, ...extra })
  const thrown = v(rep({ skipped: ['W3b supersede across sessions: boom'] }), 'W3b')
  assert.equal(thrown.killed, false, 'a mutant that throws in a writer is not killed')
  assert.ok(thrown.text.startsWith('not killed (skipped: W3b'), 'it is reported as skipped: ' + thrown.text)
  assert.equal(v(rep({ skipped: ['W3b x: boom'], red: { label: 'W3b supersede across sessions', message: 'm' } }), 'W3b').killed, false, 'a skipped step beside a red one is not killed')
  assert.equal(v(rep(), 'W3b').killed, false, 'a mutant that stays green is not killed')
  assert.equal(v(rep({ red: { label: 'W1 plain submission', message: 'm' } }), 'W3b').killed, false, 'red at another step than the named one is not killed')
  assert.equal(v(rep({ red: { label: 'W3b supersede across sessions', message: 'm' } }), 'W3b').killed, true, 'red at the named step is killed')
}

async function run(patches, model = {}, worlds = ['main', 'r4a', 'r4b']) {
  Object.assign(MODEL, { union: false, publishEach: false }, model)
  const report = { steps: [], skipped: [], red: null, at: 'boot' }
  const inWorld = async (opts, fn) => { const world = await bootWorld({ seedVariant: 'base', patches, ...opts }); try { await fn(world) } finally { await world.dispose() } }
  try {
    if (worlds.includes('main')) await inWorld({ tier: 'free', switches: SWITCHES }, (world) => scenario(world, report, patches))
    if (worlds.includes('r4a')) await inWorld({ tier: 'paid', switches: SWITCHES }, (world) => throughput(world, report, 'R4a throughput, Paid, production switches', 'paid'))
    if (worlds.includes('r4b')) await inWorld({ tier: 'free', switches: PLAIN_SWITCHES }, (world) => throughput(world, report, 'R4b throughput, Free, plain writer', 'free'))
  } catch (e) { report.red = { label: report.at, message: String(e.message).split('\n')[0].slice(0, 200) } }
  return report
}

if (require.main === module) (async () => {
  runnerSelfCheck()
  console.log('PASS the runner rule: skipped, green, wrong-step and named-step mutants are told apart')
  if (process.argv.includes('--runner-fixture')) return process.exit(0)
  let bad = 0
  if (!process.argv.includes('--skip-base')) {
    const base = await run([])
    for (const s of base.steps) console.log('PASS ' + s)
    for (const s of base.skipped) console.log('SKIPPED (writer did not run) ' + s)
    if (base.red) console.log(`RED at "${base.red.label}": ${base.red.message}`)
    console.log('caps ' + JSON.stringify(base.caps) + ' i7 ' + JSON.stringify(base.i7) + ' i8 ' + JSON.stringify(base.i8) + ' legacyAnswers ' + base.legacyAnswers)
    bad = base.skipped.length || base.red ? 1 : 0
  }
  if (process.argv.includes('--mutants')) {
    const only = (process.argv.find((x) => x.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
    for (const m of MUTANTS.filter((x) => !only.length || only.some((o) => x.name.startsWith(o + ' ')))) {
      const report = await run(m.file ? [{ name: m.name, file: m.file, from: m.from, to: m.to }] : [], m.model, m.worlds || ['main'])
      const v = verdict(report, m.red)
      console.log(`${v.killed ? 'PASS' : 'FAIL'} mutant ${m.name} (named step "${m.red}"): ${v.text}`)
      if (!v.killed) bad = 1
    }
  }
  process.exit(bad)
})().catch((e) => { console.error('FAIL ' + (e.stack || e)); process.exit(1) })

module.exports = { Device, oracle, same, counter, limitsOf, verdict, runnerSelfCheck, numbered, loadMarksLib, MUTANTS }
