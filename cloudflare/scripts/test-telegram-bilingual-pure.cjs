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
console.log(`PASS dictionary: ${englishLabels.length} labels, ${Object.keys(lang.TELEGRAM_HEADINGS).length} headings, all bilingual`)

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
for (const [key, entry] of Object.entries(lang.TELEGRAM_LABELS)) checkAgainstPack(entry.en, entry.km, `label ${key}`)
for (const [english, khmer] of Object.entries(lang.TELEGRAM_VALUE_PHRASES)) checkAgainstPack(english, khmer, 'value phrase')

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
  ['batch / lot', 'បាច់', [/(?<!អាប់)ឡូត/, 'ឡុត']],
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
  ...Object.entries(lang.TELEGRAM_VALUE_PHRASES).map(([english, km]) => [`phrase ${english}`, km]),
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
const salesAnalytics = loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => { throw new Error('no DB in this test') } }, './businessDateWindow': businessDateWindow })
const telegram = loadReal('lib/telegram.ts', {
  './db': { getDb: () => { throw new Error('no DB in this test') } },
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  './salesAnalytics': salesAnalytics,
})

const bilingualOk = (line) => {
  const split = line.indexOf(': ')
  if (split <= 0) return true              // an item bullet: product name + arithmetic only
  const labelPart = line.slice(0, split)
  return !known.has(labelPart.split(SEP)[0]) ? true : KHMER.test(labelPart)
}
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
assert.ok(saleLines.includes('Status / ស្ថានភាព: awaiting payment / រង់ចាំការទូទាត់'), 'sale status value is translated too')
assert.ok(saleLines.includes('Paid / បានបង់: unpaid / មិនទាន់បង់'), 'the unpaid marker is translated')
assert.ok(saleLines.some((line) => line.startsWith('• Coca Cola 330ml')), 'the product name is left exactly as entered')
assert.ok(!saleLines.some((line) => line.startsWith('• Coca Cola 330ml') && KHMER.test(line)), 'an item bullet must not be rewritten')

// The stock delta must NOT reuse "Change" -- the receipt summary already uses
// that word for money handed back, and one English word cannot carry two
// different Khmer words through a line-level localizer.
const stockLines = assertAllBilingual(telegram.formatStockChangeTelegramLines({
  product: 'Rice 5kg', type: 'add', quantity: 12, branch: 'Shop', reason: 'Delivery', lot: '09032026',
  branchOnHand: 40, totalOnHand: 95, by: 'Sethy',
}), 'stock change')
assert.ok(stockLines.includes('Stock change / ការផ្លាស់ប្ដូរស្តុក: +12'), 'stock delta has its own label')
assert.ok(stockLines.some((line) => line.includes('all branches / គ្រប់សាខា 95')), 'the on-hand total is bilingual')
assert.ok(!stockLines.some((line) => line.startsWith('Change / ')), '"Change" must stay the money-handed-back label')

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
assert.ok(returnLines.includes('Settlement / វិធីដោះស្រាយ: refund / សងប្រាក់'), 'the settlement enum is translated')

assertAllBilingual(telegram.formatReturnTelegramLines({
  kind: 'supplier', createdAt: '2026-09-03T03:04:05.000Z', returnNumber: 'SRET-1', party: 'Acme',
  branch: 'Shop', items: [{ product: 'Rice 5kg', quantity: 2 }], compensationUsd: 10, lossUsd: 2, by: 'Sethy',
}), 'supplier return')

// The two routes that still compose their lines inline -- covered without
// touching files other lanes own.
assertAllBilingual([
  'Receipt: 20260903-100405',
  'Status: awaiting payment → completed',
  'Customer: Sok Dara',
  'Reason: Customer cancelled',
  'Lost fee: $2.00',
], 'routes/sales.ts inline status lines')
const feeLines = assertAllBilingual([
  'Type: rent', 'Amount: $150.00', 'Date: 2026-09-03', 'Label: September', 'Note: paid in cash',
], 'routes/fees.ts inline fee lines')
// routes/fees.ts emits a bare ISO fee_date; the feed must show ONE date shape.
assert.ok(feeLines.includes('Date / កាលបរិច្ឆេទ: 09/03/2026'), 'an ISO Date value is normalised to the pinned mm/dd/yyyy')
assert.equal(lang.localizeTelegramLine('Date: 09/03/2026 10:04'), 'Date / កាលបរិច្ឆេទ: 09/03/2026 10:04', 'an already-formatted date is untouched')
assert.equal(lang.localizeTelegramLine('Note: 2026-09-03'), 'Note / កំណត់ចំណាំ: 2026-09-03', 'only the Date label is reformatted')
console.log('PASS payloads: sale, stock, transfer, both return kinds and both inline route messages are bilingual')

// A free-text value must never be rewritten, however unlucky the wording.
assert.equal(lang.localizeTelegramLine('Product: None'), 'Product / ផលិតផល: None', 'a product named "None" is left alone')
assert.equal(lang.localizeTelegramLine('Note: item(s) damaged in transit'), 'Note / កំណត់ចំណាំ: item(s) damaged in transit', 'a free-text note is left alone')
assert.equal(lang.localizeTelegramLine('• Rice 5kg 2 × $1.00 = $2.00'), '• Rice 5kg 2 × $1.00 = $2.00', 'item bullets pass through')
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
  assert.ok(reference.includes(`▸ ${doc.example}`), `${doc.command} has no example`)
  assert.ok(KHMER.test(doc.km) && !KHMER.test(doc.en), `${doc.command} descriptions are in the wrong scripts`)
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
const wired = loadReal('lib/telegram.ts', {
  './db': { getDb: () => stubDb },
  './businessDateWindow': businessDateWindow,
  './telegramLang': lang,
  // The real kernel over the same stub db, so `/shift` goes down its actual
  // query path here rather than a hand-written imitation of it.
  './salesAnalytics': loadReal('lib/salesAnalytics.ts', { './db': { getDb: () => stubDb }, './businessDateWindow': businessDateWindow }),
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

  const quiet = sent.length
  await wired.handleTelegramWebhook(env, { message: { text: 'good morning', chat: { id: -100999 } } })
  await wired.handleTelegramWebhook(env, { message: { text: '/report', chat: {} } })
  await wired.handleTelegramWebhook(env, {})
  assert.equal(sent.length, quiet, 'plain chatter, a chat-less update and an empty update send nothing')

  assert.ok(sent.every((call) => call.url.startsWith('https://api.telegram.org/bot<redacted>/')), 'every send went through the one Telegram endpoint')
  console.log(`PASS commands: ${sent.length} composed replies, allow-list enforced, nothing sent for non-commands`)

  // Business day, business date shape.
  assert.equal(wired.formatBusinessDay('2026-09-01'), '01/09/2026', 'report headers use the pinned dd/mm/yyyy')
  assert.equal(wired.formatBusinessDay('2026-12-25'), '25/12/2026', 'and a day past the 12th proves the order')
  assert.equal(wired.formatBusinessDay(''), '', 'a missing date degrades quietly')
  console.log('PASS dates: report headers render dd/mm/yyyy, the project-wide convention')

  console.log('\ntelegram bilingual + commands tests passed')
})().catch((error) => { console.error(error); process.exit(1) })
