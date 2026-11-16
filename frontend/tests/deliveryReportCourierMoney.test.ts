import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deliveryProfitIsLoss, showsCourierCost, showsDeliveryProfit } from '../src/components/contacts/deliveryReportCourierMoney.ts'

// Review finding A, 16 Nov 2026. The delivery margin (fee charged minus the courier's actual cost) is courier money and
// travels under delivery_margin_usd. A bare margin_usd is stripped from every Sales response for staff as product money,
// which left "Delivery profit: $0.00" next to a real cost. The modal must show the exact figure for a granted account and
// hide the line (never print a zero) for an account without sales:view_courier_cost.
const granted = { actual_cost_usd: 1.24, actual_cost_count: 2, delivery_margin_usd: 2.26 }
assert.equal(showsDeliveryProfit(granted), true)
assert.equal(showsCourierCost(granted), true)
assert.equal(deliveryProfitIsLoss(granted), false)

// A courier row the Worker has redacted carries neither figure.
const redacted = { charged_fee_usd: 3.5 } as Record<string, unknown>
assert.equal(showsDeliveryProfit(redacted), false, 'no grant: the profit line is hidden')
assert.equal(showsCourierCost(redacted), false, 'no grant: the cost stat is hidden')
assert.equal(deliveryProfitIsLoss(redacted), false)

// A real zero margin and a real loss are shown (a zero is a figure, absence is not).
assert.equal(showsDeliveryProfit({ delivery_margin_usd: 0 }), true)
assert.equal(deliveryProfitIsLoss({ delivery_margin_usd: 0 }), false)
assert.equal(showsDeliveryProfit({ delivery_margin_usd: -0.5 }), true)
assert.equal(deliveryProfitIsLoss({ delivery_margin_usd: -0.5 }), true)
// The retired bare key never counts as a delivery margin.
assert.equal(showsDeliveryProfit({ margin_usd: 2.26 } as Record<string, unknown>), false)
assert.equal(showsDeliveryProfit({ delivery_margin_usd: null }), false)

const root = fileURLToPath(new URL('..', import.meta.url))
const modal = readFileSync(join(root, 'src/components/contacts/DeliveryContactReportModal.tsx'), 'utf8')
assert.match(modal, /showsDeliveryProfit\(row\) \?/, 'the profit line is wrapped in the helper')
assert.match(modal, /showsCourierCost\(row\) \? stat\(/, 'the cost stat is wrapped in the helper')
assert.match(modal, /row\.delivery_margin_usd/, 'the modal reads the delivery key')
assert.doesNotMatch(modal, /(?<![A-Za-z_])margin_usd/, 'the modal no longer reads a bare margin_usd')

// No frontend source reads the retired bare courier key.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}
const offenders = walk(join(root, 'src')).filter((file) => /(?<![A-Za-z_])margin_usd/.test(readFileSync(file, 'utf8')))
assert.deepEqual(offenders, [], 'a bare margin_usd is stripped as product money; use delivery_margin_usd')

console.log('deliveryReportCourierMoney.test.ts passed')
