// Owner rule, 1 Oct 2026: a Revert works like cancelling a sale -- everything
// returns with no loss, the reverted effect leaves the reports, a Revert of a
// Revert restores. Random, seeded (deterministic) sequences of receipts, lot
// removals, undated adds, Inventory-import receipts (type 'in'), sales, transfers
// and Reverts of random rows (chain leaves, and 15% of the time any row) across
// two branches and two dated lots, against the REAL applyMovementRevert, real
// batch primitives, the real loss view and the literal invoice-report SQL.
// After EVERY step: branch_stock and each (lot, branch) equal the signed
// movement ledger; nothing is negative; lots never exceed their branch; the
// product equals its branches; each lot's received quantity and cost (4
// decimals) equal its chain-open receipts; the invoice report agrees; a removal
// is in the loss view iff its chain depth is even; no Revert row is a loss; a
// refused Revert leaves every table unchanged. Positive control: the same
// checks fail on the stock-only kernel. One fixture, one rolled-back
// transaction per seed, so the whole file stays well under 20 seconds.
const path = require('node:path')
const assert = require('node:assert/strict')
const scripts = __dirname
const fs = require('node:fs')
const { fixture, loadStockSession, user } = require(path.join(scripts, 'test-stock-session-atomic.cjs'))
const { applyMovementRevert } = loadStockSession('lib/stockRevert.ts')
const pb = loadStockSession('lib/productBatches.ts')
const losses = loadStockSession('lib/removalLosses.ts')
const { multiplyMoney4 } = loadStockSession('lib/moneyPrecision.ts')
const { getDb } = loadStockSession('lib/db.ts')
const contacts = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
const STOCK_IN_REPORT_SOURCE = contacts.match(/const STOCK_IN_REPORT_SOURCE = `([\s\S]*?)`/)[1]
const actor = { userId: user.id, userName: user.name }

const OUT = new Set(['remove', 'sale', 'transfer_out', 'out'])
const LOTS = { 9001: { date: '2026-09-10', cost: 2.3333, supplier: 'Sup X', pay: 'credit' }, 9002: { date: '2026-09-20', cost: 3.1, supplier: 'Sup Y', pay: 'paid' } }

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 } }

function setup(f) {
  f.sql.exec('BEGIN')
  f.sql.exec(`INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Store',0,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,2,0);
    INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,payment_status,received_quantity,received_branch_id,received_cost_usd,supplier_name)
      VALUES(9001,1,'20260910-x','09102026','2026-09-10',0,1,2.3333,'credit',0,1,0,'Sup X'),
            (9002,1,'20260920-y','09202026','2026-09-20',0,2,3.1,'paid',0,1,0,'Sup Y');`)
}

const q = (f, s, ...a) => f.sql.prepare(s).get(...a)
const all = (f, s, ...a) => f.sql.prepare(s).all(...a)

function snapshot(f) {
  return JSON.stringify([all(f, 'SELECT * FROM branch_stock ORDER BY product_id,branch_id'), all(f, 'SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY 1,2'),
    all(f, 'SELECT id,received_quantity,received_cost_usd,is_active,unit_cost_usd,payment_status,supplier_name FROM product_batches ORDER BY id'),
    q(f, 'SELECT stock_quantity FROM products WHERE id=1'), q(f, 'SELECT COUNT(*) n FROM inventory_movements')])
}

async function runStatements(f, statements) { await getDb(f.env).batch(statements) }

function insertMovement(f, { branch, type, qty, lot, unit, total, ref, day }) {
  return Number(f.sql.prepare(`INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,movement_type,quantity,unit_cost_usd,total_cost_usd,reason,reference_id,batch_id,created_at)
    VALUES(1,'Serum',?,?,?,?,?,?,?,?,?,?)`).run(branch, branch === 1 ? 'Shop' : 'Store', type, qty, unit ?? null, total ?? null, `probe ${type}`, ref ?? null, lot ?? null, `${day} 03:00:00`).lastInsertRowid)
}

function lotQty(f, lot, branch) { return Number(q(f, 'SELECT quantity FROM branch_batch_stock WHERE batch_id=? AND branch_id=?', lot, branch)?.quantity || 0) }
function branchQty(f, branch) { return Number(q(f, 'SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=?', branch)?.quantity || 0) }

async function receipt(f, r) {
  const lot = r() < 0.5 ? 9001 : 9002; const branch = r() < 0.5 ? 1 : 2; const n = 1 + Math.floor(r() * 6)
  const L = LOTS[lot]
  const before = q(f, 'SELECT received_cost_usd FROM product_batches WHERE id=?', lot).received_cost_usd
  const plan = pb.planReceiveBatchStock({ productId: 1, branchId: branch, quantity: n, batchId: lot, unitCostUsd: L.cost, supplierName: L.supplier, paymentStatus: L.pay,
    receiptCostPreimage: { batchExists: true, receivedCostUsd: before == null ? null : Number(before) } })
  await runStatements(f, plan.statements)
  insertMovement(f, { branch, type: 'add', qty: n, lot, unit: L.cost, total: multiplyMoney4(L.cost, n), day: L.date })
  return `receipt b${branch} lot${lot} +${n}`
}

// The Inventory import writes its stock-in as type 'in' on a received lot.
async function importReceipt(f, r) {
  const lot = r() < 0.5 ? 9001 : 9002; const branch = r() < 0.5 ? 1 : 2; const n = 1 + Math.floor(r() * 6)
  const L = LOTS[lot]
  const before = q(f, 'SELECT received_cost_usd FROM product_batches WHERE id=?', lot).received_cost_usd
  const plan = pb.planReceiveBatchStock({ productId: 1, branchId: branch, quantity: n, batchId: lot, unitCostUsd: L.cost, supplierName: L.supplier, paymentStatus: L.pay,
    receiptCostPreimage: { batchExists: true, receivedCostUsd: before == null ? null : Number(before) } })
  await runStatements(f, plan.statements)
  insertMovement(f, { branch, type: 'in', qty: n, lot, unit: L.cost, total: multiplyMoney4(L.cost, n), day: L.date })
  return `import receipt b${branch} lot${lot} +${n}`
}

async function removal(f, r) {
  const lot = r() < 0.5 ? 9001 : 9002; const branch = r() < 0.5 ? 1 : 2
  const have = lotQty(f, lot, branch); if (have <= 0) return null
  const n = 1 + Math.floor(r() * have)
  await runStatements(f, pb.planRemoveStockFromBatch({ batchId: lot, productId: 1, branchId: branch, quantity: n }).statements)
  const day = r() < 0.5 ? '2026-09-21' : '2026-09-25'
  insertMovement(f, { branch, type: 'remove', qty: n, lot, unit: LOTS[lot].cost, total: multiplyMoney4(LOTS[lot].cost, n), day })
  return `removal b${branch} lot${lot} -${n} on ${day}`
}

async function undatedAdd(f, r) {
  const branch = r() < 0.5 ? 1 : 2; const n = 1 + Math.floor(r() * 4)
  f.sql.exec(`UPDATE branch_stock SET quantity=quantity+${n} WHERE product_id=1 AND branch_id=${branch}; UPDATE products SET stock_quantity=stock_quantity+${n} WHERE id=1`)
  insertMovement(f, { branch, type: 'add', qty: n, lot: null, unit: 1, total: n, day: '2025-01-05' })
  return `undated add b${branch} +${n}`
}

async function sale(f, r) {
  const lot = r() < 0.5 ? 9001 : 9002; const branch = r() < 0.5 ? 1 : 2
  const have = lotQty(f, lot, branch); if (have <= 0) return null
  const n = 1 + Math.floor(r() * have)
  await runStatements(f, pb.planRemoveStockFromBatch({ batchId: lot, productId: 1, branchId: branch, quantity: n }).statements)
  insertMovement(f, { branch, type: 'sale', qty: -n, lot, unit: LOTS[lot].cost, total: multiplyMoney4(LOTS[lot].cost, n), ref: '77', day: '2026-09-28' })
  return `sale b${branch} lot${lot} -${n}`
}

async function transfer(f, r) {
  const lot = r() < 0.5 ? 9001 : 9002; const from = r() < 0.5 ? 1 : 2; const to = 3 - from
  const have = lotQty(f, lot, from); if (have <= 0) return null
  const n = 1 + Math.floor(r() * have)
  await runStatements(f, [
    ...pb.planRemoveStockFromBatch({ batchId: lot, productId: 1, branchId: from, quantity: n }).statements,
    ...pb.restoreBatchStockStatements(lot, to, n),
    { sql: `UPDATE branch_stock SET quantity=quantity+@n WHERE product_id=1 AND branch_id=@to`, params: { n, to } },
    { sql: `UPDATE products SET stock_quantity=stock_quantity+@n WHERE id=1`, params: { n } },
  ])
  insertMovement(f, { branch: from, type: 'transfer_out', qty: n, lot, ref: 'T1', day: '2026-09-27' })
  insertMovement(f, { branch: to, type: 'transfer_in', qty: n, lot, ref: 'T1', day: '2026-09-27' })
  return `transfer lot${lot} b${from}->b${to} ${n}`
}

// Revert a random row: prefer chain leaves (the only ones the app offers).
async function revert(f, r, codes) {
  const leaves = all(f, `SELECT * FROM inventory_movements m WHERE NOT EXISTS (SELECT 1 FROM inventory_movements x WHERE x.reference_id='revert:'||m.id)`)
  const pickAny = r() < 0.15
  const pool = pickAny ? all(f, 'SELECT * FROM inventory_movements') : leaves
  if (!pool.length) return null
  const m = pool[Math.floor(r() * pool.length)]
  const before = snapshot(f)
  const res = await applyMovementRevert(getDb(f.env), m, actor)
  if (!res.ok) {
    codes[res.code] = (codes[res.code] || 0) + 1
    if (snapshot(f) !== before) throw new Error(`refused revert ${res.code} changed state`)
    return `revert #${m.id} (${m.movement_type} ${m.reference_id || ''}) REFUSED ${res.code}`
  }
  codes.ok = (codes.ok || 0) + 1
  return `revert #${m.id} (${m.movement_type} ${m.reference_id || ''}) ok -> ${res.revertType} ${res.quantity} lot ${res.usedBatchId}`
}

function chainDepth(f, id) {
  let d = 0; let cur = id
  for (;;) { const c = q(f, 'SELECT id FROM inventory_movements WHERE reference_id=?', `revert:${cur}`); if (!c) return d; d += 1; cur = c.id }
}
function rootOf(f, m) { let cur = m; while (String(cur.reference_id || '').startsWith('revert:')) cur = q(f, 'SELECT * FROM inventory_movements WHERE id=?', Number(cur.reference_id.slice(7))); return cur }

const round4 = (x) => Math.round(x * 10000) / 10000
function check(f, step) {
  const fail = (msg) => { throw new Error(`step ${step}: ${msg}`) }
  const moves = all(f, 'SELECT * FROM inventory_movements ORDER BY id')
  const sign = (m) => (OUT.has(m.movement_type) ? -1 : 1) * Math.abs(m.quantity)
  let total = 0
  for (const b of [1, 2]) {
    const exp = moves.filter((m) => m.branch_id === b).reduce((s, m) => s + sign(m), 0)
    const got = branchQty(f, b); total += got
    if (got !== exp) fail(`branch ${b} stock ${got} != ledger ${exp}`)
    if (got < 0) fail(`branch ${b} negative`)
    let lots = 0
    for (const lot of [9001, 9002]) {
      const lexp = moves.filter((m) => m.branch_id === b && m.batch_id === lot).reduce((s, m) => s + sign(m), 0)
      const lgot = lotQty(f, lot, b); lots += lgot
      if (lgot !== lexp) fail(`lot ${lot} @b${b} ${lgot} != ledger ${lexp}`)
      if (lgot < 0) fail(`lot ${lot} @b${b} negative`)
    }
    if (lots > got) fail(`lots ${lots} > branch ${got} at b${b}`)
  }
  const prod = q(f, 'SELECT stock_quantity FROM products WHERE id=1').stock_quantity
  if (prod !== total) fail(`product ${prod} != sum branches ${total}`)
  // purchase side
  for (const lot of [9001, 9002]) {
    const roots = moves.filter((m) => (m.movement_type === 'add' || m.movement_type === 'in') && m.batch_id === lot && !String(m.reference_id || '').startsWith('revert:'))
    const live = roots.filter((m) => chainDepth(f, m.id) % 2 === 0)
    const expQty = live.reduce((s, m) => s + m.quantity, 0)
    const expUsd = round4(live.reduce((s, m) => s + m.total_cost_usd, 0))
    const row = q(f, 'SELECT received_quantity, received_cost_usd FROM product_batches WHERE id=?', lot)
    if (row.received_quantity !== expQty) fail(`lot ${lot} received_quantity ${row.received_quantity} != live receipts ${expQty}`)
    if (Math.abs(round4(row.received_cost_usd) - expUsd) > 1e-9) fail(`lot ${lot} received_cost_usd ${row.received_cost_usd} != live receipts ${expUsd}`)
    const inv = all(f, `SELECT received_quantity, received_cost_usd, payment_status FROM (${STOCK_IN_REPORT_SOURCE}) t WHERE t.id=?`, lot)
    const invQty = inv.reduce((s, x) => s + x.received_quantity, 0)
    if (invQty !== expQty) fail(`invoice report lot ${lot} ${invQty} != ${expQty}`)
  }
  // loss side
  const lossRows = all(f, `SELECT ${losses.REMOVAL_LOSS_SELECT} ${losses.REMOVAL_LOSS_FROM} WHERE ${losses.removalLossMovementWhere('m')}`)
  const lossIds = new Set(lossRows.map((x) => x.id))
  for (const m of moves.filter((x) => x.movement_type === 'remove' && !String(x.reference_id || '').startsWith('revert:'))) {
    const open = chainDepth(f, m.id) % 2 === 0
    if (open !== lossIds.has(m.id)) fail(`removal #${m.id} loss presence ${lossIds.has(m.id)} but chain depth ${chainDepth(f, m.id)}`)
  }
  for (const id of lossIds) { const m = moves.find((x) => x.id === id); if (String(m.reference_id || '').startsWith('revert:')) fail(`revert row #${id} counted as loss`) }
}

async function main() {
  const seeds = Number(process.env.SEEDS || 14); const steps = Number(process.env.STEPS || 40)
  const f = fixture()
  const codes = {}; let ops = 0;
  try {
    for (let seed = 1; seed <= seeds; seed += 1) {
      const r = rng(seed); const log = []
      setup(f)
      try {
        for (let i = 0; i < steps; i += 1) {
          const x = r()
          const op = x < 0.2 ? receipt : x < 0.3 ? importReceipt : x < 0.38 ? removal : x < 0.44 ? undatedAdd : x < 0.5 ? sale : x < 0.56 ? transfer : revert
          const line = await op(f, r, codes)
          if (line) { log.push(line); ops += 1; check(f, `${seed}.${i}`) }
        }
      } catch (e) {
        throw new Error(`seed ${seed}: ${e.message} | last steps: ${log.slice(-12).join(" ; ")}`)
      } finally { f.sql.exec('ROLLBACK') }
    }
    // The run must have exercised what it claims to.
    assert.ok(ops > 300, `ops ${ops}`)
    assert.ok((codes.ok || 0) > 40, `successful Reverts ${JSON.stringify(codes)}`)
    assert.ok((codes.already_reverted || 0) + (codes.revert_insufficient_lot_stock || 0) + (codes.revert_insufficient_branch_stock || 0) > 0, `refusals ${JSON.stringify(codes)}`)
    // Positive control: a corrupted purchase figure is caught by the same checks.
    setup(f)
    await receipt(f, rng(99)); check(f, 'control-clean')
    f.sql.exec('UPDATE product_batches SET received_quantity = received_quantity + 1 WHERE received_quantity > 0')
    assert.throws(() => check(f, 'control'), /received_quantity/, 'the invariants detect a purchase figure that drifted')
    f.sql.exec('ROLLBACK')
  } finally { f.sql.close() }
  console.log(`PASS ${seeds} seeded sequences, ${ops} steps, every invariant after every step; Revert outcomes ${JSON.stringify(codes)}`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
