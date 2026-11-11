#!/usr/bin/env node
// REVIEW d1-money #1, M1: the CAST plan check of test-sale-stock-read-branch-cast-pure.cjs passed on base too (one product, where the planner seeks either way).
// With the read-budget seed's own statistics (what production's planner sees) the OLD form `branch_id = ?` walks the branch's whole covering index from two products up
// (8,653 rows for a 2-line sale), and the shipped `+branch_id = CAST(? AS INTEGER)` seeks by product (4 rows per product). This test takes the statement text FROM the route
// source (checkout and add-lines), plans and runs it at n = 1, 2, 10 and 50 products on that seed, and requires the old form to be red at n >= 2 (the control).
// Run (from cloudflare/): node scripts/test-sale-stock-read-plan-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { bootWorld } = require('./read-budget/world.cjs')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8').replace(/\r\n/g, '\n')
const reads = [...source.matchAll(/SELECT product_id, quantity FROM branch_stock WHERE (\+branch_id = CAST\(\? AS INTEGER\)) AND product_id IN/g)]
const COVERING = /COVERING INDEX idx_branch_stock_branch_qty_product_pg/

;(async () => {
  assert.equal(reads.length, 2, 'checkout and add-lines each read branch_stock with the CAST form (found ' + reads.length + ')')
  const world = await bootWorld({ tier: 'free' })
  const problems = []
  try {
    for (const n of [1, 2, 10, 50]) {
      const ids = (await world.all('SELECT product_id FROM branch_stock WHERE branch_id=1 ORDER BY product_id LIMIT ?', n)).map((r) => r.product_id)
      const run = async (clause, branchBind) => {
        const sql = `SELECT product_id, quantity FROM branch_stock WHERE ${clause} AND product_id IN (${ids.map(() => '?').join(',')})`
        const plan = (await world.all('EXPLAIN QUERY PLAN ' + sql, branchBind, ...ids)).map((r) => r.detail).join(' | ')
        const res = await world.db.prepare(sql).bind(branchBind, ...ids).all()
        return { plan, rows: res.meta.rows_read, found: res.results.length }
      }
      const shipped = await run(reads[0][1], 1)
      const shippedText = await run(reads[0][1], '1') // a TEXT-bound id must still find the rows
      const old = await run('branch_stock.branch_id = ?', 1)
      console.log(`n=${String(n).padStart(2)}  shipped ${shipped.rows} rows (${shipped.found} found)   text-bound ${shippedText.rows} rows (${shippedText.found} found)   old form ${old.rows} rows`)
      const t = (name, ok, detail) => { if (!ok) problems.push(`n=${n} ${name}: ${detail}`) }
      t('shipped seeks by product', /idx_branch_stock_product_branch_unique/.test(shipped.plan) && !COVERING.test(shipped.plan), shipped.plan)
      t('shipped reads about 4 rows per product', shipped.rows <= 4 * n + 4, String(shipped.rows))
      t('a TEXT-bound branch id finds the same rows', shippedText.found === shipped.found && shipped.found === n, `${shippedText.found} vs ${shipped.found}`)
      if (n >= 2) t('REQUIRED RED: the old form `branch_id = ?` walks the covering index', COVERING.test(old.plan) && old.rows > 1000, `${old.plan} / ${old.rows}`)
    }
  } finally { await world.dispose() }
  if (problems.length) { console.error('RED\n  ' + problems.join('\n  ')); process.exit(1) }
  console.log('all green')
})().catch((e) => { console.error(e); process.exit(1) })
