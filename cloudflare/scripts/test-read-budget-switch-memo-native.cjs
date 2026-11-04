#!/usr/bin/env node
// Re-review F2 (6.0.1045): the ANALYZE pass measures every shape warm on ONE isolate, and the Worker keeps the read switches it last read for 15 s. An ic_simple shape (the switch row is set around
// its request only) that ran within 15 s of the switch-OFF stock-sort shape was therefore measured on the OFF path: 218M rows read under ANALYZE instead of ~0.3M, and a green run proved nothing
// about the ON path. The pass now starts a fresh isolate whenever the switch state a shape needs differs from the one the isolate last read.
//
// This test runs the real pass over the OFF stock-sort shape immediately followed by two ic_simple shapes (without the ANALYZE statistics, which would only make the OFF shape slower: the memo,
// not the statistics, is what is under test) and fails if an ic_simple shape was measured on the OFF path.
'use strict'

const assert = require('node:assert/strict')

process.env.READ_BUDGET_ONLY = '^(inventory-checks-products-stock-sort-ascending|inventory-checks-products-ic-simple-name-page|inventory-checks-products-ic-simple-page-step)$'
const { runGetPass, loadBudgets } = require('./read-budget/runner.cjs')

async function main() {
  const order = [], rows = {}
  const reds = await runGetPass({ analyze: true, analyzeDb: false, label: 'test-read-budget-switch-memo', observe: (shape, m) => { order.push(shape.id); rows[shape.id] = m.warm.rowsRead } })
  assert.deepEqual(order, ['inventory-checks-products-stock-sort-ascending', 'inventory-checks-products-ic-simple-name-page', 'inventory-checks-products-ic-simple-page-step'],
    'the OFF shape runs immediately before the ic_simple shapes')
  const off = rows['inventory-checks-products-stock-sort-ascending']
  const budgets = new Map(loadBudgets().shapes.map((entry) => [entry.id, entry]))
  for (const id of order.slice(1)) {
    const on = rows[id]
    console.log(`${id}: ON path ${on} rows read (the OFF path read ${off}; budget ${budgets.get(id).rows_max_analyze} with ANALYZE)`)
    assert.ok(on * 3 < off, `${id} was measured on the OFF path: ${on} rows read after the OFF shape's ${off}`)
  }
  assert.deepEqual(reds, [], 'no shape is over its budget')
  console.log('PASS an ic_simple shape that follows a switch-OFF shape is measured on the ON path')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
