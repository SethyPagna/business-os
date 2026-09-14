// P3-L3 item C, review defect 3: the promotion named beside a line's cut is
// capped at the SAME 40 characters on all three surfaces.
//
// The Telegram sale line already capped it (cloudflare/src/lib/telegram.ts,
// cleanLine(item.promotionLabel, 40)); the two screen surfaces did not. The
// receipt drops the label beside the product name on 58/80 mm paper and the
// sale detail drops it into a `whitespace-nowrap` price cell, so a merchant
// who names a rule "Khmer New Year mega sale on every imported lipstick,
// serum and sunscreen -- three days only" pushed the total column off the
// screen and off the paper.
//
// The receipt half is a REAL render of components/receipt/Receipt.tsx (same
// component POS, Sales and the receipt-settings preview mount), not a grep.
// The sale detail half executes the shared helper and pins the cell's shape:
// SaleDetailModal.tsx is a 2,900-line component with 51 imports and browser
// globals at module scope, so rendering it here would be a harness bigger
// than the feature; the property that matters -- the cell prints the CAPPED
// value and never the raw column -- is checked on the source.
//
// Run: node tests/promotionLabelCap.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { PROMOTION_LABEL_MAX_CHARACTERS, promotionLabelText } from '../src/utils/saleItemNameLayout.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup as (node: unknown) => string

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

// 120 characters, deliberately: three times the cap, so a mistake that caps
// at the wrong boundary cannot pass by coincidence.
const LONG_LABEL = 'Khmer New Year mega sale on every imported lipstick, serum and sunscreen -- three days only, members first!!'.slice(0, 120).padEnd(120, '!')
const CAPPED = LONG_LABEL.slice(0, 40)

await runTest('the shared cap is 40 code points, whitespace-collapsed, and never splits a character', () => {
  assert.equal(PROMOTION_LABEL_MAX_CHARACTERS, 40)
  assert.equal(LONG_LABEL.length, 120)
  assert.equal(promotionLabelText(LONG_LABEL), CAPPED)
  assert.equal(Array.from(promotionLabelText(LONG_LABEL)).length, 40)
  assert.equal(promotionLabelText('Summer sale'), 'Summer sale', 'a short label passes through untouched')
  assert.equal(promotionLabelText('  Summer   sale\nnow  '), 'Summer sale now', 'newlines and runs collapse: the cell is nowrap')
  assert.equal(promotionLabelText(null), '')
  assert.equal(promotionLabelText(undefined), '')
  assert.equal(promotionLabelText('   '), '', 'a blank label renders nothing at all, not an empty tag')
  // Khmer counts by code point like every other script, and an astral
  // character is one character, never half a surrogate pair.
  const khmer = 'បញ្ចុះតម្លៃ'.repeat(10)
  assert.equal(Array.from(promotionLabelText(khmer)).length, 40)
  const astral = '🎉'.repeat(60)
  assert.equal(promotionLabelText(astral), '🎉'.repeat(40))
  assert.doesNotMatch(promotionLabelText(astral), /[\uD800-\uDBFF]$/, 'the cap never ends on a lone high surrogate')
})

// --- the receipt, rendered for real ----------------------------------------

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
    if (id.includes('ReceiptQrCodes')) return { __esModule: true, default: () => null, normalizeQrSocialLinksForReceipt: () => [] }
    return { __esModule: true, default: () => null }
  }, mod, mod.exports)
  return mod.exports.default
}

const Receipt = loadReceiptComponent()

function renderReceiptWithLabel(label: unknown, discounted = true): string {
  return renderToStaticMarkup(React.createElement(Receipt, {
    sale: {
      receipt_number: '20260914-120000',
      created_at: '2026-09-14T05:00:00Z',
      cashier_name: 'Rath',
      payment_method: 'Cash',
      exchange_rate: 4065,
      subtotal_usd: 18,
      total_usd: 18,
      amount_paid_usd: 18,
      items: [{
        product_name: 'Lip Balm',
        quantity: 1,
        base_price_usd: 21,
        price_usd: 21,
        applied_price_usd: discounted ? 18 : 21,
        product_discount_label: label,
      }],
    },
    settings: { business_name: 'Shop', exchange_rate: 4065, receipt_template: '{}', receipt_print_settings: '{}' },
    onClose: () => {},
    _previewMode: true,
  }))
}

// The promotion tag beside the product name, as it really renders: its
// visible text and the full title parked on it, or null when no tag printed.
const PROMOTION_TAG = /class="ml-1 text-\[10px\] font-semibold text-red-600"(?: title="([^"]*)")?>([^<]*)</
function promotionTag(html: string): { title: string; text: string } | null {
  const match = html.match(PROMOTION_TAG)
  return match ? { title: match[1] ?? '', text: match[2] } : null
}

await runTest('the receipt prints the capped promotion and not one character more', () => {
  const tag = promotionTag(renderReceiptWithLabel(LONG_LABEL))
  assert.ok(tag, 'the promotion tag prints on a discounted line')
  assert.equal(tag.text, CAPPED, 'exactly the first 40 characters reach the paper')
  assert.equal(Array.from(tag.text).length, 40)
  // The full title stays reachable on screen, so the tag is not a dead end.
  assert.equal(tag.title, LONG_LABEL, 'the untruncated title is still available on hover')
})

await runTest('a short promotion is unchanged, and a line with no cut names none', () => {
  assert.equal(promotionTag(renderReceiptWithLabel('Summer sale'))?.text, 'Summer sale', 'a normal title prints in full')
  assert.equal(promotionTag(renderReceiptWithLabel('Summer sale', false)), null, 'no cut on the line, no promotion name')
  assert.equal(promotionTag(renderReceiptWithLabel('   ')), null, 'a blank label renders no tag at all')
  assert.equal(promotionTag(renderReceiptWithLabel(null)), null, 'a line with no promotion renders no tag')
})

// --- the sale detail cell ---------------------------------------------------

await runTest('the sale detail price cell prints the capped value, never the raw column', () => {
  const modal = fs.readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(modal, /import \{ promotionLabelText, saleEditorInputWidth \} from '\.\.\/\.\.\/utils\/saleItemNameLayout\.ts'/, 'the modal uses the SHARED helper, not a second cap')
  assert.match(modal, /const promotionLabel = promotionLabelText\(item\.product_discount_label\)/)
  assert.match(modal, /\(-\{fmtUSD\(displayDiscount\)\}\{promotionLabel \? ` \$\{promotionLabel\}` : ''\}\)/, 'the parentheses carry the capped value')
  const priceCell = modal.slice(modal.indexOf('<td data-sale-line-price='), modal.indexOf('<td data-sale-line-total='))
  assert.doesNotMatch(priceCell, /\{item\.product_discount_label\}|\$\{item\.product_discount_label\}/, 'the raw label is never rendered as text in the nowrap cell')
  // Same contract as the receipt: the untruncated title stays on hover.
  assert.match(priceCell, /title=\{String\(item\.product_discount_label \|\| ''\)\}/)
})

if (failed) {
  console.error(`\n${failed} promotion label cap test(s) failed`)
  process.exit(1)
}
console.log('\nPASS promotion label capped at 40 characters on the receipt and the sale detail')
