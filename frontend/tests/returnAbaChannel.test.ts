// KHQR security review N3: "Through ABA" chosen over the cap shown on screen must not silently become a cash refund. The choice is sent on every return path and the Worker's
// refusal (aba_refund_over_online) is what the cashier reads.
//
// Run: node tests/returnAbaChannel.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { abaRefundOffer, refundChannelFields } from '../src/components/returns/helpers/abaRefund.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const rows = [{ method: 'ABA KHQR', amount_usd: 20 }]
const offerFor = (creditUsd: number, over: Record<string, unknown> = {}) => abaRefundOffer({ paymentDetails: rows, method: 'ABA KHQR', canRefund: true, creditUsd, exchangeActive: false, returnType: 'refund', ...over })

test('a chosen ABA refund always carries refund_channel, within the shown cap or over it', () => {
  // CATCHES: the old fallback (chosen + over cap = nothing sent = a drawer refund the cashier did not pick).
  assert.deepEqual(refundChannelFields(offerFor(12.5), true), { refund_channel: 'aba' })
  const over = offerFor(25)
  assert.equal(over.overCap, true)
  assert.deepEqual(refundChannelFields(over, true), { refund_channel: 'aba' }, 'over the shown cap the choice is still sent, so the Worker can refuse it')
})

test('cash chosen, or no ABA offer at all, sends nothing', () => {
  // CATCHES: the channel on a cash refund, and on a sale that took no online money (the Worker would refuse with refund_channel_requires_online_order).
  assert.deepEqual(refundChannelFields(offerFor(12.5), false), {})
  assert.deepEqual(refundChannelFields(offerFor(12.5, { paymentDetails: [{ method: 'Cash', amount_usd: 20 }] }), true), {})
})

test('both return paths spread the same channel, and nothing falls back to cash on the screen', () => {
  // CATCHES: the older request path losing the choice, and a re-introduced !overCap condition.
  const source = fs.readFileSync(path.join(here, '..', 'src', 'components', 'returns', 'NewReturnModal.tsx'), 'utf8')
  assert.equal((source.match(/\.\.\.abaChannel,/g) ?? []).length, 2, 'the net return body and the older request body both carry it')
  assert.ok(/const legacyReturnIntent = \{[\s\S]*?\.\.\.abaChannel,[\s\S]*?total_refund_usd/.test(source), 'the older path is one of them')
  assert.ok(!/overCap/.test(source), 'the modal never turns the choice off by its own cap')
  assert.ok(/creditUsd: totalRefund/.test(source), 'the older path is offered the choice too (its refund total is the item total)')
})
