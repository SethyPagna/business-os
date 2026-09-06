// ONE WORD for customer credit (owner, Sep 6 2026):
//
//   "i already mentioned the credit amount/unpaid make it consistent just use
//    credit don't use both, it cause confusion... don't minus for credit amount
//    add into revenue and profit, just note the credit amount is that much so
//    instead of $-n... just $n... so we know no need to remove from profit"
//
// One sale status carried FIVE user-visible names at once -- "Awaiting
// Payment", "Not Paid", "Unpaid net sales", "Pending", "awaiting payment" --
// and the Khmer pack carried three ("រង់ចាំការទូទាត់", "មិនទាន់បង់",
// "ឥណទាន"). This pins the single word in both packs: **Credit** / **ឥណទាន**.
//
// It also pins the two hints that were factually WRONG about the arithmetic,
// which is what made the wording confusing in the first place:
//   * rpt_hint_pending_revenue said "Not counted in revenue above" while
//     rpt_hint_pending, three keys away, said "Included in sales, revenue, and
//     profit". Both described the same figure. The kernel (recognizedExpr is
//     `<> 'cancelled'`) includes it, so the second one was right.
//   * rpt_hint_pending_profit said "no figure above includes it".
//   * rpt_hint_sales_list said credit rows "show 0" -- routes/reports.ts's
//     net_revenue_usd column gates on `recognized`, so a credit row shows its
//     full revenue, not 0.
//
// SUPPLIER credit is a different ledger (money the shop owes a supplier) and
// is deliberately left alone; the keep-set below is the positive control that
// proves this test can tell the two apart instead of matching "credit"
// everywhere.
//
// Run: node tests/creditWording.test.ts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>

/** The one Khmer term for customer credit. */
const KM_CREDIT = 'ឥណទាន'

/** Khmer phrasings this lane retires from the customer-credit keys. */
const KM_RETIRED = ['មិនទាន់បង់', 'រង់ចាំការទូទាត់', 'រង់ចាំទូទាត់', 'រង់ចាំបង់ប្រាក់', 'តាមទ្រឹស្តី']

/** English words that must not describe a customer credit sale any more. */
const EN_RETIRED = [/\bunpaid\b/i, /\bnot paid\b/i, /\bawaiting[- ]payment\b/i, /\bawaiting payment\b/i, /\bpending\b/i, /\btheoretical\b/i]

/**
 * Every key whose value a user reads about a CUSTOMER credit sale. Enumerated
 * (not pattern-matched) so adding a sixth name for the status is a failing
 * test rather than a silent sixth name.
 */
const CREDIT_KEYS = [
  'awaiting_payment_title',
  'behavior3',
  'credit_awaiting_payment',
  'notification_sales_alerts_desc',
  'pos_status_awaiting_payment_desc',
  'rpt_hint_collected',
  'rpt_hint_delivery_collected',
  'rpt_hint_delivery_net',
  'rpt_hint_gross_profit',
  'rpt_hint_pending',
  'rpt_hint_sales_list',
  'rpt_pending_credit',
  'rpt_profit_hint',
  'stats_profit_hint',
  'stats_sales_hint',
  'status_awaiting_payment',
  'summary_awaiting_payment',
]

/**
 * Same rule, but for pack keys NO component reads. They describe a per-figure
 * credit block under the report totals (gross sales / discounts / net sales /
 * cost of goods / profit, each with its own hint) that was never wired up:
 * grep the ref for any of them outside src/lang and you get nothing, on this
 * branch and on the integration tip. Pre-existing, and NOT this lane's to
 * build -- components/sales/reports/** belongs to the reports lane, and the
 * handoff asks it either to render the block or to retire the keys.
 *
 * They are still held to the one-word rule below, because the day the block
 * IS rendered it must not reintroduce a sixth name. Section 8 proves the list
 * really is unrendered, so a key that starts being used moves up, not down.
 */
const CREDIT_KEYS_UNRENDERED = [
  'rpt_hint_pending_cogs',
  'rpt_hint_pending_delivery_paid',
  'rpt_hint_pending_gross',
  'rpt_hint_pending_profit',
  'rpt_hint_pending_revenue',
  'rpt_pending_block',
  'rpt_pending_cogs',
  'rpt_pending_delivery_collected',
  'rpt_pending_delivery_paid',
  'rpt_pending_discounts',
  'rpt_pending_gross_sales',
  'rpt_pending_profit',
  'rpt_pending_revenue',
]

/** Every credit key, rendered or not: sections 1-4 hold both to one word. */
const ALL_CREDIT_KEYS = [...CREDIT_KEYS, ...CREDIT_KEYS_UNRENDERED]

/**
 * POSITIVE CONTROL. Supplier credit -- what the shop owes a supplier -- keeps
 * its own wording. If the sweep above were matching on the word "credit"
 * rather than on this lane's enumerated key list, these would have been
 * rewritten too and this block would fail.
 */
const SUPPLIER_KEEP: Record<string, string> = {
  supplier_credit: 'Credit',
  fast_stockin_credit_due: 'On-credit stock needs a due date',
  notification_supplier_credit_alerts_desc: 'Unpaid supplier purchases coming due or overdue',
  notification_supplier_credit_days_desc: 'Remind when an on-credit supplier purchase is due inside this many days (overdue ones always show).',
  credit_needs_due_date: 'A credit purchase needs its due date — the admin reminder is built on it.',
  credit_open: 'On credit',
  on_credit: 'On credit',
}

let checks = 0
const check = (label: string, cond: boolean) => { assert.ok(cond, label); checks++ }

// ---- 1. Both packs carry every key -----------------------------------------
for (const key of ALL_CREDIT_KEYS) {
  check(`en.json defines ${key}`, typeof en[key] === 'string' && String(en[key]).length > 0)
  check(`km.json defines ${key}`, typeof km[key] === 'string' && String(km[key]).length > 0)
}

// ---- 2. ONE WORD in English -------------------------------------------------
for (const key of ALL_CREDIT_KEYS) {
  const value = String(en[key])
  check(`en ${key} says "credit"`, /credit/i.test(value))
  for (const retired of EN_RETIRED) {
    check(`en ${key} no longer says ${retired.source}: ${JSON.stringify(value)}`, !retired.test(value))
  }
}

// ---- 3. ONE TERM in Khmer ---------------------------------------------------
for (const key of ALL_CREDIT_KEYS) {
  const value = String(km[key])
  check(`km ${key} uses ${KM_CREDIT}`, value.includes(KM_CREDIT))
  for (const retired of KM_RETIRED) {
    check(`km ${key} no longer uses ${retired}: ${JSON.stringify(value)}`, !value.includes(retired))
  }
  // Half-translated values ("ការលក់ awaiting payment និង cancelled") read worse
  // than either language on its own.
  check(`km ${key} is not half English`, !/\b(awaiting|unpaid|pending|cancelled|completed)\b/i.test(value))
}

// ---- 4. Never a leading minus, never a deduction ----------------------------
// The owner's second sentence: "instead of $-n... just $n". No credit label may
// carry a minus sign or a subtraction arrow of its own.
for (const key of ALL_CREDIT_KEYS) {
  for (const [lang, pack] of [['en', en], ['km', km]] as const) {
    const value = String(pack[key])
    check(`${lang} ${key} carries no leading minus`, !/[-−]\s*[$0-9{]/.test(value))
  }
}

// ---- 5. The arithmetic the labels describe is the kernel's ------------------
// These three hints contradicted each other about one figure. Pin the true
// one: credit is INSIDE revenue, COGS and profit, and out of collected cash
// only.
const pendingRevenueHint = String(en.rpt_hint_pending_revenue)
check('rpt_hint_pending_revenue no longer claims the credit is outside revenue',
  !/not counted in revenue/i.test(pendingRevenueHint) && !/would add to revenue/i.test(pendingRevenueHint))
check('rpt_hint_pending_revenue says the credit is already inside revenue',
  /already/i.test(pendingRevenueHint))
check('rpt_hint_pending_profit no longer claims no figure above includes it',
  !/no figure above includes it/i.test(String(en.rpt_hint_pending_profit)))
check('rpt_hint_pending still names sales, revenue and profit as containing it',
  /sales/i.test(String(en.rpt_hint_pending)) && /revenue/i.test(String(en.rpt_hint_pending)) && /profit/i.test(String(en.rpt_hint_pending)))
check('rpt_hint_sales_list no longer says a credit row shows 0 (routes/reports.ts gates net_revenue_usd on `recognized`, which admits credit)',
  !/rows show 0/i.test(String(en.rpt_hint_sales_list)))
check('rpt_hint_collected still says credit is excluded from COLLECTED cash (the one place it is)',
  /credit/i.test(String(en.rpt_hint_collected)) && /exclud/i.test(String(en.rpt_hint_collected)))

// ---- 6. POSITIVE CONTROL: supplier credit untouched -------------------------
for (const [key, expected] of Object.entries(SUPPLIER_KEEP)) {
  check(`supplier-credit key ${key} keeps its wording`, en[key] === expected)
}
check('the control set really contains a retired word, so it would have caught an over-broad sweep',
  EN_RETIRED.some((r) => r.test(SUPPLIER_KEEP.notification_supplier_credit_alerts_desc)))

// ---- 7. The surfaces' hardcoded English fallbacks say Credit too ------------
// `translateOr(key, fallback)` renders the fallback whenever the key is
// missing, so a stale fallback is a sixth name waiting for one missing key.
const surfaces: [string, string[]][] = [
  ['../src/utils/saleStatus.ts', ['Awaiting Payment']],   // STATUS_LABELS lives here now
  ['../src/components/sales/StatusBadge.tsx', ['Awaiting Payment']],
  ['../src/components/pos/POS.tsx', ['Awaiting Payment']],
  ['../src/components/sales/SaleDetailModal.tsx', ['Credit — awaiting payment']],
  ['../src/components/loyalty-points/LoyaltyPointsPage.tsx', ['Awaiting payment and cancelled sales']],
]
for (const [rel, banned] of surfaces) {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const phrase of banned) {
    check(`${rel} no longer hardcodes "${phrase}"`, !src.includes(phrase))
  }
}

// ---- 8. The rendered/unrendered split above is a FACT, not a claim ---------
// If the reports lane wires the credit block up, its keys stop being
// unrendered and belong in CREDIT_KEYS -- this fails then, instead of the
// browser plan quietly expecting a block that no component draws.
const srcRoot = new URL('../src/', import.meta.url)
const srcFiles = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' })
  .map((rel) => rel.replace(/\\/g, '/'))
  .filter((rel) => /\.(ts|tsx)$/.test(rel) && !rel.startsWith('lang/'))
const srcText = srcFiles.map((rel) => readFileSync(new URL(rel, srcRoot), 'utf8')).join('\n')
check('the src sweep really loaded the components (control)', srcFiles.length > 100 && srcText.includes("'rpt_pending_credit'"))
for (const key of CREDIT_KEYS_UNRENDERED) {
  check(`${key} is still referenced by no component -- if this fails, move it into CREDIT_KEYS`, !srcText.includes(`'${key}'`) && !srcText.includes(`"${key}"`))
}
for (const key of ['rpt_pending_credit', 'rpt_hint_pending', 'status_awaiting_payment']) {
  check(`${key} IS rendered by a component`, srcText.includes(`'${key}'`))
}

console.log(`PASS creditWording: ${checks} checks -- one word "Credit" / "${KM_CREDIT}" across ${ALL_CREDIT_KEYS.length} keys in both packs (${CREDIT_KEYS.length} rendered, ${CREDIT_KEYS_UNRENDERED.length} pack-only)`)
