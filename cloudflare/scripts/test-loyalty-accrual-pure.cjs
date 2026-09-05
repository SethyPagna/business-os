// Loyalty accrual flag (migration 0061): a sale with loyalty_accrual = 0
// (historical import, POS opt-out) must never EARN points, while points
// REDEEMED on it stay spent. Balances are computed by summing sales, so this
// is enforced at every aggregation site — proven here against the REAL
// migration schema, the REAL route SQL, and the REAL summarizePoints source.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8').replace(/\r\n/g, '\n')

// ---- 1. Schema: column exists, defaults to 1 ----
const sqlite = new Database(':memory:')
for (const migration of loadAll()) sqlite.exec(migration)
sqlite.prepare(`INSERT INTO customers (id, name) VALUES (7, 'Dara')`).run()
const insertSale = sqlite.prepare(`
  INSERT INTO sales (receipt_number, customer_id, total_usd, total_khr, membership_points_redeemed, sale_status, loyalty_accrual)
  VALUES (@r, 7, @usd, @khr, @redeemed, 'completed', @accrual)
`)
insertSale.run({ r: 'R-1', usd: 10, khr: 41000, redeemed: 0, accrual: 1 })
insertSale.run({ r: 'R-2', usd: 90, khr: 369000, redeemed: 5, accrual: 0 }) // historical
sqlite.prepare(`INSERT INTO sales (receipt_number, customer_id, total_usd, total_khr, sale_status) VALUES ('R-3', 7, 2, 8200, 'completed')`).run()
const defaulted = sqlite.prepare(`SELECT loyalty_accrual FROM sales WHERE receipt_number = 'R-3'`).get()
assert.equal(defaulted.loyalty_accrual, 1, 'omitting the column must default to accruing (old writers unaffected)')

// ---- 2. The redemption-check aggregation SQL, taken from the route source ----
const salesRoute = read(path.join('routes', 'sales.ts'))
const aggMatch = salesRoute.match(/`(SELECT\s*\n\s*COALESCE\(SUM\(CASE WHEN[\s\S]*?FROM sales WHERE customer_id = \?)`/)
assert.ok(aggMatch, 'routes/sales.ts still contains the earned/redeemed aggregation')
const agg = sqlite.prepare(aggMatch[1]).get(7)
assert.equal(agg.earned_usd, 12, 'earned skips the accrual=0 sale ($10 + $2, not the $90 historical)')
assert.equal(agg.earned_khr, 49200, 'earned_khr skips the accrual=0 sale too')
assert.equal(agg.redeemed, 5, 'points redeemed on a non-accruing sale still count as spent')

// ---- 3. The notifications aggregation SQL, same treatment ----
const notifications = read(path.join('routes', 'notifications.ts'))
const notifMatch = notifications.match(/`\s*\n\s*(SELECT customer_id,\s*\n[\s\S]*?GROUP BY customer_id)\s*\n\s*`/)
assert.ok(notifMatch, 'routes/notifications.ts still contains the loyalty sales aggregation')
const notifRow = sqlite.prepare(notifMatch[1]).all().find((r) => r.customer_id === 7)
assert.equal(notifRow.sales_usd, 12, 'notifications earned skips the accrual=0 sale')
assert.equal(notifRow.redeemed, 5, 'notifications redeemed still counts the non-accruing sale')

// ---- 4. summarizePoints (REAL portal.ts source, extracted + transpiled) ----
const portal = read(path.join('routes', 'portal.ts'))
const calcStart = portal.indexOf('function calculatePointsValue')
const sumStart = portal.indexOf('export function summarizePoints')
assert.ok(calcStart > 0 && sumStart > calcStart, 'portal.ts still defines calculatePointsValue + summarizePoints')
const sumEnd = portal.indexOf('\n}', portal.indexOf('return {', sumStart)) + 2
const extracted = 'const toNumber = (v) => Number(v) || 0\n' + portal.slice(calcStart, sumEnd)
const output = ts.transpileModule(extracted, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', output)(moduleObj.exports, require, moduleObj)
const { summarizePoints } = moduleObj.exports
const config = { pointsBasis: 'usd', pointsPerUsd: 1, pointsPerKhr: 0, redeemPoints: 100 }
const summary = summarizePoints([
  { sale_status: 'completed', total_usd: 10, total_khr: 41000, membership_points_redeemed: 0, loyalty_accrual: 1 },
  { sale_status: 'completed', total_usd: 90, total_khr: 369000, membership_points_redeemed: 5, loyalty_accrual: 0 },
  { sale_status: 'completed', total_usd: 2, total_khr: 8200, membership_points_redeemed: 0 }, // caller without the column
], [], [], config)
assert.equal(summary.earned, 12, 'summarizePoints earns only from accruing sales; absent column keeps the default')
assert.equal(summary.redeemed, 5, 'summarizePoints still counts redemption on a non-accruing sale')

// ---- 5. The two writers ----
const importCommit = read(path.join('lib', 'salesImportCommit.ts'))
assert.match(importCommit, /loyalty_accrual, sale_status, items/, 'import INSERT carries the column')
assert.match(importCommit, /loyalty_accrual: input\.accrueLoyalty \? 1 : 0/, 'sales import defaults to 0, opts in only on explicit accrueLoyalty')

// The import-time loyalty OPTION: policy.accrue_loyalty gates it, safe default off.
const engine = read(path.join('lib', 'importEngine.ts'))
const gsMatch = engine.match(/export function getSalesImportAccrueLoyalty[\s\S]*?\n}/)
assert.ok(gsMatch, 'importEngine exports getSalesImportAccrueLoyalty')
const gsOut = ts.transpileModule(gsMatch[0].replace('export function', 'function') + '\nmodule.exports = { getSalesImportAccrueLoyalty }',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const gsMod = { exports: {} }
new Function('exports', 'require', 'module', gsOut)(gsMod.exports, require, gsMod)
const { getSalesImportAccrueLoyalty } = gsMod.exports
assert.equal(getSalesImportAccrueLoyalty(JSON.stringify({ accrue_loyalty: true })), true, 'explicit opt-in accrues')
assert.equal(getSalesImportAccrueLoyalty(JSON.stringify({ accrue_loyalty: false })), false, 'explicit false does not')
assert.equal(getSalesImportAccrueLoyalty(null), false, 'absent policy defaults to no accrual')
assert.equal(getSalesImportAccrueLoyalty('{bad json'), false, 'malformed policy defaults to no accrual')
assert.match(engine, /accrueLoyalty,\n\s*\}\)/, 'apply loop threads accrueLoyalty into the sale writer')
assert.match(salesRoute, /loyalty_accrual: \(typeof body\.loyalty_accrual === 'boolean' \? body\.loyalty_accrual : loyaltyPointsEnabled\) \? 1 : 0/, 'POS route: explicit boolean wins, otherwise use the current setting default')
const contacts = read(path.join('routes', 'contacts.ts'))
assert.match(contacts, /COALESCE\(loyalty_accrual, 1\) AS loyalty_accrual/, 'contacts feeds the flag into summarizePoints')
const pos = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'pos', 'POS.tsx'), 'utf8').replace(/\r\n/g, '\n')
const posPayload = pos.match(/loyalty_accrual: ([^,\n]+),/)
assert.ok(posPayload, 'POS checkout sends an explicit accrual decision')
// Execute the actual payload expression. The membership worker resolves the
// tab's inherited default into loyaltyAccrual before constructing this body;
// the earlier isolated base expresses its explicit boolean on active instead.
const posAccrual = new Function('active', 'loyaltyAccrual', 'return ' + posPayload[1])
for (const flag of [true, false]) assert.equal(posAccrual({ loyaltyAccrual: flag }, flag), flag, 'POS payload preserves the explicit boolean in either direction')

// ---- Part-77 (MEDIUM): manual awards count at CHECKOUT, not just in the
// display. summarizePoints (the balance POS shows) adds
// loyalty_point_adjustments; the checkout re-validation omitted the term,
// so a manually-awarded customer saw a redeemable balance the sale then
// refused with "Insufficient points balance". The two formulas must not
// drift.
sqlite.prepare(`INSERT INTO loyalty_point_adjustments (customer_id, points, note) VALUES (7, 50, 'welcome bonus')`).run()
const adjustedRow = sqlite.prepare(`SELECT COALESCE(SUM(points), 0) AS adjusted FROM loyalty_point_adjustments WHERE customer_id = 7`).get()
assert.equal(adjustedRow.adjusted, 50, 'the aggregation the route runs sees the manual award')
assert.match(salesRoute, /SUM\(points\), 0\) AS adjusted FROM loyalty_point_adjustments WHERE customer_id = \?/, 'checkout re-validation reads manual awards')
assert.match(salesRoute, /\+ rewarded \+ manuallyAwarded\)/, 'checkout balance includes the manual-award term')
const portalRoute = read(path.join('routes', 'portal.ts'))
assert.match(portalRoute, /\+ rewarded \+ manuallyAwarded\)/, 'summarizePoints keeps the same term (display/checkout parity)')

// ---- 6. The shop-wide membership-points switch (settings key
// `loyalty_points_enabled`). User, Sep 4 2026: "make the membership points on
// off in settings". Sep 5 clarification: the setting is the default for new
// sales; an explicit per-sale boolean overrides it. Existing rows are never
// rewritten. Redemption still has its separate shop-wide gate below.
assert.match(
  salesRoute,
  /SELECT value FROM settings WHERE key = 'loyalty_points_enabled'/,
  'the sale writer reads the switch from settings rather than trusting the request',
)

// Take the REAL two lines out of the route and run them, so this proves the
// shipped expression rather than a restatement of it.
const switchReadMatch = salesRoute.match(/const loyaltyPointsEnabled = !\[[^\]]*\]\.includes\(String\(loyaltyEnabledRow\?\.value \?\? ''\)[^\n]*\)/)
assert.ok(switchReadMatch, 'routes/sales.ts still resolves loyaltyPointsEnabled from the settings row')
const writerMatch = salesRoute.match(/loyalty_accrual: (\(typeof body\.loyalty_accrual[^\n]+\? 1 : 0),/)
assert.ok(writerMatch, 'routes/sales.ts still writes loyalty_accrual through a single expression')

const resolveAccrual = new Function('settingValue', 'bodyFlag', [
  'const loyaltyEnabledRow = settingValue === undefined ? undefined : { value: settingValue }',
  switchReadMatch[0],
  'const body = { loyalty_accrual: bodyFlag }',
  'return ' + writerMatch[1],
].join('\n'))

// Default OFF can be deliberately overridden ON on this sale.
assert.equal(resolveAccrual('false', true), 1, 'explicit true overrides default off')
for (const off of ['0', 'false', 'no', 'off', 'OFF', ' False ']) {
  assert.equal(resolveAccrual(off, true), 1, `explicit true overrides "${off}"`)
  assert.equal(resolveAccrual(off, false), 0, `explicit false preserves "${off}"`)
  assert.equal(resolveAccrual(off, undefined), 0, `"${off}" must read as off with no body flag`)
}
// On, and absent, both accrue -- a shop that has never touched the switch is
// unchanged, which is the whole reason the default is on.
for (const on of [undefined, '', 'true', '1', 'yes', 'anything']) {
  assert.equal(resolveAccrual(on, true), 1, `"${on}" must read as on`)
  assert.equal(resolveAccrual(on, undefined), 1, `"${on}" must accrue by default`)
}
// The per-sale opt-out still works while the programme is on.
assert.equal(resolveAccrual('true', false), 0, 'an explicit per-sale opt-out still opts out')
for (const invalid of [null, '', 'false', 'true', 0, 1, {}, []]) {
  assert.equal(resolveAccrual('true', invalid), 1, 'non-boolean body uses default on')
  assert.equal(resolveAccrual('false', invalid), 0, 'non-boolean body uses default off')
}

// Off must also stop a redemption being TAKEN. Dropping it silently would
// charge the full total while the cashier's screen still showed the discount,
// so the route refuses instead.
assert.match(
  salesRoute,
  /Membership points are turned off in Settings/,
  'a redemption attempted while the programme is off is refused, not silently dropped',
)

// The switch is a sales-policy setting, so a sales_policy grant can flip it
// and it is not buried behind full admin.
const settingsRoute = read(path.join('routes', 'settings.ts'))
assert.match(settingsRoute, /'loyalty_points_enabled'/, 'the switch is a recognised settings key')

// Forward-only, precisely: the reported balance stays truthful and only
// SPENDING is gated. A gate on `balance` would blank points a customer already
// holds, which is the retroactive change the ruling excludes.
assert.match(portalRoute, /const spendable = config\.loyaltyPointsEnabled !== false/, 'portal gates spending on the switch')
assert.match(portalRoute, /const redeemableUnits = spendable \?/, 'redeemable units are what the switch zeroes')
assert.ok(
  !/loyaltyPointsEnabled === false[\s\S]{0,200}balance: 0/.test(portalRoute),
  'the switch must NOT zero the reported balance -- that would be retroactive',
)
{
  const offSummary = summarizePoints(
    [{ sale_status: 'completed', total_usd: 500, total_khr: 0, membership_points_redeemed: 0, loyalty_accrual: 1 }],
    [], [], { ...config, redeemValueUsd: 1, redeemValueKhr: 4100, loyaltyPointsEnabled: false },
  )
  assert.equal(offSummary.balance, 500, 'a balance already earned is still reported while the programme is off')
  assert.equal(offSummary.redeemableUnits, 0, 'nothing is redeemable while the programme is off')
  assert.equal(offSummary.redeemValueUsd, 0, 'no redemption value is offered while the programme is off')
  assert.equal(offSummary.nextRedeemNeeded, 0, 'no "points to next reward" is dangled while the programme is off')

  const onSummary = summarizePoints(
    [{ sale_status: 'completed', total_usd: 500, total_khr: 0, membership_points_redeemed: 0, loyalty_accrual: 1 }],
    [], [], { ...config, redeemValueUsd: 1, redeemValueKhr: 4100, loyaltyPointsEnabled: true },
  )
  assert.equal(onSummary.redeemableUnits, 5, 'switching back on restores redemption with nothing rewritten')
}

// The till must not do this arithmetic itself. It used to divide the balance
// by the step, which would go on offering redemptions after the switch was
// flipped, because the balance stays truthful by design.
assert.match(pos, /membershipInfo\?\.points\?\.redeemableUnits/, 'the POS reads the redeemable count the server computed')

// ---- 7. Voided ledger rows stop counting, at every site that counts them.
// Migration 0117 MARKS rather than deletes: loyalty_point_adjustments carries
// CHECK (points > 0), so a compensating negative row is schema-impossible, and
// deleting an administrator's hand-issued ledger would destroy an audit trail.
// A void filter that is missing anywhere means a "zeroed" balance comes back
// non-zero on that one surface.
for (const [label, source, needles] of [
  ['contacts', contacts, [/FROM loyalty_point_adjustments[^`]*voided_at IS NULL/, /customer_share_submissions[^`]*reward_points_voided_at IS NULL/]],
  ['notifications', notifications, [/customer_share_submissions[^`]*reward_points_voided_at IS NULL/]],
  ['sales checkout', salesRoute, [/FROM loyalty_point_adjustments[^`]*voided_at IS NULL/, /customer_share_submissions[^`]*reward_points_voided_at IS NULL/]],
]) {
  for (const needle of needles) {
    assert.match(source, needle, `${label} still counts voided ledger rows -- a reset would not hold there`)
  }
}

// portal.ts owns the FORMULA but reads neither ledger: contacts.ts's
// computeCustomerPointsMap is the single gateway that loads both and hands
// them in. That is why the filters above live there and not here -- and it is
// also the property worth pinning, because a second loader would be a fourth
// place to forget a void filter.
assert.match(portalRoute, /adjustments: Array<Record<string, unknown>> = \[\]/, 'summarizePoints receives adjustments rather than querying them')

// The alert that chases customers toward a points target must go quiet while
// the programme is off; it is a prompt to act on something switched off.
assert.match(
  notifications,
  /loyalty_points_enabled[\s\S]{0,400}return null/,
  'the loyalty notification section is gated on the switch',
)

// KNOWN, DELIBERATELY NOT FIXED HERE, AND RECORDED SO IT IS NOT LOST:
// buildLoyaltySection computes `earned - deducted - redeemed + rewarded` and
// omits the manual-adjustment term the other three sites include, so its
// balance already disagrees with them. Pre-existing drift, its own item. It is
// pinned here because migration 0117 will HIDE it -- once every term is zero
// all four sites agree, and the disagreement only returns the first time
// someone issues a new adjustment, by which point nothing connects it to the
// reset. This assertion documents the state; change it when the drift is
// fixed, do not delete it.
assert.ok(
  !/\+ rewarded \+ manuallyAwarded\)/.test(notifications),
  'notifications still omits the manual-adjustment term (known drift, tracked separately) -- if this now fails, the drift was fixed and this assertion should be inverted',
)

console.log('test-loyalty-accrual-pure: all checks passed')
