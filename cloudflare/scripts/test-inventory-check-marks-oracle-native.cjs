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
// --collect (a red-first aid, never a gate): a step whose check fails is recorded in report.reds and the run goes on, so one run on a base shows every new step red. The verdicts of the runner (F.4) never use it.
const COLLECT = process.argv.includes('--collect')
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

// The role fixture of A2: another signed-in actor (id, username, role code, permissions). 903 = a counter without the stock field (I9), 904 = a lead who may approve and adjust (W10).
async function actor(world, id, username, code, permissions) {
  await world.db.prepare('INSERT OR IGNORE INTO roles(id,name,code,permissions,is_system) VALUES(?,?,?,?,0)').bind(id, 'Oracle ' + username, code, JSON.stringify(permissions)).run()
  await world.db.prepare("INSERT OR IGNORE INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(?,?,?,?,?,'{}',1,?,0)").bind(id, username, username, bcrypt.hashSync('budget-password-1', 4), id, world.orgId).run()
  await world.db.prepare("INSERT OR IGNORE INTO trusted_devices(user_id, device_id, device_name, status, decided_at) VALUES(?,'budget-device','budget device','approved',datetime('now'))").bind(id).run()
  const login = await world.send('POST', '/api/auth/login', { username, password: 'budget-password-1', organizationId: world.orgId, deviceId: 'budget-device' }, { cookie: null })
  if (!login.setCookie) throw new Error(username + ' could not sign in: ' + login.text.slice(0, 200))
  return login.setCookie.split(';')[0]
}

// F.6a, the pairing check: what a writer changed must be named by an event it wrote. Read before and after a step: every approval's status, line set, superseded set, line decisions and the sorted KEYS of applied_json.lines,
// and every item that is or was done/issue (the only items a mark reads: a task's unstarted items carry no mark) as (state, updated_at). An approval whose tuple changed needs an event naming its session with an id in
// (top before, top after]; an item whose pair changed needs an event naming that session and product in the same range. W6u proves the rule is the KEYS (applied_json.units change, no event is needed).
async function pairSnap(world) {
  const approvals = new Map((await world.all("SELECT session_id, status, line_set_json, superseded_json, line_decisions_json, (SELECT group_concat(k) FROM (SELECT key AS k FROM json_each(json_extract(applied_json,'$.lines')) ORDER BY key)) AS applied_keys FROM inventory_check_approvals"))
    .map((r) => [String(r.session_id), JSON.stringify([r.status, r.line_set_json, r.superseded_json, r.line_decisions_json, r.applied_keys])]))
  const items = new Map((await world.all("SELECT session_id, product_id, state, updated_at FROM inventory_check_items WHERE state IN ('done','issue')")).map((r) => [`${r.session_id}|${r.product_id}`, `${r.state}|${r.updated_at}`]))
  const top = Number((await world.all('SELECT COALESCE(MAX(id), 0) AS top FROM inventory_check_events'))[0].top)
  return { approvals, items, top }
}
async function paired(world, before, label) {
  const after = await pairSnap(world)
  const events = await world.all('SELECT session_id, product_id FROM inventory_check_events WHERE id > ? AND id <= ?', before.top, after.top)
  const named = new Set(events.map((e) => String(e.session_id))), namedItem = new Set(events.filter((e) => e.product_id != null).map((e) => `${e.session_id}|${e.product_id}`))
  const missing = []
  for (const [sid, tuple] of after.approvals) if (before.approvals.get(sid) !== tuple && !named.has(sid)) missing.push('approval ' + sid)
  for (const key of new Set([...before.items.keys(), ...after.items.keys()])) if (before.items.get(key) !== after.items.get(key) && !namedItem.has(key)) missing.push('item ' + key)
  assert.deepEqual(missing.slice(0, 5), [], `${label}: a writer changed ${missing.length} approval(s) or item(s) with no event naming them in (${before.top}, ${after.top}] (F.6a)`)
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
const MODEL = { union: false, publishEach: false, dropHeld: false }
// The device model of A.4. `marks` and `waitingBySession` are what the view reads (PUBLISHED); every chain of answers is applied to `staged` and published only when it ends with more = false.
class Device {
  constructor(world, branch, opts = {}) { Object.assign(this, { world, branch, marks: new Map(), waitingBySession: new Map(), staged: null, cursor: 0, tag: '', top: 0, answers: 0, rebuilds: 0, pagesFetched: 0, log: [], miss: opts.miss !== false, caps: null, maxMarks: 0, trace: !!opts.trace, union: opts.union ?? MODEL.union, publishEach: opts.publishEach ?? MODEL.publishEach, dropHeld: opts.dropHeld ?? MODEL.dropHeld }) }
  get pending() { return new Set([...this.waitingBySession.values()].flat()) }
  begin() { this.staged = { marks: new Map(this.marks), waiting: this.dropHeld ? new Map() : new Map([...this.waitingBySession].map(([k, v]) => [k, [...v]])) } }
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
  const leadCookie = await actor(world, 904, 'budget_lead', 'lead', { inventory_checks: true, inventory_check_show_stock: true, inventory: true, inventory_check_approve: true })
  const nostockCookie = await actor(world, 903, 'budget_nostock', 'employee', { inventory_checks: true })
  const device = new Device(world, 1)
  await device.build()
  const scope ={ organization: world.orgId, branchId: 1 }
  const limitsOfMarks = { pageEvents: limits.inventoryMarksChangesPageEvents, touchedMax: limits.inventoryMarksTouchedMax }
  // A step: the WRITER makes the change (a throw there is `skipped`, never red); the CHECKER (default: the device catches up and equals the oracle, and so does a freshly built device) is what can turn red.
  const step = async (label, writer, checker) => {
    at(label)
    // F.6a runs around every step except I7: a restored log reuses event ids, so "an id in (top before, top after]" cannot hold for it.
    const before = label.startsWith('I7 ') ? null : await pairSnap(world)
    try { await writer() } catch (e) { report.skipped.push(`${label}: ${String(e.message).slice(0, 120)}`); return }
    if (before) await paired(world, before, label)
    try {
      if (checker) await checker(); else { await snap(); await device.sync(); await same(world, device, label) }
      if (before) await paired(world, before, label)
      const built = new Device(world, 1); await built.build(); await same(world, built, label + ' (fresh build)'); report.steps.push(label)
    } catch (e) { if (!COLLECT) throw e; report.reds.push({ label, message: String(e.message).split('\n')[0].slice(0, 200) }) }
  }
  // A check outside step() (no device comparison): the same collect rule.
  const guarded = async (label, fn) => { at(label); try { await fn(); report.steps.push(label) } catch (e) { if (!COLLECT) throw e; report.reds.push({ label, message: String(e.message).split('\n')[0].slice(0, 200) }) } }
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
  const nullEvent = (sid, when) => world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES(?,NULL,1,NULL,'observe',?,'h','{}',json_object('approval','rejected'),'{}',?)").bind(sid, rid('ne'), when).run()
  await snap()
  at('empty world')
  const empty = await same(world, device, 'empty world'); report.steps.push('empty world (' + empty.marks.size + ' marks)')
  // W1 plain submission (some lines differ: an approval waits)
  const a = await fresh(12)
  await step('W1 plain submission with differing lines', () => submit(a, 3))
  // W2 lot submission (A2): three products, each on two received dates. X: one date +1 and the other -1 (the totals match, each date is wrong); Y: one date differs; Z: both match. The line set must hold X and Y and not Z
  // (a rule that judged waiting from the totals would drop X: countDiffersSql). Counted by the counter, as the page sends it.
  const lotsOf = async (pid) => (await world.all('SELECT s.batch_id AS batch, s.quantity AS q FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id=? AND s.branch_id=1 AND s.quantity>0 AND b.is_active=1 ORDER BY b.id', pid)).map((r) => ({ batch: Number(r.batch), q: Number(r.q) }))
  const twoLots = async (n) => { const rows = await world.all('SELECT b.variant_product_id AS pid FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id AND b.is_active=1 JOIN products p ON p.id=b.variant_product_id AND p.is_active=1 AND COALESCE(p.is_group,0)=0 WHERE s.branch_id=1 AND s.quantity>0 AND p.id NOT IN (SELECT product_id FROM inventory_check_items) GROUP BY b.variant_product_id HAVING COUNT(*)=2 AND MIN(s.quantity)>=3 ORDER BY pid LIMIT ?', n); assert.equal(rows.length, n, 'products with exactly two received dates'); return rows.map((r) => Number(r.pid)) }
  const oneLot = async (n) => { const rows = await world.all('SELECT b.variant_product_id AS pid, MIN(s.batch_id) AS batch, MIN(s.quantity) AS q FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id AND b.is_active=1 JOIN products p ON p.id=b.variant_product_id AND p.is_active=1 AND COALESCE(p.is_group,0)=0 WHERE s.branch_id=1 AND s.quantity>0 AND p.id NOT IN (SELECT product_id FROM inventory_check_items) GROUP BY b.variant_product_id HAVING COUNT(*)=1 AND MIN(s.quantity)>=4 ORDER BY pid DESC LIMIT ?', n); assert.equal(rows.length, n, 'products with one received date'); return rows.map((r) => ({ pid: Number(r.pid), batch: Number(r.batch), q: Number(r.q) })) }
  const lotLine = async (pid, deltas) => { const lots = await lotsOf(pid); assert.equal(lots.length, 2, 'two dates of ' + pid); return { productId: pid, lots: lots.map((l, k) => ({ batchId: l.batch, scope: 'lot', counted: l.q + deltas[k], seen: l.q })) } }
  const submitLots = (lines) => must(world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines }, { cookie: counterCookie }), 'lot submit')
  const byId = (list) => [...list].sort((x, y) => x - y)
  const [x2, y2, z2] = await twoLots(3)
  let w2 = null
  await step('W2 lot submission, dates differ with equal totals', async () => { w2 = await submitLots([await lotLine(x2, [1, -1]), await lotLine(y2, [1, 0]), await lotLine(z2, [0, 0])]) }, async () => {
    const sid2 = w2.json.item.id
    assert.deepEqual((await oracle(world, 1)).bySession.get(sid2), byId([x2, y2]), 'W2: the line set holds the product whose totals match but whose dates differ, and the product with one differing date, and not the matching one')
    await snap(); await device.sync(); await same(world, device, 'W2 lot submission')
    assert.deepEqual(byId(device.waitingBySession.get(sid2) || []), byId([x2, y2]), 'W2: the device holds the same list')
  })
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
  await device.sync()
  await step('W7 line reject', async () => { await must(world.send('POST', `${IC}/sessions/${bs}/approval/lines`, { requestId: rid('ln'), productId: b[0].id, action: 'reject' }), 'line reject') })
  await step('W7 line reopen', async () => { await must(world.send('POST', `${IC}/sessions/${bs}/approval/lines`, { requestId: rid('ln'), productId: b[0].id, action: 'reopen' }), 'line reopen') })
  await step('W6 approve whole', () => approval(bs, 'approve'))
  // W6p partial accept by productIds: 2 of 3 lines. The list must lose exactly those two, under their landing events; the third keeps waiting.
  const pp = await fresh(3)
  await submit(pp, 1); const pps = await sessionOf(pp[0].id); await device.sync()
  await step('W6p partial accept by productIds', () => approval(pps, 'approve', { productIds: [pp[0].id, pp[1].id] }), async () => {
    await snap(); await device.sync(); const o = await same(world, device, 'W6p partial accept by productIds')
    assert.deepEqual(o.bySession.get(pps), [pp[2].id], 'W6p: exactly the two accepted lines left the list')
  })
  // W6u dates-only partial: a product on two dates, both lowered; on Free one date lands a request (stockInLinesPerRequest 1), so the first request changes applied_json.units and plan_json and nothing else. No event is written, the keys
  // of applied_json.lines do not change, waiting is unchanged. A pairing rule that demanded an event for any applied_json change would report a false defect here (F.6a), and a waiting rule that read units would drop the line.
  const [u6] = await twoLots(1)
  const u6s = (await submitLots([await lotLine(u6, [-1, -1])])).json.item.id; await device.sync()
  const events6 = async () => Number((await world.all('SELECT COUNT(*) AS n FROM inventory_check_events WHERE session_id=?', u6s))[0].n)
  const applied6 = async () => JSON.parse((await world.all('SELECT applied_json FROM inventory_check_approvals WHERE session_id=?', u6s))[0].applied_json)
  let u6events = 0
  await step('W6u dates-only partial', async () => {
    u6events = await events6()
    for (let n = 0; n < 4; n++) { const r = await must(world.send('POST', `${IC}/sessions/${u6s}/approval`, { decision: 'approve', requestId: rid('ap') }), 'approval'); if (Object.keys((await applied6()).units || {}).length || r.json.done !== false) break }
  }, async () => {
    const applied = await applied6()
    assert.deepEqual(Object.keys(applied.lines || {}), [], 'W6u: no product is complete, so the keys of applied_json.lines do not change')
    assert.ok(Object.keys(applied.units || {}).length >= 1, 'W6u: one received date landed (applied_json.units changed)')
    assert.equal(await events6(), u6events, 'W6u: a dates-only landing writes no event')
    await snap(); await device.sync(); const o = await same(world, device, 'W6u dates-only partial')
    assert.deepEqual(o.bySession.get(u6s), [u6], 'W6u: waiting is unchanged')
  })
  await step('W6u the second date completes the product', () => approval(u6s, 'approve'))
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
    await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,actor_name,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES('l1-0',?,1,NULL,'observe',?,'h','{}',json_object('approval','rejected'),'{}',?)").bind(pool1[0].id, rid('l1d'), when1).run()
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
  // W10 takeover (A2): the lead starts approving 3 lines, one lands (Free: one line a request) and the answer is lost (the claim stays). The lead is switched off; the admin takes the approval over. The landed line must leave the list AT
  // the takeover, under its own events, not at the end (an assertion on the rule itself: the device and the oracle would agree on a server that waited).
  const w10 = await fresh(3)
  await submit(w10, 1); const w10s = await sessionOf(w10[0].id); await device.sync()
  const listOf = async (sid) => (await oracle(world, 1)).bySession.get(sid) || []
  await step('W10 takeover', async () => {
    assert.equal((await listOf(w10s)).length, 3)
    await world.db.exec("CREATE TRIGGER oracle_lost_answer BEFORE UPDATE OF applied_json ON inventory_check_approvals WHEN NEW.applied_json <> OLD.applied_json BEGIN SELECT RAISE(ABORT,'oracle_lost_answer'); END")
    try {
      const claim = rid('ap'); let lost = null
      for (let n = 0; n < 4 && (!lost || lost.status !== 503); n++) lost = await world.send('POST', `${IC}/sessions/${w10s}/approval`, { decision: 'approve', requestId: claim }, { cookie: leadCookie })
      if (lost.status !== 503) throw new Error('the lost answer was not refused: ' + lost.status + ' ' + lost.text.slice(0, 160))
    } finally { await world.db.exec('DROP TRIGGER IF EXISTS oracle_lost_answer') }
    await world.db.prepare('UPDATE users SET is_active=0 WHERE id=904').run()
  }, async () => {
    try {
      const take = await must(world.send('POST', `${IC}/sessions/${w10s}/approval`, { decision: 'approve', requestId: rid('tk') }), 'takeover')
      assert.equal(take.json.takeover, true, 'W10: the second approver took the approval over')
      await snap(); await device.sync(); await same(world, device, 'W10 takeover')
      assert.equal((await listOf(w10s)).length, 2, 'W10: the landed line left the list at the takeover')
      assert.equal((device.waitingBySession.get(w10s) || []).length, 2, 'W10: the device dropped the landed line at the takeover, not at the end')
      await approval(w10s, 'approve')
    } finally { await world.db.prepare('UPDATE users SET is_active=1 WHERE id=904').run() }
    await snap(); await device.sync(); await same(world, device, 'W10 takeover finished')
  })
  // W11 a Set closes an Issue, Undo, Redo, and a Set that cannot close (stockSetClosesIssue.ts, its own batch of items and events naming the product). The Set is the real route; Undo and Redo go through the action history.
  const [s11, s12] = await oneLot(2)
  const setLot = (p, quantity, expected) => world.send('POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: p.pid, branchId: 1, batchId: p.batch, quantity, expectedLotQuantity: expected, reason: 'Physical count', client_request_id: 'inventory_set_' + crypto.randomBytes(8).toString('hex') })
  const adjust = (p, quantity, expected) => must(setLot(p, quantity, expected), 'set')
  const markOf = (pid) => device.marks.get(pid) || [0, 0]
  const itemTime = async (pid) => Number((await world.all(`SELECT ${T('updated_at')} AS t FROM inventory_check_items WHERE product_id=? AND state IN ('done','issue') ORDER BY updated_at DESC, session_id DESC LIMIT 1`, pid))[0].t)
  await step('W11 an Issue to close', async () => {
    const s = await must(world.send('POST', `${IC}/sessions`, { branchId: 1, title: 'oracle issue', productIds: [s11.pid], scope: {}, requestId: rid('se') }), 'session'); const sid11 = s.json.item.id
    await must(world.send('PATCH', `${IC}/sessions/${sid11}/items/${s11.pid}`, { expectedRevision: 0, expectedSessionRevision: 0, requestId: rid('ob'), state: 'issue', counted_quantity: s11.q - 2, reason: 'miscount' }), 'issue')
    const r = (await world.all('SELECT revision FROM inventory_check_sessions WHERE id=?', sid11))[0]
    await must(world.send('PATCH', `${IC}/sessions/${sid11}`, { expectedRevision: Number(r.revision), requestId: rid('ck'), action: 'close' }), 'close')
  }, async () => { await snap(); await device.sync(); await same(world, device, 'W11 an Issue to close'); assert.equal(markOf(s11.pid)[1], 2, 'W11: the product is an Issue') })
  let closed = null, historyId = 0
  await step('W11 Set closes the Issue', async () => {
    closed = await adjust(s11, s11.q - 2, s11.q)
    historyId = Number((await world.all("SELECT id FROM action_history WHERE entity='stock_quantity_set' ORDER BY id DESC LIMIT 1"))[0].id)
  }, async () => {
    assert.equal(closed.json.issue_closed, true, 'W11: the Set that matches the count closes the Issue')
    await snap(); await device.sync(); await same(world, device, 'W11 Set closes the Issue')
    assert.deepEqual([markOf(s11.pid)[1], markOf(s11.pid)[0]], [1, await itemTime(s11.pid)], 'W11: the product is Done at the time of the new count')
  })
  await step('W11 Undo of the Set', () => must(world.send('POST', `/api/action-history/${historyId}/undo`, { require_applied: true, expected_generation: 0 }), 'undo'), async () => {
    await snap(); await device.sync(); await same(world, device, 'W11 Undo of the Set')
    assert.deepEqual([markOf(s11.pid)[1], markOf(s11.pid)[0]], [2, await itemTime(s11.pid)], 'W11: the Issue is open again')
  })
  await step('W11 Redo of the Set', () => must(world.send('POST', `/api/action-history/${historyId}/redo`, { require_applied: true, expected_generation: 1 }), 'redo'), async () => {
    await snap(); await device.sync(); await same(world, device, 'W11 Redo of the Set')
    assert.deepEqual([markOf(s11.pid)[1], markOf(s11.pid)[0]], [1, await itemTime(s11.pid)], 'W11: the Issue is closed again, at the time of its record')
  })
  await submit([{ id: s12.pid, q: s12.q }], 1); await device.sync()
  let refused = null, listsBefore = null
  const listsOf = (m) => JSON.stringify([...m].sort((x, y) => (x[0] < y[0] ? -1 : 1)))
  await step('W11 a Set that cannot close leaves the lists unchanged', async () => { listsBefore = listsOf((await oracle(world, 1)).bySession); refused = await setLot(s12, s12.q + 1, s12.q) }, async () => {
    assert.equal(refused.status, 409, 'W11: a Set is refused while a count of the product waits (it writes nothing): ' + refused.text.slice(0, 160))
    await snap(); await device.sync(); const o = await same(world, device, 'W11 a Set that cannot close')
    assert.equal(listsOf(o.bySession), listsBefore, 'W11: the waiting lists are unchanged')
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
  // (W13 follows I10 so that m2, which hides inactive products from the snapshot, turns red at I10 first.)
  // W13 merge and header (A2): the catalogue index (the products table, with its population token) moves, the count tables do not. A device keeps the marks of both products; Waiting is the pending ids that are still in the population,
  // so it drops by one on the device and on the oracle alike. A device that moved the mark to the kept id would differ.
  const permitProducts = () => world.db.prepare("INSERT OR REPLACE INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'").run()
  const unpermitProducts = () => world.db.prepare("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'").run()
  const waitingInPopulation = async (ids) => Number((await world.all("SELECT COUNT(*) AS n FROM products WHERE is_active=1 AND COALESCE(is_group,0)=0 AND id IN (SELECT value FROM json_each(?))", JSON.stringify([...ids])))[0].n)
  const stamp = async () => String((await world.all('SELECT stamp FROM inventory_population_token WHERE id=1'))[0].stamp)
  const [mk, md, hk] = await freshHigh(3)
  await submit([mk], 0); await submit([md], 1); await submit([hk], 0); await device.sync()
  let held = null
  await step('W13 merge a counted, waiting duplicate', async () => {
    held = { waiting: await waitingInPopulation(device.pending), stamp: await stamp() }
    await permitProducts(); try { await world.db.prepare('UPDATE products SET is_active=0, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(md.id).run() } finally { await unpermitProducts() }
  }, async () => {
    await snap(); await device.sync(); const o = await same(world, device, 'W13 merge')
    assert.ok(device.marks.has(md.id) && device.marks.has(mk.id), 'W13: the marks of both ids stay')
    assert.notEqual(await stamp(), held.stamp, 'W13: the population token moved')
    assert.deepEqual([await waitingInPopulation(device.pending), await waitingInPopulation(o.pending)], [held.waiting - 1, held.waiting - 1], 'W13: Waiting (the population that is pending) drops by one on the device and the oracle')
  })
  await step('W13 header: a counted product becomes a parent', async () => {
    held = { waiting: await waitingInPopulation(device.pending), stamp: await stamp() }
    await permitProducts(); try { await world.db.prepare('UPDATE products SET is_group=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(hk.id).run() } finally { await unpermitProducts() }
  }, async () => {
    await snap(); await device.sync(); await same(world, device, 'W13 header')
    assert.ok(device.marks.has(hk.id), 'W13: the mark of the header stays on the device')
    assert.notEqual(await stamp(), held.stamp, 'W13: the population token moved')
  })
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
  // The batching assertion of this step (the walk needed more than one read) moved to L1b below, which asserts it with the per-answer limit as well; this step keeps the device = oracle check, which m4 turns red.
  // L1b many legacy sessions (A2): five pending approvals with no stored line set, 200 members each (1,000 in all, twice the walk's limit on Free). Every answer's waiting ids stay within the limit (a legacy session is charged its
  // members) and the feed needs more than one read. Charging legacy sessions nothing (mw8) answers about a thousand ids in one read.
  // The sessions and their members' events are read first (the device holds their marks); then ONE page names all five by a product-less event, so only the walk's charge for a legacy session (its members) limits that read.
  at('L1b many legacy sessions')
  const pool1b = await freshHigh(1000), when1b = '2026-11-07T01:00:00.000Z'
  for (let k = 0; k < 5; k++) await legacySession('l1b-' + k, pool1b.slice(k * 200, k * 200 + 200), when1b)
  await device.sync()
  await step('L1b many legacy sessions', async () => {
    for (let k = 0; k < 5; k++) await nullEvent('l1b-' + k, when1b)
  }, async () => {
    const from = device.log.length
    await snap(); await device.sync()
    const chain = device.log.slice(from).filter((x) => x.chg)
    assert.ok(chain.length >= 2 && report.legacyAnswers >= 2, `L1b: the legacy walk needed more than one read (${chain.length} here, ${report.legacyAnswers} for the two sessions of 251)`)
    for (const x of chain) { const ids = x.chg.waiting.reduce((n, w) => n + w[1], 0); assert.ok(ids <= limits.inventoryMarksTouchedMax, `L1b: an answer carried ${ids} waiting ids (limit ${limits.inventoryMarksTouchedMax})`) }
    await same(world, device, 'L1b many legacy sessions')
  })
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
  // I9 native half (A2): a signed-in counter without the stock field gets no `waiting` key from /marks/changes (the strip is in the route, from the signed-in actor of that request) and a 403 from /marks/pending, while the
  // permitted viewer's answer to the same read carries it.
  const [i9] = await freshHigh(1)
  let i9from = null
  await step('I9 native half: a viewer without the stock field', async () => { await device.sync(); i9from = { cursor: device.cursor, tag: device.tag }; await submit([i9], 1) }, async () => {
    const url = `${IC}/marks/changes?branchId=1&since=${i9from.cursor}&tag=${i9from.tag}`
    // Both reads bypass the shared answer (miss: true): this step proves the strip on a COMPUTED answer; the strip on a stored one is R5s below (mw15 removes it from the hit path only).
    const permitted = await world.send('GET', url, undefined, { miss: true })
    assert.ok(permitted.status === 200 && 'waiting' in permitted.json, 'I9: the permitted viewer gets waiting (' + permitted.status + ')')
    const plainView = await world.send('GET', url, undefined, { cookie: nostockCookie, miss: true })
    assert.equal(plainView.status, 200, 'I9: the counter without the stock field reads the marks: ' + plainView.text.slice(0, 160))
    assert.ok(!('waiting' in plainView.json) && Array.isArray(plainView.json.marks), 'I9: no waiting key for a viewer without the stock field')
    const pending = await world.send('GET', `${IC}/marks/pending?branchId=1`, undefined, { cookie: nostockCookie })
    assert.deepEqual([pending.status, pending.json.code], [403, 'inventory_check_fix_stock_required'], 'I9: /marks/pending is refused')
    await snap(); await device.sync(); await same(world, device, 'I9 native half')
  })
  // R2 shared answer, racing (A3, B.5). Part 1, the two-device step: A and B hold the same cursor, a write lands, A reads (computes and stores the answer), B reads the same (since, tag) and is served the stored answer: fewer D1 calls,
  // and the second device reads about 7 rows (gross, auth included) against A's computation. Part 2, the race: B holds cursor c, A computes since c and stores an answer that ends at its own cursor, then a write W lands; B asks since c and
  // hits that older answer. B's chain must end at a top at or after W: serving the stored `more` (mw5) ends B's chain before W.
  const [r2a, r2b, r2c] = await freshHigh(3)
  const dA = new Device(world, 1, { miss: false }), dB = new Device(world, 1, { miss: false })
  at('R2 shared answer, racing'); await dA.build(); await dB.build()
  const firstChanges = (d, from) => d.log.slice(from).find((x) => x.chg)
  await step('R2 shared answer, racing', async () => { await submit([r2a], 1) }, async () => {
    await snap()
    const a0 = dA.log.length; await dA.sync()
    const computed = firstChanges(dA, a0)
    const b0 = dB.log.length; await dB.sync()
    const hit = firstChanges(dB, b0)
    assert.ok(hit.calls < computed.calls, `R2: the second device's first read is served from the shared answer (${hit.calls} calls against ${computed.calls} computing it)`)
    report.twoDevice = { firstDevice: { rows: computed.rr, calls: computed.calls }, secondDevice: { rows: hit.rr, calls: hit.calls } }
    await same(world, dA, 'R2 first device'); await same(world, dB, 'R2 second device (served from the shared answer)')
    // the race
    await submit([r2b], 1); await snap()
    await dA.sync()
    await submit([r2c], 1); await snap()
    const b1 = dB.log.length; await dB.sync()
    const chain = dB.log.slice(b1).filter((x) => x.chg)
    const topNow = Number((await world.all('SELECT COALESCE(MAX(id), 0) AS top FROM inventory_check_events'))[0].top)
    assert.ok(chain.length >= 2 && chain[0].chg.more === true, `R2: the stored answer is older than the write that landed after it, so B's first answer says more (${chain.length} reads, more ${chain[0] && chain[0].chg.more})`)
    assert.ok(dB.cursor >= topNow, `R2: B's chain ends at the write (cursor ${dB.cursor}, top when B began ${topNow})`)
    await same(world, dB, 'R2 second device after the race')
  })
  // R5s the strip at serve time (A3, B.5): a permitted viewer computes and stores the answer with Waiting; a viewer without the stock field reads the same (since, tag), is served the stored answer, and gets no `waiting` key.
  // Serving the entry as stored (mw15) leaks it. The permitted viewer's own read of the same entry still carries it.
  const [r5a] = await freshHigh(1)
  let r5from = null
  await step('R5s strip at serve time on a stored answer', async () => { await device.sync(); r5from = { cursor: device.cursor, tag: device.tag }; await submit([r5a], 1) }, async () => {
    const url = `${IC}/marks/changes?branchId=1&since=${r5from.cursor}&tag=${r5from.tag}`
    const permitted = await world.send('GET', url)
    assert.ok(permitted.status === 200 && Array.isArray(permitted.json.waiting) && permitted.json.waiting.length > 0, 'R5s: the permitted viewer computes and stores the answer with Waiting (' + permitted.status + ')')
    const plainView = await world.send('GET', url, undefined, { cookie: nostockCookie })
    assert.equal(plainView.status, 200, 'R5s: ' + plainView.text.slice(0, 160))
    assert.ok(plainView.calls < permitted.calls, `R5s: the viewer without the stock field is served the stored answer (${plainView.calls} calls against ${permitted.calls})`)
    assert.ok(!('waiting' in plainView.json) && plainView.json.marks.length > 0, 'R5s: no waiting key in the answer served from the stored entry')
    const again = await world.send('GET', url)
    assert.ok(again.calls < permitted.calls && Array.isArray(again.json.waiting) && again.json.waiting.length > 0, 'R5s: the permitted viewer still gets Waiting from the stored entry')
    await snap(); await device.sync(); await same(world, device, 'R5s strip at serve time')
  })
  // B1 branch parity (A2, lead's answer 2): the same word as branchId gets the same status and error code from every route that takes a branch. A change to the check on one side alone turns this red.
  await step('B1 branch parity', async () => {}, async () => {
    const invalid = ['', '0', '-1', '1.5', 'abc', '1e3', '9007199254740993'], valid = [' 7 ', '007', '1234567890']
    for (const word of [...invalid, ...valid]) {
      const w = encodeURIComponent(word)
      const urls = { overlay: `${IC}/overlay?branchId=${w}&ids=${p5.id}`, lots: `${IC}/lots?branchId=${w}&productId=${p5.id}`, marks: `${IC}/marks?branchId=${w}&page=0`, changes: `${IC}/marks/changes?branchId=${w}&since=0&tag=`, pending: `${IC}/marks/pending?branchId=${w}` }
      const answers = {}
      for (const [name, url] of Object.entries(urls)) { const r = await world.send('GET', url); answers[name] = [r.status, r.json && r.json.code !== undefined ? r.json.code : null] }
      const first = JSON.stringify(answers.overlay)
      assert.deepEqual(Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, JSON.stringify(v)])), Object.fromEntries(Object.keys(answers).map((k) => [k, first])), `B1: the word ${JSON.stringify(word)} is answered alike by every route: ${JSON.stringify(answers)}`)
      assert.equal(answers.overlay[0] === 400, invalid.includes(word), `B1: ${JSON.stringify(word)} ${invalid.includes(word) ? 'is refused' : 'is accepted'}: ${JSON.stringify(answers)}`)
    }
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
  // A3: K is 10,000 on both plans (B.4), so 7,500 events are within and 25,000 are beyond; the window the devices wait in after a broadcast is sent with the capabilities.
  await guarded('I8 K = 10,000 and the broadcast jitter window are served', async () => {
    assert.equal(cap.catchUpMaxEvents, 10000, 'I8: K is 10,000 events')
    assert.equal(cap.catchUpMaxEvents, limits.inventoryMarksCatchUpMaxEvents, 'I8: K comes from the plan')
    assert.deepEqual([cap.jitterMinMs, cap.jitterMaxMs], [limits.inventoryMarksBroadcastJitterMinMs, limits.inventoryMarksBroadcastJitterMaxMs], 'I8: capabilities.marks carries the jitter window')
    assert.ok(cap.jitterMaxMs > cap.jitterMinMs, 'I8: the window has a width')
  })
  const beyondEvents = Math.floor(cap.catchUpMaxEvents * 2.5)
  const within = Math.floor(cap.catchUpMaxEvents * 0.75)
  const r0 = device.rebuilds, a0 = device.answers
  at('I8 within the threshold')
  await insertEvents(within); await snap(); await device.sync(); await same(world, device, 'I8 within the threshold')
  report.i8 = { within: { events: within, answers: device.answers - a0, rebuilds: device.rebuilds - r0 } }
  assert.equal(device.rebuilds, r0, 'I8: no rebuild within the threshold')
  const r1 = device.rebuilds
  at('I8 beyond the threshold')
  await insertEvents(beyondEvents); await snap(); await device.sync(); await same(world, device, 'I8 beyond the threshold')
  report.i8.beyond = { events: beyondEvents, rebuilds: device.rebuilds - r1 }
  assert.equal(device.rebuilds - r1, 1, 'I8: beyond the threshold the device rebuilds exactly once')
  assert.ok(device.top - device.cursor <= cap.catchUpMaxEvents / 2, 'I8: the lag after the rebuild is within half the threshold')
  // The cached snapshot page obeys the lag rule (m7): a warm page is never served further behind than half the threshold.
  at('I8 lag rule on the cached page')
  const warm = new Device(world, 1, { miss: false }); await warm.build()
  await insertEvents(Math.floor(cap.catchUpMaxEvents * 0.75))
  const page = (await world.send('GET', `${IC}/marks?branchId=1&page=0`)).json
  assert.ok(page.top - page.cursor <= cap.catchUpMaxEvents / 2, `the lag rule: a page served ${page.top - page.cursor} events behind`)
  report.steps.push('I8 lag rule on the cached page')
  // R3 shared answer after a restore, ids reused (A3): the stored answer for (since, tag) is served while the log is intact (a hit). Then the log is replaced the way a restore replaces it: the event at `since` keeps its id and has another tag
  // (its request id differs), the stored answer's own cursor event is untouched, and top is still at or past `since`. `since <= top` still holds, so only the tag tells: the right answer is `rebuild`. A hit that skips the since tag check (mw4) serves it.
  const dropNoUpdate = () => world.db.prepare('DROP TRIGGER IF EXISTS inventory_check_events_no_update').run()
  const changesUrl = (since, tag) => `${IC}/marks/changes?branchId=1&since=${since}&tag=${tag}`
  const eventAt = async (id) => (await world.all('SELECT id, actor_id, request_id, created_at FROM inventory_check_events WHERE id = ?', id))[0]
  const topId = async () => Number((await world.all('SELECT COALESCE(MAX(id), 0) AS top FROM inventory_check_events'))[0].top)
  const [r3a, r3b] = await freshHigh(2)
  await guarded('R3 shared answer after a restore, ids reused', async () => {
    const since = await topId(), tag = lib.eventTag(await eventAt(since))
    await submit([r3a], 1)
    const computed = await world.send('GET', changesUrl(since, tag), undefined, { miss: true })
    assert.ok(computed.status === 200 && computed.json.cursor > since && computed.json.exact === true, 'R3: an exact answer with events is computed and stored')
    const hit = await world.send('GET', changesUrl(since, tag))
    assert.ok(hit.status === 200 && hit.calls < computed.calls, `R3: before the restore the stored answer is served (${hit.calls} calls against ${computed.calls})`)
    await dropNoUpdate()
    await world.db.prepare("UPDATE inventory_check_events SET request_id = request_id || '-restored' WHERE id = ?").bind(since).run()
    const after = await world.send('GET', changesUrl(since, tag))
    assert.equal(after.status, 200, 'R3: ' + after.text.slice(0, 160))
    assert.equal(after.json.rebuild, true, 'R3: the event at since has another tag, so the answer is rebuild, never the stored answer')
  })
  // R3b stored-cursor check (A3): the stored answer X was computed since c1 and ends at c2. A restore keeps event c1 (its tag is the request's) and replaces event c2 (another tag), top at or past c2. X holds states the restore removed: the hit
  // must not be served and a fresh answer is computed and stored over it. A hit that skips the stored-cursor check (mw13) serves X.
  await guarded('R3b stored-cursor check', async () => {
    const since = await topId(), tag = lib.eventTag(await eventAt(since))
    await submit([r3b], 1)
    const computed = await world.send('GET', changesUrl(since, tag), undefined, { miss: true })
    assert.ok(computed.status === 200 && computed.json.cursor > since && computed.json.exact === true, 'R3b: an exact answer with events is computed and stored')
    const stale = computed.json
    const hit = await world.send('GET', changesUrl(since, tag))
    assert.ok(hit.status === 200 && hit.calls < computed.calls, `R3b: before the restore the stored answer is served (${hit.calls} calls against ${computed.calls})`)
    await world.db.prepare("UPDATE inventory_check_events SET request_id = request_id || '-restored' WHERE id = ?").bind(stale.cursor).run()
    const after = await world.send('GET', changesUrl(since, tag))
    assert.equal(after.status, 200, 'R3b: ' + after.text.slice(0, 160))
    assert.equal(after.json.rebuild, undefined, 'R3b: event c1 keeps its tag, so this is not a rebuild')
    assert.notEqual(after.json.tag, stale.tag, 'R3b: the stored answer ends at an event the restore replaced and must not be served')
    assert.equal(after.json.tag, lib.eventTag(await eventAt(stale.cursor)), 'R3b: the fresh answer names the event as it is now')
  })
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
  let big = null
  try {
    assert.equal(rows.length, 500, 'products for the 500-line submission')
    const send = async (ps) => { const r = await world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: ps.map((p) => ({ productId: p.id, countedQuantity: p.q + 1, seenQuantity: p.q })) }, { cookie: counterCookie }); if (r.status >= 300) throw new Error('submit ' + ps.length + ': ' + r.status + ' ' + r.text.slice(0, 200)); return r }
    await send(rows.slice(0, 10)); await device.sync()
    big = await send(rows)
  } catch (e) { report.skipped.push(`${label}: ${String(e.message).slice(0, 120)}`); return }
  const reads0 = device.log.length
  await device.sync(3)
  const reads = device.log.slice(reads0).filter((x) => x.chg).length
  assert.ok(reads <= 3, `${label}: the device reached more = false in ${reads} reads (at most 3)`)
  assert.ok(device.maxMarks <= limits.inventoryMarksTouchedMax, `${label}: an answer touched ${device.maxMarks} products (limit ${limits.inventoryMarksTouchedMax})`)
  if (tier === 'free') {
    at0(report, 'A1d 500-line chain: read 2 carries no list')
    const sid = big.json.item.id
    const chain = device.log.slice(reads0).filter((x) => x.chg)
    assert.ok(chain.length >= 2, 'the 500-line submission is answered in a chain of at least two reads (' + chain.length + ')')
    assert.deepEqual(chain[0].chg.waiting.filter((w) => w[0] === sid), [[sid, 500]], 'read 1 carries the 500 waiting lines of the new session')
    for (const read of chain.slice(1)) assert.deepEqual(read.chg.waiting.filter((w) => w[0] === sid), [], 'a later read of the chain carries no list for the session')
    at0(report, label)
  }
  await same(world, device, label)
  const built = new Device(world, 1); await built.build(); await same(world, built, label + ' (fresh build)')
  report.steps.push(label + ' (' + reads + ' reads)')
  if (tier === 'free') { report.steps.push('A1d 500-line chain: read 2 carries no list'); await afterChain(world, report, device, rows, big.json.item.id, counterCookie) }
}
// A1d: what follows the 500-line chain, on the same Free plain-writer world. The device already holds the new session's 500 waiting ids; each step shows what an answer carries (entries are [session, count]) and that the device equals the oracle.
//   an answer for another session must leave the held list alone (the device-drops-a-held-list mutant turns red here); a supersede and a line decision bring the new list; an approval leaving pending drops it.
async function afterChain(world, report, device, rows, sid, cookie) {
  const post = async (url, body, as) => { const r = await world.send('POST', IC + url, body, as ? { cookie: as } : undefined); if (r.status >= 300) throw new Error(url + ': ' + r.status + ' ' + r.text.slice(0, 160)); return r }
  const stepA = async (label, writer, expect) => {
    at0(report, label)
    const from = device.log.length
    try { await writer() } catch (e) { report.skipped.push(label + ': ' + String(e.message).slice(0, 120)); return }
    await device.sync()
    const entries = device.log.slice(from).filter((x) => x.chg).flatMap((x) => x.chg.waiting)
    at0(report, label)
    expect(entries)
    await same(world, device, label)
    const built = new Device(world, 1); await built.build(); await same(world, built, label + ' (fresh build)'); report.steps.push(label)
  }
  const lines = (ps, differ) => ps.map((p) => ({ productId: p.id, countedQuantity: differ ? p.q + 1 : p.q, seenQuantity: p.q }))
  const other = await world.all('SELECT p.id AS id, bs.quantity AS q FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=1 WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0 ORDER BY p.id DESC LIMIT 3')
  await stepA('A1d unrelated answer keeps the held list', () => post('/submissions', { branchId: 1, requestId: rid('sb'), lines: lines(other, false) }, cookie),
    (entries) => assert.deepEqual(entries, [], 'a submission with no differing line names no list'))
  await stepA('A1d supersede after the chain', () => post('/submissions', { branchId: 1, requestId: rid('sb'), lines: lines(rows.slice(200, 205), true) }, cookie),
    (entries) => { assert.ok(entries.some((e) => e[0] === sid && e[1] === 495), 'the old session answers its new list (495)'); assert.ok(entries.some((e) => e[0] !== sid && e[1] === 5), 'the new session answers its 5 lines') })
  await stepA('A1d line decision after the chain', () => post('/sessions/' + sid + '/approval/lines', { requestId: rid('ln'), productId: rows[300].id, action: 'reject' }),
    (entries) => assert.ok(entries.some((e) => e[0] === sid && e[1] === 494), 'the decided session answers its new list (494)'))
  let small = null
  await stepA('A1d approval leaving pending', async () => {
    small = (await world.all("SELECT session_id AS s FROM inventory_check_approvals WHERE status='pending' AND lines=5 ORDER BY submitted_at DESC LIMIT 1"))[0].s
    for (let n = 0; n < 60; n++) { const r = await post('/sessions/' + small + '/approval', { decision: 'reject', requestId: rid('ap'), note: 'no' }); if (r.json.done !== false) break }
  }, (entries) => assert.ok(entries.some((e) => e[0] === small && e[1] === 0), 'the decided session answers an empty list'))
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
  { name: 'mA1 an observe walks too (every event is set-changing)', worlds: ['r4b'], file: LIB, from: "row.action === 'create' || Number(row.decides) === 1", to: "row.action !== 'close'", red: 'A1d 500-line chain' },
  { name: 'mA2 no walk on create', file: LIB, from: "row.action === 'create' || Number(row.decides) === 1", to: 'Number(row.decides) === 1', red: 'W1 plain submission' },
  { name: 'mA3 no walk on a line decision', file: LIB, from: "json_extract(after_json,'$.approval') IS NOT NULL ELSE 1 END AS decides", to: "json_extract(after_json,'$.approval') IS NOT NULL AND (product_id IS NULL OR json_extract(after_json,'$.state') IS NOT NULL OR json_extract(after_json,'$.superseded_by') IS NOT NULL) ELSE 1 END AS decides", red: 'W7 line reject' },
  { name: 'mA4 the device drops a held list between answers', model: { dropHeld: true }, worlds: ['r4b'], red: 'A1d unrelated answer keeps the held list' },
  { name: 'mw8 legacy sessions cost nothing in the walk', file: LIB, from: 'if (freshSession) { charged.add(sid); legacyCost += items }', to: 'if (freshSession) { charged.add(sid); legacyCost += 0 }', red: 'L1b' },
  // mw17 as the amendment words it (the line decision's -end event) is an equivalent mutant: the line's own event names the session and carries $.approval. The reject-whole event is the one a writer has alone.
  { name: 'mw17 reject whole writes no event naming its session', file: 'src/lib/inventoryCheckApprovals.ts', from: "eventStatement(actor, { sessionId, action: 'observe', key, hash, before: { approval: 'pending', lines: row.lines }, after: { approval: 'rejected', lines: row.lines }, result: { sessionRevision: session.revision }, now }),", to: '', red: 'W8b' },
  { name: 'mx2 waiting judged from the totals (no received dates in the line set)', file: 'src/lib/inventoryCheckSessions.ts', from: 'eps: string, dated = true): string =>', to: 'eps: string, dated = false): string =>', red: 'W2' },
  { name: 'mx10 a takeover records the landed line only later (applied_json kept)', file: 'src/lib/inventoryCheckApprovals.ts', from: 'newApplied: appliedJson(folded.lines, folded.held), unseenIds: JSON.stringify(unseen) }', to: 'newApplied: row.applied_json, unseenIds: JSON.stringify(unseen) }', red: 'W10' },
  { name: 'mx11 a Set never closes the Issue', file: 'src/lib/stockSetClosesIssue.ts', from: '@now,@now,@now WHERE ${CLOSABLE}`, params },', to: '@now,@now,@now WHERE 0`, params },', red: 'W11' },
  { name: 'mb1 /overlay accepts only nine digits of branch', file: 'src/routes/inventoryChecks.ts', from: '!/^\\d+$/.test(branchWord)', to: '!/^\\d{1,9}$/.test(branchWord)', red: 'B1' },
  { name: 'mw14 legacy without a.status = pending', file: LIB, from: "a.line_set_json IS NULL AND a.session_id IS NOT NULL AND a.status = 'pending' AS legacy", to: 'a.line_set_json IS NULL AND a.session_id IS NOT NULL AS legacy', red: 'L2' },
  // A3, the shared changes answer (B.5). mw4/mw13/mw5 mutate the serve of a stored answer in the library; mw15 mutates the hit path of the route alone (the computed path keeps its strip, which I9 proves).
  { name: 'mw4 a cache hit skips the tag check of since', file: LIB, from: '(since > 0 && (!sinceEvent || eventTag(sinceEvent) !== tag))', to: 'false', red: 'R3 shared' },
  { name: 'mw5 a cache hit is served with its stored more', file: LIB, from: 'more: stored.more || stored.cursor < topId', to: 'more: stored.more', red: 'R2 shared' },
  { name: 'mw13 a cache hit skips the stored-cursor tag check', file: LIB, from: 'stored.cursor > topId || !cursorEvent || eventTag(cursorEvent) !== stored.tag', to: 'false', red: 'R3b' },
  { name: 'mw15 waiting is not stripped from a stored answer', file: 'src/routes/inventoryChecks.ts', from: 'start.permitted ? served : withoutWaiting(served)', to: 'served', red: 'R5s' },
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
  Object.assign(MODEL, { union: false, publishEach: false, dropHeld: false }, model)
  const report = { steps: [], skipped: [], red: null, at: 'boot', reds: [] }
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
    if (base.twoDevice) console.log('two devices (B.5): ' + JSON.stringify(base.twoDevice))
    for (const r of base.reds) console.log(`RED (collected) "${r.label}": ${r.message}`)
    bad = base.skipped.length || base.red || base.reds.length ? 1 : 0
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
