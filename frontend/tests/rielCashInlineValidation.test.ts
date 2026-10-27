// Riel paid in cash is whole 100៛ notes (owner, 27 Oct 2026, lane 6.0.1006). The Worker refuses the rest with
// riel_cash_not_hundreds; the frontend says so INLINE at the riel field, in both language packs, and sends nothing.
// The real components are rendered (esbuild + renderToStaticMarkup) so the check is the markup the cashier sees.
// DISCRIMINATING: 39,950 riel by Cash shows the error and blocks; 39,900 by Cash and 39,950 by ABA do not; a recorded
// row and a stored shift count from before the rule are kept unless the user changes them.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { settlementRowsIssue, type SettlementRow } from '../src/components/sales/saleSettlement.ts'
import { exchangePaymentIssue } from '../src/components/returns/helpers/returnExchange.ts'
import { shiftCountPairBlocker, shiftRielCountInvalid } from '../src/api/shiftTransport.ts'

const require = createRequire(import.meta.url)
const render = require('react-dom/server').renderToStaticMarkup as (element: unknown) => string
const React = require('react')
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const source = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function load(relative: string, shims: Record<string, unknown>) {
  const compiled = transformSync(source(relative), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const module = { exports: {} as Record<string, any> }
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    for (const [key, value] of Object.entries(shims)) if (id.includes(key)) return value
    return { default: () => null, __esModule: true }
  }, module, module.exports)
  return module.exports
}

const ERROR = 'data-riel-cash-error'
const row = (id: string, method: string, khr: string): SettlementRow => ({ id, method, usd: '', khr })

runTest('both language packs carry the refusal, short', () => {
  assert.equal(en.riel_cash_not_hundreds, 'Cash riel must be whole 100៛ notes.')
  assert.ok(km.riel_cash_not_hundreds && /១០០៛/.test(km.riel_cash_not_hundreds) && km.riel_cash_not_hundreds.length <= 40)
})

runTest('settlement rows: a cash row of 39,950 riel is the riel_cash issue; 39,900 cash and 39,950 ABA are not', () => {
  const configured = ['Cash', 'ABA']
  assert.equal(settlementRowsIssue([row('a', 'Cash', '39950')], configured), 'riel_cash')
  assert.equal(settlementRowsIssue([row('a', 'Cash', '39900')], configured), null)
  assert.equal(settlementRowsIssue([row('a', 'ABA', '39950')], configured), null)
  // A recorded row repeated by a settlement is kept as stored; a correction replaces it, so it is asked.
  assert.equal(settlementRowsIssue([row('recorded-0', 'Cash', '19950'), row('b', 'ABA', '20000')], configured), null)
  assert.equal(settlementRowsIssue([row('recorded-0', 'Cash', '19950'), row('b', 'ABA', '20000')], configured, true), 'riel_cash')
  // The shop's own pin wins: ABA declared cash is cash.
  assert.equal(settlementRowsIssue([row('a', 'ABA', '39950')], configured, false, { aba: 'cash' }), 'riel_cash')
})

runTest('exchange payment: the same rows give the same answer before the money is netted', () => {
  const quote = { net_usd: 9.99, exchange_rate: 4000, not_paid: false }
  assert.equal(exchangePaymentIssue([row('a', 'Cash', '39950')], quote, ['Cash', 'ABA']), 'riel_cash')
  assert.equal(exchangePaymentIssue([row('a', 'ABA', '39950')], quote, ['Cash', 'ABA']), null)
})

runTest('the settlement editor marks the riel field inline, translated, and only on the cash row', () => {
  const editor = load('../src/components/sales/SaleSettlementEditor.tsx', { saleSettlement: require('../src/components/sales/saleSettlement.ts') }).default
  const props = { configuredMethods: ['Cash', 'ABA'], exchangeRate: 4000, totalUsd: 9.99, moneyPrecisionVersion: 1, saving: false, error: '', recordedIssue: null,
    translate: (key: string, english: string, khmer?: string) => key === 'riel_cash_not_hundreds' ? `KM:${khmer}` : english, fmtUSD: String, fmtKHR: String, onChange: () => {} }
  const html = (rows: SettlementRow[], extra = {}) => render(React.createElement(editor, { ...props, rows, ...extra }))
  const refused = html([row('a', 'ABA', '39950'), row('b', 'Cash', '39950')])
  assert.equal(refused.split(ERROR).length - 1, 1, 'exactly one row is marked')
  assert.match(refused, /aria-invalid="true"/)
  assert.ok(refused.includes(`KM:${km.riel_cash_not_hundreds}`), 'the Khmer text is the pack text')
  assert.ok(!html([row('b', 'Cash', '39900')]).includes(ERROR))
  assert.ok(!html([row('recorded-0', 'Cash', '19950'), row('b', 'ABA', '20000')]).includes(ERROR), 'a recorded row is not marked')
  assert.ok(html([row('recorded-0', 'Cash', '19950')], { allowRecordedEdits: true }).includes(ERROR), 'a correction asks it')
})

runTest('shift counts: the riel field is marked and the submit row blocked; a stored count left as it is passes', () => {
  assert.equal(shiftCountPairBlocker('', '39950', { blankMeansUncounted: true }), 'riel_cash')
  assert.equal(shiftCountPairBlocker('', '39900', { blankMeansUncounted: true }), null)
  assert.equal(shiftCountPairBlocker('', '39950', { blankMeansUncounted: true, storedKhr: 39950 }), null)
  assert.equal(shiftRielCountInvalid('12350', 39950), true)
  assert.equal(shiftRielCountInvalid(''), false)
  const pair = load('../src/components/shifts/ShiftCountFields.tsx', {
    AppContext: { useApp: () => ({ t: (key: string) => key === 'riel_cash_not_hundreds' ? en.riel_cash_not_hundreds : key }) },
    shiftTransport: { shiftRielCountInvalid },
  })
  const html = (extra: Record<string, unknown>) => render(React.createElement(pair.default, { label: 'Counted', usd: '', khr: '39950', onUsd: () => {}, onKhr: () => {}, usdLabel: 'USD', khrLabel: 'KHR', ...extra }))
  assert.ok(html({}).includes(en.riel_cash_not_hundreds))
  assert.ok(!html({ khr: '39900' }).includes(ERROR))
  assert.ok(!html({ storedKhr: 39950 }).includes(ERROR), 'an amend that keeps the stored count is not marked')
  assert.ok(!html({ disabled: true }).includes(ERROR), 'a read-only pair is not marked')
  assert.equal(pair.shiftCountBlockerKey('riel_cash'), 'riel_cash_not_hundreds')
})

runTest('cancel lost fee: 39,950 riel blocks the confirm and is marked inline', () => {
  const cancel = load('../src/components/sales/CancelSaleFields.tsx', { saleStatusResolution: require('../src/utils/saleStatusResolution.ts') })
  const { cancelFieldsComplete, EMPTY_CANCEL_FIELDS } = cancel
  const ready = { ...EMPTY_CANCEL_FIELDS, cancel_reason: 'mistake' as const }
  assert.equal(cancelFieldsComplete({ ...ready, cancel_fee_khr: '39950' }), false)
  assert.equal(cancelFieldsComplete({ ...ready, cancel_fee_khr: '39900' }), true)
  assert.equal(cancelFieldsComplete(ready), true)
  const fields = cancel.default
  const html = render(React.createElement(fields, { value: { ...ready, cancel_fee_khr: '39950' }, onChange: () => {}, withFee: true, tr: (key: string, english: string) => key === 'riel_cash_not_hundreds' ? 'RIEL' : english }))
  assert.ok(html.includes(ERROR) && html.includes('RIEL'))
})

runTest('POS and expense form wire the same rule at the field and stop the request', () => {
  const pos = source('../src/components/pos/POS.tsx')
  assert.match(pos, /rielCashFieldInvalid\(detail\.method, detail\.khr, posMethodKinds\)/)
  assert.match(pos, /if \(rielCashInvalidRows\.size\) return\n\s+if \(saleStatus !== 'awaiting_payment' && !posTenderCovers\)/)
  assert.match(pos, /rielCashInvalidRows\.has\(detail\.id\) \? <p [^>]*data-riel-cash-error>\{t\('riel_cash_not_hundreds'\)/)
  assert.match(pos, /isCashPaymentMethod\(d\.method, posMethodKinds\)/, 'the collect hint asks the same cash definition')
  const fee = source('../src/components/fees/FeeForm.tsx')
  assert.match(fee, /if \(!pendingCreate && rielCashInvalid\) return/)
  assert.match(fee, /rielCashInvalid \? <p [^>]*data-riel-cash-error>/)
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
