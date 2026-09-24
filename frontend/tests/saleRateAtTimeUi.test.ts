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

if (failed > 0) {
  process.exitCode = 1
}
