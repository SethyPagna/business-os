#!/usr/bin/env node
// INV-A S7: what the shared ranked scope is FOR. With catalog_ranked_scope ON and the Cache API answering (the read-budget gate runs every shape with it answering nothing, so a stored ranking is
// never a hit there), a scope is ranked once and every other page of it, a deep page included, reads only that page's rows by key: a deep page is at most 4,000 rows read on the 8.6K-product
// budget world, and runs no ranking statement. The same read with the switch OFF is the control: it re-ranks the catalogue on every page.
//
// Run: node scripts/test-ranked-scope-reads-native.cjs
'use strict'

const assert = require('node:assert/strict')
const { bootWorld, runShape, lastStatements } = require('./read-budget/world.cjs')
const { loadBudgets, getSwitches, prepareWorld } = require('./read-budget/runner.cjs')

const DEEP_PAGE_ROWS_MAX = 4000
const PRODUCTS = (page, extra = '') => `/api/products/search?page=${page}&pageSize=50&searchMode=smart&sort=created_desc&branchId=1&include=branch_stock,images,batches,tagged_lots${extra}`
const IC = (page, extra = '') => `/api/inventory-checks/list?branchId=1&page=${page}&pageSize=50${extra}`
const isRanking = (sql) => /SELECT family_root_id FROM families ORDER BY/.test(String(sql).replace(/[ \t\r\n]+/g, ' '))

async function read(world, url, { cacheMiss }) {
  const r = await runShape(world, { method: 'GET', url }, { cold: true, cacheMiss })
  assert.equal(r.status, 200, `${url} answers`)
  const rankings = (await lastStatements(world)).filter((s) => isRanking(s.sql)).length
  return { rows: r.rowsRead, rankings, total: r.json.total, ids: r.json.items.map((row) => row.id) }
}

async function main() {
  const world = await bootWorld({ tier: 'free', switches: getSwitches(loadBudgets()) })
  try {
    await prepareWorld(world)
    await world.analyze(); await world.restart(); await world.login()

    // control: OFF re-ranks every page, deep or not (the Cache API answering nothing, as the gate runs it)
    const offDeep = await read(world, PRODUCTS(120), { cacheMiss: true })
    assert.equal(offDeep.rankings, 0, 'the OFF path has no ranking statement (it ranks inside its page statement)')
    assert.ok(offDeep.rows > 40000, `control: a deep page with the switch OFF reads the catalogue again (${offDeep.rows} rows)`)

    await world.addSwitches(['catalog_ranked_scope', 'ic_wired'])
    try {
      const first = await read(world, PRODUCTS(1), { cacheMiss: false })
      assert.equal(first.rankings, 1, 'the first read of the scope ranks once')
      const second = await read(world, PRODUCTS(2), { cacheMiss: false })
      assert.equal(second.rankings, 0, 'page 2 ranks nothing')
      assert.ok(second.rows <= DEEP_PAGE_ROWS_MAX, `page 2 reads ${second.rows} rows, at most ${DEEP_PAGE_ROWS_MAX}`)
      const deep = await read(world, PRODUCTS(120), { cacheMiss: false })
      assert.equal(deep.rankings, 0, 'a deep page ranks nothing')
      assert.ok(deep.rows <= DEEP_PAGE_ROWS_MAX, `a deep page reads ${deep.rows} rows, at most ${DEEP_PAGE_ROWS_MAX}`)
      assert.equal(deep.total, first.total, 'and carries the same total')
      assert.ok(deep.ids.length > 0 && !deep.ids.some((id) => first.ids.includes(id)), 'and its own rows')

      // the Inventory list reads the ranking Products stored: its deep page is the same few rows
      const icDeep = await read(world, IC(120, '&summary=0'), { cacheMiss: false })
      assert.equal(icDeep.rankings, 0, 'the Inventory list ranks nothing when Products stored the scope')
      assert.ok(icDeep.rows <= DEEP_PAGE_ROWS_MAX, `an Inventory deep page reads ${icDeep.rows} rows, at most ${DEEP_PAGE_ROWS_MAX}`)
      assert.deepEqual(icDeep.ids, deep.ids, 'the same rows as Products at the same page')
      console.log(`PASS first read ${first.rows} rows (1 ranking); page 2 ${second.rows}; deep page ${deep.rows}; Inventory deep page ${icDeep.rows}; OFF deep page ${offDeep.rows}`)
    } finally { await world.restoreSwitches() }
  } finally { if (world.close) await world.close() }
  process.exit(0)
}
main().catch((error) => { console.error(error); process.exit(1) })
