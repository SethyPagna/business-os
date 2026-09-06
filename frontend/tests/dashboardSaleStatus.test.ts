// The Dashboard printed a CREDIT sale as a green "Completed".
//
// Dashboard.tsx carried its own three-arm status mapping (refunded/returned ->
// "Refunded", pending/draft -> "Pending", everything else -> "Completed").
// 'awaiting_payment' matched neither of the first two arms, so it fell into
// "everything else": the Recent Sales chip, the View-more portal list and the
// recent-sale detail Status row all announced a credit sale as completed and
// tinted it emerald. cloudflare/src/routes/compat.ts spreads the raw sale row
// into the dashboard payload, so `sale_status` really is 'awaiting_payment' on
// the wire -- the data was right and the label was wrong.
//
// Root cause: TWO implementations of one rule. The sale-status vocabulary now
// lives in src/utils/saleStatus.ts, which both StatusBadge.tsx and this mapper
// read, so the Dashboard chip and the Sales-list badge cannot drift again.
//
// Red at 01f0c93c: src/utils/dashboardSaleStatus.ts does not exist there, and
// the mapping it replaces returns t('completed') for 'awaiting_payment'.
//
// Run: node tests/dashboardSaleStatus.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dashboardSaleStatusLabel, dashboardSaleStatusTone } from '../src/utils/dashboardSaleStatus.ts'
import { ALL_STATUSES, STATUS_COLORS, getStatusLabel } from '../src/utils/saleStatus.ts'

let checks = 0
const check = (label: string, cond: boolean) => { assert.ok(cond, label); checks++ }
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const tOf = (pack: Record<string, string>) => (key: string) => pack[key] ?? key

// ---- 1. The defect itself, in both packs -----------------------------------
for (const [lang, pack] of [['en', en], ['km', km]] as const) {
  const t = tOf(pack)
  check(`${lang}: a credit sale reads the pack's status_awaiting_payment`,
    dashboardSaleStatusLabel('awaiting_payment', t) === t('status_awaiting_payment'))
  // The discriminating half: the OLD mapper returned exactly this instead.
  check(`${lang}: a credit sale is not labelled Completed`,
    dashboardSaleStatusLabel('awaiting_payment', t) !== t('completed'))
  check(`${lang}: nor the completed status label`,
    dashboardSaleStatusLabel('awaiting_payment', t) !== t('status_completed'))
  // The owner's one word, not five.
  check(`${lang}: and it is the one credit word`,
    dashboardSaleStatusLabel('awaiting_payment', t) === (lang === 'en' ? '⏳ Credit' : '⏳ ឥណទាន'))
}

// With no pack at all the English fallback is still Credit, never Completed.
check('with no translator it falls back to Credit', dashboardSaleStatusLabel('awaiting_payment') === 'Credit')

// POSITIVE CONTROL: the mapping this replaces, transcribed from Dashboard.tsx
// at 01f0c93c. It is run on the SAME input, and it disagrees -- so the two
// assertions above discriminate between the old code and the new rather than
// being true of both.
const mapperAt01f0c93c = (status: unknown, t: (k: string) => string) => {
  const key = String(status || '').toLowerCase()
  if (key === 'refunded' || key === 'returned') return t('refunded')
  if (key === 'pending' || key === 'draft') return t('pending')
  return t('completed')
}
check('POSITIVE CONTROL: the old mapper called a credit sale Completed',
  mapperAt01f0c93c('awaiting_payment', tOf(en)) === tOf(en)('completed')
  && mapperAt01f0c93c('awaiting_payment', tOf(en)) !== dashboardSaleStatusLabel('awaiting_payment', tOf(en)))
check('POSITIVE CONTROL: and it agreed with the new one everywhere else it was asked',
  mapperAt01f0c93c('refunded', tOf(en)) === dashboardSaleStatusLabel('refunded', tOf(en)))

// ---- 2. The tone -----------------------------------------------------------
// The chip was emerald (the "completed" tone). Credit is yellow, the same
// yellow the Sales-list StatusBadge uses -- one vocabulary, one colour.
const creditTone = dashboardSaleStatusTone('awaiting_payment')
check('a credit chip is yellow', creditTone.includes('yellow'))
check('a credit chip is not the completed emerald/green tone',
  !creditTone.includes('emerald') && !creditTone.includes('green'))
check('the tone is the shared vocabulary tone, not a private copy',
  creditTone === STATUS_COLORS.awaiting_payment)

// ---- 3. Every known status agrees with the badge, not just this one --------
for (const status of ALL_STATUSES) {
  check(`${status}: label matches the shared vocabulary`,
    dashboardSaleStatusLabel(status, tOf(en)) === getStatusLabel(status, tOf(en)))
  check(`${status}: tone matches the shared vocabulary`,
    dashboardSaleStatusTone(status) === STATUS_COLORS[status])
}

// ---- 4. Legacy values the vocabulary does not know keep their old arms ------
// 'refunded' and 'draft' are not SaleStatus members; older rows carry them.
check('legacy refunded still reads Refunded', dashboardSaleStatusLabel('refunded', tOf(en)) === tOf(en)('refunded'))
check('legacy refunded keeps the amber tone', dashboardSaleStatusTone('refunded').includes('amber'))
// en.json's 'pending' value IS the literal string 'pending' (a pack hole), so
// the hardcoded English fallback is what renders -- the same convention
// Dashboard's own translateOr uses. km.json has a real value, and gets it.
check('legacy draft still reads Pending in English', dashboardSaleStatusLabel('draft', tOf(en)) === 'Pending')
check('legacy draft reads the Khmer pending value', dashboardSaleStatusLabel('draft', tOf(km)) === km.pending)
check('legacy pending keeps the slate tone', dashboardSaleStatusTone('pending').includes('slate'))
// An empty/absent status is a completed sale, as it always was.
check('a blank status is still Completed', dashboardSaleStatusLabel('', tOf(en)) === tOf(en)('completed'))
check('a blank status keeps the emerald tone', dashboardSaleStatusTone('').includes('emerald'))

// ---- 5. Dashboard.tsx really uses it ---------------------------------------
const dashboard = read('../src/components/dashboard/Dashboard.tsx')
check('Dashboard imports the shared mapper',
  /import \{ dashboardSaleStatusLabel, dashboardSaleStatusTone \} from '\.\.\/\.\.\/utils\/dashboardSaleStatus\.ts'/.test(dashboard))
check('Dashboard no longer keeps a private status mapping',
  !/return completedStatusLabel/.test(dashboard) && !/const completedStatusLabel/.test(dashboard))
check('every dashboard status chip goes through the shared tone',
  !/getSaleStatusTone/.test(dashboard) && (dashboard.match(/dashboardSaleStatusTone\(sale\.sale_status\)/g) || []).length === 2)
check('formatSaleStatus delegates to the shared label',
  /const formatSaleStatus = useCallback\(\(status: unknown\) => dashboardSaleStatusLabel\(status, t\), \[t\]\)/.test(dashboard))

// ---- 6. StatusBadge and the mapper read ONE list ---------------------------
const badge = read('../src/components/sales/StatusBadge.tsx')
check('StatusBadge no longer declares its own status maps',
  !/export const STATUS_LABELS: Record/.test(badge) && !/export const STATUS_COLORS: Record/.test(badge))
check('StatusBadge re-exports the shared vocabulary', /from '\.\.\/\.\.\/utils\/saleStatus\.ts'/.test(badge))

console.log(`PASS dashboardSaleStatus: ${checks} checks -- a credit sale is Credit and yellow on the Dashboard, from the same vocabulary the Sales badge uses`)
