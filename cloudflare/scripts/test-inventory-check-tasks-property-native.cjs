'use strict'
// Count tasks: randomized operation sequences over the real routes (inv-app harness: tasks, sessions, submissions, approvals, the lot Set, the plain Set, Undo/Redo),
// checked after EVERY step against an independent oracle written from docs/contracts/inventory-check-tasks-20261119.md and the owner's rules (18-19 Nov), never from the Worker's SQL.
// Two organizations (null and 2) at two branches, 26 products (plain, received-date, a family, inactive), six users.
// Run: node scripts/test-inventory-check-tasks-property-native.cjs --seeds=1..20 --steps=120 [--mutant=set-autoclose|undo-ticks|undo-no-takeback|redo-now|reopen-hand|plain-revert-no-takeback|revert-revert-no-restore|cap-outside] [--focus=cap|takeback] [--shrink] [--trace]
const assert = require('node:assert/strict')
const { buildWorld, PLAIN, LOTTED, FAMILY, INACTIVE, batchesOf } = require('./harness/count-tasks-world.cjs')

const ARG = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function prng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2 ** 32 } }

const ORG = { admin: 'A', manager: 'A', emp1: 'A', emp2: 'A', adminB: 'B', empB: 'B' }
const UID = { admin: 71, manager: 90, emp1: 91, emp2: 92, adminB: 93, empB: 94 }
const ISSUER = new Set(['admin', 'manager', 'adminB'])
const SEES_STAFF = new Set(['admin', 'adminB']) // administrators; nobody here holds audit_log
const USERS_OF = { A: ['admin', 'manager', 'emp1', 'emp2'], B: ['adminB', 'empB'] }
const CAP = 30, CLOSED_SHOWN = 5
const BRANDS = { A: 'A', B: 'B', L: 'L', F: 'F' }

// ---- mutants (planted in the scratch copy's source text at load time) -------------------------------------------------------------------------------------------------------------------------
const CAP_GUARD = "    guard(`(${OPEN_TASK_COUNT_SQL})<@maxOpenTasks`, 'inventory_check_task_limit', { ...params, maxOpenTasks: issue.maxOpenTasks }),\n"
const MUTANTS = {
  'set-autoclose': { 'lib/stockSetClosesIssue.ts': [['    ...(restore ? [] : tasks.statements),\n', '    ...([]),\n']] },
  'undo-ticks': { 'lib/inventoryCheckTasks.ts': [["      AND ${kindOf(xs)} IS NOT 'stock_set_undo' AND json_extract(${xs}.scope_json,'$.restore') IS NOT 1`", '      `']] },
  'undo-no-takeback': { 'lib/stockSetClosesIssue.ts': [["UPDATE inventory_check_items SET state='unstarted',counted_quantity=NULL,revision=revision+1 WHERE session_id", 'UPDATE inventory_check_items SET revision=revision WHERE session_id']] },
  'redo-now': { 'lib/stockSetClosesIssue.ts': [["SET state='done',counted_quantity=baseline_quantity,revision=revision+1 WHERE", "SET state='done',counted_quantity=baseline_quantity,revision=revision+1,updated_at=@now WHERE"]] },
  'reopen-hand': { 'lib/inventoryCheckTasks.ts': [["CROSS JOIN ${S} t ON t.id=r.id WHERE ${autoClosedSql('t')}`", 'CROSS JOIN ${S} t ON t.id=r.id`']] },
  'plain-revert-no-takeback': { 'lib/stockSetClosesIssue.ts': [['    const issue = reopenIssueStatements(closing, now), count = takeBackSetCountStatements(closing, origin, now)\n    return { statements: [...issue, ...count.statements], changedAt: issue.length + 1 }', '    const issue = reopenIssueStatements(closing, now)\n    return { statements: [...issue], changedAt: issue.length + 1 }']] },
  'revert-revert-no-restore': { 'lib/stockSetClosesIssue.ts': [['  return { statements: [...issue, ...count.statements], changedAt: issue.length + 1 }\n}', '  return { statements: [...issue], changedAt: issue.length + 1 }\n}']] },
  'cap-outside': { 'lib/inventoryCheckSessions.ts': [[
    "  const statements: Statement[] = [\n    guard('EXISTS(SELECT 1 FROM branches WHERE id=@branchId AND is_active=1)', 'inventory_check_baseline_changed', params),\n" + CAP_GUARD,
    "  { const pre = await db.prepare(`SELECT (${OPEN_TASK_COUNT_SQL}) AS n`).get<{ n: number }>({ organization: actor.organization_id, branchId }); if (Number(pre?.n ?? 0) >= issue.maxOpenTasks) fail(409, 'inventory_check_task_limit', { open: Number(pre?.n ?? 0), limit: issue.maxOpenTasks }) }\n" +
    "  const statements: Statement[] = [\n    guard('EXISTS(SELECT 1 FROM branches WHERE id=@branchId AND is_active=1)', 'inventory_check_baseline_changed', params),\n"]] },
}

// ---- the oracle ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
class Model {
  constructor() {
    this.t = 0 // logical clock: one tick per write request, and every request is sent at least 2 ms after the one before
    this.prod = new Map(); this.stock = new Map(); this.lot = new Map()
    const add = (id, brand, o = {}) => this.prod.set(id, { id, brand, active: o.active ?? true, group: o.group ?? false, lotted: o.lotted ?? false })
    for (const p of PLAIN) add(p, p % 2 ? 'A' : 'B')
    for (const p of LOTTED) add(p, 'L', { lotted: true })
    add(FAMILY.header, 'F', { group: true }); for (const c of FAMILY.children) add(c, 'F')
    for (const p of INACTIVE) add(p, 'A', { active: false })
    for (const [id, x] of this.prod) {
      if (x.group) continue
      for (const b of [1, 2]) {
        if (x.lotted) { const [b1, b2] = batchesOf(id); this.lot.set(`${b1}:${b}`, 3); this.lot.set(`${b2}:${b}`, 7) }
        this.stock.set(`${id}:${b}`, x.active ? 10 : 0)
      }
    }
    this.finals = [] // { org, branch, product, at }  submissions and Sets that closed a difference
    this.sessions = [] // ordinary count sessions: { id, org, branch, who, status, revision, items: Map p -> { state, at, counted } }
    this.tasks = [] // { id, org, branch, at, products:Set, status, pickup:{ who, id }|null, closedSeq, creator, revision }
    this.closedSeq = 0
    this.latest = new Map() // `${org}:${b}:${p}` -> { state, lines: Map(batch|0 -> counted), bySet?, undoOf? }
    this.approvals = [] // { id, org, branch, lines: Map p -> { status, seen, counted, lots?: Map batch -> {counted, seen} } }
    this.plains = [] // plain Sets: { p, b, before, after, mv (the movement a Revert targets next), closed, fin, prevLatest, state: 'applied'|'undone' }
    this.sets = [] // lot Sets: { hid, op, p, b, batch, before, after, closed, prevLatest, state: 'applied'|'undone' }
    this.uncertain = []
  }
  countable(p) { const x = this.prod.get(p); return !!x && x.active && !x.group }
  qty(p, b) { return this.stock.get(`${p}:${b}`) ?? 0 }
  lotQty(batch, b) { return this.lot.get(`${batch}:${b}`) ?? 0 }
  setLot(batch, b, q) { this.lot.set(`${batch}:${b}`, q); const p = Math.floor(batch / 10); this.stock.set(`${p}:${b}`, batchesOf(p).reduce((s, x) => s + this.lotQty(x, b), 0)) }
  finalSince(org, b, p, since) {
    if (this.finals.some((f) => f.live !== false && f.org === org && f.branch === b && f.product === p && f.at > since)) return true
    return this.sessions.some((s) => s.status === 'closed' && s.org === org && s.branch === b && s.items.has(p) && ['done', 'issue'].includes(s.items.get(p).state) && s.items.get(p).at > since)
  }
  view(task) {
    const live = [...task.products].filter((p) => this.countable(p))
    return { total: live.length, done: live.filter((p) => this.finalSince(task.org, task.branch, p, task.at)).length, removed: task.products.size - live.length }
  }
  openTasks(org, b) { return this.tasks.filter((t) => t.org === org && t.branch === b && t.status === 'open') }
  // A task shows the figures it CLOSED with (contract 3.1, P2.1): the oracle freezes them at the close and forgets them at a reopen.
  closeTask(t, seq = ++this.closedSeq, by = 'hand') { const v = this.view(t); t.frozen = { total: v.total, done: v.done, removed: v.removed }; t.status = 'closed'; t.pickup = null; t.closedSeq = seq; t.revision++; t.closedBy = by; t.reopened = false }
  /** Before a write that takes counts back: for each task closed by the auto-close at the org and branch, the products that are done for it now. */
  snapshotDone(org, b) { return new Map(this.tasks.filter((t) => t.org === org && t.branch === b && t.status === 'closed' && t.closedBy === 'auto').map((t) => [t.id, new Set([...t.products].filter((p) => this.countable(p) && this.finalSince(org, b, p, t.at)))])) }
  /** After the take-back (owner, 19 Nov): a task closed by the auto-close reopens exactly when a product that was done for it is not any more. Returns the ids. */
  reopenAfter(org, b, before) {
    const out = []
    for (const t of this.tasks) {
      if (!(t.org === org && t.branch === b && t.status === 'closed' && t.closedBy === 'auto' && before.has(t.id))) continue
      if ([...before.get(t.id)].some((p) => this.countable(p) && !this.finalSince(org, b, p, t.at))) { t.status = 'open'; t.frozen = null; t.revision++; t.reopened = true; out.push(t.id) }
    }
    return out
  }
  /** The auto-close of a count writer: every open task of the org at the branch that holds a product the write made final (or is the named task) and whose countable products are all done. */
  autoClose(org, b, products, named = null) {
    const closed = [], seq = this.closedSeq + 1 // tasks closed by one write share its closed_at
    for (const t of this.openTasks(org, b)) {
      if (!(t.id === named || [...t.products].some((p) => products.has(p)))) continue
      const v = this.view(t); if (v.done >= v.total) { this.closeTask(t, seq, 'auto'); this.closedSeq = seq; closed.push(t.id) }
    }
    return closed
  }
  pending(b, p) { return this.approvals.some((a) => a.branch === b && a.lines.has(p) && a.lines.get(p).status === 'open') }
  /** A newer count of the product replaces an older waiting line (requests contract: "replacing older waiting lines"). */
  replaceOlder(org, b, p) { for (const a of this.approvals) if (a.org === org && a.branch === b && a.lines.has(p) && a.lines.get(p).status === 'open') a.lines.get(p).status = 'replaced' }
  linesMatch(L, p, b) { return [...L.lines].every(([batch, counted]) => (batch === 0 ? this.qty(p, b) : this.lotQty(batch, b)) === counted) }
  /** An open count session of the product at the branch (org: only that organization's, since the Set's latest count is read inside the Set's own organization). */
  openObservation(b, p, org = null) { return this.sessions.some((s) => (org === null || s.org === org) && s.status === 'open' && s.branch === b && s.items.has(p) && s.items.get(p).state !== 'unstarted') }
}

// ---- the run --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
async function runSequence(seed, ops, { mutant = null, trace = false } = {}) {
  const w = buildWorld(mutant ? MUTANTS[mutant] : {})
  const m = new Model()
  const log = []
  const ic = (u) => `/api/inventory-checks${u}`
  let lastWrite = null
  const send = async (who, method, url, body, write = true) => {
    if (write) { await sleep(2); m.t++ }
    const r = await w.call(who, method, url, body)
    if (write) lastWrite = { who, method, url, body }
    if (trace) console.log(`  ${who} ${method} ${url} -> ${r.status} ${JSON.stringify(r.json).slice(0, 220)}`)
    return r
  }
  const fail = (what, extra) => { const e = new Error(`${what}${extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 600)}`); e.invariant = what.split(':')[0]; throw e }
  const expect = (cond, what, extra) => { if (!cond) fail(what, extra) }
  const byOrdinal = (n) => m.tasks[n]
  const orgId = (o) => (o === 'A' ? null : 2)
  const stockSnapshot = () => JSON.stringify([w.rows('SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY 1,2'), w.rows('SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY 1,2')])

  // -- the invariants, after every step --
  async function checkAll(label) {
    // Stock: the oracle's on-hand and lots against the tables.
    for (const [key, q] of m.stock) { const [p, b] = key.split(':').map(Number); const row = w.row('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=?', p, b); expect((row?.quantity ?? 0) === q, `Stock: on-hand ${p}@${b}`, { oracle: q, db: row?.quantity }) }
    for (const [key, q] of m.lot) { const [batch, b] = key.split(':').map(Number); const row = w.row('SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=?', batch, b); expect((row?.quantity ?? 0) === q, `Stock: lot ${batch}@${b}`, { oracle: q, db: row?.quantity }) }
    // Pickups: at most one live pickup per task; none on a closed task (the tables).
    for (const t of m.tasks) {
      const live = w.rows("SELECT created_by FROM inventory_check_sessions WHERE json_extract(scope_json,'$.membership')='pickup' AND json_extract(scope_json,'$.task')=? AND status='open'", t.id)
      expect(live.length <= 1, 'Pickups: more than one live pickup', { task: t.id, live })
      expect(live.length === (t.pickup ? 1 : 0), 'Pickups: live pickup differs from the oracle', { task: t.id, oracle: t.pickup, live })
      if (t.pickup) expect(live[0].created_by === UID[t.pickup.who], 'Pickups: wrong picker', { task: t.id })
      const dbStatus = w.row('SELECT status FROM inventory_check_sessions WHERE id=?', t.id).status
      expect(dbStatus === t.status, 'Done rule: task status (table)', { task: t.ordinal, oracle: t.status, db: dbStatus, view: m.view(t) })
    }
    // The boards, per viewer and branch.
    for (const [who, b] of [['admin', 1], ['admin', 2], ['manager', 1], ['emp1', 1], ['emp2', 2], ['adminB', 1], ['adminB', 2], ['empB', 1]]) {
      const r = await send(who, 'GET', ic(`/tasks?branchId=${b}`), undefined, false)
      expect(r.status === 200, `Board: status ${who}@${b}`, r.json)
      const org = ORG[who], items = r.json.items
      const known = new Map(m.tasks.filter((t) => t.org === org && t.branch === b).map((t) => [t.id, t]))
      for (const it of items) expect(known.has(it.id), 'Isolation: the board shows a task of another organization or branch', { who, b, id: it.id, foreign: m.tasks.find((t) => t.id === it.id) && { org: m.tasks.find((t) => t.id === it.id).org, branch: m.tasks.find((t) => t.id === it.id).branch } })
      const open = new Set(m.openTasks(org, b).map((t) => t.id)), shownOpen = new Set(items.filter((i) => i.status === 'open').map((i) => i.id))
      expect(open.size === shownOpen.size && [...open].every((id) => shownOpen.has(id)), 'Done rule: the open tasks on the board', { who, b, oracle: [...open].map((id) => known.get(id).ordinal), shown: [...shownOpen].map((id) => known.get(id)?.ordinal) })
      const closed = [...known.values()].filter((t) => t.status === 'closed').sort((x, y) => y.closedSeq - x.closedSeq)
      const shownClosed = items.filter((i) => i.status === 'closed')
      expect(shownClosed.length === Math.min(CLOSED_SHOWN, closed.length), 'Board: number of closed tasks shown', { who, b, shown: shownClosed.length, oracle: closed.length })
      const floor = closed.length > CLOSED_SHOWN ? closed[CLOSED_SHOWN - 1].closedSeq : 0
      for (const it of items) {
        const t = known.get(it.id), v = m.view(t)
        expect(it.status === t.status, 'Done rule: task status (board)', { who, task: t.ordinal, oracle: t.status, shown: it.status, view: v })
        if (it.status === 'closed') expect(t.closedSeq >= floor, 'Board: an older closed task is shown before a newer one', { task: t.ordinal })
        expect(it.done <= it.total, 'Progress: done > total', { task: t.ordinal, it })
        const fig = t.status === 'closed' && t.frozen ? t.frozen : v
        expect(it.total === fig.total && it.done === fig.done && it.removed === fig.removed, 'Progress: total/done/removed', { who, task: t.ordinal, oracle: fig, shown: { total: it.total, done: it.done, removed: it.removed } })
        expect(it.branch_id === b, 'Isolation: branch_id')
        const picked = t.pickup ? `u${UID[t.pickup.who]}` : null
        expect(it.picked_up_by === picked, 'Pickups: picked_up_by', { task: t.ordinal, oracle: picked, shown: it.picked_up_by })
        const mine = !!t.pickup && t.pickup.who === who
        expect(it.mine === mine, 'Pickups: mine', { task: t.ordinal })
        expect(mine ? it.pickup_session_id === t.pickup.id : !('pickup_session_id' in it), 'Pickups: pickup_session_id only when mine', { task: t.ordinal, it })
        const isOpen = t.status === 'open'
        expect(it.can_pickup === (isOpen && !t.pickup), 'Board: can_pickup', { who, task: t.ordinal, it })
        expect(it.can_release === (isOpen && !!t.pickup && (t.pickup.who === who || ISSUER.has(who))), 'Board: can_release', { who, task: t.ordinal, it })
        expect(it.can_close === (isOpen && ISSUER.has(who)), 'Board: can_close', { who, task: t.ordinal, it })
        const seesIssuer = SEES_STAFF.has(who) || t.creator === who
        expect(seesIssuer ? it.issued_by === `u${UID[t.creator]}` : !('issued_by' in it), 'Visibility: issued_by', { who, creator: t.creator, it: it.issued_by })
        expect(it.revision === t.revision, 'Board: revision', { task: t.ordinal, oracle: t.revision, shown: it.revision })
      }
    }
    // /list?taskId= agrees with the board for one task.
    const ofA = m.tasks.filter((t) => t.org === 'A')
    if (ofA.length) {
      const t = ofA[m.t % ofA.length]
      const r = await send('emp1', 'GET', ic(`/list?branchId=${t.branch}&taskId=${t.id}`), undefined, false)
      expect(r.status === 200, 'Progress: /list?taskId= status', r.json)
      expect(r.json.task && r.json.task.total === m.view(t).total && r.json.task.status === t.status, 'Progress: /list?taskId= total or status', { task: t.ordinal, list: r.json.task, oracle: m.view(t) })
      for (const item of r.json.items || []) if (!item.is_group) expect(t.products.has(item.id) && m.countable(item.id), 'Progress: /list?taskId= shows a product outside the task', { id: item.id })
    }
  }

  // -- the operations --
  const lineFor = (who, b, p, mode, delta) => {
    const x = m.prod.get(p)
    if (x.lotted && mode.startsWith('lots')) {
      const lots = batchesOf(p).map((batch, i) => { const seen = m.lotQty(batch, b); const counted = mode === 'lots-differ' && i === (delta % 2) ? Math.max(0, seen + (seen === 0 ? 1 : (delta > 0 ? 1 : -1))) : seen; return { batchId: batch, scope: 'lot', counted, seen } })
      return { productId: p, lots }
    }
    const seen = m.qty(p, b), counted = mode === 'differ' ? (seen === 0 ? 1 : seen + (delta > 0 ? 1 : -1)) : seen
    return { productId: p, countedQuantity: counted, seenQuantity: seen }
  }
  const EXEC = {
    async issue(d) {
      const org = ORG[d.who], body = { branchId: d.branch, requestId: w.rid('iss'), title: `T${m.tasks.length}`, ...(d.filters ? { filters: d.filters } : { productIds: d.products }) }
      const resolved = d.filters ? [...m.prod.values()].filter((x) => m.countable(x.id) && (d.filters.brand ? x.brand === d.filters.brand : true)).map((x) => x.id) : d.products
      const eligible = d.filters ? resolved.length > 0 : d.products.every((p) => m.countable(p))
      const before = stockSnapshot()
      const r = await send(d.who, 'POST', ic('/tasks'), body)
      expect(stockSnapshot() === before, 'Stock: an issue moved stock')
      if (!ISSUER.has(d.who)) { expect(r.status === 403 && r.json.code === 'inventory_check_issue_required', 'Permissions: a non-issuer issued', r.json); return }
      const atCap = m.openTasks(org, d.branch).length >= CAP
      if (!eligible) { expect(r.status === 400 || (atCap && r.status === 409), 'Issue: an uncountable product was accepted', { r: r.json, products: d.products }); return }
      if (atCap) { expect(r.status === 409 && r.json.code === 'inventory_check_task_limit', 'Limits: issue past the cap', r.json); return }
      expect(r.status === 201, 'Issue: refused', r.json)
      const t = { id: r.json.item.id, ordinal: m.tasks.length, org, branch: d.branch, at: m.t, products: new Set(resolved), status: 'open', pickup: null, closedSeq: 0, creator: d.who, revision: 0 }
      expect(r.json.item.progress.total === resolved.length, 'Issue: progress total', { got: r.json.item.progress, resolved })
      m.tasks.push(t)
    },
    async race(d) {
      const org = ORG[d.who], open = m.openTasks(org, d.branch).length
      const live = d.products.filter((p) => m.countable(p)).concat(PLAIN.filter((p) => m.countable(p))); if (!live.length) return
      const bodies = Array.from({ length: d.k }, (_, i) => ({ branchId: d.branch, requestId: w.rid('race'), title: `R${i}`, productIds: [live[i % live.length]] }))
      await sleep(2); m.t++
      w.as(d.who)
      let answers
      if (d.hook) { // the deterministic interleaving: the second issue runs to completion just before the first one's own batch
        const db = w.app.env.DB, ob = db.batch, oo = db.batchOnce
        let fired = false, second = null
        const hook = (orig) => async (list) => { if (!fired && list.some((s) => /INSERT INTO inventory_check_sessions/.test(String(s.sql)))) { fired = true; second = await w.app.send('POST', ic('/tasks'), bodies[1]) } return orig(list) }
        db.batch = hook(ob); db.batchOnce = hook(oo)
        let first
        try { first = await w.app.send('POST', ic('/tasks'), bodies[0]) } finally { db.batch = ob; db.batchOnce = oo }
        answers = [first, second].filter(Boolean); bodies.length = answers.length; d = { ...d, k: answers.length }
      } else answers = await Promise.all(bodies.map((body) => w.app.send('POST', ic('/tasks'), body)))
      const ok = answers.filter((a) => a.status === 201), refused = answers.filter((a) => a.status === 409 && a.json.code === 'inventory_check_task_limit')
      expect(ok.length + refused.length === d.k, 'Limits: an unexpected answer in the race', answers.map((a) => [a.status, a.json?.code]))
      expect(ok.length === Math.max(0, Math.min(d.k, CAP - open)), 'Limits: concurrent issues passed the cap', { open, k: d.k, ok: ok.length })
      for (const a of ok) m.tasks.push({ id: a.json.item.id, ordinal: m.tasks.length, org, branch: d.branch, at: m.t, products: new Set([...a.json.item.scope ? [] : []]), status: 'open', pickup: null, closedSeq: 0, creator: d.who, revision: 0 })
      for (const [i, a] of answers.entries()) if (a.status === 201) m.tasks.find((t) => t.id === a.json.item.id).products = new Set(bodies[i].productIds)
      lastWrite = null
    },
    async fill(d) { // issue single-product tasks until the branch is d.gap below the cap
      const org = ORG[d.who]
      for (let guard = 0; m.openTasks(org, d.branch).length < CAP - d.gap && guard < CAP; guard++) {
        const p = [d.product, ...PLAIN].find((x) => m.countable(x)); if (p == null) return
        await EXEC.issue({ who: d.who, branch: d.branch, products: [p] })
      }
    },
    async pickup(d) {
      const t = byOrdinal(d.task); if (!t) return
      const before = stockSnapshot()
      const r = await send(d.who, 'POST', ic(`/tasks/${t.id}/pickup`), { requestId: w.rid('pk') })
      expect(stockSnapshot() === before, 'Stock: a pickup moved stock')
      if (ORG[d.who] !== t.org) { expect(r.status === 404, 'Isolation: a pickup of another organization\'s task', r.json); return }
      if (t.status === 'closed') { expect(r.status === 409 && r.json.code === 'inventory_check_task_closed', 'Pickups: a closed task was picked up', r.json); return }
      if (t.pickup) { expect(r.status === 409 && r.json.code === 'inventory_check_task_picked_up' && r.json.pickedUpBy === `u${UID[t.pickup.who]}` && r.json.mine === (t.pickup.who === d.who), 'Pickups: second pickup', r.json); return }
      expect(r.status === 201, 'Pickups: refused', r.json)
      t.pickup = { who: d.who, id: r.json.item.id }
    },
    async release(d) {
      const t = byOrdinal(d.task); if (!t) return
      const r = await send(d.who, 'POST', ic(`/tasks/${t.id}/release`), { requestId: w.rid('rel') })
      if (ORG[d.who] !== t.org) { expect(r.status === 404, 'Isolation: a release of another organization\'s task', r.json); return }
      const allowed = ISSUER.has(d.who) || (t.pickup && t.pickup.who === d.who)
      if (!t.pickup) { expect(r.status === 409 || (!allowed && r.status === 403), 'Pickups: release with no pickup', r.json); return }
      if (!allowed) { expect(r.status === 403 && r.json.code === 'inventory_check_release_forbidden', 'Pickups: release by someone else', r.json); return }
      expect(r.status === 200 && r.json.released === true, 'Pickups: release refused', r.json)
      t.pickup = null
    },
    async close(d) {
      const t = byOrdinal(d.task); if (!t) return
      const rev = d.stale ? t.revision + 7 : t.revision
      const r = await send(d.who, 'PATCH', ic(`/sessions/${t.id}`), { expectedRevision: rev, requestId: w.rid('close'), action: 'close' })
      if (ORG[d.who] !== t.org) { expect(r.status === 404, 'Isolation: a close of another organization\'s task', r.json); return }
      if (!ISSUER.has(d.who)) { expect(r.status === 403, 'Permissions: a non-issuer closed a task', r.json); return }
      if (t.status === 'closed') { expect(r.status === 409, 'Close: a closed task closed again', r.json); return }
      if (d.stale) { expect(r.status === 409 && r.json.code === 'inventory_check_conflict', 'Close: a stale revision was accepted', r.json); return }
      expect(r.status === 200, 'Close: refused with the board revision', r.json)
      expect(!r.json.closedTasks || r.json.closedTasks.length === 0, 'Close: a hand close named closed tasks', r.json.closedTasks)
      m.closeTask(t)
    },
    async submit(d) {
      const org = ORG[d.who], b = d.branch
      const lines = d.lines.filter((l) => m.countable(l.p)).map((l) => lineFor(d.who, b, l.p, l.mode, l.delta))
      if (!lines.length) return
      let named = null, expectStatus = 201
      if (d.task === 'foreign') { const f = m.tasks.find((t) => t.org !== org); if (!f) return; named = f.id; expectStatus = 404 }
      else if (d.task === 'otherBranch') { const f = m.tasks.find((t) => t.org === org && t.branch !== b); if (!f) return; named = f.id; expectStatus = 404 }
      else if (d.task != null) { const t = byOrdinal(d.task); if (!t || t.org !== org || t.branch !== b) return; named = t.id }
      const before = stockSnapshot()
      const r = await send(d.who, 'POST', ic('/submissions'), { branchId: b, requestId: w.rid('sub'), ...(named ? { taskId: named } : {}), lines })
      expect(stockSnapshot() === before, 'Stock: a submission moved stock')
      if (expectStatus === 404) { expect(r.status === 404 && r.json.code === 'inventory_check_task_not_found', 'Isolation: a submission named a task of another organization or branch', r.json); return }
      expect(r.status === 201, 'Submit: refused', { r: r.json, lines })
      const counted = new Set()
      const differs = []
      for (const line of lines) {
        const p = line.productId; counted.add(p)
        m.finals.push({ org, branch: b, product: p, at: m.t })
        m.replaceOlder(org, b, p)
        const linesMap = new Map(line.lots ? line.lots.map((l) => [l.batchId, l.counted]) : [[0, line.countedQuantity]])
        const differ = line.lots ? line.lots.some((l) => l.counted !== l.seen) : line.countedQuantity !== line.seenQuantity
        m.latest.set(`${org}:${b}:${p}`, { state: differ ? 'issue' : 'done', lines: linesMap })
        if (differ) differs.push(line)
      }
      if (differs.length) {
        expect(r.json.approval && r.json.approval.status === 'pending', 'Submit: a Differs count opened no approval', r.json.approval)
        m.approvals.push({ id: r.json.item.id, ordinal: m.approvals.length, org, branch: b, lines: new Map(differs.map((l) => [l.productId, { status: 'open', seen: l.seenQuantity, counted: l.countedQuantity, lots: l.lots }])) })
      }
      const closed = m.autoClose(org, b, counted, named)
      expect(sameSet(r.json.closedTasks || [], closed), 'Done rule: the tasks a submission closed', { oracle: closed.map(ord), got: (r.json.closedTasks || []).map(ord) })
      if (named) expect(r.json.task && r.json.task.id === named && r.json.task.closed === closed.includes(named), 'Done rule: task.closed of the named task', r.json.task)
    },
    async obsCreate(d) {
      const ps = d.products.filter((p) => m.countable(p) && !m.prod.get(p).lotted); if (!ps.length) return
      const r = await send(d.who, 'POST', ic('/sessions'), { branchId: d.branch, requestId: w.rid('s'), productIds: ps, scope: { membership: 'visible_page' } })
      expect(r.status === 201, 'Session: create refused', r.json)
      m.sessions.push({ id: r.json.item.id, ordinal: m.sessions.length, org: ORG[d.who], branch: d.branch, who: d.who, status: 'open', revision: r.json.item.revision, items: new Map(ps.map((p) => [p, { state: 'unstarted', at: null, revision: 0 }])) })
    },
    async obsObserve(d) {
      const s = m.sessions[d.sess]; if (!s || s.status !== 'open') return
      const p = [...s.items.keys()][d.idx % s.items.size], it = s.items.get(p)
      if (!m.countable(p)) return
      const body = d.state === 'unstarted' ? { state: 'unstarted' } : { state: 'done', counted_quantity: m.qty(p, s.branch) }
      const r = await send(s.who, 'PATCH', ic(`/sessions/${s.id}/items/${p}`), { expectedRevision: it.revision, expectedSessionRevision: s.revision, requestId: w.rid('o'), ...body })
      if (r.status !== 200) { m.uncertain.push(['observe', r.status, r.json?.code]); return }
      expect(!r.json.closedTasks || !r.json.closedTasks.length, 'Not counts: an observation closed a task', r.json.closedTasks)
      it.state = d.state; it.at = d.state === 'unstarted' ? null : m.t; it.revision = r.json.item?.revision ?? it.revision + 1
      s.revision = r.json.session?.revision ?? r.json.sessionRevision ?? s.revision
    },
    async obsClose(d) {
      const s = m.sessions[d.sess]; if (!s || s.status !== 'open') return
      const r = await send(s.who, 'PATCH', ic(`/sessions/${s.id}`), { expectedRevision: s.revision, requestId: w.rid('c'), action: 'close' })
      if (r.status !== 200) { m.uncertain.push(['obsClose', r.status, r.json?.code]); return }
      s.status = 'closed'; s.revision = r.json.item.revision
      const made = new Set([...s.items].filter(([, it]) => it.state === 'done').map(([p]) => p))
      for (const p of made) { m.replaceOlder(s.org, s.branch, p); m.latest.set(`${s.org}:${s.branch}:${p}`, { state: 'done', lines: new Map([[0, m.qty(p, s.branch)]]) }) }
      const closed = m.autoClose(s.org, s.branch, made)
      expect(sameSet(r.json.closedTasks || [], closed), 'Done rule: the tasks the close of a count session closed', { oracle: closed.map(ord), got: (r.json.closedTasks || []).map(ord) })
    },
    async obsResume(d) {
      const s = m.sessions[d.sess]; if (!s || s.status !== 'closed') return
      const r = await send(s.who, 'PATCH', ic(`/sessions/${s.id}`), { expectedRevision: s.revision, requestId: w.rid('rs'), action: 'resume' })
      if (r.status !== 200) { m.uncertain.push(['resume', r.status, r.json?.code]); return }
      const snap = m.snapshotDone(s.org, s.branch)
      s.status = 'open'; s.revision = r.json.item.revision // its counts are no longer final: the tasks that rested on them reopen (owner, 19 Nov)
      const reopened = m.reopenAfter(s.org, s.branch, snap)
      expect(sameSet(r.json.reopenedTasks || [], reopened), 'Reopen: the tasks a resume reopened', { oracle: reopened.map(ord), got: (r.json.reopenedTasks || []).map(ord) })
    },
    async lotSet(d) {
      const p = d.p, b = d.branch; if (!m.countable(p)) return
      const batch = batchesOf(p)[d.batchIdx], before = m.lotQty(batch, b)
      const L = m.latest.get(`A:${b}:${p}`)
      let q = d.q === 'counted' ? (L && L.lines.has(batch) ? L.lines.get(batch) : before) : d.q === 'same' ? before : Math.max(0, before + d.q)
      const body = { quantity: q, expectedLotQuantity: before, reason: 'Physical count' }
      const r = d.route === 'batches'
        ? await send(d.who, 'PATCH', `/api/batches/${batch}/branches/${b}`, { ...body, client_request_id: 'batches_set_' + w.rid('b') })
        : await send(d.who, 'POST', '/api/inventory/adjust', { type: 'set', setScope: 'lot', productId: p, branchId: b, batchId: batch, ...body, client_request_id: 'inventory_set_' + w.rid('a') })
      if (m.pending(b, p)) { expect(r.status === 409 && r.json.code === 'inventory_check_count_pending', 'Set: allowed while a count waits for approval', r.json); return }
      if (m.openObservation(b, p, 'A')) { m.uncertain.push(['lotSet-open-observation']); }
      expect(r.status === 200, 'Set: refused', r.json)
      m.setLot(batch, b, q)
      const closes = !!L && L.state === 'issue' && m.linesMatch(L, p, b)
      if (m.openObservation(b, p, 'A') && r.json.issue_closed !== closes) { m.uncertain.push(['lotSet-close-uncertain']); return }
      expect(r.json.issue_closed === closes, 'Set: issue_closed', { oracle: closes, got: r.json.issue_closed, latest: L && { state: L.state, lines: [...L.lines] }, stock: m.qty(p, b), lots: batchesOf(p).map((x) => m.lotQty(x, b)) })
      let closed = [], fin = null
      if (closes) {
        fin = { org: 'A', branch: b, product: p, at: m.t }; m.finals.push(fin)
        m.latest.set(`A:${b}:${p}`, { state: 'done', lines: new Map([[0, m.qty(p, b)]]), bySet: r.json.operation_id || 'zero' })
        closed = m.autoClose('A', b, new Set([p]))
      }
      expect(sameSet(r.json.closed_tasks || [], closed), 'Done rule: the tasks a Set closed', { oracle: closed.map(ord), got: (r.json.closed_tasks || []).map(ord) })
      if (r.json.action_history_id && q !== before) m.sets.push({ hid: r.json.action_history_id, op: r.json.operation_id, p, b, batch, before, after: q, closed: closes, prevLatest: L, fin, state: 'applied' })
    },
    async plainSet(d) {
      const p = d.p, b = d.branch; if (!m.countable(p) || m.prod.get(p).lotted) return
      const before = m.qty(p, b), L = m.latest.get(`A:${b}:${p}`)
      const q = d.q === 'counted' ? (L && L.lines.has(0) ? L.lines.get(0) : before) : d.q === 'same' ? before : Math.max(0, before + d.q)
      const r = await send(d.who, 'POST', '/api/inventory/adjust', { type: 'set', productId: p, branchId: b, quantity: q, reason: 'Physical count', client_request_id: 'inventory_set_' + w.rid('a'), ...(q > before ? { supplierName: 'Property supplier', unitCostUsd: 4 } : {}) })
      if (m.pending(b, p)) { expect(r.status === 409, 'Set: a plain Set allowed while a count waits for approval', r.json); return }
      if (r.status !== 200) { m.uncertain.push(['plainSet', r.status, r.json?.code]); return }
      m.stock.set(`${p}:${b}`, q)
      // The contract names POST /inventory/adjust as a Set that closes a difference (section 3.7): a plain Set that makes the latest Differs match closes it and ticks.
      let closes = !!L && L.state === 'issue' && m.linesMatch(L, p, b)
      // An open count session's Done item of the product is a newer count than the Issue only when it was made after it (the model keeps no per-count time): then the real answer decides, as for the lot Set.
      if (m.openObservation(b, p, 'A') && closes !== (r.json.issue_closed === true)) { m.uncertain.push(['plainSet-open-observation']); closes = r.json.issue_closed === true }
      if (closes !== (r.json.issue_closed === true)) {
        m.uncertain.push(['plainSet-issue_closed', { p, b, oracle: closes, got: r.json.issue_closed ?? null }])
        fail('Set: a plain Set that makes the latest Differs match did not close it', { p, b, got: r.json })
      }
      const mv = w.row('SELECT MAX(id) AS id FROM inventory_movements').id
      let fin = null
      if (r.json.issue_closed === true) { fin = { org: 'A', branch: b, product: p, at: m.t }; m.finals.push(fin); m.latest.set(`A:${b}:${p}`, { state: 'done', lines: new Map([[0, q]]), bySet: `m${mv}` }); const closed = m.autoClose('A', b, new Set([p])); expect(sameSet(r.json.closed_tasks || [], closed), 'Done rule: the tasks a plain Set closed', { oracle: closed.map(ord), got: r.json.closed_tasks }) }
      else expect(!(r.json.closed_tasks || []).length, 'Done rule: a plain Set that closed no difference closed a task', r.json.closed_tasks)
      if (q !== before) m.plains.push({ p, b, before, after: q, mv, set: `m${mv}`, closed: r.json.issue_closed === true, fin, prevLatest: L, state: 'applied' })
    },
    async plainRevert(d) { // the plain Set's Revert is its Undo; the Revert of that Revert is its Redo (the Products page / Changes list route)
      const s = [...m.plains].reverse().find((x) => x.state === (d.redo ? 'undone' : 'applied')); if (!s) return
      if (m.qty(s.p, s.b) !== (d.redo ? s.before : s.after) || !m.countable(s.p)) return // stock moved since: out of this model
      const r = await send('admin', 'POST', `/api/inventory/movements/${s.mv}/revert`, {})
      if (r.status !== 200) { m.uncertain.push(['plainRevert', r.status, r.json?.code || r.json?.error]); return }
      s.mv = w.row('SELECT MAX(id) AS id FROM inventory_movements').id
      if (!d.redo) {
        const snap = m.snapshotDone('A', s.b)
        if (s.fin) s.fin.live = false
        m.reopenAfter('A', s.b, snap) // the tables are compared with the model after every step
        m.stock.set(`${s.p}:${s.b}`, s.before); s.state = 'undone'
        const L = m.latest.get(`A:${s.b}:${s.p}`)
        if (s.closed && L && L.bySet === s.set) m.latest.set(`A:${s.b}:${s.p}`, { ...s.prevLatest, undoOf: s.set })
      } else {
        if (s.fin) { s.fin.live = true; m.autoClose('A', s.b, new Set([s.p])) }
        m.stock.set(`${s.p}:${s.b}`, s.after); s.state = 'applied'
        const L = m.latest.get(`A:${s.b}:${s.p}`)
        if (s.closed && L && L.undoOf === s.set) m.latest.set(`A:${s.b}:${s.p}`, { state: 'done', lines: new Map([[0, s.after]]), bySet: s.set })
      }
    },
    async undo(d) {
      const s = [...m.sets].reverse().find((x) => x.state === 'applied'); if (!s) return
      if (m.lotQty(s.batch, s.b) !== s.after) return // the lot moved since: out of this model
      const r = await send('admin', 'POST', `/api/action-history/${s.hid}/undo`, {})
      if (r.status !== 200) { m.uncertain.push(['undo', r.status, r.json?.code || r.json?.error]); return }
      const snap = m.snapshotDone('A', s.b)
      if (s.fin) s.fin.live = false // the Undo takes the Set's own count back (the Issue side is separate: the latest bookkeeping below)
      m.reopenAfter('A', s.b, snap) // the tables are compared with the model after every step
      m.setLot(s.batch, s.b, s.before); s.state = 'undone'
      const L = m.latest.get(`A:${s.b}:${s.p}`)
      if (s.closed && L && L.bySet === s.op) m.latest.set(`A:${s.b}:${s.p}`, { ...s.prevLatest, undoOf: s.op })
      expect(!(r.json.closed_tasks || r.json.closedTasks || []).length, 'Not counts: an Undo closed a task', r.json)
    },
    async redo(d) {
      const s = [...m.sets].reverse().find((x) => x.state === 'undone'); if (!s) return
      if (m.lotQty(s.batch, s.b) !== s.before) return
      const r = await send('admin', 'POST', `/api/action-history/${s.hid}/redo`, {})
      if (r.status !== 200) { m.uncertain.push(['redo', r.status, r.json?.code || r.json?.error]); return }
      if (s.fin) { s.fin.live = true; m.autoClose('A', s.b, new Set([s.p])) } // restored at its ORIGINAL time, then the normal auto-close
      m.setLot(s.batch, s.b, s.after); s.state = 'applied'
      const L = m.latest.get(`A:${s.b}:${s.p}`)
      if (s.closed && L && L.undoOf === s.op) m.latest.set(`A:${s.b}:${s.p}`, { state: 'done', lines: new Map([[0, m.qty(s.p, s.b)]]), bySet: s.op })
      expect(!(r.json.closed_tasks || r.json.closedTasks || []).length, 'Not counts: a Redo closed a task', r.json)
    },
    async decide(d) {
      const a = m.approvals.filter((x) => [...x.lines.values()].some((l) => l.status === 'open'))[d.idx % Math.max(1, m.approvals.length)]; if (!a) return
      const open = [...a.lines].filter(([, l]) => l.status === 'open'); if (!open.length) return
      const [p, line] = open[d.idx % open.length]
      const before = stockSnapshot()
      if (d.kind === 'reject') {
        const r = await send('admin', 'POST', ic(`/sessions/${a.id}/approval/lines`), { productId: p, action: 'reject', requestId: w.rid('rj') })
        if (r.status !== 200) { m.uncertain.push(['reject', r.status, r.json?.code]); return }
        line.status = 'rejected'; expect(stockSnapshot() === before, 'Stock: a reject moved stock')
        expect(!(r.json.closedTasks || []).length, 'Not counts: a reject closed a task')
      } else if (d.kind === 'modify') {
        if (line.lots) return
        const counted = Math.max(0, line.counted + 1)
        const r = await send('admin', 'POST', ic(`/sessions/${a.id}/approval/lines`), { productId: p, action: 'modify', counted, requestId: w.rid('md') })
        if (r.status !== 200) { m.uncertain.push(['modify', r.status, r.json?.code]); return }
        line.counted = counted; expect(stockSnapshot() === before, 'Stock: a modify moved stock')
      } else {
        const r = await send('admin', 'POST', ic(`/sessions/${a.id}/approval`), { decision: 'approve', productIds: [p], requestId: w.rid('ap') })
        if (r.status !== 200) { m.uncertain.push(['approve', r.status, r.json?.code]); expect(stockSnapshot() === before, 'Stock: a refused approval moved stock'); return }
        expect(!(r.json.closedTasks || []).length, 'Not counts: an approval closed a task', r.json.closedTasks)
        for (const [q, l] of a.lines) {
          if (l.status !== 'open' || q !== p) continue
          l.status = 'applied'
          if (l.lots) { for (const lt of l.lots) m.setLot(lt.batchId, a.branch, Math.max(0, m.lotQty(lt.batchId, a.branch) + (lt.counted - lt.seen))) }
          else m.stock.set(`${q}:${a.branch}`, Math.max(0, m.qty(q, a.branch) + (l.counted - l.seen)))
          const L = m.latest.get(`${a.org}:${a.branch}:${q}`); if (L && L.state === 'issue') L.state = 'done'
        }
      }
    },
    async retire(d) { // deactivate (stock to zero, then inactive), make a header, or merge (the survivor takes the stock, the other is retired)
      const p = d.p; if (!m.countable(p) || m.pending(1, p) || m.pending(2, p) || m.openObservation(1, p) || m.openObservation(2, p) || m.prod.get(p).lotted) return
      const x = m.prod.get(p)
      w.raw.exec('PRAGMA foreign_keys=OFF')
      if (d.kind === 'header') { w.raw.prepare('UPDATE products SET is_group=1 WHERE id=?').run([p]); x.group = true }
      else {
        const keep = d.kind === 'merge' ? d.keep : null
        if (keep != null && (!m.countable(keep) || m.prod.get(keep).lotted || keep === p)) { w.raw.exec('PRAGMA foreign_keys=ON'); return }
        w.stockWrite(() => {
          for (const b of [1, 2]) {
            if (keep != null) { w.raw.prepare('UPDATE branch_stock SET quantity=quantity+? WHERE product_id=? AND branch_id=?').run([m.qty(p, b), keep, b]); m.stock.set(`${keep}:${b}`, m.qty(keep, b) + m.qty(p, b)) }
            w.raw.prepare('UPDATE branch_stock SET quantity=0 WHERE product_id=? AND branch_id=?').run([p, b]); m.stock.set(`${p}:${b}`, 0)
          }
          if (keep != null) w.raw.prepare('UPDATE products SET stock_quantity=(SELECT SUM(quantity) FROM branch_stock WHERE product_id=?) WHERE id=?').run([keep, keep])
          w.raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=?').run([p]); w.raw.prepare('UPDATE products SET is_active=0 WHERE id=?').run([p])
        })
        x.active = false
      }
      w.raw.exec('PRAGMA foreign_keys=ON')
      await w.bumpProducts(); m.t++
    },
    async retry() {
      if (!lastWrite) return
      const snap = await boardSnapshot(), stock = stockSnapshot(), again = lastWrite
      const r = await send(again.who, again.method, again.url, again.body, false)
      expect(r.status === 200 || r.status === 201 || r.status >= 400, 'Retries: odd status')
      expect(stockSnapshot() === stock, 'Retries: a same-key retry moved stock', again.url)
      expect(!(r.json?.closedTasks || []).length || again.url.includes('/inventory/adjust') || again.url.includes('/api/batches'), 'Retries: a replay named closed tasks', r.json)
      expect(JSON.stringify(await boardSnapshot()) === JSON.stringify(snap), 'Retries: a same-key retry changed the board', again.url)
      if (r.status === 201) fail('Retries: a same-key retry created a second record', { url: again.url, r: r.json })
    },
    async foreign(d) {
      const tA = m.tasks.filter((t) => t.org === 'A'), t = tA[d.idx % Math.max(1, tA.length)]; if (!t) return
      const snap = await boardSnapshot()
      const r1 = await send('empB', 'GET', ic(`/list?branchId=${t.branch}&taskId=${t.id}`), undefined, false)
      expect(r1.status === 404, 'Isolation: /list?taskId= of another organization', r1.json)
      const r2 = await send('emp1', 'GET', ic(`/list?branchId=${3 - t.branch}&taskId=${t.id}`), undefined, false)
      expect(r2.status === 400 && r2.json.parameter === 'branchId', 'Isolation: /list?taskId= at another branch', r2.json)
      const r3 = await send('adminB', 'GET', ic(`/sessions/${t.id}`), undefined, false)
      expect(r3.status === 404, 'Isolation: another organization reads a task session', r3.json)
      const r4 = await send('empB', 'GET', ic('/sessions'), undefined, false)
      expect(!(r4.json.items || []).some((s) => m.tasks.some((x) => x.org === 'A' && (x.id === s.id || (x.pickup && x.pickup.id === s.id)))), 'Isolation: Count sessions of another organization')
      expect(JSON.stringify(await boardSnapshot()) === JSON.stringify(snap), 'Isolation: a foreign read changed the board')
    },
    async fixCycle(d) { // a macro of the same primitives: a Differs by date, rejected, a task issued, the Set that fixes it, a later task, Undo, Redo
      const p = d.p, b = d.branch, a = m.approvals.length
      await EXEC.submit({ who: 'emp1', branch: b, lines: [{ p, mode: 'lots-differ', delta: d.delta }], task: null })
      if (m.approvals.length === a) return
      await EXEC.decide({ kind: 'reject', idx: m.approvals.filter((x) => [...x.lines.values()].some((l) => l.status === 'open')).indexOf(m.approvals[a]) })
      const ord = m.tasks.length
      await EXEC.issue({ who: 'admin', branch: b, products: [p, ...d.with] })
      const L = m.latest.get(`A:${b}:${p}`); if (!L) return
      const off = [...L.lines].findIndex(([batch, counted]) => batch !== 0 && m.lotQty(batch, b) !== counted)
      if (off >= 0) await EXEC.lotSet({ who: 'admin', route: d.route, p, branch: b, batchIdx: batchesOf(p).indexOf([...L.lines][off][0]), q: 'counted' })
      if (d.hand && m.tasks[ord] && m.tasks[ord].status === 'open') await EXEC.close({ who: 'admin', task: ord, stale: false }) // closed by hand: a take-back never reopens it
      await EXEC.issue({ who: 'manager', branch: b, products: [p] })
      if (d.undo) { await EXEC.undo({}); if (d.redo) await EXEC.redo({}) }
    },
    async plainCycle(d) { // the same for a plain product: a Differs, rejected, a task issued, the plain Set that fixes it, (hand close), its Revert, the Revert of the Revert
      const p = d.p, b = d.branch, a = m.approvals.length
      await EXEC.submit({ who: 'emp1', branch: b, lines: [{ p, mode: 'differ', delta: d.delta }], task: null })
      if (m.approvals.length === a) return
      await EXEC.decide({ kind: 'reject', idx: m.approvals.filter((x) => [...x.lines.values()].some((l) => l.status === 'open')).indexOf(m.approvals[a]) })
      const ord = m.tasks.length
      await EXEC.issue({ who: 'admin', branch: b, products: [p, ...d.with.filter((x) => x !== p)] })
      await EXEC.plainSet({ who: 'admin', p, branch: b, q: 'counted' })
      if (d.hand && m.tasks[ord] && m.tasks[ord].status === 'open') await EXEC.close({ who: 'admin', task: ord, stale: false })
      if (d.undo) { await EXEC.plainRevert({ redo: false }); if (d.redo) await EXEC.plainRevert({ redo: true }) }
    },
    async pickupRow(d) { // the picker's Count sessions row carries the task's progress
      const t = m.tasks.find((x) => x.pickup && x.status === 'open'); if (!t) return
      const r = await send(t.pickup.who, 'GET', ic(`/sessions?mine=1&status=open&branchId=${t.branch}&pageSize=100`), undefined, false) // the list pages by 20: ask for the picker's open sessions
      const row = (r.json.items || []).find((s) => s.id === t.pickup.id)
      expect(row && row.task && row.task.id === t.id && row.task.total === m.view(t).total && row.task.done === m.view(t).done, 'Progress: the pickup row in Count sessions', row && row.task)
      expect(!(r.json.items || []).some((s) => m.tasks.some((x) => x.id === s.id)), 'Board: a task row is listed under Count sessions')
    },
  }
  const ord = (id) => { const t = m.tasks.find((x) => x.id === id); return t ? `#${t.ordinal}` : id }
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))
  async function boardSnapshot() {
    const out = []
    for (const [who, b] of [['admin', 1], ['admin', 2], ['adminB', 1]]) { const r = await send(who, 'GET', ic(`/tasks?branchId=${b}`), undefined, false); out.push(r.json.items.map((i) => [i.id, i.status, i.done, i.total, i.removed, i.picked_up_by, i.revision])) }
    return out
  }

  for (let i = 0; i < ops.length; i++) {
    const d = ops[i]
    if (trace) console.log(`step ${i}: ${JSON.stringify(d)}`)
    try { await EXEC[d.op](d); await checkAll(`step ${i}`) } catch (error) { error.step = i; error.seed = seed; if (ARG.dump) console.log(JSON.stringify(w.rows("SELECT s.id,s.status,s.organization_id o,s.branch_id b,json_extract(s.scope_json,'$.membership') kind,json_extract(s.scope_json,'$.restore') rs,i.product_id p,i.state,i.counted_quantity c,i.baseline_quantity base,i.updated_at u FROM inventory_check_items i JOIN inventory_check_sessions s ON s.id=i.session_id WHERE i.product_id=131 ORDER BY i.updated_at"), null, 0)), ARG.dump && console.log(JSON.stringify(w.rows("SELECT e.session_id,e.action,e.request_id,e.created_at FROM inventory_check_events e WHERE e.product_id=131 AND e.request_id LIKE 'stock-set%' ORDER BY e.id"))), ARG.dump && console.log(JSON.stringify(w.rows("SELECT id,generation,state,history_id FROM stock_lot_adjustment_operations"))); throw error }
    log.push(d)
  }
  return { model: m }
}

// ---- the generator (descriptors only; the executor resolves them against the model) -------------------------------------------------------------------------------------------------------------
function generate(seed, steps) {
  const rnd = prng(seed), pick = (l) => l[Math.floor(rnd() * l.length)], int = (n) => Math.floor(rnd() * n)
  const ALL = [...PLAIN, ...LOTTED, ...FAMILY.children]
  const POOL = [...ALL, ...ALL, FAMILY.header, ...INACTIVE] // mostly countable, sometimes not
  const ops = []
  let tasks = 0, sessions = 0
  const some = (n, pool = ALL) => { const s = new Set(); while (s.size < n) s.add(pick(pool)); return [...s] }
  for (let i = 0; i < steps; i++) {
    const r = rnd()
    const who = rnd() < 0.8 ? pick(['admin', 'manager', 'emp1', 'emp2']) : pick(['adminB', 'empB'])
    const branch = rnd() < 0.75 ? 1 : 2
    if (ARG.focus === 'takeback' && rnd() < 0.3) { ops.push(rnd() < 0.5 ? { op: 'plainCycle', p: pick(PLAIN), branch, delta: -1, with: some(1 + int(2), PLAIN), hand: rnd() < 0.4, undo: true, redo: rnd() < 0.5 } : { op: 'fixCycle', p: pick(LOTTED), branch, delta: int(2), with: some(int(2), PLAIN), hand: rnd() < 0.5, route: pick(['adjust', 'batches']), undo: true, redo: rnd() < 0.5 }); continue }
    if (ARG.focus === 'cap' && rnd() < 0.1) { ops.push(rnd() < 0.5 ? { op: 'fill', who: 'admin', branch: 1, gap: 1 + int(3), product: pick(PLAIN) } : { op: 'race', who: 'admin', branch: 1, k: 2 + int(3), products: some(3, PLAIN), hook: rnd() < 0.5 }); continue }
    if (r < 0.13) { ops.push({ op: 'issue', who: rnd() < 0.85 ? pick(['admin', 'manager', 'adminB']) : 'emp1', branch, products: some(1 + int(4), POOL) }); tasks++ }
    else if (r < 0.16) { ops.push({ op: 'issue', who: pick(['admin', 'manager', 'adminB']), branch, filters: { brand: pick(['A', 'B', 'L', 'F']) } }); tasks++ }
    else if (r < 0.23 && tasks) ops.push({ op: 'pickup', who: pick(['admin', 'manager', 'emp1', 'emp2', 'empB']), task: int(tasks) })
    else if (r < 0.27 && tasks) ops.push({ op: 'release', who: pick(['admin', 'manager', 'emp1', 'emp2', 'adminB']), task: int(tasks) })
    else if (r < 0.30 && tasks) ops.push({ op: 'close', who: pick(['admin', 'manager', 'emp1', 'adminB']), task: int(tasks), stale: rnd() < 0.2 })
    else if (r < 0.52) {
      const lines = some(1 + int(3)).map((p) => ({ p, mode: LOTTED.includes(p) ? pick(['match', 'lots-match', 'lots-differ']) : pick(['match', 'match', 'differ']), delta: pick([1, -1]) }))
      const org = ['adminB', 'empB'].includes(who) ? 'B' : 'A'
      if (org === 'B') for (const l of lines) l.mode = l.mode === 'lots-differ' ? 'lots-match' : l.mode === 'differ' ? 'match' : l.mode
      const t = rnd()
      ops.push({ op: 'submit', who, branch, lines, task: t < 0.45 && tasks ? int(tasks) : t < 0.5 ? 'foreign' : t < 0.55 ? 'otherBranch' : null })
    }
    else if (r < 0.56) { ops.push({ op: 'obsCreate', who: pick(['emp1', 'emp2', 'manager', 'empB']), branch, products: some(1 + int(2), PLAIN) }); sessions++ }
    else if (r < 0.61 && sessions) ops.push({ op: 'obsObserve', sess: int(sessions), idx: int(4), state: rnd() < 0.8 ? 'done' : 'unstarted' })
    else if (r < 0.645 && sessions) ops.push({ op: 'obsClose', sess: int(sessions) })
    else if (r < 0.655 && sessions) ops.push({ op: 'obsResume', sess: int(sessions) })
    else if (r < 0.72) ops.push({ op: 'lotSet', who: pick(['admin', 'manager']), route: pick(['adjust', 'batches']), p: pick(LOTTED), branch, batchIdx: int(2), q: pick(['counted', 'counted', 'same', -1, 1, -2]) })
    else if (r < 0.75) ops.push({ op: 'plainSet', who: pick(['admin', 'manager']), p: pick(PLAIN), branch, q: pick(['counted', 'same', -1, 2]) })
    else if (r < 0.79) ops.push(rnd() < 0.6 ? { op: 'undo' } : { op: 'plainRevert', redo: false })
    else if (r < 0.81) ops.push(rnd() < 0.6 ? { op: 'redo' } : { op: 'plainRevert', redo: true })
    else if (r < 0.86) ops.push({ op: 'decide', kind: pick(['reject', 'reject', 'modify', 'approve']), idx: int(8) })
    else if (r < 0.88) ops.push({ op: 'retire', kind: pick(['deactivate', 'header', 'merge']), p: pick(PLAIN), keep: pick(PLAIN) })
    else if (r < 0.93) ops.push({ op: 'retry' })
    else if (r < 0.96) ops.push({ op: 'foreign', idx: int(10) })
    else if (r < 0.965) ops.push({ op: 'pickupRow' })
    else if (r < 0.975) ops.push(rnd() < 0.4 ? { op: 'plainCycle', p: pick(PLAIN), branch, delta: -1, with: some(1 + int(2), PLAIN), hand: rnd() < 0.4, undo: rnd() < 0.8, redo: rnd() < 0.5 } : { op: 'fixCycle', p: pick(LOTTED), branch, delta: int(2), with: some(int(2), PLAIN), hand: rnd() < 0.3, route: pick(['adjust', 'batches']), undo: rnd() < 0.7, redo: rnd() < 0.5 })
    else if (r < 0.985) { ops.push({ op: 'fill', who: 'admin', branch: 1, gap: 1 + int(3), product: pick(PLAIN) }); tasks += 30 }
    else ops.push({ op: 'race', who: 'admin', branch: 1, k: 2 + int(3), products: some(3, PLAIN), hook: rnd() < 0.5 })
  }
  return ops
}

// ---- shrinking: drop chunks, then single steps, while the same invariant still fails ----------------------------------------------------------------------------------------------------------------
async function fails(seed, ops, mutant) { try { await runSequence(seed, ops, { mutant }); return null } catch (e) { return e } }
async function shrink(seed, ops, mutant, invariant) {
  let cur = ops
  for (let chunk = Math.ceil(cur.length / 2); chunk >= 1; chunk = Math.floor(chunk / 2)) {
    for (let at = 0; at < cur.length;) {
      const next = cur.slice(0, at).concat(cur.slice(at + chunk))
      const e = await fails(seed, next, mutant)
      if (e && e.invariant === invariant) cur = next; else at += chunk
    }
  }
  return cur
}

async function main() {
  const [from, to] = String(ARG.seeds || '1..5').split('..').map(Number)
  const steps = Number(ARG.steps || 120), mutant = ARG.mutant || null
  const results = { seeds: 0, passed: 0, failed: [], uncertain: {}, ops: 0 }
  const started = Date.now()
  for (let seed = from; seed <= (to || from); seed++) {
    const n = steps === 0 ? 50 + (seed % 151) : steps
    const ops = generate(seed, n)
    results.seeds++; results.ops += ops.length
    try {
      const { model } = await runSequence(seed, ops, { mutant, trace: !!ARG.trace })
      results.passed++
      for (const u of model.uncertain) { const k = u.map((x) => (x && typeof x === 'object' ? (x.got === undefined ? 'got:none' : 'got:' + x.got) : x)).join(':'); results.uncertain[k] = (results.uncertain[k] || 0) + 1 }
      if (ARG.verbose) console.log(`seed ${seed}: ${ops.length} steps ok, tasks ${model.tasks.length} (closed ${model.tasks.filter((t) => t.status === 'closed').length}), finals ${model.finals.length}, sets ${model.sets.length}, uncertain ${model.uncertain.length}`)
    } catch (error) {
      if (!error.invariant) { console.log(`seed ${seed}: CRASH at step ${error.step}: ${error.stack}`); results.failed.push({ seed, crash: String(error.message) }); if (mutant) break; continue }
      console.log(`seed ${seed}: FAIL at step ${error.step} [${error.invariant}] ${error.message}`)
      let shrunk = null
      if (ARG.shrink) { shrunk = await shrink(seed, ops.slice(0, error.step + 1), mutant, error.invariant); console.log(`  shrunk to ${shrunk.length} steps: ${JSON.stringify(shrunk)}`) }
      results.failed.push({ seed, step: error.step, invariant: error.invariant, message: error.message.slice(0, 400), shrunk })
      if (mutant) break
    }
  }
  console.log(`\nRESULT ${JSON.stringify({ mutant, seeds: results.seeds, passed: results.passed, failed: results.failed.length, ops: results.ops, uncertain: results.uncertain, seconds: Math.round((Date.now() - started) / 1000) })}`)
  if (mutant) { const found = results.failed.some((f) => f.invariant); console.log(found ? `MUTANT ${mutant} FOUND` : `MUTANT ${mutant} SURVIVED (a crash is not a find)`); process.exit(found ? 0 : 1) }
  process.exit(results.failed.length ? 1 : 0)
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(2) })
module.exports = { generate, runSequence, MUTANTS }
