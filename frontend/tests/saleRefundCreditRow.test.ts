import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSettlementPayload,
  initialSettlementRows,
  settlementRowsEqual,
  settlementRowsIssue,
  type SettlementRow,
} from '../src/components/sales/saleSettlement.ts'

// An exchange's refund credit is not money the customer handed over: every payment form carries it locked, as stored.
const here = path.dirname(fileURLToPath(import.meta.url))
const editorSource = fs.readFileSync(path.resolve(here, '../src/components/sales/SaleSettlementEditor.tsx'), 'utf8')
const en = JSON.parse(fs.readFileSync(path.resolve(here, '../src/lang/en.json'), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(path.resolve(here, '../src/lang/km.json'), 'utf8')) as Record<string, string>

const sale = {
  paymentDetails: JSON.stringify([
    { method: 'Cash', amount_usd: 3.3333, amount_khr: 0, refund_credit: true },
    { method: 'Cash USD', amount_usd: 3, amount_khr: 0 },
  ]),
  amountPaidUsd: 6.3333, amountPaidKhr: 0, totalUsd: 10, exchangeRate: 4100, moneyPrecisionVersion: 1 as const,
}
// Cash was renamed to Cash USD since: the rename moved the customer's row, and the credit kept the method it was booked under.
const configured = ['Cash USD', 'ABA']
const rows = initialSettlementRows({ ...sale, configuredMethods: configured })

assert.equal(rows[0].refundCredit, true, 'the flagged stored row is the credit')
assert.equal(rows[0].method, 'Cash', 'the credit keeps its stored method even though it is no longer configured')
assert.equal(rows[1].refundCredit, undefined, "the customer's own row of the same method is not the credit")
assert.equal(rows[1].method, 'Cash USD', "the customer's row carries the renamed method")

for (const replaceRecorded of [false, true]) {
  assert.equal(settlementRowsIssue(rows.slice(0, 1), configured, replaceRecorded), null,
    `a credit row with 4 decimals and an inactive method is valid as recorded (correction ${replaceRecorded})`)
}
const plainRow: SettlementRow = { id: 'settlement-new', method: 'Cash', usd: '3.3333', khr: '' }
assert.equal(settlementRowsIssue([plainRow], configured), 'method', 'control: the same row without the flag is a new row and needs an active method')

for (const replaceRecorded of [false, true]) {
  const payload = buildSettlementPayload(rows, configured, replaceRecorded)
  assert.deepEqual(payload?.payment_details[0], { method: 'Cash', amount_usd: 3.3333, amount_khr: 0, refund_credit: true },
    `the credit is sent exactly as stored (correction ${replaceRecorded})`)
  assert.equal(payload?.payment_details.filter((row) => row.refund_credit === true).length, 1)
}
assert.equal(buildSettlementPayload([plainRow], ['Cash'])?.payment_details[0].refund_credit, undefined, 'control: no flag is invented')

assert.equal(settlementRowsEqual(rows, rows.map((row) => ({ ...row }))), true)
assert.equal(settlementRowsEqual(rows, rows.map(({ refundCredit: _flag, ...row }) => row)), false, 'losing the flag is a change')

assert.match(editorSource, /const locked = row\.refundCredit === true \|\| \(row\.id\.startsWith\('recorded-'\) && !allowRecordedEdits\)/, 'the credit is locked in every mode')
assert.equal((editorSource.match(/disabled=\{saving \|\| locked\}/g) ?? []).length, 2, 'both amount inputs read the lock')
assert.match(editorSource, /disabled=\{saving \|\| row\.refundCredit === true \|\|/, 'the credit row cannot be removed')
assert.match(editorSource, /translate\('refund_credit', 'Refund credit', 'ប្រាក់សងវិញ'\)/, 'the row is labelled with the receipt word')
assert.equal(en.refund_credit, 'Refund credit')
assert.equal(km.refund_credit, 'ប្រាក់សងវិញ')

console.log('PASS refund credit row: locked, labelled, kept with its method and flag in every payment form')
