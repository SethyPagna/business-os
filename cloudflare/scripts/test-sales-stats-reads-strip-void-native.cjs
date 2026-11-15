#!/usr/bin/env node
// lane/sales-stats-reads items 4 and 5 (audit #13, #23).
//   4. readStripMoneyRows pages on `+id`, so GET /api/sales/stats-strip seeks its window on the date index instead of walking every sale by primary key.
//   5. The cancelled group tests `s.sale_status = 'cancelled'` (not COALESCE(...)) and pages on `+s.id`, so an undated report seeks idx_sales_status_created_pg.
// ORACLE: the same Worker with each change patched back out in memory. Every answer must be byte-identical to the oracle (statuses NULL, '', 'Cancelled',
// ' cancelled', returned and partial_return included, report_atomic OFF and ON, EXPLAIN with and without ANALYZE), and the rows must be fewer.
// Required reds: each mutant below must be CAUGHT.
'use strict'
const assert = require('node:assert/strict')
const { bootWorld } = require('./read-budget/world.cjs')
const { ATOMIC, applyFixture, day, runUrls, bodies, step, log, finish } = require('./sales-stats-reads-harness.cjs')

const SALES = 'src/routes/sales.ts'
const KERNEL = 'src/lib/salesAnalytics.ts'
const STRIP_NEW = "const stripId=continuous?'id':'+id'"
const STRIP_OLD = "const stripId='id'"
const STRIP_CURSOR = 'AND ${stripId}>@stripAfter ORDER BY'
const STRIP_PAGE = 'ORDER BY ${stripId} LIMIT'
const VOID_NEW = "status === 'cancelled' && options.plainCancelled !== false ? `${alias}.sale_status = @status` : `COALESCE(${alias}.sale_status, 'completed') = @status`"
const VOID_OLD = "`COALESCE(${alias}.sale_status, 'completed') = @status`"
const VOID_ID = "const REPORT_VOID_ID_EXPR = '+s.id'"

const oldStrip = [{ name: 'old-strip', file: SALES, from: STRIP_NEW, to: STRIP_OLD }]
const oldVoid = [{ name: 'old-void', file: KERNEL, from: VOID_NEW, to: VOID_OLD }, { name: 'old-void-id', file: KERNEL, from: VOID_ID, to: "const REPORT_VOID_ID_EXPR = 's.id'" }]
const OLD = [...oldStrip, ...oldVoid]
const MUTANTS = {
  stripKeepsRowid: [{ name: 'm-strip', file: SALES, from: STRIP_NEW, to: STRIP_OLD }],
  voidWrapsColumn: [{ name: 'm-void-coalesce', file: KERNEL, from: VOID_NEW, to: VOID_OLD }],
  voidPagesOnRowid: [{ name: 'm-void-id', file: KERNEL, from: VOID_ID, to: "const REPORT_VOID_ID_EXPR = 's.id'" }],
  // NULL counted as cancelled: the fixture's NULL-status sales change the answer
  voidNullIsCancelled: [{ name: 'm-void-null', file: KERNEL, from: VOID_NEW, to: "status === 'cancelled' ? `COALESCE(${alias}.sale_status, 'cancelled') = @status` : `COALESCE(${alias}.sale_status, 'completed') = @status`" }],
  // the case-insensitive match: ' cancelled' / 'Cancelled' would join the group
  voidIsCaseInsensitive: [{ name: 'm-void-nocase', file: KERNEL, from: VOID_NEW, to: "status === 'cancelled' ? `lower(trim(${alias}.sale_status)) = @status` : `COALESCE(${alias}.sale_status, 'completed') = @status`" }],
  stripPagesBackwards: [{ name: 'm-strip-desc', file: SALES, from: STRIP_PAGE, to: 'ORDER BY ${stripId} DESC LIMIT' }],
  // an hours window tests datetime(created_at), which no index serves: the plus there turns every 2,000-row page into a full scan and a sort
  // a `>=` cursor re-reads the last row of every page, so every window over one page is refused (422 duplicate_row)
  stripCursorGe: [{ name: 'm-strip-ge', file: SALES, from: STRIP_CURSOR, to: 'AND ${stripId}>=@stripAfter ORDER BY' }],
  // every dated window on `+id` again: past about 90 days each page re-scans the window (+38% at a year)
  stripDatedAlwaysPlus: [{ name: 'm-strip-dated-plus', file: SALES, from: 'const STRIP_PLUS_ID_MAX_DAYS=90', to: 'const STRIP_PLUS_ID_MAX_DAYS=100000' }],
  // a scoped report (filter subquery / id list) on the plain cancelled predicate again: the planner reads every cancelled sale in the window (121 -> 1,989 rows)
  voidScopedPlain: [{ name: 'm-void-scoped-plain', file: KERNEL, from: '({ plainCancelled: !scope?.narrow })', to: '({ plainCancelled: true })' }],
  // the plain status predicate for ANY status: NULL-status sales stop counting as 'completed' (reaches /daily-report and /day-report with a status filter)
  voidPlainForAnyStatus: [{ name: 'm-void-any', file: KERNEL, from: "status === 'cancelled' && options.plainCancelled !== false ?", to: "status !== '' ?" }],
  // a single extra statement before the header read: the exact calls check must see it (no blanket +1)
  oneMoreCall: [{ name: 'm-one-more-call', file: SALES, from: 'const totals = await readSalesHeaderTotals(c.env, windowFilter, scope)', to: "await c.env.DB.prepare('SELECT 1').all(); const totals = await readSalesHeaderTotals(c.env, windowFilter, scope)" }],
  // the three classification rules of GET /stats (status, branch, resolved-id limit), each broken both ways
  statusNeverBroad: [{ name: 'm-status-never', file: SALES, from: "new Set(['completed', 'awaiting_payment'])", to: 'new Set([])' }],
  statusAlwaysBroad: [{ name: 'm-status-always', file: SALES, from: 'statuses.every((status) => BROAD_STATS_STATUSES.has(status))', to: 'true' }],
  branchNeverBroad: [{ name: 'm-branch-never', file: SALES, from: '- (branchClausePushed ? 1 : 0) > 0', to: '- 0 > 0' }],
  branchOnlyAlone: [{ name: 'm-branch-alone', file: SALES, from: '- (branchClausePushed ? 1 : 0) > 0', to: '- (branchClausePushed && !statusClausePushed ? 1 : 0) > 0' }],
  idLimitZero: [{ name: 'm-ids-zero', file: KERNEL, from: 'export const REPORT_NARROW_SCOPE_IDS_MAX = 10', to: 'export const REPORT_NARROW_SCOPE_IDS_MAX = 0' }],
  idLimit200: [{ name: 'm-ids-200', file: KERNEL, from: 'export const REPORT_NARROW_SCOPE_IDS_MAX = 10', to: 'export const REPORT_NARROW_SCOPE_IDS_MAX = 200' }],
  stripContinuousPlus: [{ name: 'm-strip-continuous-plus', file: SALES, from: STRIP_NEW, to: "const stripId='+id'" }],
}
const urls = (ctx) => {
  const w = (a, b) => `startDate=${day(ctx, a)}&endDate=${day(ctx, b)}`
  return {
    'strip today': `/api/sales/stats-strip?${w(0, 0)}`,
    'strip yesterday+today': `/api/sales/stats-strip?${w(1, 0)}`,
    'strip 30d': `/api/sales/stats-strip?${w(29, 0)}`,
    'strip branch': `/api/sales/stats-strip?${w(29, 0)}&branchId=1`,
    'strip branch today': `/api/sales/stats-strip?${w(0, 0)}&branchId=1`,
    'strip time': `/api/sales/stats-strip?${w(1, 0)}&startTime=08:00&endTime=18:00`,
    // continuous (hours) windows, as Inventory sends them: more than one 2,000-row page on the seed
    'strip continuous 30d': `/api/sales/stats-strip?${w(29, 0)}&createdFrom=${encodeURIComponent(day(ctx, 29) + ' 00:00:00')}&createdTo=${encodeURIComponent(day(ctx, -1) + ' 00:00:00')}`,
    'strip continuous 120d': `/api/sales/stats-strip?${w(119, 0)}&createdFrom=${encodeURIComponent(day(ctx, 119) + ' 00:00:00')}&createdTo=${encodeURIComponent(day(ctx, -1) + ' 00:00:00')}`,
    // windows of more than one 2,000-row page: the paging itself (the cursor) is exercised, and refused (422) if it is wrong
    // the Sales strip presets (quarter, half year, year): a dated window must never read more than the pre-lane route, whatever its length
    'strip dated 90d': `/api/sales/stats-strip?${w(89, 0)}`,
    'strip dated 180d': `/api/sales/stats-strip?${w(179, 0)}`,
    'strip dated 365d': `/api/sales/stats-strip?${w(364, 0)}`,
    'strip dated 120d': `/api/sales/stats-strip?${w(119, 0)}`,
    'strip dated 365d hours': `/api/sales/stats-strip?${w(364, 0)}&startTime=08:00&endTime=18:00`,
    'strip continuous 365d': `/api/sales/stats-strip?${w(364, 0)}&createdFrom=${encodeURIComponent(day(ctx, 364) + ' 00:00:00')}&createdTo=${encodeURIComponent(day(ctx, -1) + ' 00:00:00')}`,
    'strip continuous today': `/api/sales/stats-strip?${w(0, 0)}&createdFrom=${encodeURIComponent(day(ctx, 0) + ' 00:00:00')}&createdTo=${encodeURIComponent(day(ctx, -1) + ' 00:00:00')}`,
    'stats all-time': '/api/sales/stats',
    'stats today': `/api/sales/stats?${w(1, 0)}`,
    'stats 30d': `/api/sales/stats?${w(29, 0)}`,
    'stats start-only': `/api/sales/stats?startDate=${day(ctx, 10)}`,
    'stats end-only': `/api/sales/stats?endDate=${day(ctx, 10)}`,
    // narrow scopes (a cashier / branch filter holding a few sales) on a status that goes through the cancelled group: never above the pre-lane route
    'stats narrow returned cashier': `/api/sales/stats?endDate=${day(ctx, 0)}&status=returned&cashier=Budget`,
    'stats narrow search returned': `/api/sales/stats?search=Customer%2012&status=returned&branchId=2&cashier=zzzz`,
    'stats narrow search partial': `/api/sales/stats?search=Customer%2012&status=partial_return&branchId=2&cashier=zzzz`,
    // the two report routes that take a status filter, each status against the old predicate (NULL status counts as completed)
    ...Object.fromEntries(['completed', 'cancelled', 'returned', 'partial_return', 'awaiting_delivery', 'awaiting_payment'].flatMap((st) => [
      [`daily-report ${st}`, `/api/sales/daily-report?${w(1, 0)}&status=${st}`],
      [`day-report ${st}`, `/api/sales/day-report?date=${day(ctx, 0)}&status=${st}`],
    ])),
    // every status option, a value the filter does not know, each branch, and the combinations (the classification rules: status, branch, resolved-id limit)
    ...Object.fromEntries(['awaiting_payment', 'partial_return', 'returned', 'awaiting_delivery', 'cancelled', 'completed', 'bogus'].flatMap((st) => [
      [`stats status=${st} all-time`, `/api/sales/stats?status=${st}`],
      [`stats status=${st} 30d`, `/api/sales/stats?${w(29, 0)}&status=${st}`],
    ])),
    'stats branch=1 all-time': '/api/sales/stats?branchId=1',
    'stats branch=2 all-time': '/api/sales/stats?branchId=2',
    'stats branch=1 30d': `/api/sales/stats?${w(29, 0)}&branchId=1`,
    'stats branch=2 30d': `/api/sales/stats?${w(29, 0)}&branchId=2`,
    'stats combo completed+branch=1 all-time': '/api/sales/stats?status=completed&branchId=1',
    'stats combo awaiting_payment+branch=1 all-time': '/api/sales/stats?status=awaiting_payment&branchId=1',
    'stats combo returned+branch=1 all-time': '/api/sales/stats?status=returned&branchId=1',
    'stats combo returned+branch=1 30d': `/api/sales/stats?${w(29, 0)}&status=returned&branchId=1`,
    'stats combo completed+cashier all-time': '/api/sales/stats?status=completed&cashier=Budget',
    // a typed search resolved to few ids (narrow) and to more than the limit (broad)
    'stats search 2 sales all-time': '/api/sales/stats?search=RB0000',
    'stats search 12 sales today': `/api/sales/stats?${w(0, 0)}&search=Customer%2012`,
    'stats cancelled': `/api/sales/stats?${w(29, 0)}&status=cancelled`,
    'stats completed': `/api/sales/stats?${w(29, 0)}&status=completed`,
    'stats search all-time': '/api/sales/stats?search=Customer%2012',
  }
}
const NAMES = Object.keys(urls({ anchorDate: '2026-01-01' }))
// 'strip branch' already seeks idx_sales_branch_created (branch + window) in both builds, so it is compared for parity and never-more-rows only
const REDUCED = ['strip today', 'strip 30d', 'stats all-time', 'stats completed'] // 'stats completed': a status-only (broad) scope keeps the plain predicate and its saving
// a continuous window keeps the rowid walk: exactly the oracle's rows, never above (the plus there re-scans the table on every page)
// dated windows past the plus-id crossover keep the rowid walk: exactly the oracle's rows (the plus there re-scans the window on every page)
const LONG_DATED = ['strip dated 120d', 'strip dated 180d', 'strip dated 365d']
const NARROW = ['stats narrow returned cashier', 'stats narrow search returned', 'stats narrow search partial',
  // the rare statuses and an unknown one keep the pre-lane predicate, alone and beside a branch
  ...['partial_return', 'returned', 'awaiting_delivery', 'cancelled', 'bogus'].flatMap((st) => [`stats status=${st} all-time`, `stats status=${st} 30d`]),
  'stats combo returned+branch=1 all-time', 'stats combo returned+branch=1 30d', 'stats search 2 sales all-time',
  // a cashier beside a broad status is a narrow scope: the pre-lane rows exactly
  'stats combo completed+cashier all-time']
// scopes that stay broad (the plain predicate and +id paging): clearly fewer rows than the pre-lane route
const BROAD = ['stats status=completed all-time', 'stats status=awaiting_payment all-time', 'stats branch=1 all-time', 'stats combo completed+branch=1 all-time', 'stats combo awaiting_payment+branch=1 all-time']
// every shape the three rules decide: a mutant of a rule must move one of them by more than half a percent
const RULE_SHAPES = [...NARROW, ...BROAD, 'stats search 12 sales today']
const CONTINUOUS = ['strip continuous 30d', 'strip continuous 120d', 'strip continuous 365d', 'strip continuous today']
// strip windows holding more than one page, with the independent SQL that counts the same sales (no paging code involved)
const MULTIPAGE = {
  'strip dated 120d': (ctx) => `date(created_at, '+7 hours') >= '${day(ctx, 119)}' AND date(created_at, '+7 hours') <= '${day(ctx, 0)}'`,
  'strip dated 365d': (ctx) => `date(created_at, '+7 hours') >= '${day(ctx, 364)}' AND date(created_at, '+7 hours') <= '${day(ctx, 0)}'`,
  'strip continuous 120d': (ctx) => `datetime(created_at) >= '${day(ctx, 119)} 00:00:00' AND datetime(created_at) < '${day(ctx, -1)} 00:00:00'`,
  'strip continuous 365d': (ctx) => `datetime(created_at) >= '${day(ctx, 364)} 00:00:00' AND datetime(created_at) < '${day(ctx, -1)} 00:00:00'`,
}
const statusCounts = (text) => Object.fromEntries(JSON.parse(text).by_status.map((r) => [r.sale_status, r.count]))

;(async () => {
  await step('the status fixture is real: the cancelled predicate separates NULL, empty and spaced variants', async () => {
    const world = await bootWorld({ tier: 'free' })
    try {
      await applyFixture(world)
      const old = (await world.all("SELECT id FROM sales WHERE COALESCE(sale_status,'completed')='cancelled' ORDER BY id")).map((r) => r.id)
      const next = (await world.all("SELECT id FROM sales WHERE sale_status='cancelled' ORDER BY id")).map((r) => r.id)
      assert.deepEqual(next, old, "COALESCE(x,'completed')='cancelled' and x='cancelled' must select the same ids")
      const odd = await world.all("SELECT COUNT(*) n FROM sales WHERE sale_status IS NULL OR sale_status IN ('', 'Cancelled', ' cancelled', 'cancelled ')")
      assert.ok(odd[0].n >= 6, 'the fixture must hold NULL/empty/case/space variants, has ' + odd[0].n)
      // the algebra itself, on every value of a probe table, NULL included
      await world.db.prepare('CREATE TABLE probe_status (id INTEGER PRIMARY KEY, v TEXT)').run()
      const values = [null, '', 'completed', 'cancelled', 'Cancelled', 'CANCELLED', ' cancelled', 'cancelled ', 'awaiting_payment', 'returned', 'partial_return', 'x']
      for (const v of values) await world.db.prepare('INSERT INTO probe_status(v) VALUES (?)').bind(v).run()
      const a = (await world.all("SELECT id FROM probe_status WHERE COALESCE(v,'completed')='cancelled' ORDER BY id")).map((r) => r.id)
      const b = (await world.all("SELECT id FROM probe_status WHERE v='cancelled' ORDER BY id")).map((r) => r.id)
      assert.deepEqual(b, a)
      assert.equal(a.length, 1)
    } finally { await world.dispose() }
  })

  const oldOff = await runUrls({ urls, patches: OLD, excludeSwitchReads: true })
  const newOff = await runUrls({ urls, excludeSwitchReads: true })
  const oldOn = await runUrls({ urls, patches: OLD, switches: ATOMIC, excludeSwitchReads: true })
  const newOn = await runUrls({ urls, switches: ATOMIC, excludeSwitchReads: true })
  for (const [mode, o, n] of [['OFF', oldOff, newOff], ['ON', oldOn, newOn]]) {
    await step(`parity (report_atomic ${mode}): every strip and stats answer is byte-identical to the oracle`, () => assert.deepEqual(bodies(n), bodies(o)))
    await step(`status (report_atomic ${mode}): every strip and stats shape answers HTTP 200, build and oracle (a refusing strip would match a refusing oracle)`, () => {
      for (const [label, res] of [['build', n], ['oracle', o]]) for (const name of NAMES) assert.equal(res[name].status, 200, `${label} ${name} answered ${res[name].status}: ${res[name].text.slice(0, 120)}`)
    })
    await step(`rows (report_atomic ${mode}): never above the oracle, below it for the strip and the undated report`, () => {
      // two named allowances, nothing else may read more: 'stats cancelled' reads the same few cancelled rows through either index (a handful of rows apart); 'stats branch=2 30d' is the owner-accepted
      // price of the branch rule (a branch alone is broad: 5,597 vs 5,435 rows, 162 more on a 30-day window of the small branch, while branch 1 saves 4,872 and every all-time branch shape saves)
      const MORE_ROWS = { 'stats cancelled': 12, 'stats branch=2 30d': 162 }
      for (const name of NAMES) assert.ok(n[name].rr <= o[name].rr + (MORE_ROWS[name] || 0), `${name}: rows ${n[name].rr} > oracle ${o[name].rr}`)
      for (const name of CONTINUOUS) assert.ok(n[name].rr <= o[name].rr, `${name}: a continuous window must keep the rowid walk (${n[name].rr} vs oracle ${o[name].rr})`)
      for (const name of NARROW) assert.ok(n[name].rr <= o[name].rr, `${name}: a narrow scope must not read more than the pre-lane route (${n[name].rr} vs oracle ${o[name].rr})`)
      for (const name of LONG_DATED) assert.ok(n[name].rr <= o[name].rr, `${name}: a dated window past the crossover must not read more than the pre-lane route (${n[name].rr} vs oracle ${o[name].rr})`)
      for (const name of REDUCED) assert.ok(n[name].rr < o[name].rr * 0.9, `${name}: expected clearly fewer rows (${n[name].rr} vs ${o[name].rr})`)
      for (const name of BROAD) assert.ok(n[name].rr < o[name].rr * 0.97, `${name}: a broad scope must read fewer rows than the pre-lane route (${n[name].rr} vs oracle ${o[name].rr})`)
    })
    // exact: the +1 that used to be allowed on every shape was the read-switch memo expiring mid-run (15 s on Free), counted on a different request in each world; the harness leaves those statements out (excludeSwitchReads).
    // The +-1 that remained on the 365-day strips was the second clock statement (the Telegram fallback drain, every 20 s of wall clock; the harness leaves it out too). Nothing else is left: exact.
    // the harness leaves the two clock statements out, so a route that issued an extra un-memoised switch read or drain would hide: bound what was left out by the wall clock (the memo expires every 15 s, the drain runs every 20 s, plus the cold first read)
    await step(`switch reads (report_atomic ${mode}): within the wall-clock allowance, build and oracle`, () => {
      for (const [label, res] of [['build', n], ['oracle', o]]) {
        const entries = NAMES.map((name) => res[name])
        const reads = entries.reduce((t, e) => t + e.switchReads, 0), ms = entries.reduce((t, e) => t + e.ms, 0)
        const allowed = 2 + Math.ceil(ms / 15000) + Math.ceil(ms / 20000)
        assert.ok(reads <= allowed, `${label}: ${reads} switch reads and drains over ${ms} ms, allowed ${allowed}`)
      }
    })
    await step(`calls (report_atomic ${mode}): at most the oracle's`, () => { for (const name of NAMES) assert.ok(n[name].calls <= o[name].calls, `${name}: calls ${n[name].calls} > ${o[name].calls}`) })
  }
  await step('independent oracle: the status mix of each multi-page strip window equals a plain COUNT(*) GROUP BY over the same window', async () => {
    const world = await bootWorld({ tier: 'free' })
    try {
      await applyFixture(world)
      for (const [name, win] of Object.entries(MULTIPAGE)) {
        const want = {}
        let total = 0
        for (const r of await world.all(`SELECT COALESCE(NULLIF(TRIM(sale_status), ''), 'completed') st, COUNT(*) n FROM sales WHERE ${win(world.ctx)} GROUP BY st`)) { want[r.st] = r.n; total += r.n }
        assert.ok(total > 2000, `${name}: the fixture window must span more than one 2,000-row page, has ${total}`)
        for (const [label, res] of [['OFF', newOff], ['ON', newOn]]) assert.deepEqual(statusCounts(res[name].text), want, `${name} (${label}): by_status differs from the independent count`)
      }
    } finally { await world.dispose() }
  })
  await step('the build answers the same on report_atomic OFF and ON', () => assert.deepEqual(bodies(newOn), bodies(newOff)))
  log('rows/calls oracle -> build:')
  for (const name of NAMES) log(`   ${name.padEnd(22)} OFF ${oldOff[name].rr}/${oldOff[name].calls} -> ${newOff[name].rr}/${newOff[name].calls}   ON ${oldOn[name].rr}/${oldOn[name].calls} -> ${newOn[name].rr}/${newOn[name].calls}`)

  // Production has table statistics (a fresh database does not): the same answers, and the undated report still reads fewer rows.
  const oldAn = await runUrls({ urls, patches: OLD, analyze: true, excludeSwitchReads: true })
  const newAn = await runUrls({ urls, analyze: true, excludeSwitchReads: true })
  await step('after ANALYZE the build answers byte-identically to the oracle and reads fewer rows', () => {
    assert.deepEqual(bodies(newAn), bodies(oldAn))
    for (const name of ['strip today', 'strip 30d']) assert.ok(newAn[name].rr < oldAn[name].rr, `${name}: ${newAn[name].rr} >= ${oldAn[name].rr}`)
    assert.ok(newAn['stats all-time'].rr < oldAn['stats all-time'].rr * 0.9, `stats all-time: ${newAn['stats all-time'].rr} vs ${oldAn['stats all-time'].rr}`)
  })
  const caught = async (label, patches, switches, analyze = false) => {
    const res = await runUrls({ urls, patches, switches, analyze, excludeSwitchReads: true })
    const base = analyze ? oldAn : switches ? oldOn : oldOff
    const good = analyze ? newAn : switches ? newOn : newOff
    let red = false
    try { assert.deepEqual(bodies(res), bodies(base)) } catch { red = true }
    if (!red) for (const name of NAMES) if (res[name].status !== 200) red = true
    if (!red) for (const name of NAMES) if (res[name].calls > good[name].calls) red = true
    if (!red) for (const name of REDUCED) if (res[name].rr > good[name].rr * 1.3) red = true
    if (!red) for (const name of [...CONTINUOUS, ...LONG_DATED]) if (res[name].rr > good[name].rr * 1.05) red = true
    if (!red) for (const name of RULE_SHAPES) if (res[name].rr > good[name].rr * 1.005) red = true
    await step(`required red: ${label} is caught`, () => assert.ok(red, 'the mutant passed the parity and rows checks'))
  }
  await caught('the strip pages on the rowid again', MUTANTS.stripKeepsRowid)
  await caught('the cancelled group wraps the column again', MUTANTS.voidWrapsColumn)
  await caught('the cancelled group pages on the rowid again (table statistics: only then the planner walks the key)', MUTANTS.voidPagesOnRowid, undefined, true)
  await caught('NULL counted as cancelled', MUTANTS.voidNullIsCancelled)
  await caught('cancelled matched case-insensitively', MUTANTS.voidIsCaseInsensitive)
  await caught('the strip pages backwards', MUTANTS.stripPagesBackwards)
  await caught('the strip cursor is >= (every multi-page window refused with 422)', MUTANTS.stripCursorGe)
  await caught('every dated window pages on +id again (a year reads +38% rows)', MUTANTS.stripDatedAlwaysPlus)
  await caught('a scoped report keeps the plain cancelled predicate (every cancelled sale in the window is read)', MUTANTS.voidScopedPlain)
  await caught('the plain status predicate for any status (/daily-report and /day-report with a status filter)', MUTANTS.voidPlainForAnyStatus)
  await caught('an hours (continuous) window pages on +id again: a full scan per page', MUTANTS.stripContinuousPlus)
  await caught('RULE status: no status is broad (completed and awaiting_payment read the pre-lane rows)', MUTANTS.statusNeverBroad)
  await caught('RULE status: every status is broad (a rare status reads every cancelled sale of the window)', MUTANTS.statusAlwaysBroad)
  await caught('RULE branch: a branch clause is never broad', MUTANTS.branchNeverBroad)
  await caught('RULE branch: a branch is broad only when alone (not beside completed / awaiting_payment)', MUTANTS.branchOnlyAlone)
  await caught('RULE id limit: a resolved list is never narrow (limit 0)', MUTANTS.idLimitZero)
  await caught('RULE id limit: a resolved list of up to 200 ids is narrow (the old limit)', MUTANTS.idLimit200)
  await caught('one extra D1 call on /stats (the allowance the calls check used to carry)', MUTANTS.oneMoreCall)

  // The plan, with and without table statistics (production has them; a fresh database does not).
  for (const analyze of [false, true]) {
    await step(`EXPLAIN (${analyze ? 'with' : 'without'} ANALYZE): the strip seeks the date index; the cancelled group seeks the status index`, async () => {
      const world = await bootWorld({ tier: 'free' })
      try {
        if (analyze) await world.analyze()
        const ctx = world.ctx
        const win = `date(created_at, '+7 hours') >= '${ctx.anchorDate}' AND created_at >= date('${ctx.anchorDate}', '-1 day') AND date(created_at, '+7 hours') <= '${ctx.anchorDate}' AND created_at < date('${ctx.anchorDate}', '+1 day')`
        const plan = async (sql) => (await world.all('EXPLAIN QUERY PLAN ' + sql)).map((r) => r.detail).join(' | ')
        const stripNew = await plan(`SELECT id,total_usd,sale_status,money_precision_version FROM sales WHERE ${win} AND +id>0 ORDER BY +id LIMIT 2000`)
        assert.match(stripNew, /idx_sales_created_pg/)
        assert.doesNotMatch(stripNew, /PRIMARY KEY/)
        for (const dated of [false, true]) {
          const w = dated ? win.replaceAll('created_at', 's.created_at') + ' AND ' : ''
          const voidNew = await plan(`SELECT s.id FROM sales s WHERE ${w}s.sale_status='cancelled' AND +s.id>0 ORDER BY +s.id LIMIT 2000`)
          assert.match(voidNew, /idx_sales_status_created_pg \(sale_status=\?/, 'cancelled group (dated ' + dated + '): ' + voidNew)
          assert.doesNotMatch(voidNew, /PRIMARY KEY/)
        }
        if (!analyze) {
          // the reason for the plus: without it a fresh database walks the primary key for the strip
          const stripOld = await plan(`SELECT id,total_usd,sale_status,money_precision_version FROM sales WHERE ${win} AND id>0 ORDER BY id LIMIT 2000`)
          assert.match(stripOld, /PRIMARY KEY/)
        } else {
          const voidOld = await plan("SELECT s.id FROM sales s WHERE s.sale_status='cancelled' AND s.id>0 ORDER BY s.id LIMIT 2000")
          assert.match(voidOld, /PRIMARY KEY/, 'with statistics the plain id still walks the key, which is why the group pages on +s.id')
        }
      } finally { await world.dispose() }
    })
  }
  finish()
})().catch((e) => { console.error(e); process.exit(1) })
