'use strict'
// Randomised oracle for the merge-by-date fold (the Opus reviewer's world generator, expectations moved to the lead rulings of 16 Nov):
//   M1 only ACTIVE kept lots are match targets (an archived kept lot is never reactivated); M2 a lot already inactive before the merge is left
//   exactly as it was (no fold, no marker, no activation) on both sides; M3 discarded lots of one date the keeper lacks end as ONE new lot
//   (first created, the others folded in); after any merge there is at most one active lot per received date from the merge's own doing;
//   stock is conserved; the second apply writes nothing; undo restores EVERY table exactly.
// Run (from cloudflare/): node scripts/test-merge-by-date-oracle-native.cjs [from to]   (default seeds 1..N_DEFAULT)
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const K = 1, D = 2
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const plain = (rows) => rows.map((r) => ({ ...r }))
function fixtureWrite(h, run) {
  h.raw.db.exec("BEGIN; INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
  try { run(); h.raw.db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'; COMMIT") } catch (e) { h.raw.db.exec('ROLLBACK'); throw e }
}
function bizDate(v) {
  if (v == null || String(v).trim() === '') return null
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  let iso = s.includes('T') ? s : s.replace(' ', 'T')
  if (!/([zZ]|[+-]\d\d:?\d\d)$/.test(iso)) iso += 'Z'
  const ms = Date.parse(iso); if (Number.isNaN(ms)) return null
  return new Date(ms + 7 * 3600e3).toISOString().slice(0, 10)
}
function oracleCost(keeper, added) {
  const own = keeper.cost == null ? null : Number(keeper.cost)
  const all = [keeper, ...added].filter((l) => l.cost != null && Number(l.cost) > 0)
  if (!all.length) return own
  if (all.length === 1) return Math.round(Number(all[0].cost) * 1e4) / 1e4
  let num = 0n, den = 0n
  for (const l of all) { const q = BigInt(Math.max(0, l.q)); num += BigInt(Math.round(Number(l.cost) * 1e4)) * q; den += q }
  if (den === 0n) return own
  const r = (num * 2n + den) / (2n * den)
  return Number(r) / 1e4
}
function oracleExpiry(keeperExp, addedExp) {
  const p = [keeperExp, ...addedExp].map((v) => String(v ?? '').trim()).filter(Boolean)
  if (!p.length) return keeperExp == null ? null : keeperExp
  return p.sort()[0]
}
const DATES = ['2026-11-03', '2026-11-04', '2026-11-03 16:59:59', '2026-11-03 17:00:00', '2026-11-03T17:00:00.000Z', '2026-11-02T23:30:00Z', '2026-11-04T06:00:00+07:00', '2026-11-05', null]
const COSTS = [null, 0, 1.25, 2, 2.4, 3.3333, 5, 0.0001]
const EXP = [null, '2027-01-31', '2027-03-31', '2026-12-15']
function genWorld(seed) {
  const r = mulberry32(seed)
  const pick = (a) => a[Math.floor(r() * a.length)]
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
  const lots = []
  let id = 100
  for (const [product, n] of [[K, int(1, 4)], [D, int(1, 5)]]) {
    for (let i = 0; i < n; i++) {
      id += 1
      const active = r() < 0.85 ? 1 : 0
      const stock = {}
      if (active) for (const b of [1, 2, 3]) { const q = r() < 0.5 ? int(0, 5) : 0; if (q) stock[b] = q }
      const sup = pick([null, 1, 2])
      const pay = sup ? pick(['paid', 'credit']) : pick([null, 'paid'])
      lots.push({ id, product, key: (product === K ? 'K' : 'D') + '-KEY-' + i, number: r() < 0.9 ? i + 1 : null, received: pick(DATES), expiry: pick(EXP), cost: pick(COSTS), active, sup, pay, due: pay === 'credit' ? '2026-11-20' : null, stock })
    }
  }
  const dups = lots.filter((l) => l.product === D), keeps = lots.filter((l) => l.product === K)
  if (r() < 0.4) dups[0].key = keeps[0].key
  return lots
}
function build(lots, extraUntracked) {
  const h = createProductsRouteHarness({ user: ADMIN })
  fixtureWrite(h, () => {
    const db = h.raw.db
    db.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1),(2,'Warehouse',1,0),(3,'Store',1,0); INSERT INTO suppliers(id,name) VALUES(1,'Sup K'),(2,'Sup D');")
    const bs = { [K]: { 1: 0, 2: 0, 3: 0 }, [D]: { 1: 0, 2: 0, 3: 0 } }
    for (const l of lots) for (const [b, q] of Object.entries(l.stock)) bs[l.product][b] += q
    for (const [p, b] of extraUntracked) bs[p][b] += 1
    const tot = (p) => Object.values(bs[p]).reduce((a, b) => a + b, 0)
    db.exec("INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd,wholesale_price_usd) VALUES(" + K + ",'Twin Serum','777',1," + tot(K) + ",3,3,10,8),(" + D + ",'Twin Serum','777',1," + tot(D) + ",3,3,10,8);")
    const ins = db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,supplier_id,supplier_name,payment_status,credit_due_date,received_quantity,received_cost_usd,received_branch_id,received_branch_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    for (const l of lots) {
      const q = Object.values(l.stock).reduce((a, b) => a + b, 0) + 1
      ins.run(l.id, l.product, l.key, l.number, 'LOT-' + l.id, l.received, l.expiry, l.cost, l.active, l.sup, l.sup ? ('Sup ' + (l.sup === 1 ? 'K' : 'D')) : null, l.pay, l.due, q, l.cost == null ? null : Math.round(q * l.cost * 1e4) / 1e4, 1, 'Shop')
    }
    const st = db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)')
    for (const p of [K, D]) for (const b of [1, 2, 3]) st.run(p, b, bs[p][b])
    const lst = db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)')
    for (const l of lots) for (const [b, q] of Object.entries(l.stock)) lst.run(l.id, Number(b), q)
    db.exec("INSERT INTO sales(id,receipt_number) VALUES(500,'20261105-100000');")
    const si = db.prepare('INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,batch_id) VALUES(?,?,?,?,?,?)')
    let sid = 600
    for (const l of lots.filter((x) => x.product === D)) si.run(++sid, 500, D, 'Twin Serum', 1, l.id)
    si.run(++sid, 500, D, 'Twin Serum', 1, null)
    const first = lots.find((x) => x.product === D)
    db.prepare('INSERT INTO sale_item_batch_allocations(id,sale_item_id,batch_id,branch_id,quantity,released_quantity) VALUES(1,?,?,1,1,0)').run(sid, first.id)
    db.exec("INSERT INTO returns(id,return_number,sale_id) VALUES(700,'RET-1',500);")
    db.prepare('INSERT INTO return_items(id,return_id,product_id,product_name,quantity,batch_id) VALUES(710,700,?,?,1,?)').run(D, 'Twin Serum', first.id)
    db.prepare('INSERT INTO return_item_batch_allocations(id,return_item_id,sale_item_id,batch_id,branch_id,quantity) VALUES(1,710,?,?,1,1)').run(sid, first.id)
  })
  // A product's catalog cost is derived from its lots (U-cost, 2026-09-25); start every world in that derived state, as production is.
  fixtureWrite(h, () => h.raw.db.exec(h.load('lib/catalogCostRecompute.ts').catalogCostRecomputeIfChangedSql('id IN (' + K + ',' + D + ')')))
  return h
}
const LOTCOLS = 'merge_deactivated_at IS NOT NULL AS marked,' + 'id,variant_product_id,batch_key,batch_number,lot_code,received_at,expiry_date,unit_cost_usd,is_active,supplier_id,supplier_name,payment_status,credit_due_date,received_quantity,received_cost_usd'
function snap(h) {
  const q = (s) => plain(h.raw.prepare(s).all())
  return {
    lots: q('SELECT ' + LOTCOLS + ' FROM product_batches ORDER BY id'),
    lotStock: q('SELECT batch_id,branch_id,quantity FROM branch_batch_stock WHERE quantity<>0 ORDER BY batch_id,branch_id'),
    branchStock: q('SELECT product_id,branch_id,quantity FROM branch_stock WHERE quantity<>0 ORDER BY product_id,branch_id'),
    // The catalog cost is DERIVED from the lots by the 0195 recompute (undo step 8 re-derives it), and where the kept product has no
    // cost-bearing lot the derivation falls back to the newest lot, so a world's hand-set cost can legitimately differ after undo
    // (seeds 14, 15, 25, 35, 36, 45; the same at the lane's previous tip). The lot, stock and allocation ledgers are what undo must restore exactly.
    products: q('SELECT id,is_active,stock_quantity FROM products ORDER BY id'),
    saleItems: q('SELECT id,product_id,batch_id FROM sale_items ORDER BY id'),
    returnItems: q('SELECT id,product_id,batch_id FROM return_items ORDER BY id'),
    saleAlloc: q('SELECT id,batch_id FROM sale_item_batch_allocations ORDER BY id'),
    returnAlloc: q('SELECT id,batch_id FROM return_item_batch_allocations ORDER BY id'),
  }
}
async function historyAction(h, direction) {
  const history = h.raw.prepare("SELECT id,scope FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge' ORDER BY id DESC LIMIT 1").get()
  if (!history) return { status: 'no-history' }
  const app = h.load('routes/actionHistory.ts').default
  const env = { DB: h.raw }, ctx = { waitUntil() {}, passThroughOnException() {} }
  const listed = await app.request('http://local/?scope=' + encodeURIComponent(history.scope), {}, env, ctx)
  const current = (await listed.json()).items.find((row) => row.id === history.id)
  const pointer = current[direction + '_payload']
  const response = await app.request('http://local/' + history.id + '/' + direction, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ require_applied: true, expected_generation: pointer && pointer.generation }) }, env, ctx)
  return { status: response.status, json: await response.json().catch(() => null) }
}
function expected(lots) {
  const keeper = lots.filter((l) => l.product === K), dup = lots.filter((l) => l.product === D)
  const order = (a, b) => { const na = a.number == null ? Number.MAX_SAFE_INTEGER : a.number, nb = b.number == null ? Number.MAX_SAFE_INTEGER : b.number; return na !== nb ? na - nb : a.id - b.id }
  const byDate = new Map()
  for (const l of [...keeper].filter((x) => x.active).sort(order)) { const d = bizDate(l.received); if (d && !byDate.has(d)) byDate.set(d, l) }
  const qty = (l) => Object.values(l.stock).reduce((a, b) => a + b, 0)
  const folds = new Map(), created = [], createdByDate = new Map(), untouched = lots.filter((l) => !l.active)
  for (const l of [...dup].filter((x) => x.active).sort(order)) {
    const d = bizDate(l.received)
    const t = d && (byDate.get(d) || createdByDate.get(d))
    if (t) { if (!folds.has(t.id)) folds.set(t.id, []); folds.get(t.id).push(l) } else { created.push(l); if (d) createdByDate.set(d, l) }
  }
  const exp = {}
  for (const k of [...keeper, ...created.filter((c) => folds.has(c.id))]) {
    const added = folds.get(k.id) || []
    const s = { ...k.stock }
    for (const a of added) for (const [b, q] of Object.entries(a.stock)) s[b] = (s[b] || 0) + q
    exp[k.id] = {
      cost: added.length ? oracleCost({ cost: k.cost, q: qty(k) }, added.map((a) => ({ cost: a.cost, q: qty(a) }))) : k.cost,
      expiry: added.length ? oracleExpiry(k.expiry, added.map((a) => a.expiry)) : k.expiry,
      stock: s,
    }
  }
  return { folds, created, exp, untouched }
}
const stockOf = (s, id) => { const o = {}; for (const r of s.lotStock.filter((x) => x.batch_id === id)) o[r.branch_id] = r.quantity; return o }
const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, q]) => q))
const J = JSON.stringify
function diffRows(a, b) {
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (J(a[i]) !== J(b[i])) out.push(J(a[i]) + ' vs ' + J(b[i]))
  return out.slice(0, 3).join(' | ')
}
async function runSeed(seed, opts = {}) {
  const lots = opts.lots || genWorld(seed)
  const h = build(lots, opts.untracked || [[K, 1]])
  const before = snap(h)
  const ex = expected(lots)
  const res = await h.request('POST', '/possible-duplicates/merge', { keepId: K, mergeId: D, stock: 'merge' })
  const issues = []
  if (res.status !== 200) return { seed, status: res.status, body: J(res.json).slice(0, 300), issues: ['merge not 200'] }
  const after = snap(h)
  const lotA = (id) => after.lots.find((l) => l.id === id)
  for (const k of lots.filter((l) => l.product === K)) {
    const e = ex.exp[k.id], a = lotA(k.id)
    if (e.cost == null ? a.unit_cost_usd != null : Math.abs(Number(a.unit_cost_usd) - e.cost) > 1e-9) issues.push('kept ' + k.id + ' cost exp ' + e.cost + ' got ' + a.unit_cost_usd)
    if ((e.expiry ?? null) !== (a.expiry_date ?? null)) issues.push('kept ' + k.id + ' expiry exp ' + e.expiry + ' got ' + a.expiry_date)
    if (J(stockOf(after, k.id)) !== J(nz(e.stock))) issues.push('kept ' + k.id + ' stock exp ' + J(nz(e.stock)) + ' got ' + J(stockOf(after, k.id)))
    if ((a.supplier_id ?? null) !== (k.sup ?? null) || (a.payment_status ?? null) !== (k.pay ?? null) || (a.credit_due_date ?? null) !== (k.due ?? null)) issues.push('kept ' + k.id + ' supplier changed')
    if (a.marked) issues.push('kept ' + k.id + ' marked')
  }
  for (const [kid, added] of ex.folds) for (const d of added) {
    const a = lotA(d.id)
    if (!a) { issues.push('source ' + d.id + ' deleted'); continue }
    if (a.is_active !== 0 || !a.marked || a.variant_product_id !== D) issues.push('source ' + d.id + ' active=' + a.is_active + ' marked=' + a.marked + ' product=' + a.variant_product_id)
    if (Object.keys(stockOf(after, d.id)).length) issues.push('source ' + d.id + ' still holds stock')
    if ((a.supplier_id ?? null) !== (d.sup ?? null) || (a.payment_status ?? null) !== (d.pay ?? null) || Number(a.unit_cost_usd ?? -1) !== Number(d.cost ?? -1)) issues.push('source ' + d.id + ' fields changed')
    const was = (rows, id) => rows.find((b) => b.id === id).batch_id
    for (const si of after.saleItems.filter((x) => was(before.saleItems, x.id) === d.id)) if (si.batch_id !== kid) issues.push('sale_item ' + si.id + ' batch ' + si.batch_id + ' exp ' + kid)
    for (const ri of after.returnItems.filter((x) => was(before.returnItems, x.id) === d.id)) if (ri.batch_id !== kid) issues.push('return_item ' + ri.id + ' batch ' + ri.batch_id + ' exp ' + kid)
    for (const al of after.saleAlloc.filter((x) => was(before.saleAlloc, x.id) === d.id)) if (al.batch_id !== kid) issues.push('sale alloc ' + al.id + ' exp ' + kid)
    for (const al of after.returnAlloc.filter((x) => was(before.returnAlloc, x.id) === d.id)) if (al.batch_id !== kid) issues.push('return alloc ' + al.id + ' exp ' + kid)
  }
  for (const d of ex.created) {
    const a = lotA(d.id)
    if (a.variant_product_id !== K) issues.push('created ' + d.id + ' not on keeper')
    if (a.marked) issues.push('created ' + d.id + ' marked')
    const e = ex.exp[d.id]
    if (J(stockOf(after, d.id)) !== J(nz(e ? e.stock : d.stock))) issues.push('created ' + d.id + ' stock exp ' + J(nz(e ? e.stock : d.stock)) + ' got ' + J(stockOf(after, d.id)))
    if (e && (e.cost == null ? a.unit_cost_usd != null : Math.abs(Number(a.unit_cost_usd) - e.cost) > 1e-9)) issues.push('created ' + d.id + ' cost exp ' + e.cost + ' got ' + a.unit_cost_usd)
    if (e && (e.expiry ?? null) !== (a.expiry_date ?? null)) issues.push('created ' + d.id + ' expiry exp ' + e.expiry + ' got ' + a.expiry_date)
    if (!a.is_active) issues.push('created ' + d.id + ' not active')
    if ((a.supplier_id ?? null) !== (d.sup ?? null)) issues.push('created ' + d.id + ' supplier changed')
  }
  for (const l of ex.untouched) {
    const a = lotA(l.id), b = before.lots.find((x) => x.id === l.id)
    // An inactive lot of the DISCARDED product is re-pointed onto the keeper (B2, lead ruling 16 Nov): its owner, batch number and (on a key clash)
    // batch key change; it stays inactive and unmarked, with its stock, cost, expiry, supplier and dates exactly as they were.
    if (b && b.variant_product_id === D) {
      if (a.variant_product_id !== K) issues.push('B2: inactive discarded lot ' + l.id + ' not re-pointed onto the keeper')
      const strip = (row) => { const { variant_product_id, batch_number, batch_key, updated_at, ...rest } = row; return rest }
      if (J(strip(a)) !== J(strip(b))) issues.push('M1/M2: inactive lot ' + l.id + ' changed ' + J(b) + ' -> ' + J(a))
    } else if (J(a) !== J(b)) issues.push('M1/M2: inactive lot ' + l.id + ' changed ' + J(b) + ' -> ' + J(a))
  }
  return { h, lots, before, after, ex, issues, res }
}
async function checkRest(ctx) {
  const { h, lots, before, after, issues } = ctx
  const lotA = (id) => after.lots.find((l) => l.id === id)
  const sumBy = (rows, f) => rows.reduce((m, r) => { m[f(r)] = (m[f(r)] || 0) + r.quantity; return m }, {})
  const lotB = sumBy(before.lotStock, (r) => r.branch_id), lotAf = sumBy(after.lotStock, (r) => r.branch_id)
  if (J(lotB) !== J(lotAf)) issues.push('lot stock not conserved ' + J(lotB) + ' -> ' + J(lotAf))
  const bsB = sumBy(before.branchStock, (r) => r.branch_id), bsA = sumBy(after.branchStock.filter((r) => r.product_id === K), (r) => r.branch_id)
  if (J(bsB) !== J(bsA)) issues.push('branch_stock not conserved ' + J(bsB) + ' -> ' + J(bsA))
  if (after.branchStock.some((r) => r.product_id === D)) issues.push('dup still has branch_stock')
  const kp = after.products.find((p) => p.id === K)
  if (kp.stock_quantity !== Object.values(bsA).reduce((a, b) => a + b, 0)) issues.push('products.stock_quantity ' + kp.stock_quantity)
  const kLots = sumBy(after.lotStock.filter((r) => lotA(r.batch_id).variant_product_id === K), (r) => r.branch_id)
  for (const [b, q] of Object.entries(kLots)) if (q > (bsA[b] || 0)) issues.push('branch ' + b + ' lots ' + q + ' > branch_stock ' + bsA[b])
  for (const r of after.lotStock) { const l = lotA(r.batch_id); if (!l.is_active && r.quantity > 0) issues.push('stock ' + r.quantity + ' on inactive lot ' + l.id) }
  const activeByDate = {}
  for (const l of after.lots.filter((x) => x.variant_product_id === K && x.is_active)) { const d = bizDate(l.received_at); if (d) (activeByDate[d] = activeByDate[d] || []).push(l.id) }
  const pre = {}
  for (const l of lots.filter((x) => x.product === K && x.active)) { const d = bizDate(l.received); if (d) (pre[d] = pre[d] || []).push(l.id) }
  ctx.newMulti = Object.entries(activeByDate).filter(([d, ids]) => ids.length > 1 && !((pre[d] || []).length > 1)).map(([d, ids]) => d + ':' + ids).join(' ')
  if (ctx.newMulti) issues.push('M3: more than one active lot per received date from the merge: ' + ctx.newMulti)
  const again = await h.request('POST', '/possible-duplicates/merge', { keepId: K, mergeId: D, stock: 'merge' })
  ctx.again = again.status
  if (J(snap(h)) !== J(after)) issues.push('second apply changed state (status ' + again.status + ')')
  if (again.status === 200) issues.push('second apply returned 200')
  const undo = await historyAction(h, 'undo')
  ctx.undo = undo.status
  const afterUndo = snap(h)
  if (undo.status !== 200) issues.push('undo status ' + undo.status + ' ' + J(undo.json).slice(0, 200))
  else for (const k of Object.keys(before)) if (J(before[k]) !== J(afterUndo[k])) issues.push('undo inexact in ' + k + ': ' + diffRows(before[k], afterUndo[k]))
  return ctx
}
module.exports = { runSeed, checkRest, genWorld, build, snap, historyAction, bizDate, oracleCost, K, D, J }
if (require.main === module) {
  (async () => {
    const [from, to] = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [1, Number(process.env.ORACLE_SEEDS || 40)]
    let bad = 0, seeds = 0
    for (let s = from; s <= to; s++) {
      seeds += 1
      try {
        const ctx = await runSeed(s)
        if (ctx.h) await checkRest(ctx)
        if (ctx.issues.length) { bad++; console.log(J({ seed: s, issues: ctx.issues.slice(0, 4) })) }
      } catch (e) { bad++; console.log(J({ seed: s, crash: String(e.stack).slice(0, 600) })) }
    }
    console.log('seeds ' + seeds + ', bad ' + bad)
    if (bad) process.exitCode = 1
  })()
}
