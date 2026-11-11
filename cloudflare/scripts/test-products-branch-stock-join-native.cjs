#!/usr/bin/env node
// products/search and products/filters join branch_stock (selected_bs) only when the finished SQL reads it. A plain page, a text search and every
// facet read select products columns alone, so the join is rows read for nothing; the stock and issue filters read it and must keep it.
//
// Differential: the same requests against the current Worker and against a world whose source is patched back to the old always-join behaviour
// (the base). Same seed. Every response body must be identical, the joined statements must read at least as many rows, and a plain page must read
// strictly fewer. The positive control moves one product's branch stock and the comparison must see it (a differential that cannot tell is no proof).
//
// Run: node scripts/test-products-branch-stock-join-native.cjs
'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { bootWorld, runShape, lastStatements } = require('./read-budget/world.cjs')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8').replace(/\r\n/g, '\n')
const grab = (re, what) => { const m = re.exec(SRC); assert.ok(m, `source anchor: ${what}`); return m[0] }
const OLD_PATCHES = [
  { name: 'search-always-joins', file: 'src/routes/products.ts', from: grab(/joinsReadBy\(joins, \[PRODUCT_SEARCH_SELECT_SQL[^\n]*?familyMemberWhereSql\]\)/, 'search join pick'), to: 'joins' },
  { name: 'filters-always-join', file: 'src/routes/products.ts', from: grab(/joinsReadBy\(f\.joins, \[[^\n]*?f\.familyMemberWhereSql\]\)/, 'filters join pick'), to: 'f.joins' },
]

const BASE = '&searchMode=smart&sort=name_asc&include=branch_stock,images,family&metadata=0&surface=pos&money_precision_version=1'
const hash = (value) => crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12)
// Two worlds on one seed differ by a few rows of their own bookkeeping (session and rate-limit rows); a joined statement is thousands.
const NOISE_ROWS = 40
const JOIN = /JOIN branch_stock selected_bs ON/
const readsSelected = (sql) => /\bselected_bs\./.test(String(sql).replace(/LEFT JOIN branch_stock selected_bs ON selected_bs\.product_id = p\.id AND selected_bs\.branch_id = \?\d+/g, ''))

const SEARCHES = []
for (const branch of ['', '&branchId=1', '&branchId=2']) {
  for (const stockState of ['', '&stockState=low', '&stockState=out', '&stockState=in_stock', '&stockState=healthy']) {
    for (const issue of ['', '&issueState=out_of_stock', '&issueState=no_image', '&issueState=no_category,out_of_stock']) {
      SEARCHES.push(`/api/products/search?page=1&pageSize=30${branch}${stockState}${issue}${BASE}`)
    }
  }
}
SEARCHES.push(`/api/products/search?page=2&pageSize=30&branchId=1${BASE.replace('name_asc', 'created_desc')}`)
SEARCHES.push(`/api/products/search?page=1&pageSize=30&branchId=1&query=cream${BASE}`)
SEARCHES.push(`/api/products/search?page=1&pageSize=30&branchId=1&query=cream&stockState=out${BASE}`)
const FILTERS = []
for (const stockState of ['', '&stockState=out', '&stockState=low']) {
  for (const issue of ['', '&issueState=no_image', '&issueState=out_of_stock']) {
    FILTERS.push(`/api/products/filters?branchId=1&surface=pos${stockState}${issue}`)
  }
}
FILTERS.push('/api/products/filters', '/api/products/filters?branchId=1&surface=pos&brand=MAC')

async function read(world, url) {
  const r = await runShape(world, { method: 'GET', url }, { cold: false, cacheMiss: true })
  assert.equal(r.status, 200, `${url} answers 200 (${JSON.stringify(r.json).slice(0, 160)})`)
  const statements = await lastStatements(world)
  const readCalls = statements.filter((s) => !/system_flags|telegram_scheduled_sends/.test(s.sql)).length
  return { rows: r.rowsRead, calls: r.calls, readCalls, body: r.json, hash: hash(r.json), statements }
}

async function main() {
  const current = await bootWorld({ tier: 'free', switches: { ic_simple: 'on' } })
  const base = await bootWorld({ tier: 'free', switches: { ic_simple: 'on' }, patches: OLD_PATCHES })
  try {
    let dropped = 0
    let plainPage
    let oldPlainPage
    for (const url of [...SEARCHES, ...FILTERS]) {
      const [now, old] = [await read(current, url), await read(base, url)]
      assert.equal(now.hash, old.hash, `identical response body: ${url}`)
      assert.ok(now.rows <= old.rows + NOISE_ROWS, `${url}: ${now.rows} rows is no more than the always-join ${old.rows}`)
      assert.equal(now.readCalls, old.readCalls, `${url}: the same number of read statements`)
      for (const s of now.statements) {
        const joined = JOIN.test(s.sql)
        const reads = readsSelected(s.sql)
        if (reads) assert.ok(joined, `${url}: a statement reads selected_bs and must keep the join: ${String(s.sql).slice(0, 120)}`)
        if (joined) assert.ok(reads, `${url}: the join is kept only while a fragment reads selected_bs: ${String(s.sql).slice(0, 120)}`)
      }
      if (old.statements.some((st) => JOIN.test(st.sql)) && !now.statements.some((st) => JOIN.test(st.sql))) dropped += 1
      if (url.includes('/search?page=1&pageSize=30&branchId=1&searchMode=smart')) { plainPage = now; oldPlainPage = old }
      const stockFilter = /stockState=(low|out|in_stock|healthy)|issueState=[^&]*out_of_stock/.test(url)
      if (stockFilter && /branchId=\d/.test(url)) assert.ok(now.statements.some((s) => JOIN.test(s.sql)), `${url}: a stock/issue filter on a branch keeps the join`)
      else if (!stockFilter && /branchId=1/.test(url) && !/query=/.test(url)) assert.ok(!now.statements.some((s) => JOIN.test(s.sql)), `${url}: no stock filter, no join`)
    }
    assert.ok(plainPage && oldPlainPage, 'the plain branch page ran')
    assert.ok(plainPage.rows < oldPlainPage.rows * 0.9, `the plain till page reads clearly fewer rows (${plainPage.rows} vs ${oldPlainPage.rows})`)
    assert.ok(dropped >= 8, `the join dropped on many shapes (${dropped})`)

    // positive control: the comparison sees stock. One product's branch stock moves, and the stockState=out answer changes in BOTH worlds, still equal.
    const probe = `/api/products/search?page=1&pageSize=100&branchId=1&stockState=out${BASE}`
    const before = await read(current, probe)
    const target = before.body.items.find((item) => Number(item.stock_quantity) <= 0)
    assert.ok(target, 'the seed has an out-of-stock product at branch 1')
    for (const world of [current, base]) {
      await world.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('stock_transaction_permit', 'legacy-separate-pool-v1')").run()
      await world.db.batch([
        world.db.prepare('UPDATE branch_stock SET quantity = quantity + 50 WHERE branch_id = 1 AND product_id = ?').bind(target.id),
        world.db.prepare('UPDATE products SET stock_quantity = stock_quantity + 50 WHERE id = ?').bind(target.id),
      ])
      await world.db.prepare("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'").run()
    }
    const after = await read(current, probe)
    const afterBase = await read(base, probe)
    assert.notEqual(after.hash, before.hash, 'control: a stock change moves the response the comparison reads')
    assert.equal(after.hash, afterBase.hash, 'and both worlds still agree after it')
    assert.ok(!after.body.items.some((item) => item.id === target.id), 'the restocked product leaves the out-of-stock list')

    console.log(`PASS ${SEARCHES.length} searches + ${FILTERS.length} filters identical to the always-join base; join dropped on ${dropped}; plain till page ${oldPlainPage.rows} -> ${plainPage.rows} rows`)
  } finally {
    await current.dispose()
    await base.dispose()
  }
  process.exit(0)
}
main().catch((error) => { console.error(error); process.exit(1) })
