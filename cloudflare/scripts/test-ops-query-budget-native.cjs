#!/usr/bin/env node
// Every ops/queries/*.sql states what it may read (-- ops:max-rows-read N) and stays under N on the read-budget seed,
// with and without ANALYZE. One query that read 349M rows on the seed could end the Free day by itself, so a query too
// costly to run on Free is listed in REFUSED_ON_FREE and carries -- ops:refused-on-free instead of a number.
'use strict'

const path = require('path')
const { pathToFileURL } = require('url')
const { bootWorld } = require('./read-budget/world.cjs')
const { roundUp } = require('./read-budget/budgets.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
// health-movement-balance-rows.sql read 349,382,402 rows on the seed (140 s) and stk-c-lot-drain-without-movement.sql
// 209,756,641 (224 s), against 5,000,000 reads a day on Free. Rewrite one to a ceiling before it leaves this list.
const REFUSED_ON_FREE = ['health-movement-balance-rows', 'stk-c-lot-drain-without-movement']
// The local runtime has no dbstat table, so this query cannot be measured here. It reads about one row per database page
// (~22,000 pages at 85 MB), so its directive must stay at or under the ceiling below.
const UNMEASURABLE = { 'd1-dbstat-probe': 100000 }

async function main() {
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const names = guard.listQueries()
  const reds = []
  const queries = []
  for (const name of names) {
    try { queries.push(guard.loadQuery(name)) } catch (e) { reds.push(`${name}: ${e.code || e.message}`) }
  }
  for (const q of queries) {
    if (q.refusedOnFree && !REFUSED_ON_FREE.includes(q.name)) reds.push(`${q.name}: marked refused-on-free but not listed in REFUSED_ON_FREE`)
  }
  for (const name of REFUSED_ON_FREE) {
    const q = queries.find((x) => x.name === name)
    if (!q || !q.refusedOnFree) reds.push(`${name}: listed in REFUSED_ON_FREE but the file lacks -- ops:refused-on-free`)
  }
  for (const [name, ceiling] of Object.entries(UNMEASURABLE)) {
    const q = queries.find((x) => x.name === name)
    if (!q || q.refusedOnFree || q.maxRowsRead > ceiling) reds.push(`${name}: unmeasurable query must state -- ops:max-rows-read of at most ${ceiling}`)
  }
  const runnable = queries.filter((q) => !q.refusedOnFree && !(q.name in UNMEASURABLE))
  const world = await bootWorld({ tier: 'free' })
  const rows = new Map()
  try {
    for (const mode of ['without ANALYZE', 'with ANALYZE']) {
      if (mode === 'with ANALYZE') await world.analyze()
      for (const q of runnable) {
        try {
          const read = (await world.db.prepare(q.sql).all()).meta.rows_read
          rows.set(q.name, Math.max(rows.get(q.name) || 0, read))
          if (read > q.maxRowsRead) reds.push(`${q.name}: read ${read} rows ${mode}, budget ${q.maxRowsRead} (-- ops:max-rows-read ${roundUp(read)})`)
        } catch (e) { reds.push(`${q.name}: failed ${mode} on the seed: ${String(e.message).slice(0, 160)}`) }
      }
    }
  } finally { await world.dispose() }
  console.log(`test-ops-query-budget: ${runnable.length} queries measured, ${Object.keys(UNMEASURABLE).length} unmeasurable here, ${REFUSED_ON_FREE.length} refused on Free, ${reds.length} red`)
  for (const line of reds) console.error('RED ' + line)
  if (reds.length) process.exitCode = 1
}

main().catch((e) => { console.error(`test-ops-query-budget: crashed: ${e && e.stack}`); process.exitCode = 1 })
