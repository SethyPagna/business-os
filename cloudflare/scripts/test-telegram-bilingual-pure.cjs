// S4-8 / S4-9. Pins the bilingual Telegram layer on the COMPOSED payload --
// no bot token, no live chat, no network. Four things it must prove:
//
//   1. Every line a message sends carries BOTH languages (every English label
//      is followed by its Khmer), including the two routes that still build
//      their lines inline (routes/sales.ts status, routes/fees.ts fee).
//   2. The Khmer in the Worker dictionary is the SAME Khmer the app uses --
//      cross-checked against frontend/src/lang/km.json, so a second, divergent
//      spelling of a retail term cannot be born on the server side. This
//      checkout has no khmerRetailVocabulary.test.ts; km.json IS the glossary,
//      and this is the check that holds the Worker to it.
//   3. The command reference renders, and every shipped command appears in it.
//   4. An unauthorised chat is refused with NO shop data, and a bad argument
//      answers helpfully instead of throwing.
//
// Run (from cloudflare/): node scripts/test-telegram-bilingual-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  } finally { Module._load = originalLoad }
  return moduleObj.exports
}

const lang = loadReal('lib/telegramLang.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const analyticsPrecision = { './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision }
// lib/telegram.ts asks lib/saleTotals.ts who was billed for a delivery fee,
// so the message and the stored total_usd cannot disagree about it. Loaded
// REAL -- stubbing that rule here would test the stub, not the rule.
const saleTotals = loadReal('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const businessDateWindow = loadReal('lib/businessDateWindow.ts')

const KHMER = /[ក-៿]/
const SEP = lang.BILINGUAL_SEPARATOR

// --- 1. the dictionary itself ----------------------------------------------

for (const [key, entry] of Object.entries(lang.TELEGRAM_LABELS)) {
  assert.ok(entry.en && entry.km, `label '${key}' needs both languages`)
  assert.ok(KHMER.test(entry.km), `label '${key}' km is not Khmer script: ${entry.km}`)
  assert.ok(!KHMER.test(entry.en), `label '${key}' en must not contain Khmer`)
}
for (const [heading, km] of Object.entries(lang.TELEGRAM_HEADINGS)) {
  assert.ok(KHMER.test(km), `heading '${heading}' km is not Khmer script`)
  assert.equal(lang.localizeTelegramHeading(heading), `${heading}${SEP}${km}`)
}
// An English label must be unique: the line localizer looks entries up BY
// English text, so two keys sharing one English word would be a coin flip.
const englishLabels = Object.values(lang.TELEGRAM_LABELS).map((entry) => entry.en)
assert.equal(new Set(englishLabels).size, englishLabels.length, 'two label keys share one English label')
assert.deepEqual(lang.TELEGRAM_LABELS.cashEnd, { en: 'Closing cash', km: 'សាច់ប្រាក់បិទវេន' })
assert.deepEqual(lang.TELEGRAM_LABELS.credit, { en: 'Not Paid', km: 'ប្រាក់ជំពាក់' })
assert.deepEqual(lang.TELEGRAM_LABELS.cashReview, { en: 'Cash review needed', km: 'ត្រូវពិនិត្យសាច់ប្រាក់' })
// The Sep 21 2026 section titles and figures.
assert.deepEqual(lang.TELEGRAM_LABELS.shiftReport, { en: 'Shift report', km: 'របាយការណ៍វេន' })
assert.deepEqual(lang.TELEGRAM_LABELS.revenue, { en: 'Revenue', km: 'ចំណូល' })
assert.deepEqual(lang.TELEGRAM_LABELS.paymentMethods, { en: 'Payment methods', km: 'វិធីទូទាត់' })
console.log(`PASS dictionary: ${englishLabels.length} labels, ${Object.keys(lang.TELEGRAM_HEADINGS).length} headings, all bilingual`)

// --- 1b. the language mode (owner, Sep 21 2026) ------------------------------
// "Khmer + english, option to choose one or the other language or both and
// both as default. In settings." ONE module-level mode, applied while a
// message is COMPOSED. Everything the shop CHOSE is a label; everything the
// shop TYPED is a value, and a value is never translated or cut.
const inMode = (mode, build) => {
  const previous = lang.getTelegramLanguage()
  lang.setTelegramLanguage(mode)
  try { return build() } finally { lang.setTelegramLanguage(previous) }
}
assert.equal(lang.getTelegramLanguage(), 'both', 'the shipped default is bilingual')
assert.equal(inMode('both', () => lang.label('cashier')), `Cashier${SEP}អ្នកគិតប្រាក់`)
assert.equal(inMode('en', () => lang.label('cashier')), 'Cashier')
assert.equal(inMode('km', () => lang.label('cashier')), 'អ្នកគិតប្រាក់')
assert.equal(inMode('en', () => lang.bi('still open', 'នៅបើកនៅឡើយ')), 'still open')
assert.equal(inMode('km', () => lang.bi('still open', 'នៅបើកនៅឡើយ')), 'នៅបើកនៅឡើយ')
// An enumerated word INSIDE a value follows the same mode.
assert.equal(inMode('en', () => lang.localizeTelegramValue('unpaid')), 'unpaid')
assert.equal(inMode('km', () => lang.localizeTelegramValue('unpaid')), 'មិនទាន់បង់')
assert.equal(inMode('both', () => lang.localizeTelegramValue('unpaid')), `unpaid${SEP}មិនទាន់បង់`)
// A `{ en, km }` phrase rewrites the ENGLISH too -- the whole point of that
// shape. The `en` mode is where the old early-return hid the defect: an
// English-only shop was the one reader still being sent the retired phrase.
assert.equal(inMode('en', () => lang.localizeTelegramValue('awaiting payment')), 'Not Paid')
assert.equal(inMode('km', () => lang.localizeTelegramValue('awaiting payment')), 'ប្រាក់ជំពាក់')
assert.equal(inMode('both', () => lang.localizeTelegramValue('awaiting payment')), `Not Paid${SEP}ប្រាក់ជំពាក់`)
// Every sale status, in every mode, carries the app's own wording and never
// the raw enum. km.json/en.json status_* are the source; the emoji is the
// heading's job, not a value's.
const SALE_STATUS_WORDING = [
  ['awaiting payment', 'Not Paid', 'ប្រាក់ជំពាក់'],
  ['awaiting delivery', 'Awaiting Delivery', 'រង់ចាំការដឹកជញ្ជូន'],
  ['partial return', 'Partial Return', 'ប្រគល់ខ្លះ'],
  ['completed', 'Completed', 'បានបញ្ចប់'],
  ['cancelled', 'Cancelled', 'បានបោះបង់'],
  ['returned', 'Returned', 'បានប្រគល់'],
]
for (const [wire, english, khmer] of SALE_STATUS_WORDING) {
  assert.equal(inMode('both', () => lang.localizeTelegramLine(`Status: ${wire}`)), `· Status${SEP}ស្ថានភាព: ${english}${SEP}${khmer}`)
  assert.equal(inMode('en', () => lang.localizeTelegramLine(`Status: ${wire}`)), `· Status: ${english}`)
  assert.equal(inMode('km', () => lang.localizeTelegramLine(`Status: ${wire}`)), `· ស្ថានភាព: ${khmer}`)
}
// Negative control: the retired pair must not be reachable in ANY mode.
for (const mode of ['both', 'en', 'km']) {
  const rendered = inMode(mode, () => SALE_STATUS_WORDING.map(([wire]) => lang.localizeTelegramLine(`Status: ${wire}`)).join('\n'))
  assert.ok(!/awaiting.payment/i.test(rendered), `${mode}: the retired English phrase survives\n${rendered}`)
  assert.ok(!rendered.includes('កំពុងរង់ចាំការទូទាត់'), `${mode}: the retired Khmer phrase survives\n${rendered}`)
}
// A plain string phrase keeps the caller's English, unchanged, in en mode --
// dropping the early return must not have altered it.
assert.equal(inMode('en', () => lang.localizeTelegramValue('restock')), 'restock')
assert.equal(inMode('km', () => lang.localizeTelegramLine('Cashier: Za')), '· អ្នកគិតប្រាក់: Za', 'the VALUE is never translated')
assert.equal(inMode('en', () => lang.localizeTelegramLine('Cashier: Za')), '· Cashier: Za')
// The reason a mode is applied at composition and never by splitting finished
// text: a value can contain the separator itself.
assert.equal(
  inMode('km', () => lang.localizeTelegramLine('Note: deliver 9 / 10 boxes')),
  '· កំណត់ចំណាំ: deliver 9 / 10 boxes',
  'a value containing " / " must survive a single-language rendering intact',
)
// The heading keeps its emoji in every mode; only the words change.
assert.equal(inMode('km', () => lang.localizeTelegramHeading('🛍️ Sale recorded')), '🛍️ បានកត់ត្រាការលក់')
assert.equal(inMode('en', () => lang.localizeTelegramHeading('🛍️ Sale recorded')), '🛍️ Sale recorded')
// Anything that is not one of the three values is the bilingual default: a
// typo in a settings row must not blank the shop's reports.
for (const junk of ['', null, undefined, 'klingon', 'EN-GB', 'both ']) {
  assert.equal(inMode(junk, () => lang.getTelegramLanguage()), 'both', `"${junk}" must fall back to both`)
}
assert.equal(inMode('EN', () => lang.label('cashier')), 'Cashier', 'the value is case-insensitive')
assert.equal(lang.getTelegramLanguage(), 'both', 'the mode is restored after every render')
console.log('PASS language mode: both/en/km applied at composition, values untouched, junk falls back to both')

// --- 2. the Khmer agrees with the app's language pack -----------------------

const flatten = (input, target = {}) => {
  for (const [key, value] of Object.entries(input || {})) {
    if (value == null) continue
    if (typeof value === 'object' && !Array.isArray(value)) flatten(value, target)
    else target[key] = String(value)
  }
  return target
}
const packDir = path.join(__dirname, '..', '..', 'frontend', 'src', 'lang')
const enPack = flatten(JSON.parse(fs.readFileSync(path.join(packDir, 'en.json'), 'utf8')))
const kmPack = flatten(JSON.parse(fs.readFileSync(path.join(packDir, 'km.json'), 'utf8')))

// english text (lowercased) -> every Khmer the packs use for it
const packKhmer = new Map()
for (const [key, english] of Object.entries(enPack)) {
  const khmer = kmPack[key]
  if (!khmer) continue
  const normalized = english.trim().toLowerCase()
  if (!packKhmer.has(normalized)) packKhmer.set(normalized, new Set())
  packKhmer.get(normalized).add(khmer.trim())
}

// The ONLY terms allowed to differ from the pack, each because the pack's
// entry for that English word is a DIFFERENT SENSE of it. Adopting the pack
// spelling here would be worse Khmer, not better. Keep this list tiny: every
// new entry is a claim that the app and the bot mean different things by the
// same word, and that claim has to be true.
const SENSE_EXEMPT = {
  From: 'the pack\'s "From" is a date-range start (ចាប់ពី); a transfer\'s From is a source branch (ពី)',
}

const divergent = []
let checked = 0
const checkAgainstPack = (english, khmer, where) => {
  if (SENSE_EXEMPT[english]) return
  const allowed = packKhmer.get(String(english).trim().toLowerCase())
  if (!allowed) return
  checked += 1
  if (!allowed.has(String(khmer).trim())) {
    divergent.push(`${where} "${english}": worker says ${khmer}, km.json says ${[...allowed].join(' | ')}`)
  }
}
// The six SALE STATUSES name the pack key they were copied from, in the
// source, so they are held to THAT key rather than to whichever pack entry
// happens to share the English word. Two entries do share one: `partial_return`
// (a row tag) and `returned_quantity_tag` (a quantity tag) are older, longer
// Khmer for a DIFFERENT sense -- a quantity that came back, not the state a
// sale is in -- and the owner shortened the status wording itself on Sep 22
// 2026. Checking against the named key is the stricter test, not the looser
// one: it fails if the pack is edited and the Worker is not.
const STATUS_PACK_KEYS = {
  'awaiting payment': 'status_awaiting_payment',
  'awaiting delivery': 'status_awaiting_delivery',
  'partial return': 'status_partial_return',
  completed: 'status_completed',
  cancelled: 'status_cancelled',
  returned: 'status_returned',
}
// The packs put a status emoji in front; a Telegram bubble already carries
// the one emoji it needs on the heading, so only the words are copied.
const packWords = (text) => String(text ?? '').replace(/^[^\p{L}\p{N}$]+/u, '').trim()
for (const [phrase, key] of Object.entries(STATUS_PACK_KEYS)) {
  const entry = lang.TELEGRAM_VALUE_PHRASES[phrase]
  assert.equal(typeof entry, 'object', `the sale status "${phrase}" must rewrite BOTH languages, not only append Khmer`)
  assert.ok(enPack[key] && kmPack[key], `${key} must exist in both packs`)
  assert.equal(entry.en, packWords(enPack[key]), `value phrase "${phrase}" must say what en.json ${key} says`)
  assert.equal(entry.km, packWords(kmPack[key]), `value phrase "${phrase}" must say what km.json ${key} says`)
}
for (const [key, entry] of Object.entries(lang.TELEGRAM_LABELS)) checkAgainstPack(entry.en, entry.km, `label ${key}`)
for (const [english, khmer] of Object.entries(lang.TELEGRAM_VALUE_PHRASES)) {
  if (STATUS_PACK_KEYS[english]) continue
  checkAgainstPack(english, khmer, 'value phrase')
}

assert.deepEqual(
  divergent,
  [],
  'the Worker dictionary must reuse the app\'s Khmer, not invent a rival spelling:\n  ' + divergent.join('\n  '),
)
assert.ok(Object.keys(SENSE_EXEMPT).length <= 3, 'too many glossary exemptions -- the Worker is drifting from the app\'s Khmer')
console.log(`PASS glossary: ${checked} Worker terms also exist in the language packs and use the pack's Khmer (${Object.keys(SENSE_EXEMPT).length} documented sense exemption)`)

// The check above transitively covers every Worker term that HAS a pack
// counterpart. The terms that do not -- 'Net Total', 'SRET', the command
// descriptions -- are where a rival spelling could still be born, so hold
// those to the rival-spelling rules the app's own glossary uses.
//
// FOLLOW-UP: frontend/tests/khmerRetailVocabulary.test.ts (on
// origin/fx/khmer-naming, not yet at this base commit) owns the full rule
// list. When it merges, replace this block with a scan of
// src/lib/telegramLang.ts driven by THAT file's GLOSSARY, so the rules live
// in one place. Until then this is the retail subset Telegram can hit.
const RIVAL_SPELLINGS = [
  ['batch / lot / received date', 'ថ្ងៃចូល', ['បាច់', /ឡូត/, 'ឡុត']],
  ['customer', 'អតិថិជន', ['អ្នកទិញ']],
  ['cost', 'ថ្លៃដើម', ['តម្លៃដើម']],
  ['reason', 'មូលហេតុ', ['ហេតុផល']],
  ['settle', 'ដោះស្រាយ', ['សម្រះ']],
  ['barcode', 'បាកូដ', ['បារកូដ']],
  ['update', 'ធ្វើបច្ចុប្បន្នភាព', ['អាប់ដេត']],
  ['return (noun)', 'ការប្រគល់មកវិញ', [/ការត្រឡប់(?!វិញ)/, 'បងវិល', 'ការបង្វិលត្រឡប់']],
]
const everyWorkerKhmer = [
  ...Object.entries(lang.TELEGRAM_LABELS).map(([key, entry]) => [`label ${key}`, entry.km]),
  ...Object.entries(lang.TELEGRAM_HEADINGS).map(([heading, km]) => [`heading ${heading}`, km]),
  ...Object.entries(lang.TELEGRAM_VALUE_PHRASES).map(([english, phrase]) => [`phrase ${english}`, typeof phrase === 'string' ? phrase : phrase.km]),
  ...lang.TELEGRAM_COMMANDS.map((doc) => [`reference ${doc.command}`, doc.km]),
]
const forked = []
for (const [concept, canonical, rivals] of RIVAL_SPELLINGS) {
  for (const [where, khmer] of everyWorkerKhmer) {
    for (const rival of rivals) {
      const hit = typeof rival === 'string' ? khmer.includes(rival) : rival.test(khmer)
      if (hit) forked.push(`${concept}: ${where} uses ${rival}, the app says ${canonical} -- ${khmer}`)
    }
  }
}
assert.deepEqual(forked, [], `the Worker forked the Khmer retail vocabulary:\n  ${forked.join('\n  ')}`)
console.log(`PASS rival spellings: ${everyWorkerKhmer.length} Worker Khmer strings clear all ${RIVAL_SPELLINGS.length} retail glossary rules`)

// --- 3. every label the Worker actually emits is in the dictionary ----------
// A source-shape check: scan lib/telegram.ts's builders AND the two routes
// that compose lines inline for `Something: ` line prefixes, and require each
// to be a known label. This is what stops a new line shipping English-only.
const known = new Set(englishLabels)
const LINE_LABEL = /[`'"]([A-Z][A-Za-z ]{1,24}): \$\{/g
const scanned = []
for (const rel of ['src/lib/telegram.ts', 'src/routes/sales.ts', 'src/routes/fees.ts']) {
  const source = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
  // Scan line by line so an HTTP error body can be excluded. The 500 returned
  // by POST /:id/items builds its message with exactly the same shape as a
  // Telegram line -- a capitalised phrase, a colon, an interpolation -- but it
  // is an API response that never reaches Telegram, and adding it to
  // telegramLang.ts would put an HTTP error into the bot vocabulary. Telegram
  // lines are always pushed onto a lines array; they are never returned as JSON.
  for (const line of source.split(/\r?\n/)) {
    if (line.includes('c.json(')) continue
    for (const match of line.matchAll(LINE_LABEL)) scanned.push([rel, match[1]])
  }
}
const unknownLabels = [...new Set(scanned.filter(([, name]) => !known.has(name)).map(([rel, name]) => `${name} (${rel})`))].sort()
assert.deepEqual(unknownLabels, [], 'these Telegram line labels have no entry in telegramLang.ts, so they would ship English-only:\n  ' + unknownLabels.join('\n  '))
assert.ok(scanned.length >= 20, `expected to scan real label sites, found ${scanned.length}`)
console.log(`PASS coverage: all ${new Set(scanned.map(([, name]) => name)).size} emitted line labels resolve in the dictionary`)

// --- 4. composed event payloads: both languages on every labelled line ------

// lib/telegram.ts reads the sales kernel for the shift report (S4-7).
const schemaProbeReal = loadReal('lib/schemaProbe.ts')
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './schemaProbe': schemaProbeReal, './db': { getDb: () => { throw new Error('no DB in this test') } }, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
// Sep 6 2026: the owner's low-stock alert setting reaches this module through
// lib/lowStockSettings.ts. The SQL builder is the REAL one -- the clauses
// asserted below are the ones it composes -- while the settings READ answers
// the shipped default, there being no settings row in this harness. The rule
// itself is proven in scripts/test-low-stock-settings-pure.cjs.
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } } })
const lowStockStub = { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG }

// The drawer arithmetic and its labels are shared with the close routes and
// the app, in lib/shiftReconciliation.ts. Bound to the SAME stub db as the
// kernel so the report goes down its real path here too.
const reconciliationFor = (getDb, analytics) => loadReal('lib/shiftReconciliation.ts', {
  './db': { getDb },
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': analytics,
  './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts'),
})
const telegram = loadReal('lib/telegram.ts', {
  './lowStockSettings': lowStockStub,
  './db': { getDb: () => { throw new Error('no DB in this test') } },
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange,
  './salesAnalytics': salesAnalytics,
  './shiftReconciliation': reconciliationFor(() => { throw new Error('no DB in this test') }, salesAnalytics),
})

const bilingualOk = (line) => {
  const split = line.indexOf(': ')
  if (split <= 0) return true              // an item bullet: product name + arithmetic only
  const labelPart = line.slice(0, split)
  // Strip the row bullet before the lookup: leaving it on would make every
  // label unrecognised and this whole check vacuously true.
  const english = labelPart.replace(lang.ROW_BULLET, '').split(SEP)[0]
  return !known.has(english) ? true : KHMER.test(labelPart)
}
// Positive control for the line above: a KNOWN label with its Khmer removed
// must be reported, or the check proves nothing.
assert.equal(bilingualOk(`${lang.ROW_BULLET}Cashier: Za`), false, 'a known label with no Khmer must fail bilingualOk')
assert.equal(bilingualOk(`${lang.ROW_BULLET}Cashier${SEP}អ្នកគិតប្រាក់: Za`), true)
const assertAllBilingual = (lines, what) => {
  const localized = lines.filter(Boolean).map(lang.localizeTelegramLine)
  const english = localized.filter((line) => !bilingualOk(line))
  assert.deepEqual(english, [], `${what}: these lines have an English label with no Khmer:\n  ${english.join('\n  ')}`)
  assert.ok(localized.some((line) => KHMER.test(line)), `${what} produced no Khmer at all`)
  return localized
}

const saleLines = assertAllBilingual(telegram.formatSaleTelegramLines({
  status: 'awaiting_payment', createdAt: '2026-09-03T03:04:05.000Z', receiptNumber: '20260903-100405', cashier: 'Za',
  customer: 'Sok Dara', phone: '012 345 678', branch: 'Shop',
  items: [{ name: 'Coca Cola 330ml', quantity: 2, unitPriceUsd: 0.5, basePriceUsd: 0.6, lineTotalUsd: 1 }],
  exchangeRate: 4100, isDelivery: true, deliveryFeeUsd: 1.5, deliveryPaidBy: 'shop',
  driver: { name: 'Dara', phone: '099 111 222' },
  subtotalUsd: 1, discountUsd: 0.2, totalUsd: 0.8, totalKhr: 0, paidUsd: 0, paidKhr: 0,
}), 'sale receipt summary')
// RENAMED Sep 22 2026. This line used to read
// `Status / ស្ថានភាព: awaiting payment / កំពុងរង់ចាំការទូទាត់` -- a phrase the
// app had already replaced everywhere the owner could see it except here.
assert.ok(saleLines.includes('· Status / ស្ថានភាព: Not Paid / ប្រាក់ជំពាក់'), `sale status value carries the app's own wording:\n${saleLines.join('\n')}`)
assert.ok(!saleLines.join('\n').includes('awaiting payment'), 'the retired English phrase is gone')
// REDESIGNED Sep 6 2026. The unsettled sale used to end on
// `Paid / បានបង់: unpaid / មិនទាន់បង់` -- a label saying "paid", a value
// saying "not paid", and the amount owed nowhere on the line. It now names
// the owner's word and the positive figure, in both languages.
assert.ok(saleLines.includes('· Not Paid / ប្រាក់ជំពាក់: $0.80'), `the unsettled amount is one positive Not Paid line:\n${saleLines.join('\n')}`)
assert.ok(!saleLines.some((line) => line.startsWith('· Paid')), 'no Paid line survives on a wholly unpaid sale')
assert.ok(!saleLines.join('\n').includes('មិនទាន់បង់'), 'and no "unpaid" marker either')
// P10: numbered like the printed receipt ("1. name ...") instead of a bullet.
assert.ok(saleLines.some((line) => line.startsWith('1. Coca Cola 330ml')), 'the product name is left exactly as entered')
assert.ok(!saleLines.some((line) => line.startsWith('1. Coca Cola 330ml') && KHMER.test(line)), 'a numbered item line must not be rewritten')

// The stock delta must NOT reuse "Change" -- the receipt summary already uses
// that word for money handed back, and one English word cannot carry two
// different Khmer words through a line-level localizer.
const stockLines = assertAllBilingual(telegram.formatStockChangeTelegramLines({
  product: 'Rice 5kg', type: 'add', quantity: 12, branch: 'Shop', reason: 'Delivery', lot: '09032026',
  branchOnHand: 40, totalOnHand: 95, by: 'Sethy',
}), 'stock change')
assert.ok(stockLines.includes('· Stock change / ការផ្លាស់ប្ដូរស្តុក: +12'), 'stock delta has its own label')
assert.ok(stockLines.some((line) => line.includes('all branches / គ្រប់សាខា 95')), 'the on-hand total is bilingual')
assert.ok(!stockLines.some((line) => line.startsWith('· Change / ')), '"Change" must stay the money-handed-back label')

assertAllBilingual(telegram.formatTransferTelegramLines({
  createdAt: '2026-09-03T03:04:05.000Z', fromBranch: 'Shop', toBranch: 'Warehouse', note: 'restock run', by: 'Sethy',
  items: [{ product: 'Rice 5kg', quantity: 4, fromOnHand: 36, toOnHand: 20, totalOnHand: 95 }],
}), 'transfer')

const returnLines = assertAllBilingual(telegram.formatReturnTelegramLines({
  kind: 'customer', createdAt: '2026-09-03T03:04:05.000Z', returnNumber: 'RET-1', receiptNumber: 'INV-9',
  party: 'Sok Dara', branch: 'Shop', reason: 'Wrong size', returnType: 'partial_return', settlement: 'refund',
  items: [{ product: 'Rice 5kg', quantity: 1, refundUsd: 7.25, stockAction: 'restock', branchOnHand: 39, totalOnHand: 94 }],
  refundUsd: 7.25, refundKhr: 0, by: 'Sethy',
}), 'customer return')
assert.ok(returnLines.includes('· Settlement / វិធីដោះស្រាយ: refund / សងប្រាក់'), 'the settlement enum is translated')

assertAllBilingual(telegram.formatReturnTelegramLines({
  kind: 'supplier', createdAt: '2026-09-03T03:04:05.000Z', returnNumber: 'SRET-1', party: 'Acme',
  branch: 'Shop', items: [{ product: 'Rice 5kg', quantity: 2 }], compensationUsd: 10, lossUsd: 2, by: 'Sethy',
}), 'supplier return')

// The status change is a BUILDER now (Sep 22 2026), not a route's inline
// array -- so it is driven the way every other message is.
const statusLines = assertAllBilingual(telegram.formatSaleStatusTelegramLines({
  receipt: '20260903-100405', fromStatus: 'awaiting_payment', toStatus: 'completed',
  customer: 'Sok Dara', reason: 'Customer cancelled', lostFeeUsd: 2, by: 'Sethy',
}), 'sale status change')
assert.ok(statusLines.includes('· Status / ស្ថានភាព: Not Paid / ប្រាក់ជំពាក់ → Completed / បានបញ្ចប់'), statusLines.join('\n'))
// routes/fees.ts is the one route still composing lines inline.
const feeLines = assertAllBilingual([
  'Type: rent', 'Amount: $150.00', 'Date: 2026-09-03', 'Label: September', 'Note: paid in cash',
], 'routes/fees.ts inline fee lines')
// routes/fees.ts emits a bare ISO fee_date; the feed must show ONE date shape.
assert.ok(feeLines.includes('· Date / កាលបរិច្ឆេទ: 03/09/2026'), 'an ISO Date value is normalised to the pinned dd/mm/yyyy')
assert.equal(lang.localizeTelegramLine('Date: 03/09/2026 10:04'), '· Date / កាលបរិច្ឆេទ: 03/09/2026 10:04', 'an already-formatted date is untouched')
assert.equal(lang.localizeTelegramLine('Note: 2026-09-03'), '· Note / កំណត់ចំណាំ: 2026-09-03', 'only the Date label is reformatted')
console.log('PASS payloads: sale, status change, stock, transfer, both return kinds and the inline fee message are bilingual')

// A free-text value must never be rewritten, however unlucky the wording.
assert.equal(lang.localizeTelegramLine('Product: None'), '· Product / ផលិតផល: None', 'a product named "None" is left alone')
assert.equal(lang.localizeTelegramLine('Note: item(s) damaged in transit'), '· Note / កំណត់ចំណាំ: item(s) damaged in transit', 'a free-text note is left alone')
assert.equal(lang.localizeTelegramLine('• Rice 5kg 2 × $1.00 = $2.00'), '• Rice 5kg 2 × $1.00 = $2.00', 'item bullets pass through')
assert.equal(lang.localizeTelegramLine('1. Rice 5kg 2 × $1.00 = $2.00'), '1. Rice 5kg 2 × $1.00 = $2.00', 'numbered item lines pass through, unbulleted')
assert.equal(lang.localizeTelegramLine(lang.GROUP_RULE), lang.GROUP_RULE, 'a divider is not a label row and gains no bullet')
assert.equal(lang.localizeTelegramLine('Mystery: 12'), 'Mystery: 12', 'an unknown label passes through instead of throwing')
console.log('PASS safety: free-text values, item bullets and unknown labels are never rewritten')

// --- 5. the command reference -----------------------------------------------

const reference = lang.telegramCommandReference()
assert.ok(reference.length < 4096, 'the reference must fit one Telegram message')
assert.ok(KHMER.test(reference), 'the reference is bilingual')
assert.ok(!/[<>]|\*\*|__/.test(reference), 'postTelegram sends no parse_mode, so the reference must be plain text')
for (const doc of lang.TELEGRAM_COMMANDS) {
  assert.ok(reference.includes(`${doc.icon} ${doc.command}`), `${doc.command} is missing from the reference`)
  assert.ok(reference.includes(doc.en), `${doc.command} has no English description`)
  assert.ok(reference.includes(doc.km), `${doc.command} has no Khmer description`)
  assert.ok(KHMER.test(doc.km) && !KHMER.test(doc.en), `${doc.command} descriptions are in the wrong scripts`)
  // SHORTENED Sep 6 2026: a dated command carries the `[date]` marker on its
  // own usage line. The per-command `▸ /report 09/01/2026` example line is
  // gone -- seven of them said the same thing the one footer date line says.
  assert.ok(!doc.example, `${doc.command} still carries a per-command example`)
}
assert.ok(!reference.includes('▸'), 'no example lines survive in the reference')
// Two lines per command (usage + Khmer), one rule for the whole block, a
// two-line header and a four-line footer: 7 * 2 + 3 + 5 = 22, against the 45
// the owner called "so long".
assert.ok(reference.split('\n').length <= 24, `the reference must stay at a glance; it is ${reference.split('\n').length} lines`)
for (const doc of lang.TELEGRAM_COMMANDS) {
  assert.ok(reference.includes(`${doc.icon} ${doc.command}${doc.dated ? ' [date]' : ''} — ${doc.en}`), `${doc.command} has no usage line`)
}
assert.ok(reference.includes('dd/mm/yyyy'), 'the reference states the project date convention')
// The refusal inverted on Sep 4 2026 rather than loosening: exactly ONE
// slash order may be offered, and it is now the day-first one.
assert.ok(!reference.includes('mm/dd/yyyy'), 'the month-first order is no longer offered')
// Width in GRAPHEMES, not UTF-16 units: Khmer stacks combining marks, so
// `.length` over-counts a Khmer line by ~25% and would fail an honest layout.
const graphemes = new Intl.Segmenter('km', { granularity: 'grapheme' })
const widest = reference.split('\n').reduce((max, line) => Math.max(max, [...graphemes.segment(line)].length), 0)
assert.ok(widest <= 52, `the reference must stay phone-width; widest line is ${widest} graphemes`)

// The riel sign lives in the Khmer block, so strip it before probing.
const khmerText = (text) => KHMER.test(String(text).replace(/៛/g, ''))
// The reference is composed per mode, not trimmed afterwards: a single
// language gets ONE line per command, with the icon moved onto the language
// that survives, and no orphaned hanging-indent line left behind.
const referenceEn = inMode('en', () => lang.telegramCommandReference())
const referenceKm = inMode('km', () => lang.telegramCommandReference())
for (const [mode, single] of [['en', referenceEn], ['km', referenceKm]]) {
  assert.equal(single.split('\n').length, reference.split('\n').length - lang.TELEGRAM_COMMANDS.length - 2,
    `the '${mode}' reference must drop exactly one line per pair:\n${single}`)
  assert.ok(!single.split('\n').some((line) => line.trim() === ''), `the '${mode}' reference left an empty line behind`)
  for (const doc of lang.TELEGRAM_COMMANDS) {
    assert.ok(single.includes(`${doc.icon} ${doc.command}${doc.dated ? ' [date]' : ''} — ${mode === 'en' ? doc.en : doc.km}`),
      `${doc.command} has no usage line in '${mode}':\n${single}`)
  }
  // The accepted date FORMS are what the reader types; they never change.
  assert.ok(single.includes('dd/mm/yyyy') && single.includes('today'), `the '${mode}' reference dropped the date forms`)
  assert.ok(!/[<>]|\*\*|__/.test(single), `the '${mode}' reference must stay plain text`)
}
assert.ok(!khmerText(referenceEn), `the 'en' reference still carries Khmer:\n${referenceEn}`)
assert.ok(referenceKm.startsWith('🤖 របាយការណ៍ Business OS'), `the 'km' reference lost its icon:\n${referenceKm}`)
// A bad date answers in the shop's language too -- and still names both forms.
const refusalKm = inMode('km', () => lang.parseReportDate('12/25/2026', '2026-09-04'))
const refusalEn = inMode('en', () => lang.parseReportDate('12/25/2026', '2026-09-04'))
assert.equal(refusalKm.ok, false)
assert.ok(!/[A-Za-z]/.test(refusalKm.message.split('\n')[0].replace(/12\/25\/2026/g, '')), refusalKm.message)
assert.ok(refusalKm.message.includes('dd/mm/yyyy') && refusalEn.message.includes('dd/mm/yyyy'), 'both modes name the accepted forms')
assert.ok(!khmerText(refusalEn.message), refusalEn.message)
// So does the refusal an unapproved chat gets -- and it still leaks nothing.
const refusalKmChat = inMode('km', () => lang.telegramUnauthorizedReply('-1009988'))
assert.ok(refusalKmChat.includes('-1009988'), refusalKmChat)
assert.ok(khmerText(refusalKmChat), `the 'km' refusal must be Khmer:
${refusalKmChat}`)
assert.ok(!/[A-Za-z]/.test(refusalKmChat.replace(/Business OS|Settings|Telegram|-1009988/g, '')), refusalKmChat)
for (const leak of ['$', '៛', 'Sale', 'Receipt', 'Total', 'Revenue', 'Cashier', 'Product', '/report']) {
  assert.ok(!refusalKmChat.includes(leak), `the Khmer refusal must not contain "${leak}"`)
}
console.log(`PASS reference modes: 'en' ${referenceEn.split('\n').length} lines, 'km' ${referenceKm.split('\n').length} lines, no orphan indents, refusals follow the mode`)
console.log(`PASS reference: ${lang.TELEGRAM_COMMANDS.length} commands, ${reference.split('\n').length} lines, widest ${widest} chars, plain text`)

// --- 6. arguments: helpful, never thrown -------------------------------------

assert.deepEqual(lang.parseReportDate('', '2026-09-04'), { ok: true, date: '2026-09-04' })
assert.deepEqual(lang.parseReportDate(undefined, '2026-09-04'), { ok: true, date: '2026-09-04' })
assert.deepEqual(lang.parseReportDate('today', '2026-09-04'), { ok: true, date: '2026-09-04' })
assert.deepEqual(lang.parseReportDate('YESTERDAY', '2026-09-01'), { ok: true, date: '2026-08-31' }, 'yesterday crosses a month end')
assert.deepEqual(lang.parseReportDate('2026-09-01', '2026-09-04'), { ok: true, date: '2026-09-01' }, 'ISO is accepted')
assert.deepEqual(lang.parseReportDate('09/01/2026', '2026-09-04'), { ok: true, date: '2026-01-09' }, 'dd/mm/yyyy is the project convention -- 9 January')
assert.deepEqual(lang.parseReportDate('9/1/2026', '2026-09-04'), { ok: true, date: '2026-01-09' }, 'unpadded dd/mm/yyyy is accepted')
// Past the 12th, so only one reading can parse at all:
assert.deepEqual(lang.parseReportDate('25/12/2026', '2026-09-04'), { ok: true, date: '2026-12-25' }, '25 December can only be day-first')
// The owner wrote the direction as "dd-mm-yyyy", so the dash spelling is
// accepted too. It adds no ambiguity that 01/09/2026 does not already
// carry: a 4-digit year LAST cannot be read as ISO, and only one slash
// order is accepted at all.
assert.deepEqual(lang.parseReportDate('01-09-2026', '2026-09-04'), { ok: true, date: '2026-09-01' }, 'the dash spelling the owner used is accepted, day-first')
for (const bad of ['12/25/2026', '2026-13-01', '13/45/2026', '30/02/2026', 'last tuesday', 'DROP TABLE sales', '2026/09/01']) {
  const parsed = lang.parseReportDate(bad, '2026-09-04')
  assert.equal(parsed.ok, false, `"${bad}" must not be guessed at`)
  assert.ok(KHMER.test(parsed.message), `the refusal for "${bad}" is bilingual`)
  assert.ok(parsed.message.includes('dd/mm/yyyy') && parsed.message.includes('yyyy-mm-dd'), 'the refusal names the accepted forms')
}
console.log('PASS arguments: today/yesterday/ISO/dd-mm-yyyy accepted, month-first and junk input answered bilingually')

// --- 7. an unauthorised chat learns nothing about the shop -------------------

const refusal = lang.telegramUnauthorizedReply('-1009988')
assert.ok(KHMER.test(refusal), 'the refusal is bilingual')
assert.ok(refusal.includes('-1009988'), 'it names the asking chat so the owner can approve it')
for (const leak of ['$', '៛', 'Sale', 'Receipt', 'Total', 'Revenue', 'Cashier', 'Product', '/report']) {
  assert.ok(!refusal.includes(leak), `the refusal must not contain "${leak}"`)
}
console.log('PASS refusal: an unapproved chat gets its own id and nothing about the shop')

// --- 8. the allow-list and the dispatcher, driven end to end ----------------
// Real handleTelegramWebhook, real settings query, stubbed D1 rows; the fetch
// to api.telegram.org is captured instead of sent, so nothing leaves this box.

const sent = []
global.fetch = async (url, init) => {
  sent.push({ url: String(url).replace(/bot[^/]+/, 'bot<redacted>'), body: JSON.parse(init.body) })
  return { ok: true, status: 200, text: async () => '', json: async () => ({ ok: true }) }
}

const settingsRows = [
  { key: 'telegram_automation_enabled', value: 'true' },
  { key: 'telegram_chat_id', value: '-100111, -100222' },
]
const stubDb = {
  prepare(sql) {
    return {
      all: async () => (/FROM settings/.test(sql) ? settingsRows : []),
      get: async () => (/FROM products/.test(sql) ? { products: 0, units: 0, out_of_stock: 0, low_stock: 0 } : { count: 0, usd: 0, khr: 0, quantity: 0 }),
    }
  },
}
const stubAnalytics = loadReal('lib/salesAnalytics.ts', { './schemaProbe': schemaProbeReal, './db': { getDb: () => stubDb }, './removalLosses': loadReal('lib/removalLosses.ts'), './businessDateWindow': businessDateWindow, ...analyticsPrecision })
const wired = loadReal('lib/telegram.ts', {
  './lowStockSettings': lowStockStub,
  './db': { getDb: () => stubDb },
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './saleTotals': saleTotals,
  './nativeSaleChange': nativeSaleChange,
  // The real kernel over the same stub db, so `/shift` goes down its actual
  // query path here rather than a hand-written imitation of it.
  './salesAnalytics': stubAnalytics,
  './shiftReconciliation': reconciliationFor(() => stubDb, stubAnalytics),
})
const env = { TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-secret' }
const lastSent = () => sent[sent.length - 1].body.text

;(async () => {
  await wired.handleTelegramWebhook(env, { message: { text: '/report', chat: { id: -100111 } } })
  assert.ok(lastSent().includes('📊'), 'the first allow-listed chat gets a report')
  assert.ok(KHMER.test(lastSent()), 'the report is bilingual')

  await wired.handleTelegramWebhook(env, { message: { text: '/report', chat: { id: '-100222' } } })
  assert.ok(lastSent().includes('📊'), 'a second allow-listed chat id also works')

  const before = sent.length
  await wired.handleTelegramWebhook(env, { message: { text: '/report', chat: { id: -100999 } } })
  assert.equal(sent.length, before + 1, 'an unapproved chat gets exactly one reply')
  assert.ok(lastSent().startsWith('🔒'), 'and that reply is the refusal')
  assert.ok(!lastSent().includes('📊'), 'no report reaches an unapproved chat')
  assert.equal(sent[sent.length - 1].body.chat_id, '-100999', 'the refusal goes back to the asker, not the shop chat')

  // 25 past the 12th: the echoed header proves the WHOLE path is day-first,
  // where 09/01/2026 would have read identically under either order.
  await wired.handleTelegramWebhook(env, { message: { text: '/report@business_os_bot 25/12/2026', chat: { id: -100111 } } })
  assert.ok(lastSent().includes('25/12/2026'), 'a bot mention is stripped and the date is honoured, day first')

  // 01-09-2026 used to be the rejected example; day-first made it a real
  // date, so the refusal is now demonstrated with a month-first spelling.
  await wired.handleTelegramWebhook(env, { message: { text: '/report 12/25/2026', chat: { id: -100111 } } })
  assert.ok(lastSent().startsWith('⚠️'), 'a month-first date is answered, not thrown')
  assert.ok(!lastSent().includes('📊'), 'and no data is sent with it')

  await wired.handleTelegramWebhook(env, { message: { text: '/nonsense', chat: { id: -100111 } } })
  assert.ok(lastSent().startsWith('🤔') && lastSent().includes('/report'), 'an unknown command answers with the reference')

  for (const command of ['/help', '/start']) {
    await wired.handleTelegramWebhook(env, { message: { text: command, chat: { id: -100111 } } })
    assert.equal(lastSent(), lang.telegramCommandReference(), `${command} sends the reference`)
  }
  for (const command of ['/sales', '/fees', '/inventory', '/stock', '/lowstock', '/today', '/summary']) {
    const count = sent.length
    await wired.handleTelegramWebhook(env, { message: { text: command, chat: { id: -100111 } } })
    assert.equal(sent.length, count + 1, `${command} answers`)
    assert.ok(KHMER.test(lastSent()), `${command} answers bilingually`)
  }

  // --- the two stock replies -------------------------------------------------
  // `/inventory` and `/stock` were the two replies the Sep 6 2026 redesign
  // never touched, and then the two the Sep 21 2026 sectioned-layout redesign
  // left as a single un-numbered block while every other reply took on
  // numbered, titled sections. `/inventory` used to put two figures on one
  // line ("Low stock: N · Out of stock: N") and ended with a
  // `▸ /stock — the product list` pointer -- exactly the kind of line the
  // redesign deleted from the command reference and forbids there; both are
  // still gone. Both are driven here over a stub that actually HAS stock, so
  // there are figures on the lines to count.
  const inventoryRows = [
    { name: 'Coca-Cola 330ml', stock_quantity: 0, low_threshold: 5, out_of_stock_threshold: 0 },
    { name: 'Rice 5kg', stock_quantity: 3, low_threshold: 5, out_of_stock_threshold: 0 },
  ]
  const stockedDb = {
    prepare(sql) {
      return {
        all: async () => (/FROM settings/.test(sql) ? settingsRows : /FROM products/.test(sql) ? inventoryRows : []),
        get: async () => (/FROM products/.test(sql) ? { products: 1240, units: 8630, out_of_stock: 3, low_stock: 12 } : { count: 0, usd: 0, khr: 0, quantity: 0 }),
      }
    },
  }
  const stocked = loadReal('lib/telegram.ts', {
    './lowStockSettings': lowStockStub,
    './db': { getDb: () => stockedDb },
    './businessDateWindow': businessDateWindow,
    './telegramLang': lang,
    './saleTotals': saleTotals,
    './nativeSaleChange': nativeSaleChange,
    './salesAnalytics': stubAnalytics,
    './shiftReconciliation': reconciliationFor(() => stockedDb, stubAnalytics),
  })
  const RULE = '━'.repeat(18)
  await stocked.handleTelegramWebhook(env, { message: { text: '/inventory', chat: { id: -100111 } } })
  const inventoryReply = lastSent()
  await stocked.handleTelegramWebhook(env, { message: { text: '/stock', chat: { id: -100111 } } })
  const stockReply = lastSent()

  assert.deepEqual(inventoryReply.split('\n'), [
    '🏷️ Inventory / ស្តុក',
    RULE,
    '1. Products / ផលិតផល',
    '· Active products / ផលិតផលសកម្ម: 1,240',
    '· Units on hand / ឯកតាក្នុងស្តុក: 8,630',
    RULE,
    '2. Stock / ស្តុក',
    '· Low stock / ស្តុកទាប: 12',
    '· Out of stock / អស់ស្តុក: 3',
  ], `/inventory does not have the shared numbered-section shape:\n${inventoryReply}`)
  assert.deepEqual(stockReply.split('\n'), [
    '📦 Low stock / ស្តុកទាប',
    RULE,
    '1. Stock / ស្តុក',
    '· Products / ផលិតផល: 2',
    '• OUT / អស់ស្តុក — Coca-Cola 330ml — 0 (⚠ 5)',
    '• LOW / ស្តុកទាប — Rice 5kg — 3 (⚠ 5)',
  ], `/stock does not have the shared numbered-section shape:\n${stockReply}`)

  // RETIRED (Sep 22 2026): a bare RULE with no numbered header after it -- the
  // shape both replies had until this pass, and the shape every other report
  // stopped drawing on Sep 21 2026. Every RULE in a report line is now
  // immediately followed by an "N. <title>" section header.
  for (const [command, reply] of [['/inventory', inventoryReply], ['/stock', stockReply]]) {
    const rows = reply.split('\n')
    rows.forEach((row, index) => {
      if (row !== RULE) return
      assert.ok(/^\d+\.\s/.test(rows[index + 1] || ''), `${command} draws a bare divider with no numbered section after it:\n${reply}`)
    })
  }
  // And the two literally retired sentences stay retired.
  for (const [command, reply] of [['/inventory', inventoryReply], ['/stock', stockReply]]) {
    assert.ok(!reply.includes('▸'), `${command} still carries the old pointer line:\n${reply}`)
    assert.ok(!/Low stock:.*Out of stock:/.test(reply), `${command} put both health figures back on one line:\n${reply}`)
  }

  // The section order is now content: a strict-after loop (like
  // scripts/test-shift-report-pure.cjs's ORDER check), never a membership
  // check. `/inventory` has two sections; `/stock` has one, so its loop is a
  // single-item sanity check on the same code path.
  const strictSectionOrder = (reply, keys) => {
    const rows = reply.split('\n')
    let cursor = -1
    for (const key of keys) {
      const at = rows.findIndex((row, index) => index > cursor && row === `${keys.indexOf(key) + 1}. ${lang.label(key)}`)
      assert.ok(at > cursor, `"${key}" is out of order in the report:\n${reply}`)
      cursor = at
    }
  }
  strictSectionOrder(inventoryReply, ['products', 'stock'])
  strictSectionOrder(stockReply, ['stock'])

  // Positive control: swapping the two /inventory sections in a LOCAL copy of
  // the already-rendered text must make the same strict-after loop reject it
  // -- proving the loop checks ORDER and not just presence.
  {
    const rows = inventoryReply.split('\n')
    const productsAt = rows.indexOf('1. Products / ផលិតផល')
    const stockAt = rows.indexOf('2. Stock / ស្តុក')
    const swapped = [...rows];
    [swapped[productsAt], swapped[stockAt]] = [swapped[stockAt], swapped[productsAt]]
    const swappedText = swapped.join('\n')
    let rejected = false
    try { strictSectionOrder(swappedText, ['products', 'stock']) } catch { rejected = true }
    assert.ok(rejected, 'the /inventory section-order check does not discriminate: a swapped pair of section headers still passed it')
  }

  // All three language modes, same fixture: every figure survives, and the
  // section count never changes -- only which half of each label prints.
  for (const [command, hasSecondSection] of [['/inventory', true], ['/stock', false]]) {
    const both = await stocked.telegramCommandReply(env, command, Date.now(), 'both')
    const en = await stocked.telegramCommandReply(env, command, Date.now(), 'en')
    const km = await stocked.telegramCommandReply(env, command, Date.now(), 'km')
    const sectionCount = (text) => text.split('\n').filter((row) => /^\d+\.\s/.test(row)).length
    assert.equal(sectionCount(both), hasSecondSection ? 2 : 1, `${command} both-mode section count:\n${both}`)
    assert.equal(sectionCount(en), sectionCount(both), `${command} en-mode dropped or added a section:\n${en}`)
    assert.equal(sectionCount(km), sectionCount(both), `${command} km-mode dropped or added a section:\n${km}`)
    assert.ok(!KHMER.test(en), `${command} en-mode still carries Khmer:\n${en}`)
    assert.ok(en.split('\n').some((row) => /^\d+\.\s[A-Za-z]/.test(row)), `${command} en-mode section headers lost their number:\n${en}`)
    assert.ok(km.split('\n').filter((row) => /^\d+\.\s/.test(row)).every((row) => !/[A-Za-z]/.test(row)), `${command} km-mode section header still carries English:\n${km}`)
    // Every figure in the both-mode reply also appears in the single-language
    // renderings -- the mode changes labels only, never a value.
    for (const figure of both.match(/\d[\d,]*(?:\.\d+)?/g) || []) {
      assert.ok(en.includes(figure), `${command} en-mode lost the figure ${figure}:\n${en}`)
      assert.ok(km.includes(figure), `${command} km-mode lost the figure ${figure}:\n${km}`)
    }
  }
  console.log('PASS stock replies: numbered sections, strict order with a positive control, all three language modes, retired wording stays out')

  // ONE FIGURE PER LINE, the rule the redesign applied to the other five
  // reports. A labelled line is `English / ខ្មែរ: value`; product bullets are
  // a list, not a labelled figure, so they are not counted.
  for (const [command, reply] of [['/inventory', inventoryReply], ['/stock', stockReply]]) {
    for (const line of reply.split('\n')) {
      if (line.startsWith('•') || !line.includes(': ') || !line.slice(0, line.indexOf(': ')).includes(SEP)) continue
      const value = line.slice(line.indexOf(': ') + 2)
      const figures = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []
      assert.equal(figures.length, 1, `${command} puts ${figures.length} figures on one line: "${line}"`)
    }
  }

  // A shop with nothing low says so through the ABSENCE of the second block,
  // the same way every other report drops a zero line.
  await wired.handleTelegramWebhook(env, { message: { text: '/inventory', chat: { id: -100111 } } })
  assert.deepEqual(lastSent().split('\n'), [
    '🏷️ Inventory / ស្តុក',
    RULE,
    '1. Products / ផលិតផល',
    '· Active products / ផលិតផលសកម្ម: 0',
    '· Units on hand / ឯកតាក្នុងស្តុក: 0',
  ], `a shop with nothing low still printed a zero block:\n${lastSent()}`)
  console.log('PASS stock replies: the shared header shape, one figure per line, no pointer line')

  const quiet = sent.length
  await wired.handleTelegramWebhook(env, { message: { text: 'good morning', chat: { id: -100999 } } })
  await wired.handleTelegramWebhook(env, { message: { text: '/report', chat: {} } })
  await wired.handleTelegramWebhook(env, {})
  assert.equal(sent.length, quiet, 'plain chatter, a chat-less update and an empty update send nothing')

  assert.ok(sent.every((call) => call.url.startsWith('https://api.telegram.org/bot<redacted>/')), 'every send went through the one Telegram endpoint')
  // The connection test is an outbound message too, and it was carrying the
  // last explanatory sentence the bot sends: "Every notification category is
  // on by default; turn any off in Settings" -- told to a reader who is
  // standing in Settings, having just pressed the button in it. One
  // confirmation line, a blank, and the command reference is the whole
  // message now.
  await stocked.sendTelegramTest({ ...env, BUSINESS_OS_ADMIN_URL: 'https://admin.example.com' })
  const testMessage = sent[sent.length - 2].body.text
  assert.deepEqual(testMessage.split('\n').slice(0, 3), [
    `✅ ${'Business OS alerts and commands are connected.'}${SEP}ការជូនដំណឹង និងពាក្យបញ្ជា Business OS បានភ្ជាប់រួចរាល់។`,
    '',
    '🤖 Business OS — Reports',
  ], testMessage)
  assert.ok(!/on by default|turn any off/i.test(testMessage), `the connection test still explains itself:\n${testMessage}`)
  assert.ok(testMessage.endsWith(lang.telegramCommandReference()), 'the connection test still carries the command reference')
  console.log('PASS connection test: one confirmation line and the reference, no explanation')

  // NO POINTER LINES ANYWHERE. The redesign deleted `▸ /report 09/01/2026`
  // from the command reference on the grounds that a message should not spend
  // a line telling the reader to send another message; the same rule holds
  // for every reply this bot composes, not only for the reference.
  for (const call of sent) {
    assert.ok(!String(call.body.text || '').includes('▸'), `a reply still carries a pointer line:\n${call.body.text}`)
  }
  console.log(`PASS commands: ${sent.length} composed replies, allow-list enforced, nothing sent for non-commands`)

  // The shop chooses ONE language for the whole chat in Settings. The setting
  // travels the real path: settings row -> getTelegramConfig -> the compose
  // scope, so the reply a group actually receives changes, and the mode is
  // put back afterwards so the next compose is not poisoned by this one.
  for (const [value, wants, rejects] of [['km', 'Khmer', 'English'], ['en', 'English', 'Khmer']]) {
    settingsRows.push({ key: 'telegram_language', value })
    await wired.handleTelegramWebhook(env, { message: { text: '/report', chat: { id: -100111 } } })
    const reply = lastSent()
    assert.ok(!reply.includes(SEP), `with telegram_language=${value} the chat must not get both languages:\n${reply}`)
    assert.equal(khmerText(reply), value === 'km', `telegram_language=${value} must answer in ${wants}, not ${rejects}:\n${reply}`)
    assert.ok(reply.includes('📊'), `telegram_language=${value} lost the report itself:\n${reply}`)
    assert.equal(lang.getTelegramLanguage(), 'both', 'the compose scope must restore the module mode')
    settingsRows.pop()
  }
  await wired.handleTelegramWebhook(env, { message: { text: '/report', chat: { id: -100111 } } })
  assert.ok(lastSent().includes(SEP), 'removing the setting returns the chat to the bilingual default')
  console.log('PASS language setting: telegram_language km/en/unset reaches the composed reply and restores the mode')
  // Business day, business date shape.
  assert.equal(wired.formatBusinessDay('2026-09-01'), '01/09/2026', 'report headers use the pinned dd/mm/yyyy')
  assert.equal(wired.formatBusinessDay('2026-12-25'), '25/12/2026', 'and a day past the 12th proves the order')
  assert.equal(wired.formatBusinessDay(''), '', 'a missing date degrades quietly')
  console.log('PASS dates: report headers render dd/mm/yyyy, the project-wide convention')

  console.log('\ntelegram bilingual + commands tests passed')
})().catch((error) => { console.error(error); process.exit(1) })
