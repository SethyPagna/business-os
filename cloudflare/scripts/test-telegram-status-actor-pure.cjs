// The receipt-status Telegram message: it must name the user who made the
// update (S4-6), and it must name the STATUSES the way the app names them
// (Sep 22 2026 -- the owner found "awaiting payment" still on their phone
// long after the app had renamed that status to "Not Paid / ប្រាក់ជំពាក់").
//
// The lines used to be composed INLINE in routes/sales.ts's
// `app.patch('/:id/status', ...)` handler, and this test used to extract that
// block out of the source text and eval it. They now come from
// lib/telegram.ts's formatSaleStatusTelegramLines, like every other event
// message -- a route composing message text is a place the message rules do
// not reach, which is exactly how the retired wording survived. So this test:
//
//   1. Drives the REAL builder for three actors -- full name, username-only,
//      and none -- to prove it degrades sanely when there is none.
//   2. Checks that routes/sales.ts still WIRES the actor (and the rest of the
//      facts) into that builder, by scanning the real source: moving the
//      composition must not quietly drop the `by` argument.
//   3. Runs the resulting lines through the REAL localizeTelegramLine (the
//      one function that makes every Telegram line bilingual, per
//      lib/telegram.ts's sendTelegramEvent) to prove the composed message
//      actually carries the Khmer line, not just an English one.
//
// Run (from cloudflare/): node scripts/test-telegram-status-actor-pure.cjs
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

const noDb = { getDb: () => { throw new Error('no DB in this test') } }
const telegramLang = loadReal('lib/telegramLang.ts')
const actorSnapshot = loadReal('lib/actorSnapshot.ts')
const businessDateWindow = loadReal('lib/businessDateWindow.ts')
const moneyPrecision = loadReal('lib/moneyPrecision.ts')
const saleMoneyPrecision = loadReal('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const reportMoneyPrecision = loadReal('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = loadReal('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = loadReal('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const refundMoneyPrecision = loadReal('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = loadReal('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const saleTotals = loadReal('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const financialPrecision = loadReal('lib/financialPrecision.ts')
const nativeSaleChange = loadReal('lib/nativeSaleChange.ts', { './financialPrecision': financialPrecision, './saleTotals': saleTotals })
const salesAnalytics = loadReal('lib/salesAnalytics.ts', {
  './schemaProbe': loadReal('lib/schemaProbe.ts'), './db': noDb, './removalLosses': loadReal('lib/removalLosses.ts'),
  './businessDateWindow': businessDateWindow, './saleMoneyPrecision': saleMoneyPrecision,
  './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement,
  './refundMoneyPrecision': refundMoneyPrecision,
})
const lowStockRule = loadReal('lib/lowStockSettings.ts', { './db': noDb })
const telegram = loadReal('lib/telegram.ts', {
  './lowStockSettings': { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG },
  './db': noDb, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang,
  './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange, './salesAnalytics': salesAnalytics,
  './shiftReconciliation': loadReal('lib/shiftReconciliation.ts', { './db': noDb, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts') }),
})

const build = (user, overrides = {}) => telegram.formatSaleStatusTelegramLines({
  receipt: '20260904-100405',
  fromStatus: 'completed',
  toStatus: 'cancelled',
  customer: 'Sok Dara',
  // N13: the REAL kernel, not a local re-implementation -- if the Telegram
  // line and the stored cashier_name ever disagreed, that is the bug.
  by: actorSnapshot.actorSnapshot(user),
  ...overrides,
})

// -- non-vacuous proof: WITHOUT the actor line, none of these would hold. --

// N13: the account USERNAME wins -- the shop channel must name the same
// identity the sale row stores as cashier_name, and the fixture session
// carries a display name that differs so the two are distinguishable.
{
  const lines = build({ name: 'Za', username: 'za01' })
  assert.deepEqual(lines.filter((line) => line.startsWith('By')), ['By: za01'])
  assert.equal(lines[lines.length - 1], 'By: za01', 'the actor line is last, matching the existing `by` idiom in formatStockChangeTelegramLines/formatTransferTelegramLines/formatReturnTelegramLines')
  console.log('PASS 1: a named actor produces the trailing "By: za01" line -- the username, never the display name')
}

// A session with no display name at all changes nothing: the username was
// always the value being reported.
{
  const lines = build({ name: '', username: 'za01' })
  assert.ok(lines.includes('By: za01'), 'the username is reported whether or not a display name exists')
  assert.deepEqual(
    build({ name: 'Za Sethy', username: 'za01' }).filter((line) => line.startsWith('By')),
    lines.filter((line) => line.startsWith('By')),
    'the display name has no influence on the actor line',
  )
  console.log('PASS 2: the actor line is identical with and without a display name')
}

// No actor at all (defensive: requireAuth should always set one, but the
// line must still degrade sanely if it somehow does not) -- no dangling
// "By: undefined" / "By: null", and no bare "By:" line either.
{
  const lines = build(null)
  assert.ok(!lines.some((line) => line.startsWith('By')), 'with no known actor, the whole line is omitted -- never "By: undefined"')
  assert.ok(!build({ id: 7, name: 'Za Sethy' }).some((line) => line.startsWith('By')), 'a session with a display name but NO account username still prints no actor line')
  assert.ok(!lines.some((line) => /undefined|null/.test(line)), 'no line anywhere prints the literal "undefined"/"null"')
  console.log('PASS 3: a missing actor omits the line entirely, the same degrade-gracefully idiom `by` already uses elsewhere')
}

// ---- the route still WIRES the facts into the builder ---------------------
// The composition moved out of routes/sales.ts, so the risk moved with it:
// a field silently dropped from the call site would print nothing and break
// no type. Scan the real source for the call and for each argument it must
// carry. If the call is renamed or restructured this fails loudly rather
// than silently testing a builder nothing calls.
{
  const salesSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  const start = salesSrc.indexOf('lines: formatSaleStatusTelegramLines({')
  assert.ok(start > 0, 'routes/sales.ts must compose its status alert through lib/telegram.ts -- has the call moved?')
  const call = salesSrc.slice(start, salesSrc.indexOf('}),', start))
  for (const [field, value] of [
    ['receipt', 'sale.receipt_number'], ['fromStatus', 'oldStatus'], ['toStatus', 'saleStatus'],
    ['customer', 'sale.customer_name'], ['reason', 'cancelReasonLabel'], ['skippedUnits', 'totalSkippedUnits'],
    ['lostFeeUsd', 'cancelFeeUsd'], ['lostFeeKhr', 'cancelFeeKhr'], ['by', 'actorName'],
  ]) {
    assert.ok(new RegExp(`${field}:[^,\\n]*${value.replace('.', '\\.')}`).test(call), `the status alert no longer passes ${field} (${value}):\n${call}`)
  }
  // The retired inline composition must not come back beside the new call.
  assert.ok(!/Status: \$\{oldStatus/.test(salesSrc), 'the raw-enum status line must not be re-composed in the route')
  console.log('PASS 4: routes/sales.ts wires all nine facts, actor included, into the shared builder')
}

// ---- the REAL bilingual pipeline actually carries the Khmer line ----------
// Mirrors sendTelegramEvent's own composition (lib/telegram.ts) without
// needing the DB-backed config lookup: heading + lines, each cleaned and
// localized, blanks dropped.
function cleanLine(value, max = 400) {
  return String(value ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}
function composeMessage(lines) {
  return [
    telegramLang.localizeTelegramHeading('🧾 Receipt status updated'),
    ...lines.map((line) => telegramLang.localizeTelegramLine(cleanLine(line))),
  ].filter(Boolean).join('\n')
}

{
  const text = composeMessage(build({ name: 'Za', username: 'za01' }))
  assert.ok(text.includes('· By / ដោយ: za01'), `composed message must carry the bilingual actor line, got:\n${text}`)
  assert.ok(/[ក-៿]/.test(text), 'the composed message must contain Khmer script somewhere')
  console.log('PASS 5: the composed message carries "· By / ដោយ: za01" -- English label, Khmer label, one value')
}

{
  const text = composeMessage(build(null))
  assert.ok(!text.includes('By'), `with no actor, no "By" line (bilingual or not) should appear, got:\n${text}`)
  console.log('PASS 6: with no actor, the composed message has no "By" line at all (bilingual or not)')
}

// ---- the whole message, exactly as the shop receives it -------------------
// The owner's Sep 22 2026 reference layout, and the defect it was reported
// against: the status line used to read
// `Status: awaiting payment → completed` -- the raw database enum, in
// English only, using a phrase the app retired months earlier.
{
  const text = composeMessage(telegram.formatSaleStatusTelegramLines({
    receipt: '20260921-150355', fromStatus: 'awaiting_payment', toStatus: 'completed',
    customer: 'Polyta Thay', by: 'admin',
  }))
  assert.equal(text, [
    '🧾 Receipt status updated / ស្ថានភាពបានផ្លាស់ប្ដូរ',
    '· Receipt / វិក្កយបត្រ: 20260921-150355',
    '· Status / ស្ថានភាព: Not Paid / ប្រាក់ជំពាក់ → Completed / បានបញ្ចប់',
    telegramLang.GROUP_RULE,
    '· Customer / អតិថិជន: Polyta Thay',
    '· By / ដោយ: admin',
  ].join('\n'), text)
  // The negative control the whole change exists for.
  assert.ok(!/awaiting.payment/i.test(text), 'the retired English phrase must be gone')
  assert.ok(!text.includes('កំពុងរង់ចាំការទូទាត់'), 'and the retired Khmer phrase with it')
  console.log('PASS 7: the shipped status message matches the owner\'s reference layout, in both languages')
}

// Each optional fact adds exactly one row, in the second group, above `By`.
{
  const full = telegram.formatSaleStatusTelegramLines({
    receipt: 'R-9', fromStatus: 'completed', toStatus: 'cancelled', customer: 'Sok Dara',
    reason: 'Customer cancelled', skippedUnits: 3, lostFeeUsd: 2, lostFeeKhr: 0, by: 'admin',
  })
  assert.deepEqual(full, [
    'Receipt: R-9',
    'Status: completed → cancelled',
    telegramLang.GROUP_RULE,
    'Customer: Sok Dara',
    'Reason: Customer cancelled',
    // UPDATED Sep 23 2026. The note is a PLAIN `Label: value` row like every
    // other line the builder emits -- it briefly composed its own bilingual
    // sentence here, which is the one thing a builder must not do (see the
    // three-mode check at the end of this file). `unit(s)` is the counter
    // every other Telegram message writes (lib/telegram.ts's `counted`), so
    // the English plural is carried the same way here as in /report.
    'Stock skipped: 3 unit(s)',
    'Lost fee: $2.00',
    'By: admin',
  ], full.join('\n'))
  const one = telegram.formatSaleStatusTelegramLines({ receipt: 'R-9', fromStatus: 'completed', toStatus: 'cancelled', skippedUnits: 1 })
  assert.ok(one.includes('Stock skipped: 1 unit(s)'), one.join('\n'))
  assert.ok(!full.join('\n').includes('ឯកតា') && !full.join('\n').includes('មិនប៉ះពាល់ស្តុក'),
    'the BUILDER emits English only -- the Khmer is added by the localizer, in the shop\'s mode')
  // A bare change -- no customer, no reason, no fee, no actor -- keeps its
  // first group and drops the second, divider and all.
  const bare = telegram.formatSaleStatusTelegramLines({ receipt: 'R-9', fromStatus: 'completed', toStatus: 'cancelled' })
  assert.deepEqual(bare, ['Receipt: R-9', 'Status: completed → cancelled'], bare.join('\n'))
  console.log('PASS 8: every optional row is its own line in plain English, and an empty group takes its divider with it')
}

// ---- 9. the three language modes, through the REAL send path --------------
//
// Every check above runs the lines through localizeTelegramLine directly,
// which is the localisation HALF of sendTelegramEvent -- and that is exactly
// the blind spot that let a builder-composed bilingual sentence ship: the
// mode is set by sendTelegramEvent around its own pass, long after the route
// asked the builder for its lines, so a `bi()` call inside the builder always
// read the module's `both` default and printed both languages to an en-only
// and a km-only shop alike. The only way to see that is to send.
//
// So this block drives the real exported sendTelegramEvent with the shop's
// `telegram_language` setting answered from a stub settings table and the
// Telegram API call captured instead of made. NOTHING IS SENT: fetch is
// replaced for the duration and restored after.
;(async () => {
  const posted = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/, 'the send path must be the Telegram API and nothing else')
    posted.push(JSON.parse(init.body))
    return { ok: true, status: 200, text: async () => '' }
  }
  let shopLanguage = 'both'
  const settingsDb = {
    getDb: () => ({
      prepare: () => ({
        all: async () => [
          { key: 'telegram_automation_enabled', value: '1' },
          { key: 'telegram_chat_id', value: '-100999' },
          { key: 'telegram_language', value: shopLanguage },
        ],
      }),
    }),
  }
  const wired = loadReal('lib/telegram.ts', {
    './lowStockSettings': { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG },
    './db': settingsDb, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang,
    './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange, './salesAnalytics': salesAnalytics,
    './shiftReconciliation': loadReal('lib/shiftReconciliation.ts', { './db': noDb, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts') }),
  })
  const sendIn = async (mode) => {
    shopLanguage = mode
    posted.length = 0
    const sent = await wired.sendTelegramEvent({ TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-one' }, {
      type: 'status',
      lines: wired.formatSaleStatusTelegramLines({ receipt: 'R-9', fromStatus: 'completed', toStatus: 'cancelled', skippedUnits: 3, by: 'admin' }),
    })
    assert.equal(sent, true, `sendTelegramEvent did not compose anything in ${mode} mode`)
    assert.equal(posted.length, 1, `expected exactly one captured message in ${mode} mode`)
    return posted[0].text.split('\n').find((line) => line.includes('skipped') || line.includes('មិនប៉ះពាល់ស្តុក'))
  }
  try {
    const both = await sendIn('both')
    const en = await sendIn('en')
    const km = await sendIn('km')
    assert.equal(both, '· Stock skipped / មិនប៉ះពាល់ស្តុក: 3 unit(s) / ឯកតា', both)
    assert.equal(en, '· Stock skipped: 3 unit(s)', en)
    assert.equal(km, '· មិនប៉ះពាល់ស្តុក: 3 ឯកតា', km)
    // THE REGRESSION, stated as its own assertion: an en-only shop must get no
    // Khmer on this line and a km-only shop no English. Both were false while
    // the builder paired the words itself.
    assert.ok(!/[ក-៿]/.test(en), 'an English-only shop must not be sent Khmer on the skipped-stock note')
    assert.ok(!/[A-Za-z]/.test(km.replace(/[·\s]/g, '')), 'a Khmer-only shop must not be sent English words on it')
    console.log('PASS 9: the skipped-stock note renders en-only, km-only and bilingual through the real sendTelegramEvent path')
  } finally {
    globalThis.fetch = realFetch
  }
  console.log('All Telegram status-actor tests passed')
})().catch((error) => { console.error(error); process.exit(1) })
