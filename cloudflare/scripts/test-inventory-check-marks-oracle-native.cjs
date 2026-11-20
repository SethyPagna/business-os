'use strict'
// The count marks oracle (invariants I6, I7, I8, I10; spec section 3, S0a). Runs under the native-test lock (Records/Locks/native-tests).
//   node scripts/test-inventory-check-marks-oracle-native.cjs [--mutants]
// A simulated device builds its map from /marks pages (+ /marks/pending), then follows /marks/changes; after every writer step the device map must equal the oracle: the latest count of each product by the rule
// of LATEST_ITEMS_SQL (text copied below so it survives the deletion of the old reader), and the waiting set must equal PENDING_ITEMS_SQL. A device that has not seen the step cannot pass: the oracle changes with every writer.
// --mutants: the same run on a Worker with one line of lib/inventoryCheckMarks.ts (or the cached-page rule) mutated; every mutant must turn the run red.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const bcrypt = require('bcryptjs')
const { bootWorld } = require('./read-budget/world.cjs')

const IC = '/api/inventory-checks'
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
const PENDING = `SELECT DISTINCT i.product_id AS product_id FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id = a.session_id AND i.branch_id = a.branch_id
  WHERE a.organization_id IS ?1 AND a.branch_id = ?2 AND ${waiting('a', 'i')}`

async function counter(world) {
  await world.db.prepare("INSERT OR IGNORE INTO roles(id,name,code,permissions,is_system) VALUES(902,'Counter','employee',?,0)").bind(JSON.stringify({ inventory_checks: true, inventory_check_show_stock: true })).run()
  await world.db.prepare("INSERT OR IGNORE INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(902,'budget_counter','budget_counter',?,902,'{}',1,?,0)").bind(bcrypt.hashSync('budget-password-1', 4), world.orgId).run()
  await world.db.prepare("INSERT OR IGNORE INTO trusted_devices(user_id, device_id, device_name, status, decided_at) VALUES(902,'budget-device','budget device','approved',datetime('now'))").run()
  const login = await world.send('POST', '/api/auth/login', { username: 'budget_counter', password: 'budget-password-1', organizationId: world.orgId, deviceId: 'budget-device' }, { cookie: null })
  if (!login.setCookie) throw new Error('the counter could not sign in: ' + login.text.slice(0, 200))
  return login.setCookie.split(';')[0]
}

async function oracle(world, branch) {
  const marks = new Map((await world.all(LATEST, world.orgId, branch)).map((r) => [Number(r.product_id), [Number(r.t), Number(r.s)]]))
  const pending = new Set((await world.all(PENDING, world.orgId, branch)).map((r) => Number(r.product_id)))
  return { marks, pending }
}

class Device {
  constructor(world, branch, opts = {}) { Object.assign(this, { world, branch, marks: new Map(), pending: new Set(), cursor: 0, tag: '', answers: 0, rebuilds: 0, pagesFetched: 0, log: [], miss: opts.miss !== false, caps: null }) }
  async get(url) { const r = await this.world.send('GET', url, undefined, { miss: this.miss }); this.answers++; this.log.push({ url: url.replace(IC, ''), status: r.status, calls: r.calls, rr: r.rr }); return r }
  async build() {
    const w = this.world
    this.marks = new Map(); this.pending = new Set(); this.rebuilds += 1
    const first = await this.get(`${IC}/marks?branchId=${this.branch}&page=0`)
    assert.equal(first.status, 200, 'marks page 0: ' + first.text.slice(0, 200))
    const answers = [first.json]
    for (const page of first.json.buckets) if (page !== 0) { const r = await this.get(`${IC}/marks?branchId=${this.branch}&page=${page}`); assert.equal(r.status, 200, 'marks page ' + page); answers.push(r.json) }
    const cursors = []
    for (const a of answers) { this.pagesFetched++; cursors.push([a.cursor, a.tag]); for (const [id, t, s] of a.rows ?? []) this.marks.set(id, [t, s]) }
    let after = ''
    for (;;) {
      const r = await this.get(`${IC}/marks/pending?branchId=${this.branch}${after}`)
      if (r.status === 403) break
      assert.equal(r.status, 200, 'pending: ' + r.text.slice(0, 200))
      cursors.push([r.json.cursor, r.json.tag]); for (const id of r.json.ids) this.pending.add(id)
      if (!r.json.next) break
      after = `&afterAt=${encodeURIComponent(r.json.next.afterAt)}&afterId=${encodeURIComponent(r.json.next.afterId)}`
    }
    const min = cursors.reduce((a, b) => (b[0] < a[0] ? b : a))
    this.cursor = min[0]; this.tag = min[1]
    await this.sync()
  }
  async sync(limit = 200) {
    for (let n = 0; n < limit; n++) {
      const r = await this.get(`${IC}/marks/changes?branchId=${this.branch}&since=${this.cursor}&tag=${this.tag}`)
      assert.equal(r.status, 200, 'changes: ' + r.text.slice(0, 200))
      if (r.json.rebuild || (this.catchUp && r.json.top - this.cursor > this.catchUp)) { return this.build() }
      for (const [id, t, s] of r.json.marks) { if (s === 0) this.marks.delete(id); else this.marks.set(id, [t, s]) }
      for (const [id, w] of r.json.pending ?? []) { if (w) this.pending.add(id); else this.pending.delete(id) }
      this.cursor = r.json.cursor; this.tag = r.json.tag; this.top = r.json.top
      if (!r.json.more) return
    }
    throw new Error('the change feed did not finish')
  }
}

const diff = (a, b) => { const out = []; for (const [k, v] of a) if (!b.has(k) || JSON.stringify(b.get(k)) !== JSON.stringify(v)) out.push(`${k}: ${JSON.stringify(v)} vs ${JSON.stringify(b.get(k))}`); for (const k of b.keys()) if (!a.has(k)) out.push(`${k}: missing vs ${JSON.stringify(b.get(k))}`); return out }
async function same(world, device, label) {
  const o = await oracle(world, device.branch)
  const dm = diff(device.marks, o.marks), dp = diff(new Map([...device.pending].map((x) => [x, 1])), new Map([...o.pending].map((x) => [x, 1])))
  assert.deepEqual([dm.slice(0, 5), dp.slice(0, 5)], [[], []], `${label}: device vs oracle (${dm.length} mark and ${dp.length} waiting differences)`)
  return o
}

async function scenario(world, report) {
  const must = async (p, what) => { const r = await p; if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 300)}`); return r }
  let offset = 0
  const fresh = async (n) => { const rows = await world.all(`SELECT p.id AS id, bs.quantity AS q FROM products p JOIN branch_stock bs ON bs.product_id=p.id AND bs.branch_id=1 WHERE p.is_active=1 AND COALESCE(p.is_group,0)=0 AND p.id NOT IN (SELECT product_id FROM inventory_check_items) ORDER BY p.id LIMIT ? OFFSET ?`, n, offset); offset += n; assert.equal(rows.length, n, 'products left'); return rows }
  const plain = (ps, diffEvery = 0) => ps.map((p, i) => ({ productId: p.id, countedQuantity: diffEvery && i % diffEvery === 0 ? p.q + 1 : p.q, seenQuantity: p.q }))
  const submit = (ps, diffEvery, extra = {}) => must(world.send('POST', `${IC}/submissions`, { branchId: 1, requestId: rid('sb'), lines: plain(ps, diffEvery), ...extra }, { cookie: counterCookie }), 'submit')
  const approval = async (sid, decision, extra = {}) => { for (let n = 0; n < 60; n++) { const r = await must(world.send('POST', `${IC}/sessions/${sid}/approval`, { decision, requestId: rid('ap'), ...extra }), 'approval ' + decision); if (r.json.done !== false) return r } throw new Error('approval did not finish') }
  const sessionOf = async (pid) => (await world.all('SELECT i.session_id AS s FROM inventory_check_items i JOIN inventory_check_approvals a ON a.session_id=i.session_id WHERE i.product_id=? ORDER BY i.updated_at DESC LIMIT 1', pid))[0].s
  const counterCookie = await counter(world)
  const device = new Device(world, 1)
  await device.build()
  const step = async (label, fn) => { try { await fn() } catch (e) { report.skipped.push(`${label}: ${String(e.message).slice(0, 120)}`); return } await device.sync(); await same(world, device, label); const fresh = new Device(world, 1); await fresh.build(); await same(world, fresh, label + ' (fresh build)'); report.steps.push(label) }
  const empty = await same(world, device, 'empty world'); report.steps.push('empty world (' + empty.marks.size + ' marks)')
  // W1 plain submission (some lines differ: an approval waits)
  const a = await fresh(12)
  await step('W1 plain submission with differing lines', () => submit(a, 3))
  // W3 supersede: a newer count of a product whose line waits
  await step('W3 supersede a waiting line', async () => { await submit([a[0]], 1) })
  // W6 approve whole / W7 line decisions / W8 reject / W9 close
  const b = await fresh(9)
  await submit(b, 3); const bs = await sessionOf(b[0].id)
  await step('W7 line reject', async () => { await must(world.send('POST', `${IC}/sessions/${bs}/approval/lines`, { requestId: rid('ln'), productId: b[0].id, action: 'reject' }), 'line reject') })
  await step('W7 line reopen', async () => { await must(world.send('POST', `${IC}/sessions/${bs}/approval/lines`, { requestId: rid('ln'), productId: b[0].id, action: 'reopen' }), 'line reopen') })
  await step('W6 approve whole', () => approval(bs, 'approve'))
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
  // The touched cap (m4): more products in one page of events than inventoryMarksTouchedMax, so the answer stops early and the cursor must be the last event WALKED.
  const cap = (await world.send('GET', `${IC}/list?branchId=1&page=1&pageSize=1`)).json.capabilities.marks
  report.caps = cap
  device.catchUp = cap.catchUpMaxEvents
  await step('touched cap: the feed pages without skipping events', async () => {
    const many = await fresh(560), sids = []
    for (let i = 0; i < many.length; i += 40) sids.push((await submit(many.slice(i, i + 40), 1)).json.item.id)
    await device.sync()
    for (const sid of sids) {
      await world.db.prepare("UPDATE inventory_check_items SET state = CASE state WHEN 'done' THEN 'issue' ELSE 'done' END, reason = CASE state WHEN 'done' THEN 'short' ELSE NULL END WHERE session_id=?").bind(sid).run()
      await world.db.prepare("INSERT INTO inventory_check_events(session_id,product_id,actor_id,action,request_id,request_hash,before_json,after_json,result_json,created_at) VALUES(?,NULL,1,'close',?, 'h','{}','{}','{}',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(sid, rid('ap')).run()
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
  const within = Math.floor(cap.catchUpMaxEvents * 0.75)
  const r0 = device.rebuilds, a0 = device.answers
  await insertEvents(within); await device.sync(); await same(world, device, 'I8 within the threshold')
  report.i8 = { within: { events: within, answers: device.answers - a0, rebuilds: device.rebuilds - r0 } }
  assert.equal(device.rebuilds, r0, 'I8: no rebuild within the threshold')
  const r1 = device.rebuilds
  await insertEvents(cap.catchUpMaxEvents * 2 + 500); await device.sync(); await same(world, device, 'I8 beyond the threshold')
  report.i8.beyond = { events: cap.catchUpMaxEvents * 2 + 500, rebuilds: device.rebuilds - r1 }
  assert.equal(device.rebuilds - r1, 1, 'I8: beyond the threshold the device rebuilds exactly once')
  assert.ok(device.top - device.cursor <= cap.catchUpMaxEvents / 2, 'I8: the lag after the rebuild is within half the threshold')
  // The cached snapshot page obeys the lag rule (m7): a warm page is never served further behind than half the threshold.
  const warm = new Device(world, 1, { miss: false }); await warm.build()
  await insertEvents(Math.floor(cap.catchUpMaxEvents * 0.75))
  const page = (await world.send('GET', `${IC}/marks?branchId=1&page=0`)).json
  assert.ok(page.top - page.cursor <= cap.catchUpMaxEvents / 2, `the lag rule: a page served ${page.top - page.cursor} events behind`)
  report.steps.push('I8 lag rule on the cached page')
}

const MUTANTS = [
  { name: 'm1 drop the session id tie-break', file: 'src/lib/inventoryCheckMarks.ts', from: 'ORDER BY x.updated_at DESC, x.session_id DESC LIMIT 1)', to: 'ORDER BY x.updated_at DESC LIMIT 1)' },
  { name: 'm2 seek only active products', file: 'src/lib/inventoryCheckMarks.ts', from: 'WHERE p.id >= @lo AND p.id < @hi ORDER BY p.id', to: 'WHERE p.id >= @lo AND p.id < @hi AND p.is_active = 1 ORDER BY p.id' },
  { name: 'm3 drop the NULL-product expansion', file: 'src/lib/inventoryCheckMarks.ts', from: 'approval ? sessionProducts.get(sid) ?? [] : []', to: '[]' },
  { name: 'm4 cursor = the last event of the page, not the last walked', file: 'src/lib/inventoryCheckMarks.ts', from: 'const cursorRow = last as Row', to: 'const cursorRow = list[list.length - 1]' },
  { name: 'm5 skip the tag check', file: 'src/lib/inventoryCheckMarks.ts', from: '(since > 0 && (!atEvent || eventTag(atEvent) !== tag))', to: 'false' },
  { name: 'm6 drop the session branch match', file: 'src/lib/inventoryCheckMarks.ts', from: 'AND sx.organization_id IS @organization AND sx.branch_id = x.branch_id', to: 'AND sx.organization_id IS @organization' },
  { name: 'm7 drop the cached page lag rule', file: 'src/routes/inventoryChecks.ts', from: ' && check.top - cached.cursor <= limits.inventoryMarksCatchUpMaxEvents / 2', to: '' },
]
const SWITCHES = { ic_simple: 'on', ic_marks: 'on', ic_wired: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', catalog_ranked_scope: 'on' }

async function run(patches) {
  const world = await bootWorld({ tier: 'free', seedVariant: 'base', switches: SWITCHES, patches })
  const report = { steps: [], skipped: [] }
  try { await scenario(world, report) } finally { await world.dispose() }
  return report
}

if (require.main === module) (async () => {
  const base = await run([])
  for (const s of base.steps) console.log('PASS ' + s)
  for (const s of base.skipped) console.log('SKIPPED (writer did not run) ' + s)
  console.log('caps ' + JSON.stringify(base.caps) + ' i7 ' + JSON.stringify(base.i7) + ' i8 ' + JSON.stringify(base.i8))
  let bad = base.skipped.length ? 1 : 0
  if (process.argv.includes('--mutants')) {
    for (const m of MUTANTS) {
      let red = null
      try { await run([{ name: m.name, file: m.file, from: m.from, to: m.to }]) } catch (e) { red = String(e.message).split('\n')[0].slice(0, 160) }
      console.log(red ? `PASS mutant ${m.name} is red: ${red}` : `FAIL mutant ${m.name} stayed green`)
      if (!red) bad = 1
    }
  }
  process.exit(bad)
})().catch((e) => { console.error('FAIL ' + (e.stack || e)); process.exit(1) })

module.exports = { Device, oracle, same, counter }
