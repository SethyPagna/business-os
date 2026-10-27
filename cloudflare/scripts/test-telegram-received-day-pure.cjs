// Lane 6.0.1007. Owner, 27 Oct 2026 (owner-answers-27-oct item 16): the Telegram daily summary's Received section is
// the money actually received that day -- payments are dated by when they were taken, not by the day the sale was rung --
// and it must agree with the in-app reports for the same day.
//
// Pure: the REAL lib/telegram.ts, lib/dayPaymentsReceived.ts, lib/shiftReconciliation.ts and lib/salesAnalytics.ts over
// node:sqlite carrying the REAL migration chain. The in-app figure is the real shift reader (shiftCashSales + shiftRefunds)
// asked about a window that is exactly the business day, so the Telegram figure is checked against the code the shift
// report itself runs, not against a copy. The sales kernel's totals are stubs (revenue is not this lane's subject).
// Telegram is a local function: nothing is sent anywhere, every id is made up.
//
// Run (from cloudflare/): node scripts/test-telegram-received-day-pure.cjs
// Mutants: the same parity run against the module with one rule broken must FAIL (see MUTANTS below).
const world = require('./harness/received-day-world.cjs')
const { fs, path, assert, loadReal, seedStockFixture, openShop, insert, seedShop, buildModules, compatDb, root, D1, D2, D3, DAYS, NOW_MS } = world
const { telegramLang, salesAnalyticsReal, paymentMethodRegistry, shiftReconciliation, dayModule, loadTelegram } = buildModules(compatDb)

const posts = []
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith('https://api.telegram.org/botSYNTHETIC-TOKEN/'), `unexpected fetch ${url}`)
  posts.push(JSON.parse(init.body))
  return { ok: true, status: 200, text: async () => '' }
}

let passed = 0
const check = (name, cond, detail) => { assert.ok(cond, detail ? `${name}\n${detail}` : name); passed += 1; console.log(`PASS ${name}`) }

// ---- the in-app figure: the shift reader over a window that is exactly the business day --------------------------
const dayWindow = (date) => {
  const start = Date.parse(`${date}T00:00:00.000Z`) - 7 * 3_600_000
  return { opened_at: new Date(start).toISOString(), closed_at: new Date(start + 86_400_000).toISOString() }
}
async function inApp(env, date, branchId) {
  const session = { user_id: 0, scope_mode: 'shop_wide', branch_id: branchId, opening_float_usd: 0, opening_float_khr: 0, ...dayWindow(date) }
  const rows = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('pos_payment_methods', 'pos_payment_method_kinds')`).all()
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  const options = { kinds: paymentMethodRegistry.parsePaymentMethodKinds(values.pos_payment_method_kinds), configuredMethods: paymentMethodRegistry.parseConfiguredMethods(values.pos_payment_methods) }
  return { received: await shiftReconciliation.shiftCashSales(env, session, NOW_MS, options), refunded: await shiftReconciliation.shiftRefunds(env, session, NOW_MS) }
}
const plain = (value) => JSON.parse(JSON.stringify(value))

async function parity(env, module) {
  const mismatches = []
  for (const date of DAYS) {
    for (const branchId of [null, 1, 2]) {
      const theirs = plain(await inApp(env, date, branchId))
      const ours = plain(await module.dayPaymentsReceived(env, { business_date: date, branch_id: branchId }))
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) mismatches.push(`${date} branch ${branchId}: telegram ${JSON.stringify(ours)} vs in-app ${JSON.stringify(theirs)}`)
    }
  }
  return mismatches
}

const rowsUnder = (text, header) => {
  const lines = text.split('\n')
  const start = lines.indexOf(header)
  if (start < 0) return null
  const rows = []
  for (const line of lines.slice(start + 1)) { if (/^=+[^=].*[^=]=+$/.test(line)) break; rows.push(line) }
  return rows
}

async function main() {
  const shop = openShop()
  seedShop(shop)
  const env = { DB: shop, TELEGRAM_BOT_TOKEN: 'SYNTHETIC-TOKEN' }
  const real = dayModule((text) => text)
  const telegram = loadTelegram(real)

  // 1. Parity, by construction and by number.
  const mismatches = await parity(env, real)
  check('every day and branch: the Telegram figure is the in-app reader\'s (cash, riel, bank, review codes and refunds)', mismatches.length === 0, mismatches.join('\n'))

  const figures = async (date, branchId) => plain(await real.dayPaymentsReceived(env, { business_date: date, branch_id: branchId }))
  const brief = (value) => ({ usd: value.received.usd, khr: value.received.khr, bank: value.received.digital, refunded: value.refunded, review: value.received.reviewCodes })
  // Asserted as numbers too, so two readers wrong in the same way cannot pass.
  assert.deepStrictEqual(brief(await figures(D1, 1)), { usd: 10, khr: 0, bank: { usd: 0, khr: 0 }, refunded: { usd: 1, khr: 0 }, review: [] }, 'D1 branch 1')
  check('D1: only what was taken on D1 -- the $10 cash of S3 (not the later $30 or $20), $1 refunded', true)
  assert.deepStrictEqual(brief(await figures(D2, 1)), { usd: 48, khr: 41000, bank: { usd: 10, khr: 0 }, refunded: { usd: 5, khr: 10250 }, review: [] }, 'D2 branch 1')
  check('D2: S1 paid today (+30, rung D1), S3 corrected (-10 cash, +10 bank), S4 net of change (+18, 41,000 riel), old S5/S6 (+10); S2 and the cancelled/late/other-branch money out; refunds by hand-back day', true)
  assert.deepStrictEqual(brief(await figures(D3, 1)), { usd: 4, khr: 0, bank: { usd: 20, khr: 0 }, refunded: { usd: 0, khr: 0 }, review: [] }, 'D3 branch 1')
  check('D3: S2 paid today (+$20 bank, rung D2) and the first-second old sale S7 (+$4)', true)
  assert.deepStrictEqual(brief(await figures(D2, null)), { usd: 59, khr: 41000, bank: { usd: 10, khr: 0 }, refunded: { usd: 65, khr: 10250 }, review: [] }, 'D2 whole shop')
  check('D2 whole shop: the other branch\'s $11 and its $60 return are added to branch 1\'s figures', true)
  const d2Shop = await figures(D2, null)

  // 2. The old rule would have said something else: dated by the day the sale was rung.
  const old = async (date, branchId) => {
    const sold = salesAnalyticsReal.whereActiveSales('sales', { startDate: date, endDate: date, branchId })
    return plain(await shiftReconciliation.tenderWhere(env, [sold.sql], sold.params, { kinds: {}, configuredMethods: ['Cash', 'ABA Pay'] }))
  }
  const oldD2 = await old(D2, 1)
  const newD2 = (await figures(D2, 1)).received
  check('control: dating by the sale\'s creation day gives a DIFFERENT D2 than dating by receipt (so the parity above is not vacuous)',
    oldD2.usd !== newD2.usd || oldD2.digital.usd !== newD2.digital.usd, `${JSON.stringify(oldD2)} vs ${JSON.stringify(newD2)}`)

  // 3. The message itself, for each day, in both languages.
  const switches = { sales: true, cashiers: false, products: false, returns: false, expenses: false, compare: false }
  const report = (date, language) => telegram.telegramCommandReply(env, `/report ${date.split('-').reverse().join('/')}`, NOW_MS, language, undefined, switches)
  const en2 = await report(D2, 'en')
  const km2 = await report(D2, 'km')
  const both2 = await report(D2, 'both')
  const shopD2 = await figures(D2, null)
  check('D2 /report (English): Received rows are the day\'s receipts, then what was handed back',
    JSON.stringify(rowsUnder(en2, '=====Received=====')) === JSON.stringify([
      `· Dollars: $${shopD2.received.usd.toFixed(2)}`, `· Riel: ${shopD2.received.khr.toLocaleString('en-US')}៛`, `· Bank: $${shopD2.received.digital.usd.toFixed(2)}`,
      `· Refunded: $${shopD2.refunded.usd.toFixed(2)} · ${shopD2.refunded.khr.toLocaleString('en-US')}៛`,
    ]), en2)
  check('D2 /report (Khmer): the same rows in Khmer, the refund row from the pack\'s "refunded"',
    ['=====បានទទួល=====', '· ដុល្លារ:', '· រៀល:', '· ធនាគារ:', '· បានសងប្រាក់:'].every((line) => km2.includes(line)) && !/Received|Refunded|Dollars/.test(km2), km2)
  check('D2 /report (both languages): bilingual section title and refund row',
    both2.includes('=====Received/បានទទួល=====') && both2.includes('Refunded/បានសងប្រាក់'), both2)
  const packs = Object.fromEntries(['en', 'km'].map((pack) => [pack, JSON.parse(fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'lang', `${pack}.json`), 'utf8'))]))
  check('the new label is copied from the packs (km.json refunded), not hard-coded a second time',
    telegramLang.TELEGRAM_LABELS.refunded.en === packs.en.refunded && telegramLang.TELEGRAM_LABELS.refunded.km === packs.km.refunded,
    JSON.stringify([telegramLang.TELEGRAM_LABELS.refunded, packs.en.refunded, packs.km.refunded]))
  const en1 = await report(D1, 'en')
  const en3 = await report(D3, 'en')
  check('D1 /report: $10 dollars, no bank, $1 refunded', JSON.stringify(rowsUnder(en1, '=====Received=====')) === JSON.stringify(['· Dollars: $10.00', '· Riel: 0៛', '· Bank: $0.00', '· Refunded: $1.00']), en1)
  check('D3 /report: $4 dollars, $20 bank, nothing refunded (no Refunded row)', JSON.stringify(rowsUnder(en3, '=====Received=====')) === JSON.stringify(['· Dollars: $4.00', '· Riel: 0៛', '· Bank: $20.00']), en3)
  const quietReport = await telegram.telegramCommandReply(env, '/report 21/10/2026', NOW_MS, 'en')
  check('the section stays an opt-in: without the sales switch the day summary has no Received section', !quietReport.includes('=====Received====='), quietReport)

  // The after-shift overview reads the same figure for its branch.
  const overview = await telegram.shiftOverviewFigures(env, { business_date: D2, branch_id: 1 }, 'Other', switches, NOW_MS)
  const branchD2 = await figures(D2, 1)
  check('the after-shift overview for branch 1 carries the same received and refunded figures as the day module',
    JSON.stringify(plain(overview.sections.sales.received)) === JSON.stringify(branchD2.received) && JSON.stringify(plain(overview.sections.sales.refunded)) === JSON.stringify(branchD2.refunded),
    JSON.stringify(plain(overview.sections)))

  // 4. Rows read: every statement is a range on an index.
  const captured = []
  const spy = openShop()
  seedShop(spy)
  const realPrepare = spy.prepare.bind(spy)
  spy.prepare = (sql) => { captured.push(sql); return realPrepare(sql) }
  await real.dayPaymentsReceived({ DB: spy }, { business_date: D2, branch_id: 1 })
  const shape = (pattern) => captured.find((sql) => pattern.test(sql))
  const statements = {
    'version 0 sales': shape(/FROM sales WHERE/), 'payment events': shape(/FROM sale_payment_events/), 'refunds': shape(/FROM returns/),
  }
  const planOf = (sql) => spy.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...spy.bind(sql, { startDate: D2, endDate: D2, branchId: 1, from: dayWindow(D2).opened_at.slice(0, 19).replace('T', ' '), to: dayWindow(D2).closed_at.slice(0, 19).replace('T', ' ') })).map((row) => row.detail)
  const plans = Object.fromEntries(Object.entries(statements).map(([name, sql]) => [name, sql ? planOf(sql) : null]))
  for (const [name, plan] of Object.entries(plans)) check(`${name}: the statement exists`, plan !== null)
  const scans = (plan) => plan.filter((detail) => /^SCAN (sales|returns|e)\b/.test(detail) || /^SCAN sale_payment_events/.test(detail))
  check('version 0 sales: SEARCH on the created_at index, no table scan', plans['version 0 sales'].some((d) => /SEARCH sales USING INDEX \w*created\w*/.test(d)) && scans(plans['version 0 sales']).length === 0, plans['version 0 sales'].join(' | '))
  check('payment events: SEARCH on idx_sale_payment_events_received, sales by primary key, no table scan',
    plans['payment events'].some((d) => /SEARCH e USING INDEX idx_sale_payment_events_received/.test(d)) && plans['payment events'].some((d) => /SEARCH sales USING INTEGER PRIMARY KEY/.test(d)) && scans(plans['payment events']).length === 0,
    plans['payment events'].join(' | '))
  check('refunds: SEARCH on the returns created_at index, no table scan', plans.refunds.some((d) => /SEARCH returns USING INDEX \w*created\w*/.test(d)) && scans(plans.refunds).length === 0, plans.refunds.join(' | '))
  const reads = captured.filter((sql) => /FROM (sales|sale_payment_events|returns|settings)\b/.test(sql)).length
  check('four statements for the section: the cash settings, version 0 sales, payment events and refunds', reads === 4, `${reads}: ${captured.join('\n---\n')}`)

  // The same plans at production-like scale WITH planner statistics (ANALYZE), and a mutant that breaks the index range.
  const series = (count) => 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ' + count + ')'
  const spread = "strftime('%Y-%m-%d %H:%M:%S', '2026-09-01', '+' || (i % 90) || ' days', '+' || (i % 24) || ' hours')"
  seedStockFixture(spy.raw, () => spy.raw.exec([
    series(30000) + " INSERT INTO sales (id, receipt_number, branch_id, sale_status, created_at, exchange_rate, payments_version, payment_method, payment_details, amount_paid_usd, total_usd) SELECT 1000 + i, 'B-' || i, 1 + i % 2, 'completed', " + spread + ", 4100, i % 2, 'Cash', '[{\"method\":\"Cash\",\"amount_usd\":5}]', 5, 5 FROM n;",
    series(15000) + " INSERT INTO sale_payment_events (event_id, sale_id, direction, origin, payment_method, payment_details, amount_paid_usd, exchange_rate, received_at, branch_id) SELECT 'bulk-' || i, 1001 + 2 * (i % 14000), 'in', 'checkout', 'Cash', '[{\"method\":\"Cash\",\"amount_usd\":5}]', 5, 4100, " + spread + ", 1 + i % 2 FROM n;",
    series(6000) + " INSERT INTO returns (id, sale_id, branch_id, status, return_scope, created_at, total_refund_usd, total_refund_khr) SELECT 1000 + i, 1001 + i, 1 + i % 2, 'completed', 'customer', " + spread + ", 2, 8200 FROM n;",
    'ANALYZE;',
  ].join('\n')))
  const sizes = Object.fromEntries(['sales', 'sale_payment_events', 'returns'].map((table) => [table, spy.raw.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n]))
  const scaled = Object.fromEntries(Object.entries(statements).map(([name, sql]) => [name, planOf(sql)]))
  check('at scale (' + JSON.stringify(sizes) + ', ANALYZEd): all three statements still SEARCH an index and none scans its table',
    Object.values(scaled).every((plan) => plan.some((d) => /^SEARCH /.test(d)) && scans(plan).length === 0), JSON.stringify(scaled, null, 1))
  const window2 = [dayWindow(D2).opened_at, dayWindow(D2).closed_at].map((iso) => iso.slice(0, 19).replace('T', ' '))
  const created = (table) => spy.raw.prepare("SELECT COUNT(*) AS n FROM " + table + " WHERE created_at >= date(?, '-1 day') AND created_at < date(?, '+1 day')").get(D2, D2).n
  const touched = { sales: created('sales'), events: spy.raw.prepare('SELECT COUNT(*) AS n FROM sale_payment_events WHERE received_at >= ? AND received_at < ?').get(...window2).n, returns: created('returns') }
  check('rows the index range admits for one day are under 5% of each table (the sales range is the day and its neighbour UTC date) (sales ' + touched.sales + '/' + sizes.sales + ', events ' + touched.events + '/' + sizes.sale_payment_events + ', returns ' + touched.returns + '/' + sizes.returns + ')',
    touched.sales < sizes.sales / 20 && touched.events < sizes.sale_payment_events / 20 && touched.returns < sizes.returns / 20, JSON.stringify(touched))
  const wrapped = []
  const wrapSpy = { ...spy, prepare: (sql) => { wrapped.push(sql); return spy.prepare(sql) } }
  await dayModule((text) => text.replace('e.received_at >= @from AND e.received_at < @to', 'datetime(e.received_at) >= @from AND datetime(e.received_at) < @to')).dayPaymentsReceived({ DB: wrapSpy }, { business_date: D2, branch_id: 1 })
  const wrappedEventsPlan = planOf(wrapped.find((sql) => /FROM sale_payment_events/.test(sql)))
  check('mutant datetime(received_at): the plan check would go red (the index is no longer searched)', !wrappedEventsPlan.some((d) => /SEARCH e USING INDEX idx_sale_payment_events_received/.test(d)), wrappedEventsPlan.join(' | '))


  // 5. Mutants: each breaks one rule and the parity run must catch it.
  const MUTANTS = [
    ['created_day: events dated by the sale\'s creation day (the old behaviour)', (text) => text.replace('e.received_at >= @from AND e.received_at < @to', 'sales.created_at >= @from AND sales.created_at < @to')],
    ['ignore_out: undo/correction money out is not netted', (text) => text.replace("WHERE sales.payments_version = 1 AND", "WHERE e.direction = 'in' AND sales.payments_version = 1 AND")],
    ['no_upper_bound: events from the day onward', (text) => text.replace(' AND e.received_at < @to', '')],
    ['no_branch: the branch clause is dropped from events', (text) => text.replace(" AND e.branch_id = @branchId", '')],
    ['cancelled_counts: cancelled sales\' events are kept', (text) => text.replace("AND COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'\n      LIMIT", 'LIMIT').replace("AND COALESCE(NULLIF(sales.sale_status, ''), 'completed') <> 'cancelled'\r\n      LIMIT", 'LIMIT')],
    ['late_counts: a payment recorded outside the drawer counts', (text) => text.replace("(e.drawer_effect = 1 OR e.origin = 'opening')", '1 = 1').replace("payment_details: Number(row.drawer_effect) === 0 ? '' : row.payment_details", 'payment_details: row.payment_details')],
    ['refund_cancelled: cancelled returns are refunds', (text) => text.replace("AND COALESCE(returns.status, 'completed') <> 'cancelled' ", '')],
    ['refund_debt: a refund that only lowered a debt counts as cash out', (text) => text.replace("refundDrawerUsdSql('returns')", "'COALESCE(returns.total_refund_usd, 0)'")],
    ['refund_by_sale_day: refunds follow the original sale\'s day', (text) => text.replace("localDateRangeClause('returns.created_at')", "'returns.sale_id IN (SELECT id FROM sales WHERE ' + localDateRangeClause('sales.created_at') + ')'")],
    ['no_events: version 1 money is not read at all', (text) => text.replace('if (!eventRows.length) return', 'if (true) return')],
  ]
  for (const [name, mutate] of MUTANTS) {
    const before = fs.readFileSync(path.join(root, 'src', 'lib', 'dayPaymentsReceived.ts'), 'utf8')
    assert.notStrictEqual(mutate(before), before, `positive control: mutant ${name} must change the source`)
    const caught = await parity(env, dayModule(mutate))
    check(`mutant ${name}: the parity run goes red (${caught.length} mismatch${caught.length === 1 ? '' : 'es'})`, caught.length > 0, 'the mutant passed the parity run')
  }
  // The headline mutant, at message level: a Telegram built on it prints another D2.
  const createdDayMutant = loadTelegram(dayModule(MUTANTS[0][1]))
  const wrongD2 = await createdDayMutant.telegramCommandReply(env, '/report 21/10/2026', NOW_MS, 'en', undefined, switches)
  check('mutant created_day, at message level: the D2 Received rows differ from the real ones', JSON.stringify(rowsUnder(wrongD2, '=====Received=====')) !== JSON.stringify(rowsUnder(en2, '=====Received=====')), wrongD2)

  console.log(`\n${passed} checks passed; ${posts.length} messages sent (none: the Telegram API is a local stand-in).`)
}

main().catch((error) => { console.error(error); process.exit(1) })
