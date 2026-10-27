// Lane 6.0.1007. D1 calls per Telegram message on the Cloudflare Free plan (50 calls per invocation, a db.batch is ONE call).
// Before: the day summary took 40 calls (111 with every section on) and a shift overview 41-46 (116 with every section on).
// The REAL telegram.ts, sales kernel, shift reconciliation and lib/db.ts over node:sqlite behind a D1-shaped binding that counts
// calls the way Cloudflare does (harness/d1-binding-shim.cjs). Nothing is sent: fetch is a local stand-in.
//
// Three claims:
//   1. the batched message is the SAME message (text and figures) as the unbatched one, every section on and off;
//   2. with today's sales kernel (its two-pass snapshot is a chain of ~14 dependent reads, owned by perf-reads) the message costs
//      the depth of that chain, a fraction of before -- pinned as a budget so it cannot creep back up;
//   3. my share is small: with a kernel whose snapshot is ONE read round (what perf-reads is building) a message is 10 calls or fewer.
//
// Run (from cloudflare/): node scripts/test-telegram-d1-calls-pure.cjs
const world = require('./harness/received-day-world.cjs')
const { d1Binding } = require('./harness/d1-binding-shim.cjs')
const { assert, loadReal, seedStockFixture, openShop, insert, setting, seedShop, buildModules, D2, NOW_MS } = world

const realDb = loadReal('lib/db.ts', { './importMaintenanceFence': {} })

const posts = []
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('https://api.telegram.org/botSYNTHETIC-TOKEN/'), `unexpected fetch ${url}`)
  posts.push(JSON.parse(init.body))
  return { ok: true, status: 200, text: async () => '' }
}
let passed = 0
const check = (name, cond, detail) => { assert.ok(cond, detail ? `${name}\n${detail}` : name); passed += 1; console.log(`PASS ${name}`) }

const SWITCHES = { sales: 'telegram_summary_sales_enabled', cashiers: 'telegram_summary_cashiers_enabled', products: 'telegram_summary_products_enabled', returns: 'telegram_summary_returns_enabled', expenses: 'telegram_summary_expenses_enabled', compare: 'telegram_summary_compare_enabled' }
const ALL = Object.fromEntries(Object.keys(SWITCHES).map((section) => [section, true]))
const NONE = Object.fromEntries(Object.keys(SWITCHES).map((section) => [section, false]))

function shop() {
  const db = openShop()
  seedShop(db)
  setting(db, 'telegram_topic_reports', '9007')
  for (const [id, name, stock] of [[1, 'Rose Serum', 0], [2, 'Lip Tint', 3]]) insert(db, 'products', { id, name, stock_quantity: stock, low_stock_threshold: 5, out_of_stock_threshold: 0, is_active: 1 })
  insert(db, 'sale_items', { id: 1, sale_id: 4, product_id: 1, product_name: 'Rose Serum', quantity: 1, total_usd: 28 })
  insert(db, 'inventory_movements', { id: 1, product_id: 2, product_name: 'Lip Tint', branch_id: 1, movement_type: 'remove', quantity: 1, created_at: '2026-10-21 04:00:00' })
  const shift = (id, branchId, branchName) => insert(db, 'shift_sessions', {
    id, revision: 1, shift_code: `S-20261021-${id}-Za`, scope_mode: 'per_account', user_id: id, user_name: 'Za', branch_id: branchId, branch_name: branchName, business_date: D2,
    opened_at: '2026-10-21T01:07:00.000Z', closed_at: '2026-10-21T11:30:00.000Z', opening_float_usd: 10, opening_float_khr: 10000, opening_float_usd_registered: 1, opening_float_khr_registered: 1,
    closing_counted_usd: 120, closing_counted_khr: 50000,
  })
  shift(41, 1, 'Toul Kork'); shift(42, 2, 'Riverside')
  return db
}

/** One world: a database, its counting binding and the modules over the real db.ts. `batched: false` swaps the coalescer for the identity. */
function build({ kernel = 'real', batched = true, switches = ALL, ideal = false, mutate } = {}) {
  const db = shop()
  for (const [section, key] of Object.entries(SWITCHES)) setting(db, key, switches[section] ? 'true' : 'false')
  const { d1, log } = d1Binding(db.raw)
  const mods = buildModules(realDb, { kernel })
  let analytics = mods.salesAnalytics
  if (ideal) {
    // A kernel whose snapshot is one read round: each question costs one read, answered with fixed numbers.
    const one = async (env) => { await realDb.getDb(env).prepare('SELECT 1 AS one').get() }
    analytics = {
      ...mods.salesAnalyticsReal,
      getSalesTotals: async (env) => { await one(env); return { ...mods.salesAnalyticsReal.emptySalesTotals(), revenue_usd: 100, tx_count: 4, pending_tx_count: 1, not_paid_owed_usd: 20 } },
      getSalesGroupedTotals: async (env) => { await one(env); return [] },
      getProductSalesRanking: async (env) => { await one(env); return [] },
    }
  }
  const overrides = { './salesAnalytics': analytics, ...(batched ? {} : { './d1ReadCoalescer': { coalesceD1Reads: (env) => env } }) }
  const telegram = mods.loadTelegram(mods.dayModule((text) => text), overrides, mutate)
  return { db, log, env: { DB: d1, TELEGRAM_BOT_TOKEN: 'SYNTHETIC-TOKEN' }, telegram, mods }
}

const calls = (w) => w.log.length
async function daySummary(w, sections) {
  w.log.length = 0
  const text = await w.telegram.telegramCommandReply(w.env, '/report 21/10/2026', NOW_MS, 'en', undefined, sections)
  return { text, calls: calls(w) }
}
async function overviewMessage(w, shiftId, nowMs = NOW_MS) {
  w.log.length = 0
  const before = posts.length
  assert.equal(await w.telegram.scheduleTelegramShiftOverview(w.env, shiftId, nowMs), 'fallback')
  const scheduling = calls(w)
  const key = w.telegram.shiftOverviewKey(shiftId, 1)
  w.log.length = 0
  assert.equal(await w.telegram.deliverTelegramShiftOverview(w.env, key, nowMs + 120_000), 'sent')
  assert.equal(posts.length, before + 1)
  return { text: posts[posts.length - 1].text, calls: calls(w), scheduling }
}

async function main() {
  // 1 + 2. Same message, far fewer calls (today's kernel).
  const sameSections = []
  for (const [name, sections] of [['every section on', ALL], ['default sections', NONE]]) {
    const batched = build({ switches: sections }), plain = build({ switches: sections, batched: false })
    const a = await daySummary(batched, sections), b = await daySummary(plain, sections)
    check(`day summary, ${name}: the batched message is word for word the unbatched one`, a.text === b.text && a.text.includes('Business summary'), `${a.text}\n---\n${b.text}`)
    sameSections.push({ name, batched: a.calls, plain: b.calls })
    const ov = await overviewMessage(batched, 41), ovPlain = await overviewMessage(plain, 41)
    check(`overview, ${name}: the batched message is word for word the unbatched one`, ov.text === ovPlain.text && ov.text.includes('Reports overview'), `${ov.text}\n---\n${ovPlain.text}`)
    sameSections.push({ name: `overview ${name}`, batched: ov.calls, plain: ovPlain.calls })
  }
  const by = Object.fromEntries(sameSections.map((row) => [row.name, row]))
  console.log('calls (batched / unbatched):', JSON.stringify(by))
  // Budgets are the measured depth of the kernel's snapshot chain plus the message's own reads; the unbatched figures are what each cost before.
  // Cold isolate: every module here is freshly loaded, so the kernel's schema probes are included.
  const BUDGET = { 'every section on': 30, 'default sections': 28, 'overview every section on': 38, 'overview default sections': 22 }
  for (const [name, limit] of Object.entries(BUDGET)) {
    check(`${name}: ${by[name].batched} calls with today's kernel (budget ${limit}; ${by[name].plain} unbatched)`, by[name].batched <= limit && by[name].plain >= by[name].batched * 2, JSON.stringify(by[name]))
  }
  check('every section on: the day summary is at least 4x cheaper than before', by['every section on'].plain >= by['every section on'].batched * 4, JSON.stringify(by['every section on']))

  // 3. My share, with a one-round kernel.
  const ideal = build({ ideal: true })
  const dayIdeal = await daySummary(ideal, ALL)
  const overviewIdeal = await overviewMessage(ideal, 41)
  console.log(`one-round kernel: day summary ${dayIdeal.calls} calls, overview ${overviewIdeal.calls} calls (+${overviewIdeal.scheduling} to schedule it)`)
  check(`day summary, every section on, one-round kernel: ${dayIdeal.calls} calls (target 10 or fewer)`, dayIdeal.calls <= 10, `${dayIdeal.calls}`)
  check(`overview delivered, every section on, one-round kernel: ${overviewIdeal.calls} calls including the claim and the settle (target 10 or fewer)`, overviewIdeal.calls <= 10, `${overviewIdeal.calls}`)

  // Two overviews due in one tick (every section on, today's kernel): the drain sends ONE per invocation, so a tick stays under the
  // 50-call limit; the other goes out on the next tick. Unbatched two would have cost 218 calls in one invocation.
  const tick = build()
  for (const id of [41, 42]) assert.equal(await tick.telegram.scheduleTelegramShiftOverview(tick.env, id, NOW_MS), 'fallback')
  const ticks = []
  for (const at of [120_000, 420_000]) {
    tick.log.length = 0
    const sent = await tick.telegram.drainDueTelegramShiftOverviews(tick.env, NOW_MS + at, { limit: 10, sweepStale: true })
    ticks.push({ sent, calls: calls(tick) })
  }
  check(`two overviews due at once, cron limit 10: one per tick (${JSON.stringify(ticks)}), each tick under the 50-call limit, none lost`,
    ticks[0].sent === 1 && ticks[1].sent === 1 && ticks.every((t) => t.calls < 50), JSON.stringify(ticks))
  // Mutants: take the batching out of one entry point and its budget must break.
  const MUTANTS = [
    ['day summary not batched', (text) => text.replace('  env = coalesceD1Reads(env)\r\n  const totals = getSalesTotals', '  const totals = getSalesTotals').replace('  env = coalesceD1Reads(env)\n  const totals = getSalesTotals', '  const totals = getSalesTotals'), 'day'],
    ['overview figures not batched', (text) => text.replace('  env = coalesceD1Reads(env)\r\n  const scope = summaryScope', '  const scope = summaryScope').replace('  env = coalesceD1Reads(env)\n  const scope = summaryScope', '  const scope = summaryScope'), 'figures'],
    ['overview delivery not batched', (text) => text.replace('const reads = coalesceD1Reads(env)', 'const reads = env'), 'delivery'],
  ]
  const figuresCalls = async (w) => { w.log.length = 0; await w.telegram.shiftOverviewFigures(w.env, { business_date: D2, branch_id: 1 }, 'Other', ALL, NOW_MS); return calls(w) }
  const scenario = { day: (w) => daySummary(w, ALL).then((r) => r.calls), figures: figuresCalls, delivery: (w) => overviewMessage(w, 41).then((r) => r.calls) }
  for (const [name, mutate, kind] of MUTANTS) {
    const source = require('fs').readFileSync(require('path').join(world.root, 'src', 'lib', 'telegram.ts'), 'utf8')
    assert.notStrictEqual(mutate(source), source, `positive control: mutant "${name}" must change the source`)
    const baseline = await scenario[kind](build({ ideal: true })), broken = await scenario[kind](build({ ideal: true, mutate }))
    check(`mutant "${name}": more calls than the real code with the one-round kernel (${broken} against ${baseline})`, broken > baseline, `${broken} vs ${baseline}`)
  }

  console.log(`\n${passed} checks passed; ${posts.length} messages composed for the local stand-in (none sent anywhere).`)
}

main().catch((error) => { console.error(error); process.exit(1) })
