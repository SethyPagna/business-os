// RET-A riel row (owner 29 Sep 2026: refunds record the currency they were
// paid in, reports add a riel row; verifier 6 Oct: the riel actually paid out,
// not a converted equivalent).
//
// The real report kernel (getSalesTotals) over the full migrated schema
// reports refund_paid_khr, and it is the shift drawer's own riel figure
// (REFUND_DRAWER_KHR_SQL) over the same refunds -- the kernel restates that
// arithmetic because shiftReconciliation imports it, so this pins the two.
//   R1  riel refund, $4 = 16,000 riel, nothing lowered     16,000 out
//   R2  riel refund on a debt sale, $3 of $4 lowered        4,000 out
//   R3  dollar refund                                       0
//   R4  riel refund recorded before 0234 (no currency)      0 (it was dollars)
//   R5  cancelled riel refund                               0
//   R6  riel refund on a cancelled sale                     0
//   R7  supplier return in riel                             0
// Discriminating: the previous kernel sent no refund_paid_khr at all.
//
// Run (from cloudflare/): node scripts/test-report-refund-riel-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformSync } = require('esbuild')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const cache = new Map()
function load(file, overrides = {}) {
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }; cache.set(file, mod)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)((id) => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(file), id)
      return load(target.endsWith('.ts') ? target : `${target}.ts`, overrides)
    }
    return require(id)
  }, mod, mod.exports)
  return mod.exports
}

async function main() {
  const db = openDb(loadAll())
  db.exec(`
    INSERT INTO branches(id, name, is_active) VALUES (1, 'Shop', 1);
    INSERT INTO sales(id, receipt_number, branch_id, branch_name, created_at, subtotal_usd, total_usd, amount_paid_usd, amount_paid_khr,
      exchange_rate, sale_status, status_before_return) VALUES
      (1, 'S1', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 10, 0, 4000, 'partial_return', 'completed'),
      (2, 'S2', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 7, 0, 4000, 'partial_return', 'awaiting_payment'),
      (3, 'S3', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 10, 0, 4000, 'partial_return', 'completed'),
      (6, 'S6', 1, 'Shop', '2026-09-20 03:00:00', 10, 10, 10, 0, 4000, 'cancelled', NULL);
    INSERT INTO returns(id, return_number, sale_id, branch_id, cashier_id, return_scope, reason, total_refund_usd, total_refund_khr,
      exchange_rate, status, created_at, refund_currency, owed_reduction_usd) VALUES
      (1, 'R1', 1, 1, 7, 'customer', 'x', 4, 16000, 4000, 'completed', '2026-09-20 05:00:00', 'KHR', 0),
      (2, 'R2', 2, 1, 7, 'customer', 'x', 4, 16000, 4000, 'completed', '2026-09-20 05:00:00', 'KHR', 3),
      (3, 'R3', 3, 1, 7, 'customer', 'x', 4, 16000, 4000, 'completed', '2026-09-20 05:00:00', 'USD', 0),
      (4, 'R4', 3, 1, 7, 'customer', 'x', 1, 4000, 4000, 'completed', '2026-09-20 05:00:00', NULL, 0),
      (5, 'R5', 1, 1, 7, 'customer', 'x', 2, 8000, 4000, 'cancelled', '2026-09-20 05:00:00', 'KHR', 0),
      (6, 'R6', 6, 1, 7, 'customer', 'x', 4, 16000, 4000, 'completed', '2026-09-20 05:00:00', 'KHR', 0),
      (7, 'R7', 1, 1, 7, 'supplier', 'x', 2, 8000, 4000, 'completed', '2026-09-20 05:00:00', 'KHR', 0);
  `)
  const kernel = load(path.join(root, 'src/lib/salesAnalytics.ts'), { './db': { getDb: () => db } })
  const shift = load(path.join(root, 'src/lib/shiftReconciliation.ts'), { './db': { getDb: () => db } })

  const totals = await kernel.getSalesTotals({}, { startDate: '2026-09-20', endDate: '2026-09-20' })
  assert.equal(totals.refund_paid_khr, 20000, 'riel actually paid out: 16,000 + 4,000')
  assert.equal(totals.refund_usd, 13, 'control: the dollar refund figure is unchanged ($4 + $4 + $4 + $1)')

  const drawer = db.db.prepare(`SELECT COALESCE(SUM(${shift.REFUND_DRAWER_KHR_SQL}), 0) AS khr FROM returns
    WHERE COALESCE(returns.status, 'completed') <> 'cancelled' AND COALESCE(returns.return_scope, 'customer') = 'customer'
      AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = returns.sale_id AND COALESCE(NULLIF(s.sale_status, ''), 'completed') = 'cancelled')`).get().khr
  assert.equal(totals.refund_paid_khr, drawer, 'the report and the shift drawer read the same riel')
  console.log('PASS the report kernel reports the riel refunds paid out, equal to the shift drawer\'s riel')

  const shared = kernel.salesTotalsFromSnapshot(await kernel.readSalesReportSnapshot({}, { startDate: '2026-09-20', endDate: '2026-09-20' }))
  assert.equal(shared.refund_paid_khr, 20000, 'the shared-snapshot reducer agrees')
  const empty = await kernel.getSalesTotals({}, { startDate: '2026-09-21', endDate: '2026-09-21' })
  assert.equal(empty.refund_paid_khr, 0, 'a window without refunds reads 0')
  console.log('PASS every totals path carries it; an empty window reads 0')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
