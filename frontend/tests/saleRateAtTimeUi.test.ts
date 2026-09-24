// A sale's money is read at the rate the sale was made with. Owner rule
// (24 Sep 2026): "a change to the exchange rate applies only from the date
// and time it was changed onwards; every older sale (and other dated money
// record) keeps the rate it was made with."
//
// Every case runs production code with live settings at 4,200, a rate no
// fixture sale was made at, so a surface that reaches for today's rate prints
// different riel than one that reads the sale. The receipt is RENDERED
// (react-dom/server): the component POS.tsx, Sales.tsx and the
// receipt-settings preview mount, and the DOM printReceipt.ts clones for
// print/image/PDF -- a grep can pass while the paper still says otherwise.
//
// Run: node tests/saleRateAtTimeUi.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { RECEIPT_TEMPLATE_REVISION } from '../src/utils/receiptAppliedConfig.ts'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

// Same stub shape as receiptItemNumbering.test.ts: only the shell (app
// context, icons, portal menu) is faked -- the money math, template
// normalizer and line layout that decide what a row says load for real.
function loadReceiptComponent(): unknown {
  const source = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
  const mod = { exports: {} as Record<string, unknown> }
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.includes('/AppContext')) {
      return {
        useApp: () => ({
          fmtUSD: (value: number | string) => `$${Number(value).toFixed(2)}`,
          fmtKHR: (value: number | string) => `${Math.round(Number(value)).toLocaleString('en-US')}៛`,
          khrSymbol: '៛',
          t: (key: string) => key,
        }),
      }
    }
    if (id.includes('utils/formatters')) return require('../src/utils/formatters.ts')
    if (id.includes('receiptLineMath')) return require('../src/utils/receiptLineMath.ts')
    if (id.includes('receiptTotals')) return require('../src/utils/receiptTotals.ts')
    if (id.includes('receipt-settings/template')) return require('../src/components/receipt-settings/template.ts')
    if (id.includes('receiptAppliedConfig')) return require('../src/utils/receiptAppliedConfig.ts')
    if (id.includes('receiptTextContrast')) return require('../src/utils/receiptTextContrast.ts')
    if (id.includes('receiptItemColumns')) return require('../src/utils/receiptItemColumns.ts')
    if (id.includes('saleItemNameLayout')) return require('../src/utils/saleItemNameLayout.ts')
    if (id.includes('customerIdentity')) return require('../src/utils/customerIdentity.ts')
    if (id.includes('contactOptionUtils')) return require('../src/components/contacts/contactOptionUtils.ts')
    if (id.includes('ReceiptQrCodes')) {
      return { __esModule: true, default: () => null, normalizeQrSocialLinksForReceipt: () => [] }
    }
    return { __esModule: true, default: () => null }
  }, mod, mod.exports)
  return mod.exports.default
}

const Receipt = loadReceiptComponent()
const LIVE_RATE = 4200

// A legacy (pre-v1) delivery sale that stored no riel of its own, so every
// riel figure on the paper is derived from a rate: 2 x $5.00 + $1.00 delivery
// the customer pays = $11.00, $5.00 paid, $6.00 still owed.
function renderReceipt(saleOverrides: Record<string, unknown>): string {
  const settings = {
    business_name: 'Shop',
    exchange_rate: LIVE_RATE,
    // Every riel sub-line on. A template from before the current revision has
    // them forced off (receiptAppliedConfig.ts), so stamp the current one.
    receipt_template: JSON.stringify({ show_item_khr: true, show_delivery_khr: true, template_revision: RECEIPT_TEMPLATE_REVISION }),
    receipt_print_settings: JSON.stringify({}),
  }
  const sale = {
    receipt_number: '20240315-101500',
    created_at: '2024-03-15T03:15:00Z',
    cashier_name: 'Rath',
    payment_method: 'Cash',
    money_precision_version: 0,
    subtotal_usd: 10,
    discount_usd: 0,
    tax_usd: 0,
    is_delivery: 1,
    delivery_fee_usd: 1,
    delivery_fee_paid_by: 'customer',
    total_usd: 11,
    amount_paid_usd: 5,
    amount_paid_khr: 0,
    items: [{ product_name: 'Serum', quantity: 2, applied_price_usd: 5, price_usd: 5, base_price_usd: 5, total_usd: 10 }],
    ...saleOverrides,
  }
  return renderToStaticMarkup(React.createElement(Receipt, { sale, settings, onClose: () => {}, _previewMode: true }))
}

// The printed text with every tag collapsed to one "|", so a row reads
// "|Balance due:|$0.01|21៛|".
const printedText = (html: string): string => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|')

await runTest('a legacy sale 21 riel short prints a 21 riel balance, not the 41 riel of a rounded cent', () => {
  // $10.00 at 4,100 paid with 40,979 riel owes $0.0051. The legacy column
  // prints that to the cent; the riel line is the owed amount converted once.
  const text = printedText(renderReceipt({
    exchange_rate: 4100, is_delivery: 0, delivery_fee_usd: 0, total_usd: 10, amount_paid_usd: 0, amount_paid_khr: 40979,
  }))
  const row = text.match(/\|Balance due:\|[^|]*\|[^|]*\|/)?.[0]
  assert.equal(row, '|Balance due:|$0.01|21៛|')
})

await runTest('a delivery sale booked at 4,000 prints every riel line at 4,000 while Settings says 4,200', () => {
  const text = printedText(renderReceipt({ exchange_rate: 4000 }))
  assert.match(text, /\|· 1 USD = 4,000 ៛\|/)
  assert.match(text, /\|Serum\|2\|\$5\.00\|\$10\.00\|40,000៛\|/)
  assert.match(text, /\|Delivery Fee:\|\$1\.00\|4,000៛\|/)
  assert.match(text, /\|TOTAL\|\$11\.00\|44,000៛\|/)
  assert.match(text, /\|Balance due:\|\$6\.00\|24,000៛\|/)
  assert.doesNotMatch(text, /4,200|42,000|46,200|25,200/, 'the live 4,200 rate reached the paper')
})

for (const missing of [null, 0] as const) {
  await runTest(`a delivery sale that stored rate ${missing} prints at the 4,100 default, never the live 4,200`, () => {
    const text = printedText(renderReceipt({ exchange_rate: missing }))
    assert.match(text, /\|· 1 USD = 4,100 ៛\|/)
    assert.match(text, /\|Delivery Fee:\|\$1\.00\|4,100៛\|/)
    assert.match(text, /\|TOTAL\|\$11\.00\|45,100៛\|/)
    assert.match(text, /\|Balance due:\|\$6\.00\|24,600៛\|/)
    assert.doesNotMatch(text, /4,200|46,200|25,200/, 'the live 4,200 rate reached the paper')
  })
}

await runTest('settling reads the sale\'s own rate for legacy and v1 alike, and refuses to invent one', async () => {
  const { saleOwnExchangeRate } = await import('../src/utils/saleMoneyV1.ts')
  assert.equal(saleOwnExchangeRate({ exchange_rate: 4000 }), 4000)
  assert.equal(saleOwnExchangeRate({ exchange_rate: '4000' }), 4000)
  for (const missing of [null, undefined, 0, '', -1, 'abc']) {
    assert.equal(saleOwnExchangeRate({ exchange_rate: missing }), null, String(missing))
  }
  // The Sale detail's settlement session: the sale's own rate, never the
  // settings row. The source at the lane tip read `rawSettings.exchange_rate`
  // for legacy sales and compared the session with the live config rate.
  const modal = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(modal, /rawSettings\.exchange_rate/)
  assert.doesNotMatch(modal, /paymentConfig\.value\.exchangeRate/)
  assert.match(modal, /const exchangeRate = saleOwnExchangeRate\(selectedSale\) \?\? CURRENCY\.DEFAULT_EXCHANGE_RATE/)
})

await runTest('a sale with no rate of its own is refused in the shop\'s language, not as the raw code, on settle, add items and amend', () => {
  // The Worker's refusal, the code the UI maps.
  const worker = fs.readFileSync(new URL('../../cloudflare/src/routes/sales.ts', import.meta.url), 'utf8')
  assert.match(worker, /code: 'money_precision_invalid_rate' \}, 409\)/)
  const sales = fs.readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  assert.match(sales, /code === 'money_precision_invalid_rate'\s*\n\s*\? translateOr\('sale_invalid_own_rate'/)
  // Settlement detail, add-items and amendment failures all route through it.
  assert.equal(sales.match(/saleInvalidRateMessage\(error\) \?\? getErrorMessage\(/g)?.length, 3)
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
  assert.match(en.sale_invalid_own_rate, /no exchange rate of its own/)
  assert.match(km.sale_invalid_own_rate, /អត្រាប្តូរប្រាក់/)
  assert.notEqual(km.sale_invalid_own_rate, en.sale_invalid_own_rate)
})

if (failed > 0) {
  process.exitCode = 1
}
