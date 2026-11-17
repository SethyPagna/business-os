'use strict'
// The census predicate cost_usd_over_4dp (ops/queries/stock-state-census-exactness-20261116.sql): a numeric value whose distance from the nearest
// 4-place figure exceeds 0.000001. cost-4dp lane (owner rule: costs are stored to 4 decimals): every cost-writing flow ends with zero rows over it,
// in products (cost and purchase twin, USD and KHR), lots (unit and received cost) and manual cost entries. History snapshots (sale_items,
// return_items, inventory_movements) are NOT in scope: they keep what was true when they were written.
//
// countsSql: one SELECT returning { products, lots, entries } for an async harness (h.q1(sql)); countOver4dp(db) for a node:sqlite / better-sqlite3 handle.
const assert = require('node:assert/strict')

const over = (c) => `(typeof(${c}) IN ('integer','real') AND ABS(${c} * 10000 - ROUND(${c} * 10000)) > 0.000001)`
const any = (cols) => cols.map(over).join(' OR ')
const PRODUCT_COLUMNS = ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']
const LOT_COLUMNS = ['unit_cost_usd', 'received_cost_usd']
const ENTRY_COLUMNS = ['cost_usd', 'cost_khr', 'previous_cost_usd']

const countsSql = `SELECT (SELECT COUNT(*) FROM products WHERE ${any(PRODUCT_COLUMNS)}) AS products,
  (SELECT COUNT(*) FROM product_batches WHERE ${any(LOT_COLUMNS)}) AS lots,
  (SELECT COUNT(*) FROM product_cost_entries WHERE ${any(ENTRY_COLUMNS)}) AS entries`

function countOver4dp(db) { return { ...db.prepare(countsSql).get() } }

function assertNoCostOver4dp(db, label = 'census') {
  assert.deepEqual(countOver4dp(db), { products: 0, lots: 0, entries: 0 }, `${label}: a stored cost has more than 4 decimals`)
}

module.exports = { countsSql, countOver4dp, assertNoCostOver4dp, PRODUCT_COLUMNS, LOT_COLUMNS, ENTRY_COLUMNS }
