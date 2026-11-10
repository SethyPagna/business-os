// KHQR security review N1: the staff screens and the till must read the money exactly as the Worker's staff detail sends it. The fixture is NOT hand-made: it is the
// recorded output of the Worker's real staff route (cloudflare/scripts/test-online-order-staff-money-contract-native.cjs writes it and fails when the Worker's output
// differs), and this test feeds it to the UI's own logic. Before the fix the Worker sent camelCase only, so a paid $25 order read as $0 paid (the till asked the customer to
// pay again) and a cancelled order owing $25 offered no Refund.
//
// Run: node tests/onlineOrdersWorkerContract.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { availableActions, fulfilHandoff, type StaffOrderDetail } from '../src/components/online-orders/onlineOrdersLogic.ts'
import { fulfilMoney, withOnlineTender } from '../src/components/online-orders/fulfilOrder.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const recorded = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'staff-order-detail-contract.json'), 'utf8')) as Record<'paid' | 'cancelled_owing' | 'partly_refunded', StaffOrderDetail>
const ALL = { canView: true, canDecide: true, canRefund: true }

test('the recorded Worker detail is the customer-view money shape (the names the screens read)', () => {
  // CATCHES: a fixture re-recorded from a Worker that sends camelCase only.
  for (const [name, detail] of Object.entries(recorded)) {
    for (const key of ['paid_usd', 'refunded_usd', 'refund_due_usd', 'balance_due_usd', 'held_in_review_usd']) assert.equal(typeof (detail.money as Record<string, unknown>)[key], 'number', `${name}.money.${key}`)
  }
})

test('a paid $25 order: the hand-off carries $25, the till adds one $25 online payment row and has nothing to take', () => {
  // CATCHES: paid_usd read as 0 (the cashier is told to take $25 from a customer who already paid, and no online row is added).
  const handoff = fulfilHandoff(recorded.paid)
  assert.equal(handoff.paid_usd, 25)
  const money = fulfilMoney(handoff.paid_usd, 25)
  assert.equal(money.kind, 'same'); assert.equal(money.balanceUsd, 0); assert.equal(money.coverUsd, 25)
  assert.deepEqual(withOnlineTender([] as Array<{ id: string; method: string; usd: string; khr: string }>, 'ABA KHQR', money.coverUsd).map((row) => [row.method, row.usd]), [['ABA KHQR', '25.00']])
})

test('a cancelled order owing $25 offers Refund; a paid order that owes nothing does not', () => {
  // CATCHES: refund_due_usd read as 0 (Refund never shown, refund notes cannot be written from the screen).
  assert.ok(availableActions(recorded.cancelled_owing, ALL).includes('refund'))
  assert.ok(!availableActions(recorded.cancelled_owing, { ...ALL, canRefund: false }).includes('refund'))
  assert.ok(!availableActions(recorded.paid, ALL).includes('refund'))
  assert.equal(recorded.partly_refunded.money.refunded_usd, 10)
  assert.ok(availableActions(recorded.partly_refunded, ALL).includes('refund'), 'what is still due ($15) can be noted')
})

test('in the composed tree the fixture equals the Worker lane\'s copy', () => {
  // CATCHES: the two lanes recording different shapes.
  const worker = path.join(here, '..', '..', 'cloudflare', 'scripts', 'fixtures', 'staff-order-detail-contract.json')
  if (!fs.existsSync(worker)) return
  assert.deepEqual(JSON.parse(fs.readFileSync(worker, 'utf8')), recorded)
})
