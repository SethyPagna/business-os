#!/usr/bin/env node
// QW3: GET /api/products/filters shares one cache entry across every branch and surface when the request carries no stock or issue term (branchId, branch_id and surface reach the
// vocabulary's SQL only through those terms), and keeps them in the key when one is present. The active promotion list is read per request, outside the cached facets.
//   - Without a stock term the answer is identical with and without a branch (deep equal), and the second request is a cache hit.
//   - With a stock term the answer differs by branch (the second store holds no stock in the base seed) and each branch is its own entry.
//   - Control: the base (the old key, patched back in) misses on the second branch, so the hit is the change and not an accident of the harness.
//
// Run: node scripts/test-products-filters-shared-key-native.cjs
'use strict'

const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')

const OLD_KEY = [{ name: 'old-full-url-key', file: 'src/routes/products.ts', from: 'const filtersQuery = imageOnly ? {} : canonicalFiltersQuery(c.req.query())', to: 'const filtersQuery = imageOnly ? {} : c.req.query()' },
  { name: 'old-url-keeps-branch', file: 'src/routes/products.ts', from: "else for (const name of ['branchId', 'branch_id', 'surface']) if (!(name in filtersQuery)) filtersUrl.searchParams.delete(name)", to: 'else void 0' }]

const filters = async (world, qs, miss = false) => {
  const r = await world.send('GET', `/api/products/filters${qs}`, undefined, { miss })
  assert.equal(r.status, 200, `${qs} ${r.text.slice(0, 200)}`)
  return r
}

async function main() {
  const opts = { tier: 'free', switches: { ic_simple: 'on' } }
  const world = await bootWorld(opts)
  const base = await bootWorld({ ...opts, patches: OLD_KEY })
  try {
    const plain = await filters(world, '', true)
    assert.equal(plain.cache, 'miss')
    assert.ok(plain.json.brands.length > 10 && plain.json.initials.length >= 1, 'a real vocabulary')
    const one = await filters(world, '?branchId=1')
    assert.equal(one.cache, 'hit', 'a branch without a stock term is the same entry')
    assert.deepEqual(one.json, plain.json, 'and the same answer')
    for (const qs of ['?branch_id=2', '?surface=pos', '?branchId=2&surface=inventory']) {
      const r = await filters(world, qs)
      assert.equal(r.cache, 'hit', `${qs} is the same entry`)
      assert.deepEqual(r.json, plain.json, `${qs} answers the same`)
    }
    assert.ok(one.rr < plain.rr * 0.1, `a hit reads far fewer rows (${one.rr} vs ${plain.rr}); the promotion list alone is read`)
    assert.ok(Array.isArray(one.json.promotions), 'the promotion list is in the answer')

    // control: the old key misses on the second branch
    await filters(base, '', true)
    assert.equal((await filters(base, '?branchId=1')).cache, 'miss', 'control: the old key made every branch its own entry')

    // with a stock term the branch matters
    const s1 = await filters(world, '?stockState=in_stock&branchId=1', true)
    const s2 = await filters(world, '?stockState=in_stock&branchId=2', true)
    assert.notDeepEqual(s2.json, s1.json, 'a stock term by branch differs (the second store stocks nothing in the base seed)')
    assert.equal((await filters(world, '?stockState=in_stock&branchId=1')).cache, 'hit', 'each branch is its own entry: its repeat hits')
    assert.deepEqual((await filters(world, '?stockState=in_stock&branchId=1')).json, s1.json)
    assert.deepEqual((await filters(world, '?stockState=in_stock&branchId=2')).json, s2.json, 'and the entries do not mix')
    const issue = await filters(world, '?issueState=out&branchId=1', true)
    assert.equal((await filters(world, '?issueState=out&branchId=2')).cache, 'miss', 'an issue term keeps the branch in the key too')
    assert.ok(issue.json.initials, 'issue read ok')

    console.log(`PASS shared entry across branches and surfaces (miss ${plain.rr} rows, hit ${one.rr} rows); stock and issue terms keep the branch; old key missed`)
  } finally {
    await world.dispose(); await base.dispose()
  }
  process.exit(0)
}
main().catch((error) => { console.error(error); process.exit(1) })
