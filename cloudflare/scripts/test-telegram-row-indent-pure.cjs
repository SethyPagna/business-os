// Pins the hanging indent of Telegram list rows. Owner, 23 Sep 2026, over a
// 15-item sale alert: "for each new line in this report to telegram we can do
// some add spaced so they don't show directly from new line so easier to
// read. like an indentation so it doesn't start with numbered list."
//
// A phone wraps a row wider than its message bubble back to the left edge,
// under the item numbers, where the rest of the row reads as the next item.
// lib/telegram.ts telegramRowLines now breaks a list row at a phone's width and
// starts every line after the first with HANGING_INDENT. Checked here: the
// helper itself, the owner's own sale through formatSaleTelegramLines, and the
// indent surviving the REAL sendTelegramEvent, which trims every line it
// cleans. NOTHING IS SENT: fetch is captured for the duration.
//
// Run (from cloudflare/): node scripts/test-telegram-row-indent-pure.cjs
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
const telegram = loadReal('lib/telegram.ts', {
  './lowStockSettings': { ...lowStockRule, loadLowStockConfig: async () => lowStockRule.DEFAULT_LOW_STOCK_CONFIG },
  './db': settingsDb, './businessDateWindow': businessDateWindow, './telegramLang': telegramLang,
  './saleTotals': saleTotals, './nativeSaleChange': nativeSaleChange, './salesAnalytics': salesAnalytics,
  './shiftReconciliation': loadReal('lib/shiftReconciliation.ts', { './db': noDb, './salesAnalytics': salesAnalytics, './nativeSaleChange': nativeSaleChange, './paymentMethodRegistry': loadReal('lib/paymentMethodRegistry.ts') }),
})

const { telegramRowLines } = telegram
const INDENT = telegramLang.HANGING_INDENT
const WIDTH = 36
assert.equal(INDENT, '     ', 'the one continuation indent is five spaces (the command reference already used it)')

// ---- 1. the helper --------------------------------------------------------
// A row that fits a phone stays one line: nothing about a short item changes.
assert.deepEqual(telegramRowLines('2. Rice 5kg', ['1 × $7.25', '= $7.25']), ['2. Rice 5kg 1 × $7.25 = $7.25'])
// A row that does not fit breaks between its words, and the price equation
// keeps one line of its own when it fits one.
assert.deepEqual(
  telegramRowLines('7. Cle De Peau Volumizing Cream Supreme 50g', ['1 × $350.00', '(−$10.00)', '= $340.00']),
  ['7. Cle De Peau Volumizing Cream', `${INDENT}Supreme 50g`, `${INDENT}1 × $350.00 (−$10.00) = $340.00`],
)
// An equation too wide for one line breaks between its parts, never inside
// one: a quantity stays with its price, a total with its `=`.
assert.deepEqual(
  telegramRowLines('1. Coca Cola 330ml', ['2 × $0.60', '(−$0.20 Summer sale)', '= $1.00']),
  ['1. Coca Cola 330ml 2 × $0.60', `${INDENT}(−$0.20 Summer sale) = $1.00`],
)
// A part wider than a whole line breaks between its words, losing none.
const longCut = '(−$0.20 Buy two get the third one free this weekend)'
const cutLines = telegramRowLines('3. Soap', ['2 × $0.60', longCut, '= $1.00'])
assert.ok(cutLines.every((line) => line.length <= WIDTH), cutLines.join('\n'))
assert.equal(cutLines.map((line) => line.trim()).join(' '), `3. Soap 2 × $0.60 ${longCut} = $1.00`)
// A part wider than a line breaks at its own separators first: a figure of a
// transfer's on-hand never leaves its branch behind ("· Shop" / "25").
assert.deepEqual(
  telegramRowLines('• Rice 5kg', ['10', '— Warehouse 90 · Shop 25 · all branches 115']),
  ['• Rice 5kg 10 — Warehouse 90', `${INDENT}· Shop 25 · all branches 115`],
)
// The marker never ends a line on its own: a name with no space to break at
// (a Khmer name, a long code) stays on the number's line.
const unbroken = 'ក្រែមលាបមុខសម្រាប់ស្បែកស្ងួតខ្លាំងណាស់'
assert.deepEqual(telegramRowLines(`4. ${unbroken}`, ['1 × $5.00', '= $5.00']), [`4. ${unbroken}`, `${INDENT}1 × $5.00 = $5.00`])
// Nor does a separator: a break before `—` or `·` leaves it opening the next
// line, beside the figure it introduces, never dangling at a line's end.
const separated = telegramRowLines('• OUT — Dior Rouge Dior On Stage Ink Blur Matte 122 — 2 · all branches 115')
assert.ok(separated.length > 1, separated.join('\n'))
for (const line of separated) {
  assert.ok(line.length <= WIDTH, `"${line}" is wider than a phone shows whole`)
  assert.ok(!/(?:^| )(?:\d+\.|[•↔·—=×→])$/.test(line), `"${line}" ends with a marker or separator`)
}
assert.equal(separated.map((line) => line.trim()).join(' '), '• OUT — Dior Rouge Dior On Stage Ink Blur Matte 122 — 2 · all branches 115')
console.log('PASS 1: telegramRowLines keeps short rows whole and breaks long ones on an indent')

// ---- 2. the owner's sale ---------------------------------------------------
// The 15 items of the owner's 23 Sep 2026 message, every one wider than a
// phone: [name, price, cut]. One of each, net = price - cut.
const OWNER_ITEMS = [
  ['Candle Mango Papaya 411g', 28, 3], ['Candle Champagne Toast 411g', 28, 3], ['Cle de peau UV Spf 50+', 95, 5],
  ['Prada Paradoxe EDP 90ml', 140, 5], ['Rabanne Paco Rabanne EDP 80ml', 85, 5], ['Prada ParaDoxe Virtual Flower 50ml', 113, 5],
  ['Cle De Peau Volumizing Cream Supreme 50g', 350, 10], ['Glossier Glossier You EDP100ml', 138, 8], ['Dior Forever Velvet Powder 3N', 65, 5],
  ['Bobbi Brown Vitamin Base Serum No Box 30ml', 53, 3], ['YSL Setting Spray 100ml', 65, 5], ['Dior Rouge Dior On Stage Matte Lipstick 215', 49, 2],
  ['Dior Rouge Dior On Stage Ink Blur Matte 100', 49, 1], ['Urban Decay Eyeliner 24/7 Inks', 27, 2], ['Dior Rouge Dior On Stage Ink Blur Matte 122', 49, 1],
]
const ownerSale = {
  status: 'awaiting_payment', createdAt: '2026-09-23T05:06:16.000Z', receiptNumber: '20260923-120616', cashier: 'Za', branch: 'Shop',
  customer: 'Jrukprey', phone: '070489626', exchangeRate: 4065,
  items: OWNER_ITEMS.map(([name, price, cut]) => ({ name, quantity: 1, basePriceUsd: price, unitPriceUsd: price - cut, lineTotalUsd: price - cut })),
  subtotalUsd: 1271, discountUsd: 0, taxUsd: 0, totalUsd: 1271, totalKhr: 5166615, paidUsd: 0, paidKhr: 0,
}
// What each item printed as ONE line before this change -- the text a phone
// used to wrap back under the numbers.
const oneLine = OWNER_ITEMS.map(([name, price, cut], index) => `${index + 1}. ${name} 1 × $${price.toFixed(2)} (−$${cut.toFixed(2)}) = $${(price - cut).toFixed(2)}`)
assert.equal(oneLine[6], '7. Cle De Peau Volumizing Cream Supreme 50g 1 × $350.00 (−$10.00) = $340.00', 'the fixture reproduces the owner message')

// Every line of the item block either opens an item with its number or
// continues the item above on the indent, and none is wider than a phone.
function checkItemBlock(block, where) {
  assert.ok(block.length > OWNER_ITEMS.length, `${where}: the owner's items are wider than a phone, so they take more lines than items`)
  const items = []
  for (const line of block) {
    assert.ok(line.length <= WIDTH, `${where}: "${line}" is ${line.length} characters, wider than a phone shows whole`)
    if (line.startsWith(INDENT)) {
      assert.ok(items.length, `${where}: a continuation line cannot come first`)
      assert.ok(/^\S/.test(line.slice(INDENT.length)), `${where}: "${line}" is indented by exactly the one indent`)
      assert.ok(!/^\d+\. /.test(line.trim()), `${where}: a continuation line never looks like the next item`)
      items[items.length - 1].push(line.trim())
    } else {
      assert.match(line, new RegExp(`^${items.length + 1}\\. `), `${where}: item ${items.length + 1} opens at the left edge with its number`)
      items.push([line])
    }
  }
  // Read back as one line each, the items say exactly what they said before:
  // nothing lost, nothing reordered, only the breaks and the indent are new.
  assert.deepEqual(items.map((lines) => lines.join(' ')), oneLine, `${where}: the items' text is unchanged`)
}

const GROUP = telegramLang.GROUP_RULE
const lines = telegram.formatSaleTelegramLines(ownerSale)
const groups = lines.join('\n').split(`\n${GROUP}\n`)
const itemBlock = groups.find((group) => group.startsWith('1. ')).split('\n')
checkItemBlock(itemBlock, 'formatSaleTelegramLines')
assert.deepEqual(itemBlock.slice(0, 4), [
  '1. Candle Mango Papaya 411g',
  `${INDENT}1 × $28.00 (−$3.00) = $25.00`,
  '2. Candle Champagne Toast 411g',
  `${INDENT}1 × $28.00 (−$3.00) = $25.00`,
])
console.log('PASS 2: the owner\'s 15-item sale opens each item at the left edge and continues it on the indent')

// ---- 3. through the REAL send path -----------------------------------------
// sendTelegramEvent cleans every line (cleanLine trims), so without its own
// handling the indent built above would reach the phone stripped, back at
// the left edge. The item block must arrive exactly as built, in every mode.
;(async () => {
  const posted = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.telegram\.org\/bot/, 'the send path must be the Telegram API and nothing else')
    posted.push(JSON.parse(init.body))
    return { ok: true, status: 200, text: async () => '' }
  }
  try {
    for (const mode of ['both', 'en', 'km']) {
      shopLanguage = mode
      posted.length = 0
      const sent = await telegram.sendTelegramEvent({ TELEGRAM_BOT_TOKEN: 'test-token-not-a-real-one' }, { type: 'sales', lines: telegram.formatSaleTelegramLines(ownerSale) })
      assert.equal(sent, true, `sendTelegramEvent composed nothing in ${mode} mode`)
      assert.equal(posted.length, 1, `expected one captured message in ${mode} mode`)
      const text = posted[0].text
      const block = text.split(`\n${GROUP}\n`).find((group) => group.startsWith('1. ')).split('\n')
      checkItemBlock(block, `sent in ${mode} mode`)
      assert.deepEqual(block, itemBlock, `${mode} mode: the item block arrives exactly as built`)
      // The label rows around it are untouched by the indent: still one
      // bullet row each, localized as before.
      assert.ok(text.split('\n').some((line) => line.startsWith(`${telegramLang.ROW_BULLET}`)), `${mode} mode: label rows keep their bullet`)
    }
    console.log('PASS 3: the indent survives the real sendTelegramEvent in both, en and km modes')
  } finally {
    globalThis.fetch = realFetch
  }
  console.log('All Telegram row-indent tests passed')
})().catch((error) => { console.error(error); process.exit(1) })
