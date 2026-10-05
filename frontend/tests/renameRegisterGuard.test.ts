// Pins the owner's rename register so a renamed label cannot drift back.
//
// The register (old -> new, both languages, date, scope, deliberate
// exceptions) is Records/Lanes/2026-10-05/RENAME-CONSISTENCY-REPORT.md. The
// 5 Oct sweep found every rename had landed on the screens someone looked at
// and nowhere else: a Khmer value still carrying the old word, an English
// fallback that only shows when a pack lookup misses, a Worker refusal that
// reaches the user verbatim. verify:i18n cannot see any of that, because the
// keys exist in both packs; only the words are wrong.
//
// Three layers are checked for every rename: the flattened pack values (the
// way AppContext resolves them), the frontend code outside the packs, and the
// Worker's own copy. Comments may name the retired wording; shipping code may
// not. Each allowance below names the reason it is deliberate.
//
// Run: node tests/renameRegisterGuard.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const REPO = path.dirname(FRONTEND)
const read = (file: string): string => fs.readFileSync(file, 'utf8')

function flatten(input: unknown, target: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== 'object') return target
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value == null || Array.isArray(value)) continue
    if (typeof value === 'object') { flatten(value, target); continue }
    target[key] = String(value)
  }
  return target
}
const packFile = (name: string) => path.join(FRONTEND, 'src', 'lang', `${name}.json`)
const en = flatten(JSON.parse(read(packFile('en'))))
const km = flatten(JSON.parse(read(packFile('km'))))

const stripComments = (source: string): string => source
  .replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//g, '$1')
  .replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1')

function sourceFiles(dir: string, skip: (rel: string) => boolean): Array<[rel: string, code: string]> {
  const out: Array<[string, string]> = []
  const walk = (abs: string) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const full = path.join(abs, entry.name)
      const rel = path.relative(REPO, full).split(path.sep).join('/')
      if (entry.isDirectory()) { if (!skip(rel)) walk(full); continue }
      if (/\.(ts|tsx)$/.test(entry.name) && !skip(rel)) out.push([rel, stripComments(read(full))])
    }
  }
  walk(dir)
  return out
}
const frontendCode = sourceFiles(path.join(FRONTEND, 'src'), (rel) => rel.startsWith('frontend/src/lang'))
const workerCode = sourceFiles(path.join(REPO, 'cloudflare', 'src'), () => false)
assert.ok(frontendCode.length > 300 && workerCode.length > 100, 'the scan must actually read both packages')

type Allow = { file: string; text: string; why: string }
type Rule = {
  id: string
  owner: string
  /** the retired wording, as it can appear in a value or a code string */
  old: RegExp
  sampleOld: string
  sampleNew: string
  packs: Array<'en' | 'km'>
  exceptKeys?: Record<string, string>
  code: boolean
  worker: boolean
  allow?: Allow[]
}

const RULES: Rule[] = [
  {
    id: 'R1 received date (Khmer)', owner: '3-4 Sep: "Batch name change Date in ថ្ងៃចូល"',
    old: /ថ្ងៃទទួល(?!ប្រាក់)|កាលបរិច្ឆេទទទួល/, sampleOld: 'មិនបានកត់ត្រាកាលបរិច្ឆេទទទួល', sampleNew: 'មិនបានកត់ត្រាថ្ងៃចូល',
    packs: ['km'], code: true, worker: true,
  },
  {
    id: 'R1 received date (English lot)', owner: '4 Sep S4-27b: the noun moves too',
    old: /(?<!\ba |\{)\blots?\b(?![_(}])/i, sampleOld: 'No lot costs recorded yet', sampleNew: 'No received-date costs recorded yet',
    packs: ['en'], code: false, worker: false,
  },
  {
    id: 'R1 received date (Worker refusals)', owner: '4 Sep S4-27b: the Worker\'s user-visible strings',
    old: /[Bb]atch\/lot|Batch #|receipt lots|lot provenance|exact lot tracking|batch allocations|stock or batch activity|stock, lots, prices|Insufficient batch stock|cannot use a batch|Selected batch (price|does not)|Batch and expiry/,
    sampleOld: 'Batch/lot "x" was not found', sampleNew: 'Received date "x" was not found',
    packs: ['en'], code: true, worker: true,
  },
  {
    // Bare វគ្គ stays where it is a generic session inside an already
    // qualified phrase (បញ្ចប់វគ្គ = the Complete Session button).
    id: 'R2b stock-in session (Khmer)', owner: '5 Oct: "Stock-in session" = វគ្គបញ្ចូលស្តុក everywhere',
    old: /ការទទួលស្តុក|វគ្គស្តុកចូល/, sampleOld: 'រកមិនឃើញការទទួលស្តុកទេ', sampleNew: 'រកមិនឃើញវគ្គបញ្ចូលស្តុកទេ',
    packs: ['km'], code: true, worker: true,
  },
  {
    id: 'R3 Not Paid', owner: '7-24 Sep: Not Paid / ប្រាក់ជំពាក់',
    old: /awaiting[- ]payment|កំពុងរង់ចាំបង់ប្រាក់|រង់ចាំការទូទាត់|រង់ចាំបង់ប្រាក់/i, sampleOld: 'Review the fixed awaiting-payment receipts', sampleNew: 'Review the fixed Not Paid receipts',
    packs: ['en', 'km'], code: true, worker: true,
    allow: [
      { file: 'cloudflare/src/routes/notifications.ts', text: 'Awaiting payment${SUMMARY_SEPARATOR}', why: 'stale-client fallback beside its metaKey (pinned by notPaidTerminology)' },
      { file: 'cloudflare/src/routes/notifications.ts', text: '} awaiting payment` : null', why: 'stale-client fallback beside its summaryKey (pinned by notPaidTerminology)' },
      { file: 'cloudflare/src/lib/saleNotPaidStockRecovery.ts', text: "'Awaiting payment stock hold correction'", why: 'stored movement reason, written and then matched by SQL for idempotency' },
      { file: 'cloudflare/src/lib/telegramLang.ts', text: "'awaiting payment': { en: 'Not Paid'", why: 'the rewrite table that turns the wire phrase into Not Paid' },
      { file: 'cloudflare/src/lib/salesAnalytics.ts', text: '-- The awaiting-payment cohort', why: 'an SQL comment inside a query string' },
      { file: 'frontend/src/utils/saleNotPaidStockRecovery.ts', text: 'is not a fixed awaiting-payment stock deduction', why: 'internal manifest validation, never rendered as copy' },
    ],
  },
  {
    id: 'R5 cost price, not purchase price', owner: '10 Sep: Cost price / ថ្លៃដើម',
    old: /purchase price|តម្លៃទិញ/i, sampleOld: 'Selling price is below purchase price', sampleNew: 'Selling price is below cost price',
    packs: ['en', 'km'], code: true, worker: true,
  },
  {
    id: 'R7 wholesale, not VIP / special price', owner: '4-5 Sep S4-28',
    old: /\bVIP\b|special price|តម្លៃពិសេស/i, sampleOld: 'VIP Price (KHR)', sampleNew: 'Wholesale price (KHR)',
    packs: ['en', 'km'], code: true, worker: true,
  },
  {
    id: 'R10 Expenses, not Fees', owner: '31 Aug: "for fees section i think that can be named to Expense"',
    old: /'Fees'|'(Add|Edit|Delete) fee'|This fee changed|New fee type|Returns, Fees,|កម្រៃថ្លៃសេវា/, sampleOld: "label: 'Fees',", sampleNew: "label: 'Expenses',",
    packs: ['en', 'km'], code: true, worker: true,
  },
  {
    id: 'R11 Conflicts, not Possible Duplicates', owner: '31 Aug: "rename it to conflicts instead of duplicates"',
    // Section-level wording only: "Possible duplicate" for ONE candidate in
    // the contact decision dialog is a different concept and stays.
    old: /Possible Duplicates|'Duplicates'|Could not load possible duplicates|No possible duplicates found|Possible duplicate records|ស្ទួនដែលអាចមាន/,
    sampleOld: 'Use Possible Duplicates to choose', sampleNew: 'Use Conflicts to choose',
    packs: ['en', 'km'], code: true, worker: true,
    allow: [{ file: 'frontend/src/components/products/import/importTemplateRouter.ts', text: "conflictMode: { label: 'Duplicates'", why: 'how duplicate import ROWS were handled, a different concept' }],
  },
  {
    id: 'R12 Website Editor / website, not customer portal', owner: '24 Sep: "rename to Website Editor instead of customer portal"',
    old: /customer portal|ផតថល/i, sampleOld: 'Show point value on customer portal', sampleNew: 'Show point value on the website',
    packs: ['en', 'km'], code: true, worker: true,
    allow: [{ file: 'cloudflare/src/routes/portal.ts', text: "'customer portal visitor'", why: 'stored source label on AI log rows, not copy' }],
  },
  {
    id: 'R13 Partial Access, not Review Required', owner: 'Part 347: the tier is Partial Access / សិទ្ធិមួយផ្នែក',
    old: /Review Required|តម្រូវការត្រួតពិនិត្យ|«ត្រូវការពិនិត្យ»|ឬត្រូវការពិនិត្យ\)|សិទ្ធិមានកម្រិត/, sampleOld: 'Under Review Required, viewing', sampleNew: 'Under Partial Access, viewing',
    packs: ['en', 'km'], code: true, worker: true,
  },
  {
    id: 'R15 Records and Complete Session', owner: '30 Sep: "Records" instead of "Field history"; "Complete Session" everywhere',
    old: /Field history|Post stock changes|Complete stock-in/i, sampleOld: "tr('field_history', 'Field history')", sampleNew: "tr('field_history', 'Records')",
    packs: ['en'], code: true, worker: true,
  },
  {
    id: 'R16 Leang Cosmetics, not Leang Beauty', owner: '27 Sep: "Leang Cosmetics" everywhere; staff app "Leang Cosmetics Admin"',
    old: /Leang Beauty/, sampleOld: "generateTotpSecret(target.username, 'Leang Beauty')", sampleNew: 'generateTotpSecret(target.username, ADMIN_APP_NAME)',
    packs: ['en', 'km'], code: true, worker: true,
    allow: [
      { file: 'frontend/src/components/catalog/CatalogAccountSection.tsx', text: 'bought from Leang Cosmetics/Leang Beauty', why: 'names the old shop name on purpose so past buyers recognise it' },
      { file: 'frontend/src/components/catalog/CatalogAccountSection.tsx', text: 'ធ្លាប់ទិញពី Leang Cosmetics/Leang Beauty', why: 'the Khmer copy of that reminder, which G38 P0 (d7357d88a) moved into the shared sign-up dialog' },
      { file: 'frontend/src/components/catalog/PortalNoPaymentNotice.tsx', text: 'Leang Cosmetics/Leang Beauty', why: 'same deliberate old-name mention' },
      { file: 'frontend/src/components/catalog/portalLanguagePacks.ts', text: 'Leang Cosmetics/Leang Beauty', why: 'the Khmer copy of those two notices' },
      { file: 'frontend/src/components/catalog/portalLanguagePacks.ts', text: 'Leang Beauty', why: 'the Khmer copy of those two notices' },
      { file: 'frontend/src/components/catalog/portalContentI18n.ts', text: "'Leang Beauty',", why: 'do-not-translate list, so the old name is never machine-translated' },
      { file: 'cloudflare/src/lib/portalAccounts.ts', text: 'bought from Leang Cosmetics/Leang Beauty', why: 'the Worker copy of the sign-up reminder' },
    ],
  },
  {
    id: 'R8 concise delivery fee (Khmer fallbacks)', owner: '10 Sep: ថ្លៃដឹក for the fee',
    old: /ថ្លៃដឹកជញ្ជូន/, sampleOld: 'កែថ្លៃដឹកជញ្ជូន?', sampleNew: 'កែថ្លៃដឹក?',
    packs: [], code: true, worker: true,
  },
]

// Discriminating controls: every pattern catches its retired sample and spares
// the wording that replaced it, and the comment stripper keeps code while
// dropping a comment -- otherwise a clean scan proves nothing.
for (const rule of RULES) {
  assert.match(rule.sampleOld, rule.old, `${rule.id}: the pattern must catch the retired wording`)
  assert.doesNotMatch(rule.sampleNew, rule.old, `${rule.id}: the pattern must spare the new wording`)
}
assert.equal(stripComments("// Field history\nconst a = 'Records'").includes('Field history'), false, 'a // comment is dropped')
assert.equal(stripComments("{/* Review Required */}<b>{t('x')}</b>").includes('Review Required'), false, 'a JSX comment is dropped')
assert.equal(stripComments("const u = 'https://leangbeauty.com/'; const b = 'Possible Duplicates'").includes('Possible Duplicates'), true, 'code after a URL survives')
assert.doesNotMatch('reset_slow_hint: this can take a few minutes if there is a lot of stored data', RULES[1].old, '"a lot of" is not the retired noun')

const violations: string[] = []
const allowed = (rule: Rule, rel: string, line: string) =>
  (rule.allow || []).some((entry) => entry.file === rel && line.includes(entry.text))
const usedAllowances = new Set<Allow>()

for (const rule of RULES) {
  for (const name of rule.packs) {
    const pack = name === 'en' ? en : km
    for (const [key, value] of Object.entries(pack)) {
      if (rule.exceptKeys?.[key]) continue
      if (rule.old.test(value)) violations.push(`${rule.id}: ${name}.json "${key}" = ${value.slice(0, 120)}`)
    }
  }
  const scopes: Array<Array<[string, string]>> = []
  if (rule.code) scopes.push(frontendCode)
  if (rule.worker) scopes.push(workerCode)
  for (const files of scopes) {
    for (const [rel, code] of files) {
      if (!rule.old.test(code)) continue
      code.split('\n').forEach((line, index) => {
        if (!rule.old.test(line)) return
        const hit = (rule.allow || []).find((entry) => entry.file === rel && line.includes(entry.text))
        if (hit) { usedAllowances.add(hit); return }
        if (!allowed(rule, rel, line)) violations.push(`${rule.id}: ${rel}:${index + 1} ${line.trim().slice(0, 140)}`)
      })
    }
  }
}
assert.deepEqual(violations, [], `retired wording is back:\n  ${violations.join('\n  ')}`)

// An allowance that no longer matches anything is stale and would silently
// cover the next real regression in that file.
const stale = RULES.flatMap((rule) => (rule.allow || []).filter((entry) => !usedAllowances.has(entry)).map((entry) => `${rule.id}: ${entry.file} "${entry.text}"`))
assert.deepEqual(stale, [], `these allowances match nothing any more; delete them:\n  ${stale.join('\n  ')}`)

// The canonical words themselves, in both packs, where each surface reads them.
const CANONICAL: Array<[key: string, english: string, khmer: string]> = [
  ['received_date', 'Received date', 'ថ្ងៃចូល'],
  ['inventory_batch_session', 'Receive session', 'វគ្គទទួលស្តុក'],
  ['stock_in_session', 'Stock-in session', 'វគ្គបញ្ចូលស្តុក'],
  ['stock_in_sessions', 'Stock-in sessions', 'វគ្គបញ្ចូលស្តុក'],
  ['credit_awaiting_payment', 'Not Paid', 'ប្រាក់ជំពាក់'],
  ['on_credit', 'Not Yet Paid', 'មិនទាន់បង់'],
  ['cost_in_purchase', 'Cost price', 'ថ្លៃដើម'],
  ['wholesale_price', 'Wholesale price', 'តម្លៃបោះដុំ'],
  ['delivery_fee', 'Delivery fee', 'ថ្លៃដឹក'],
  ['delivery_actual_cost', 'Actual delivery cost', 'ថ្លៃដឹកដើម'],
  ['fees', 'Expenses', 'ចំណាយ'],
  ['perm_section_fees', 'Expenses', 'ចំណាយ'],
  ['possible_duplicates', 'Conflicts', 'ទំនាស់ទិន្នន័យ'],
  ['product_duplicates_section', 'Conflicts', 'ទំនាស់ទិន្នន័យ'],
  ['customer_portal', 'Website Editor', 'កម្មវិធីកែសម្រួលគេហទំព័រ'],
  ['review_required', 'Partial Access', 'សិទ្ធិមួយផ្នែក'],
  ['complete_session', 'Complete Session', 'បញ្ចប់វគ្គ'],
  ['items', 'Items', 'មុខទំនិញ'],
  ['field_history', 'Records', 'កំណត់ត្រា'],
  ['shift_counted_cash', 'Closing cash', 'សាច់ប្រាក់បិទវេន'],
  ['shift_additional_cash', 'Additional change used', 'ប្រាក់អាប់បន្ថែមដែលបានប្រើ'],
]
for (const [key, english, khmer] of CANONICAL) {
  assert.equal(en[key], english, `en.json "${key}" must stay ${english}`)
  assert.equal(km[key], khmer, `km.json "${key}" must stay ${khmer}`)
}

// Owner, 5 Oct: wherever the English names a stock-in session, the Khmer says
// វគ្គបញ្ចូលស្តុក -- a bare វគ្គ or ការទទួលស្តុក there reads as "a session" or
// "receiving stock", not the record staff open from the Stock-in Sessions list.
const stockInSessionKhmer = Object.keys(en)
  .filter((key) => /stock-in sessions?/i.test(en[key]) && !km[key]?.includes('វគ្គបញ្ចូលស្តុក'))
assert.deepEqual(stockInSessionKhmer, [], `stock-in session not rendered as វគ្គបញ្ចូលស្តុក: ${stockInSessionKhmer.join(', ')}`)

// "Original price" is the price before a discount. ថ្លៃដើម is the owner's word
// for COST price, so a Khmer hint that renders "original price" with it tells
// a cashier the cart shows the cost.
const originalPriceAsCost = Object.keys(en)
  .filter((key) => /original price/i.test(en[key]) && km[key]?.includes('ថ្លៃដើម'))
assert.deepEqual(originalPriceAsCost, [], `"original price" rendered as the cost-price word: ${originalPriceAsCost.join(', ')}`)

// The staff app and the shop keep the names the owner chose (27-28 Sep).
const manifest = JSON.parse(read(path.join(FRONTEND, 'public', 'manifest.json'))) as Record<string, string>
assert.equal(manifest.name, 'Leang Cosmetics Admin')
assert.equal(manifest.short_name, 'Leang Admin')
assert.match(read(path.join(REPO, 'cloudflare', 'src', 'routes', 'auth.ts')), /const ADMIN_APP_NAME = 'Leang Cosmetics Admin'/)

console.log(`PASS renameRegisterGuard: ${RULES.length} rename rules hold across both packs, frontend code and Worker copy; ${CANONICAL.length} canonical terms pinned`)
