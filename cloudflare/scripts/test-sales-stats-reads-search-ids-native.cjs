#!/usr/bin/env node
// lane/sales-stats-reads items 1, 2 and 3 (audit #1, #9).
//   1. GET /api/sales/stats resolves the sales a search matches ONCE (resolveReportScopeIds, called by readSalesHeaderTotals through readSalesReportTotalsPinned) and the report tests `id IN json_each(ids)`,
//      instead of re-running the text match in every page, group and pass. A match of more than REPORT_SCOPE_IDS_MAX sales keeps the subquery scope (exact, never cut).
//   2. GET /api/sales/stats takes the list's own `id=` filter, so a link to one sale reads its totals by id (the cohort is found by one primary-key seek).
//   3. A typed receipt number matches by LIKE across every column and every line, so an exact-receipt fast path would change the result set: proven below with a
//      sale whose notes and another receipt contain the typed text.
// ORACLE: the same Worker with the change patched back out (the subquery scope for every request; the list's inline id block). Every answer must be
// byte-identical to the oracle for every search, window, status, switch state; the rows fewer; each mutant CAUGHT.
'use strict'
// The oracle re-runs the text match in every statement (a million rows per request): a parity test, not a timing gate.
process.env.READ_BUDGET_DEADLINE_MS ||= '240000'
const assert = require('node:assert/strict')
const { bootWorld, explain } = require('./read-budget/world.cjs')
const { ATOMIC, applyFixture, day, runUrls, bodies, step, log, finish } = require('./sales-stats-reads-harness.cjs')

const SALES = 'src/routes/sales.ts'
const KERNEL = 'src/lib/salesAnalytics.ts'
const RESOLVE = 'const pinned = await resolveReportScopeIds(env, scalarScope)'
const NO_RESOLVE = 'const pinned = { scope: scalarScope, ids: null }'
const LIST_ID = '  if (query.id) pushSaleIdFilter(where, params, parseSaleIdFilter(query.id))'
const LIST_ID_OLD = `  if (query.id) {
    const ids = String(query.id).split(',').map((v) => v.trim()).filter(Boolean).map((v) => Number(v)).filter((v) => Number.isFinite(v))
    if (ids.length === 1) {
      where.push('s.id = @saleId')
      params.saleId = ids[0]
    } else if (ids.length > 1) {
      const keys = ids.map((id, index) => {
        const key = \`saleId\${index}\`
        params[key] = id
        return \`@\${key}\`
      })
      where.push(\`s.id IN (\${keys.join(', ')})\`)
    }
  }`
const OLD = [
  { name: 'old-resolve', file: KERNEL, from: RESOLVE, to: NO_RESOLVE },
  { name: 'old-list-id', file: SALES, from: LIST_ID, to: LIST_ID_OLD },
]
// A tiny cap forces the fallback on the seed (15,800 sales is far below the real cap): the same searches, ids when they fit, the exact subquery when they do not.
const CAP_ROWS = { name: 'cap-rows', file: KERNEL, from: 'export const REPORT_SCOPE_IDS_MAX = 50_000', to: 'export const REPORT_SCOPE_IDS_MAX = 40' }
const CAP_BYTES = { name: 'cap-bytes', file: KERNEL, from: 'export const REPORT_SCOPE_IDS_MAX_BYTES = 800_000', to: 'export const REPORT_SCOPE_IDS_MAX_BYTES = 400' }
const MUTANTS = {
  silentTruncation: [
    CAP_ROWS,
    { name: 'm-trunc-guard', file: KERNEL, from: '  if (rows.length > REPORT_SCOPE_IDS_MAX) return unresolved', to: '  if (false) return unresolved' },
    { name: 'm-trunc-slice', file: KERNEL, from: '  const ids = rows.map((row) => Number(row.id))', to: '  const ids = rows.slice(0, REPORT_SCOPE_IDS_MAX).map((row) => Number(row.id))' },
  ],
  // every id page carries the whole list again (page k scans and seeks all N ids: quadratic in the match) / a page's slice that loses an id
  idsNotPaged: [{ name: 'm-unpaged', file: KERNEL, from: 'const REPORT_SALE_ID_ORDER = /^\\+?s\\.id$/', to: 'const REPORT_SALE_ID_ORDER = /^never$/' }],
  sliceDropsAnId: [{ name: 'm-slice-short', file: KERNEL, from: 'JSON.stringify(ids.slice(start, end))', to: 'JSON.stringify(ids.slice(start, end - 1))' }],
  // every list scope resolved, a status-only filter included (two resolves it cannot repay)
  resolvesEveryFilter: [{ name: 'm-gate', file: KERNEL, from: 'if (!LIST_SCOPE_TEXT_SEARCH.test(subquery[1])) return unresolved', to: '' }],
  keepsOneId: [{ name: 'm-one-id', file: KERNEL, from: '`${subquery[1]} LIMIT @reportScopeLimit`', to: '`${subquery[1]} LIMIT @reportScopeLimit - @reportScopeLimit + 1`' }],
  emptyMatchIsNoFilter: [{ name: 'm-empty', file: KERNEL, from: '  if (ids.some((id) => !Number.isSafeInteger(id))) return unresolved', to: '  if (ids.some((id) => !Number.isSafeInteger(id))) return unresolved\n  if (!ids.length) return { scope: undefined, ids: null }' }],
  resolverIgnoresTheScope: [{ name: 'm-resolve-none', file: KERNEL, from: RESOLVE, to: 'const pinned = { scope: undefined, ids: null }' }],
  idScopeNotAtomic: [{ name: 'm-atomic', file: KERNEL, from: "  'JSON_EACH',", to: "  'LENGTH'," }],
  // (anchors are one line: the patcher reads the CRLF files verbatim)
  idFilterDropped: [{ name: 'm-no-id', file: SALES, from: '  pushSaleIdFilter(where, params, saleIds)', to: '' }],
}

// The rows the seed lacks for item 3: a receipt typed in full is also inside another sale's notes and is the start of another receipt.
async function prepare(world) {
  const recent = (await world.all('SELECT id FROM sales ORDER BY id DESC LIMIT 1 OFFSET 200')).map((r) => r.id)
  world.fx = { a: recent[0] }
  const ids = (await world.all('SELECT id FROM sales WHERE id < ? ORDER BY id DESC LIMIT 3', world.fx.a)).map((r) => r.id)
  world.fx = { a: ids[0], b: ids[1], c: ids[2] }
  await world.db.prepare("UPDATE sales SET receipt_number='ZZ-1000', search_normalized='zz-1000' WHERE id=?").bind(world.fx.a).run()
  await world.db.prepare("UPDATE sales SET notes='see ZZ-1000 for the original' WHERE id=?").bind(world.fx.b).run()
  await world.db.prepare("UPDATE sales SET receipt_number='ZZ-10001', search_normalized='zz-10001' WHERE id=?").bind(world.fx.c).run()
}

const enc = encodeURIComponent
async function urls(ctx, world) {
  const w = (a, b) => `startDate=${day(ctx, a)}&endDate=${day(ctx, b)}`
  const one = async (sql, ...v) => (await world.all(sql, ...v))[0]
  const recentReceipt = (await one('SELECT receipt_number r FROM sales WHERE id >= (SELECT MAX(id) FROM sales) - 60 AND receipt_number LIKE ? ORDER BY id DESC LIMIT 1', 'R%')).r
  const product = (await one('SELECT product_name n FROM sale_items WHERE sale_id = (SELECT MAX(id) FROM sales WHERE id < ?) AND product_name IS NOT NULL LIMIT 1', world.fx.a)).n
  const searches = {
    'receipt exact': recentReceipt,
    'receipt prefix': recentReceipt.slice(0, 5),
    'customer name': 'Customer 12',
    'customer broad': 'Customer',
    'every receipt': 'R0',
    'product name': product,
    'product word': product.split(/\s+/)[0],
    'phone full': '0000000012',
    'phone part': '000000001',
    'khmer': 'សុខា',
    'khmer two words': 'សុខា ចាន់',
    'latin folded': 'zed quux',
    'latin part': 'quux',
    'no match': 'zzzzqq',
    'receipt typed in notes': 'ZZ-1000',
    'two words': 'Customer 12 ABA',
  }
  const out = {}
  const windows = { 'all-time': '', 'today': w(1, 0), '30d': w(29, 0) }
  for (const [sname, text] of Object.entries(searches)) {
    for (const [wname, q] of Object.entries(windows)) out[`stats ${sname} | ${wname}`] = `/api/sales/stats?${q ? q + '&' : ''}search=${enc(text)}`
  }
  out['stats customer name | start-only'] = `/api/sales/stats?startDate=${day(ctx, 10)}&search=${enc('Customer 12')}`
  out['stats customer name | end-only'] = `/api/sales/stats?endDate=${day(ctx, 10)}&search=${enc('Customer 12')}`
  out['stats khmer | start-only'] = `/api/sales/stats?startDate=${day(ctx, 10)}&search=${enc('សុខា')}`
  out['stats OR | all-time'] = `/api/sales/stats?search=${enc('zed សុខា')}&searchMode=OR`
  out['stats customer + cancelled'] = `/api/sales/stats?${w(29, 0)}&status=cancelled&search=${enc('Customer 12')}`
  out['stats customer + completed'] = `/api/sales/stats?status=completed&search=${enc('Customer 12')}`
  out['stats customer + branch 2'] = `/api/sales/stats?branchId=2&search=${enc('Customer 12')}`
  out['stats customer + cashier'] = `/api/sales/stats?cashier=Budget&search=${enc('Customer 12')}`
  out['stats customer + cashier none'] = `/api/sales/stats?cashier=zzzz&search=${enc('Customer 12')}`
  out['stats no search + cashier'] = `/api/sales/stats?cashier=Budget`
  out['stats status only'] = `/api/sales/stats?status=cancelled`
  out['stats window only'] = `/api/sales/stats?${w(29, 0)}`
  return { out, searches, recentReceipt }
}
const flatUrls = (ctx, world) => urls(ctx, world).then((r) => r.out)

// the id shapes: new-only (the oracle has no id filter on /stats)
async function idUrls(ctx, world) {
  const w = (a, b) => `startDate=${day(ctx, a)}&endDate=${day(ctx, b)}`
  const ids = (await world.all('SELECT id, receipt_number r FROM sales WHERE created_at >= datetime(?, \'-30 hours\') ORDER BY id DESC LIMIT 4', ctx.anchor))
  const [x, y, z] = ids
  const out = {
    'stats id': `/api/sales/stats?id=${x.id}`,
    'stats id | today': `/api/sales/stats?id=${x.id}&${w(1, 0)}`,
    'stats id | window excludes it': `/api/sales/stats?id=${x.id}&startDate=${day(ctx, 100)}&endDate=${day(ctx, 90)}`,
    'stats id | start-only': `/api/sales/stats?id=${x.id}&startDate=${day(ctx, 10)}`,
    'stats id | end-only': `/api/sales/stats?id=${x.id}&endDate=${day(ctx, 0)}`,
    'stats id list': `/api/sales/stats?id=${x.id},${y.id},${z.id}`,
    'stats id list with junk': `/api/sales/stats?id=${x.id},abc,${y.id},,`,
    'stats id junk only': `/api/sales/stats?id=abc`,
    'stats id fraction': `/api/sales/stats?id=${x.id}.5`,
    'stats id missing': `/api/sales/stats?id=999999999`,
    'stats id + status mismatch': `/api/sales/stats?id=${x.id}&status=cancelled`,
    'stats id + cashier none': `/api/sales/stats?id=${x.id}&cashier=zzzz`,
    'stats id + cashier': `/api/sales/stats?id=${x.id}&cashier=Budget`,
    'stats id + search of another receipt': `/api/sales/stats?id=${x.id}&search=${enc(y.r)}`,
    'stats id + search of itself': `/api/sales/stats?id=${x.id}&search=${enc(x.r)}`,
    'stats id + branch 2': `/api/sales/stats?id=${x.id}&branchId=2`,
    'stats id + branch 1': `/api/sales/stats?id=${x.id}&branchId=1`,
    'list id': `/api/sales?id=${x.id}&limit=5`,
    'list id list': `/api/sales?id=${x.id},${y.id},${z.id}&limit=5`,
    'list id junk': `/api/sales?id=abc&limit=3`,
    'list id fraction': `/api/sales?id=${x.id}.5&limit=3`,
    'list id + search': `/api/sales?id=${x.id}&search=${enc(x.r)}&limit=3`,
    // the oracle's own answers for the same sales, found the old way: the receipt typed as an all-time search
    'oracle x': `/api/sales/stats?search=${enc(x.r)}`,
    'oracle y': `/api/sales/stats?search=${enc(y.r)}`,
    'oracle z': `/api/sales/stats?search=${enc(z.r)}`,
    'oracle none': `/api/sales/stats`,
  }
  world.idShapes = { x, y, z }
  return out
}

// A match that is nearly the whole of a narrow window pays for its two resolves (2R) and saves little (4(R-N) on the sale pages, N ids against a window scan of R ~ 1.6N): the net 2R-4N is
// 5-7% of a 15K-row read on the seed ("Customer" over 30d: 15,831 -> 16,667; every receipt: 14,115 -> 15,037), and 30% under the pre-lane route. Every other shape, and every unwindowed broad match, must read no more than the oracle.
const WINDOWED_BROAD = /(customer broad|every receipt|receipt prefix) \| (30d|today)$/
const WINDOWED_BROAD_PRICE = 1.08
const NO_TEXT = /^stats (no search|status only)/
const MUTANT_SHAPES = [
  'stats customer name | all-time', 'stats customer name | 30d', 'stats product name | today', 'stats khmer | all-time', 'stats latin folded | all-time', 'stats no match | all-time',
  'stats no match | 30d', 'stats receipt exact | all-time', 'stats customer broad | all-time', 'stats OR | all-time', 'stats customer + cashier none',
  'stats customer + branch 2', 'stats status only', 'stats customer name | start-only',
]
const pick = (res, names) => Object.fromEntries(names.map((n) => [n, res[n]]))

;(async () => {
  // ---------------------------------------------------------------- item 3 (the receipt fast path would change the result set)
  await step('item 3: a typed receipt number matches more than the sale that carries it, so an exact-receipt fast path would change the answer', async () => {
    const world = await bootWorld({ tier: 'free' })
    try {
      await applyFixture(world)
      await prepare(world)
      const r = await world.send('GET', '/api/sales?search=ZZ-1000&limit=50', undefined, { miss: true })
      assert.equal(r.status, 200)
      const got = r.json.map((s) => s.id).sort((p, q) => p - q)
      const expected = [world.fx.a, world.fx.b, world.fx.c].sort((p, q) => p - q)
      assert.deepEqual(got, expected, 'the LIKE search returns the sale with that receipt, the sale whose notes contain it and the longer receipt that starts with it')
      const exact = await world.all("SELECT id FROM sales WHERE receipt_number = 'ZZ-1000'")
      assert.deepEqual(exact.map((s) => s.id), [world.fx.a], 'the exact-receipt lookup (idx_sales_receipt_number) finds one sale: a different set')
      const plan = (await world.all("EXPLAIN QUERY PLAN SELECT id FROM sales WHERE receipt_number = 'ZZ-1000'")).map((p) => p.detail).join(' | ')
      assert.match(plan, /idx_sales_receipt_number/, 'the index exists and serves the exact lookup; it just cannot serve the LIKE set')
      const stats = await world.send('GET', '/api/sales/stats?search=ZZ-1000', undefined, { miss: true })
      assert.equal(JSON.parse(stats.text).total_count, 3, 'the totals count all three, as the list does')
    } finally { await world.dispose() }
  })

  // ---------------------------------------------------------------- item 1 (parity with the oracle)
  const opts = { urls: flatUrls, prepare }
  const oldOff = await runUrls({ ...opts, patches: OLD })
  const newOff = await runUrls({ ...opts, regimes: true })
  const oldOn = await runUrls({ ...opts, patches: OLD, switches: ATOMIC })
  const newOn = await runUrls({ ...opts, switches: ATOMIC, regimes: true })
  const NAMES = Object.keys(newOff)
  const SEARCH_NAMES = NAMES.filter((n) => /search|\| |customer \+|OR/.test(n) && !/^stats (no search|status only|window only)/.test(n))
  for (const [mode, o, n] of [['OFF', oldOff, newOff], ['ON', oldOn, newOn]]) {
    await step(`parity (report_atomic ${mode}): every search x window x filter answers byte-identically to the oracle`, () => assert.deepEqual(bodies(n), bodies(o)))
    await step(`calls (report_atomic ${mode}): at most three more calls than the oracle (the id statement before and after the read; the oracle's own call count moves by one with the isolate's cold probes)`, () => {
      for (const name of NAMES) assert.ok(n[name].calls <= o[name].calls + 3, `${name}: calls ${n[name].calls} > ${o[name].calls} + 3`)
    })
  }
  await step('the build answers the same on report_atomic OFF and ON', () => assert.deepEqual(bodies(newOn), bodies(newOff)))

  await step('regime: with the real cap every filtered request resolves to an id list (never the subquery); a window-only request carries no scope', () => {
    for (const res of [newOff, newOn]) {
      for (const name of NAMES) {
        if (name === 'stats window only') assert.ok(!res[name].ids && !res[name].subquery, name + ' must carry no scope')
        else if (NO_TEXT.test(name)) assert.ok(res[name].subquery && !res[name].ids, name + ' has no typed search: an index serves its filter in every statement, so it keeps the subquery (two resolves would only add rows)')
        else assert.ok(res[name].ids && !res[name].subquery, name + ' must read through the resolved id list')
      }
    }
  })

  await step('rows: every filtered request reads fewer rows than the oracle, and the searches far fewer', () => {
    for (const [o, n] of [[oldOff, newOff], [oldOn, newOn]]) {
      for (const name of SEARCH_NAMES) assert.ok(n[name].rr <= o[name].rr * (WINDOWED_BROAD.test(name) ? WINDOWED_BROAD_PRICE : 1), `${name}: rows ${n[name].rr} > ${o[name].rr}`)
      for (const name of ['stats customer name | all-time', 'stats customer name | 30d', 'stats product name | all-time', 'stats khmer | all-time', 'stats latin folded | all-time', 'stats no match | all-time', 'stats receipt exact | all-time', 'stats phone full | all-time']) {
        assert.ok(n[name].rr < o[name].rr * 0.6, `${name}: expected well under the oracle (${n[name].rr} vs ${o[name].rr})`)
      }
    }
  })
  log('rows/calls oracle -> build (report_atomic OFF | ON):')
  for (const name of NAMES.filter((n) => /\| (all-time|30d|today)$/.test(n) && /customer name|product name|receipt exact|no match|customer broad|khmer \|/.test(n))) {
    log(`   ${name.padEnd(42)} OFF ${oldOff[name].rr}/${oldOff[name].calls} -> ${newOff[name].rr}/${newOff[name].calls}   ON ${oldOn[name].rr}/${oldOn[name].calls} -> ${newOn[name].rr}/${newOn[name].calls}`)
  }

  // ---------------------------------------------------------------- item 2 (the exact id filter on /stats)
  const idsOff = await runUrls({ urls: idUrls, prepare: async (world) => { await prepare(world) }, regimes: true, patches: [] })
  const idsOn = await runUrls({ urls: idUrls, prepare, switches: ATOMIC, regimes: true })
  const idsOldList = await runUrls({ urls: idUrls, prepare, patches: OLD.filter((p) => p.name === 'old-list-id') })
  const total = (res, name) => JSON.parse(res[name].text)
  await step('item 2: the id filter on /stats equals the old route answering the receipt as an all-time search, for each sale', () => {
    // 'stats id' for x, and the same sale found the old way
    assert.deepEqual(total(idsOff, 'stats id'), total(idsOff, 'oracle x'), 'one sale by id == its receipt typed as a search (the old, expensive link)')
    assert.equal(total(idsOff, 'stats id').total_count, 1)
    assert.equal(total(idsOff, 'stats id list').total_count, 3)
    assert.equal(total(idsOff, 'stats id list with junk').total_count, 2, 'a value that is not a number is skipped, exactly as the list skips it')
    assert.equal(total(idsOff, 'stats id junk only').total_count, total(idsOff, 'oracle none').total_count, 'no usable id = no id filter (as the list)')
    assert.equal(total(idsOff, 'stats id fraction').total_count, 0, 'a fraction names no sale')
    assert.equal(total(idsOff, 'stats id missing').total_count, 0)
    assert.equal(total(idsOff, 'stats id | window excludes it').total_count, 0, 'the window still applies on top of the id')
    assert.equal(total(idsOff, 'stats id | today').total_count, 1)
    assert.equal(total(idsOff, 'stats id | start-only').total_count, 1)
    assert.equal(total(idsOff, 'stats id | end-only').total_count, 1)
    assert.equal(total(idsOff, 'stats id + status mismatch').total_count, 0, 'every other filter still ANDs with the id (the fast path applies only with nothing but the window beside it)')
    assert.equal(total(idsOff, 'stats id + cashier none').total_count, 0)
    assert.equal(total(idsOff, 'stats id + cashier').total_count, 1)
    assert.equal(total(idsOff, 'stats id + search of another receipt').total_count, 0)
    assert.equal(total(idsOff, 'stats id + search of itself').total_count, 1)
    assert.equal(total(idsOff, 'stats id + branch 2').total_count + total(idsOff, 'stats id + branch 1').total_count, 1, 'the sale is in exactly one branch (or has a line there)')
    // the list and the totals describe the same sales
    const list = (name) => JSON.parse(idsOff[name].text).map((s) => s.id).sort((p, q) => p - q)
    assert.equal(list('list id').length, 1)
    assert.equal(list('list id list').length, 3)
    assert.equal(list('list id list').length, total(idsOff, 'stats id list').total_count)
    assert.deepEqual(list('list id junk').length > 1, true)
    assert.equal(list('list id fraction').length, 0)
    assert.equal(list('list id + search').length, 1)
    // the sum of the three singles is the three together
    const sum = [oneOf(idsOff, 'oracle x'), oneOf(idsOff, 'oracle y'), oneOf(idsOff, 'oracle z')].reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - Number(total(idsOff, 'stats id list').revenue_usd)) < 0.005, 'revenue of three sales == the sum of their singles')
  })
  function oneOf(res, name) { return Number(JSON.parse(res[name].text).revenue_usd) }
  await step('item 2: the id request is cheap (one primary-key seek finds the cohort), on both switch states', () => {
    for (const res of [idsOff, idsOn]) {
      assert.ok(res['stats id'].rr < res['oracle x'].rr / 20, `by id ${res['stats id'].rr} rows vs the receipt as a search ${res['oracle x'].rr}`)
      assert.ok(res['stats id'].rr < 3000, 'the id filter is one primary-key seek per statement (no resolve is needed for it)')
      assert.ok(res['stats id + search of itself'].ids, 'with another filter the cohort is resolved (still an id list)')
    }
    // one primary-key seek finds the cohort; nothing else over the unfiltered totals
    assert.ok(idsOff['stats id'].calls <= idsOff['oracle none'].calls + 2, 'id only: at most the statement that finds the cohort before and after the read')
  })
  await step('item 2: the id filter answers the same with report_atomic ON and OFF', () => assert.deepEqual(bodies(pickIds(idsOn)), bodies(pickIds(idsOff))))
  function pickIds(res) { return Object.fromEntries(Object.entries(res).filter(([k]) => !/^oracle/.test(k))) }
  await step('item 2: the list\'s id filter is unchanged by sharing it with /stats (byte-identical to the old inline block)', () => {
    for (const name of Object.keys(idsOff).filter((n) => n.startsWith('list '))) assert.equal(idsOff[name].text, idsOldList[name].text, name)
  })

  // ---------------------------------------------------------------- the cap: a longer match keeps the exact subquery and is never cut
  const subset = (names) => async (ctx, world) => pick(await flatUrls(ctx, world), names)
  const CAP_SHAPES = [...MUTANT_SHAPES, 'stats customer broad | 30d', 'stats product word | 30d', 'stats latin part | all-time', 'stats receipt typed in notes | all-time']
  for (const [label, cap, kind] of [['rows', [CAP_ROWS], 'REPORT_SCOPE_IDS_MAX (40 ids)'], ['bytes', [CAP_BYTES], 'REPORT_SCOPE_IDS_MAX_BYTES (400 bytes)']]) {
    const res = await runUrls({ urls: subset(CAP_SHAPES), patches: cap, regimes: true, prepare })
    await step(`cap (${kind}): searches over the cap keep the subquery, the rest use ids, and every answer is byte-identical to the oracle`, () => {
      assert.deepEqual(bodies(res), bodies(pick(oldOff, CAP_SHAPES)))
      const ids = CAP_SHAPES.filter((n) => res[n].ids), sub = CAP_SHAPES.filter((n) => res[n].subquery)
      assert.ok(ids.length >= 3, 'some search must still fit under the cap: ' + ids.join('; '))
      assert.ok(sub.length >= 3, 'some search must exceed the cap and fall back: ' + sub.join('; '))
      assert.ok(CAP_SHAPES.every((n) => res[n].ids !== res[n].subquery), 'each request carries exactly one scope kind')
      for (const n of sub) assert.ok(res[n].rr <= oldOff[n].rr * 1.2 + 200000, `${n}: the fallback costs the oracle's rows plus one bounded id read (${res[n].rr} vs ${oldOff[n].rr})`)
    })
  }

  await step('no typed search: a status or cashier filter reads exactly what the oracle reads (no resolve is spent on it)', () => {
    for (const [n, o] of [[newOff, oldOff], [newOn, oldOn]]) for (const name of ['stats status only', 'stats no search + cashier']) assert.ok(n[name].rr <= o[name].rr + 12, `${name}: rows ${n[name].rr} > oracle ${o[name].rr}`)
  })

  // ---------------------------------------------------------------- near the cap: the broad matches (about 15,800 of 15,800 sales) with the cap just above them
  // A resolved list is paged by its cursor, so a match near the cap reads linearly (one walk over the ids), never more than the subquery it replaces.
  const NEAR_CAP = { name: 'cap-near', file: KERNEL, from: 'export const REPORT_SCOPE_IDS_MAX = 50_000', to: 'export const REPORT_SCOPE_IDS_MAX = 16_000' }
  const BROAD = ['stats customer broad | all-time', 'stats customer broad | 30d', 'stats every receipt | all-time', 'stats every receipt | 30d', 'stats receipt prefix | all-time']
  const nearOff = await runUrls({ urls: subset(BROAD), patches: [NEAR_CAP], regimes: true, prepare })
  const nearOn = await runUrls({ urls: subset(BROAD), patches: [NEAR_CAP], regimes: true, prepare, switches: ATOMIC })
  await step('near the cap: a broad match under it reads through the id list, answers like the oracle and reads no more rows than the oracle (OFF and ON)', () => {
    for (const [res, o] of [[nearOff, oldOff], [nearOn, oldOn]]) {
      assert.deepEqual(bodies(res), bodies(pick(o, BROAD)))
      for (const name of BROAD) assert.ok(res[name].ids && !res[name].subquery, name + ' must resolve to an id list under the cap')
      for (const name of BROAD) assert.ok(res[name].rr <= o[name].rr * (WINDOWED_BROAD.test(name) ? WINDOWED_BROAD_PRICE : 1), `${name}: near-cap rows ${res[name].rr} > oracle ${o[name].rr}`)
    }
  })

  // ---------------------------------------------------------------- required reds
  const caught = async (label, patches, { against, shapes = MUTANT_SHAPES, switches, ids = false, calls = false, rowsOver } = {}) => {
    const res = await runUrls({ urls: ids ? idUrls : subset(shapes), patches, switches, prepare, regimes: true })
    let red = false
    const base = against
    try { assert.deepEqual(bodies(ids ? pickIds(res) : res), bodies(ids ? pickIds(base) : pick(base, shapes))) } catch { red = true }
    if (!red && calls) for (const name of shapes) if (res[name].calls > newOn[name].calls + 1) red = true
    if (!red && rowsOver) for (const name of shapes) if (res[name].rr > rowsOver[name].rr * 1.02) red = true
    await step(`required red: ${label} is caught`, () => assert.ok(red, 'the mutant passed the parity checks'))
  }
  await caught('the resolver cuts an over-long match silently (cap 40)', MUTANTS.silentTruncation, { against: oldOff, shapes: ['stats customer broad | all-time', 'stats customer broad | 30d', 'stats customer name | all-time', 'stats product name | today'] })
  await caught('every page carries the whole id list again (quadratic reads)', MUTANTS.idsNotPaged, { against: oldOff, shapes: BROAD, rowsOver: newOff })
  await caught('each page slice of the id list drops its last id (sales dropped)', MUTANTS.sliceDropsAnId, { against: oldOff, shapes: BROAD })
  await caught('the resolver is spent on a filter with no typed search (status only reads more rows)', MUTANTS.resolvesEveryFilter, { against: oldOff, shapes: ['stats status only', 'stats no search + cashier'], rowsOver: newOff })
  await caught('the resolver keeps one id', MUTANTS.keepsOneId, { against: oldOff })
  await caught('a search that matches nothing reads as no filter', MUTANTS.emptyMatchIsNoFilter, { against: oldOff, shapes: ['stats no match | all-time', 'stats no match | 30d', 'stats customer name | all-time'] })
  await caught('the resolver ignores the scope it is given (no filter at all)', MUTANTS.resolverIgnoresTheScope, { against: oldOff, shapes: ['stats no match | all-time', 'stats customer name | all-time', 'stats customer + cashier none'] })
  await caught('/stats drops the id filter', MUTANTS.idFilterDropped, { against: idsOff, ids: true })
  await caught('the id-list scope is not eligible for the atomic report (report_atomic ON)', MUTANTS.idScopeNotAtomic, { against: newOn, shapes: ['stats customer name | all-time', 'stats product name | all-time', 'stats no match | all-time'], switches: ATOMIC, calls: true })
  finish()
})().catch((e) => { console.error(e); process.exit(1) })
