// 6.0.963: the refund credit of an exchange is a tender row flagged refund_credit. The receipt names it "Refund credit" (Khmer ប្រាក់សងវិញ) and never prints it as the
// cash method it is stored under. Rendered assertions through the real component.
//
// Run: node --experimental-strip-types tests/receiptRefundCredit.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
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

// Same stub shape as receiptCompactRows.test.ts: only the shell (app context,
// icons, portal menu) is faked -- every collaborator that decides what a row
// says (money math, template normalizer, name layout) is loaded for real.
function loadReceiptComponent(source: string): unknown {
  const mod = { exports: {} as Record<string, unknown> }
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.includes('/AppContext')) {
      return {
        useApp: () => ({
          fmtUSD: (value: number | string) => `$${Number(value).toFixed(2)}`,
          fmtKHR: (value: number | string) => `${Math.round(Number(value)).toLocaleString()}៛`,
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


const receiptSource = fs.readFileSync(new URL('../src/components/receipt/Receipt.tsx', import.meta.url), 'utf8')
const Receipt = loadReceiptComponent(receiptSource)

const credit = { method: 'Cash', amount_usd: 10, amount_khr: 0, refund_credit: true }
const cash = { method: 'Cash', amount_usd: 4, amount_khr: 0 }

function render(paymentDetails: unknown, receiptLanguage: string, method = 'Cash'): string {
  const settings = {
    business_name: 'Shop',
    exchange_rate: 4065,
    receipt_template: JSON.stringify({ receipt_language: receiptLanguage, show_payment_method: true, show_amount_paid: true }),
    receipt_print_settings: JSON.stringify({}),
  }
  const paid = (paymentDetails as Array<{ amount_usd: number }>).reduce((sum, row) => sum + row.amount_usd, 0)
  const sale = {
    receipt_number: '20261022-101500', created_at: '2026-10-22T03:15:00Z', cashier_name: 'Rath', payment_method: method, exchange_rate: 4065,
    subtotal_usd: 14, discount_usd: 0, tax_usd: 0, total_usd: 14, amount_paid_usd: paid,
    payment_details: JSON.stringify(paymentDetails),
    items: [{ product_name: 'Palette', quantity: 1, base_price_usd: 14, price_usd: 14, applied_price_usd: 14 }],
  }
  return renderToStaticMarkup(React.createElement(Receipt, { sale, settings, onClose: () => {}, _previewMode: true }))
}

await runTest('the credit row prints as "Refund credit", never as the cash method it is stored under', () => {
  const html = render([credit, cash], 'en')
  assert.ok(html.includes('Refund credit'), 'the credit is named')
  assert.match(html, /Refund credit \+ Cash/, 'the credit and the cash taken beside it read as two methods')
  assert.doesNotMatch(html, /Paids*Cash/i, 'not printed as plain Cash')
})

await runTest('a sale paid only by the credit never reads "Cash"', () => {
  const html = render([credit], 'en')
  assert.ok(html.includes('Refund credit'))
  assert.doesNotMatch(html, /Paid\s*Cash/i, 'the paid line does not name Cash')
})

await runTest('the Khmer receipt names it ប្រាក់សងវិញ', () => {
  const html = render([credit, cash], 'km')
  assert.ok(html.includes('ប្រាក់សងវិញ'))
})

await runTest('a plain cash sale (no flagged row) still prints Cash, and an unflagged first row is not guessed to be a credit', () => {
  const html = render([cash, { method: 'Cash', amount_usd: 10, amount_khr: 0 }], 'en')
  assert.ok(!html.includes('Refund credit'))
  assert.match(html, /Cash/)
})

await runTest('the sale detail names the flagged row the same way', () => {
  const source = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
  assert.ok(source.includes("refund_credit: (entry as { refund_credit?: unknown })?.refund_credit === true"), 'the parser keeps the flag')
  assert.ok(source.includes('detail.refund_credit ? refundCreditLabel : detail.method'), 'the per-row label uses the credit word')
  assert.ok(source.includes('{paymentMethodShown}') && !source.includes('>{sale.payment_method}</span>'), 'the badge no longer prints the stored cash method for a credit')
})

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log('receipt refund credit: all checks passed')
