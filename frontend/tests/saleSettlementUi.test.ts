import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSettlementPayload,
  configuredSettlementMethods,
  initialSettlementRows,
  recordedSettlementIssue,
  settlementRowsIssue,
  settlementTotals,
  type SettlementRow,
} from '../src/components/sales/saleSettlement.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, relative), 'utf8')
const modalSource = read('../src/components/sales/SaleDetailModal.tsx')
const editorSource = read('../src/components/sales/SaleSettlementEditor.tsx')
const salesSource = read('../src/components/sales/Sales.tsx')
const historySource = read('../src/utils/actionHistory.ts')

assert.deepEqual(
  configuredSettlementMethods([' Cash ', 'ABA Bank', 'aba bank', 'Pi Pay', 'Transfer', 'Wing']),
  ['Cash', 'ABA Bank', 'Wing'],
  'configured selector options use canonical spelling, casefold dedupe, and exclude retired methods',
)
assert.deepEqual(configuredSettlementMethods([]), [], 'an explicit empty configuration must block settlement')
assert.deepEqual(configuredSettlementMethods('not-json'), [], 'a malformed configuration must not invent active tenders')
assert.deepEqual(configuredSettlementMethods(undefined), [], 'a missing configuration must not invent active tenders')

const partial = initialSettlementRows({
  paymentDetails: [
    { method: 'cash', amount_usd: 3, amount_khr: 0 },
    { method: 'ABA Bank', amount_usd: 0, amount_khr: 12600 },
  ],
  paymentMethod: 'Cash + ABA Bank',
  amountPaidUsd: 3,
  amountPaidKhr: 12600,
  totalUsd: 10,
  exchangeRate: 4200,
  configuredMethods: ['Cash', 'ABA Bank'],
})
assert.deepEqual(partial.slice(0, 2).map(({ method, usd, khr }) => ({ method, usd, khr })), [
  { method: 'Cash', usd: '3', khr: '' },
  { method: 'ABA Bank', usd: '', khr: '12600' },
])
assert.equal(partial[2]?.usd, '4.00', 'latest reviewed settings rate calculates a cent-precision outstanding row')
assert.deepEqual(settlementTotals([
  { id: 'precision', method: 'Cash', usd: '1.005', khr: '' },
], 4100), { amountPaidUsd: 1.005, amountPaidKhr: 0, paidEquivalentUsd: 1.005 })

const repeated: SettlementRow[] = [
  { id: 'recorded-a', method: 'cash', usd: '1.005', khr: '' },
  { id: 'b', method: 'Cash', usd: '', khr: '500' },
]
assert.equal(settlementRowsIssue(repeated, ['Cash']), null, 'POS tender rows may repeat the same configured method')
assert.deepEqual(buildSettlementPayload(repeated, ['Cash']), {
  payment_details: [
    { method: 'Cash', amount_usd: 1.005, amount_khr: 0 },
    { method: 'Cash', amount_usd: 0, amount_khr: 500 },
  ],
}, 'the full ordered native tender snapshot is submitted without aggregate fields')
assert.equal(settlementRowsIssue([{ id: 'x', method: 'Cash', usd: '-1', khr: '' }], ['Cash']), 'amount')
assert.equal(settlementRowsIssue([{ id: 'x', method: 'Cash', usd: '1.005', khr: '' }], ['Cash']), 'amount', 'new USD tender must use cents')
assert.equal(settlementRowsIssue([{ id: 'recorded-x', method: 'Retired', usd: '1.005', khr: '' }], ['Cash']), null, 'an existing legacy 4dp inactive tender remains unchanged')
assert.equal(settlementRowsIssue([{ id: 'x', method: 'Cash', usd: '', khr: '1.5' }], ['Cash']), 'amount')
assert.equal(settlementRowsIssue([{ id: 'x', method: 'Unknown', usd: '1', khr: '' }], ['Cash']), 'method')

assert.equal(recordedSettlementIssue({ paymentDetails: '{bad', amountPaidUsd: 0, amountPaidKhr: 0 }), 'malformed')
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 'oops' }], amountPaidUsd: 0, amountPaidKhr: 0 }), 'malformed')
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 3 }], amountPaidUsd: 2, amountPaidKhr: 0 }), 'mismatch')
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 3 }], amountPaidUsd: 3, amountPaidKhr: 0 }), null)
assert.equal(recordedSettlementIssue({ paymentDetails: [{ method: 'Cash', amount_usd: 1.2349 }], amountPaidUsd: 1.23, amountPaidKhr: 0 }), 'mismatch', 'header and lines compare at exact 4dp precision')
assert.equal(recordedSettlementIssue({ paymentDetails: null, paymentMethod: 'Cash + ABA Bank', amountPaidUsd: 3, amountPaidKhr: 0 }), 'allocation')

assert.doesNotMatch(editorSource, /<select[\s>]/, 'settlement editor must not add a native select')
assert.match(editorSource, /min-h-11/, 'method targets remain at least 44px tall')
assert.match(editorSource, /h-11 w-11/, 'row removal remains a 44px touch target')
assert.match(editorSource, /grid-cols-1[\s\S]*sm:grid-cols-2/, 'USD and KHR controls stay legible at 320px')
assert.match(editorSource, /disabled=\{saving \|\|/, 'editor controls lock while the settlement request runs')
assert.match(editorSource, /row\.id\.startsWith\('recorded-'\)/, 'recorded tender rows are visibly read-only')
assert.match(modalSource, /client_request_id:\s*settlementRequestIdRef\.current/, 'retries reuse one reviewed request id')
assert.match(modalSource, /expected_exchange_rate:\s*settlementSession\.exchangeRate/, 'the server guards the reviewed exchange-rate quote')
assert.match(modalSource, /expected_updated_at:\s*settlementSession\.expectedUpdatedAt/, 'the reviewed sale revision is frozen with the tender')
assert.match(modalSource, /exchangeRateChanged[\s\S]*?sale_settlement_rate_changed/, 'a stale quote refreshes the preview and requires another confirmation')
assert.match(modalSource, /settlementSession\.exchangeRate/, 'the editor and coverage preview use the frozen settings rate')
assert.match(modalSource, /useCloseGuard\(\{ dirty: settlementDirty \}/, 'edited tender rows are protected by the standard close guard')
assert.doesNotMatch(modalSource, /payment_method:\s*method[\s\S]{0,120}amount_paid_usd/, 'settlement no longer sends derived payment aggregates')
assert.match(salesSource, /hasServerSettlementHistory[\s\S]*?refreshServerItems/, 'server settlement history replaces the local status-only history entry')
assert.match(salesSource, /code\?: unknown \}\)\.code === 'exchange_rate_changed'[\s\S]*?exchangeRateChanged/, 'Sales returns the server current rate to the open review')
assert.match(historySource, /applier === 'sale\.settlement'/, 'settlement undo and redo include optimistic generation checks')

console.log('PASS awaiting-payment multi-tender settlement UI contract')
