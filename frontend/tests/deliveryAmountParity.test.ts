// A sale carries TWO delivery money fields and the owner (Sep 6 2026) asked for
// both to be editable: "i see the delivery fees it should show options to
// change delivery actual cost and the delivery fees. both."
//
// Both are typed by a person, so both need an acceptance rule, and that rule
// lives twice -- once in the browser (src/utils/deliveryAmounts.ts) and once in
// the Worker (cloudflare/src/lib/deliveryAmounts.ts), because neither package
// imports the other. Two copies of one rule is exactly how a form that accepts
// "-2" ends up in front of a route that refuses it, so this test runs BOTH
// copies over the same matrix and fails when they disagree. Same shape, and
// for the same reason, as branchRoleParity.test.ts.
//
// It also pins the two things a working copy of the rule is worthless without:
// that both editors actually CALL it, and that a refusal is SHOWN. Before this
// lane, SaleDetailModal answered a bad amount with a bare `return` -- Apply did
// nothing at all, no message, no dialog, the number still sitting in the box.
//
// Run: node tests/deliveryAmountParity.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DELIVERY_AMOUNT_ERROR_KEYS,
  MAX_DELIVERY_AMOUNT_USD,
  deliveryAmountCents,
  deliveryAmountChanged,
  parseDeliveryAmountUsd,
} from '../src/utils/deliveryAmounts.ts'

let failed = 0
const runTest = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const workerSource = read('../../cloudflare/src/lib/deliveryAmounts.ts')
const browserSource = read('../src/utils/deliveryAmounts.ts')

// The Worker copy, evaluated for real. Both files are plain functions with no
// imports, so stripping the type annotations is enough to run one.
const asRunnable = workerSource
  .replace(/export type [\s\S]*?\n\n/g, '')
  .replace(/: DeliveryAmountResult/g, '')
  .replace(/: DeliveryAmountError/g, '')
  .replace(/: Record<DeliveryAmountError, string>/g, '')
  .replace(/: number \| null/g, '')
  .replace(/: boolean/g, '')
  .replace(/: string/g, '')
  .replace(/\((\w+): unknown, (\w+): unknown\)/g, '($1, $2)')
  .replace(/\((\w+): unknown\)/g, '($1)')
  .replace(/export (function|const)/g, '$1')
const worker = new Function(`${asRunnable}
return { parseDeliveryAmountUsd, deliveryAmountCents, deliveryAmountChanged, MAX_DELIVERY_AMOUNT_USD, DELIVERY_AMOUNT_ERROR_MESSAGES }`)() as {
  parseDeliveryAmountUsd: (raw: unknown) => { ok: boolean; usd?: number; code?: string }
  deliveryAmountCents: (value: unknown) => number | null
  deliveryAmountChanged: (before: unknown, after: unknown) => boolean
  MAX_DELIVERY_AMOUNT_USD: number
  DELIVERY_AMOUNT_ERROR_MESSAGES: Record<string, string>
}

// Every shape a delivery amount arrives in: what a cashier types, what an
// <input type="number"> hands back, the riel figure typed into a dollar box
// that the ceiling exists for, and the absent values a cleared field produces.
const INPUTS: unknown[] = [
  '0', '0.00', '1', '1.5', '2.50', ' 3.25 ', '007', '.5', '1e2',
  '-0.01', '-2', '-0', 'abc', '1.2.3', '', '   ', null, undefined,
  0, 1.005, 1.0049, 2500000, 1000000, 1000000.01, NaN, Infinity, -Infinity,
  '1,50', '$2', true, false,
]

runTest('both copies answer identically for every shape a typed amount arrives in', () => {
  for (const input of INPUTS) {
    const mine = parseDeliveryAmountUsd(input)
    const theirs = worker.parseDeliveryAmountUsd(input)
    assert.deepEqual(
      mine,
      theirs,
      `parseDeliveryAmountUsd disagreed for ${JSON.stringify(String(input))}: browser ${JSON.stringify(mine)} vs worker ${JSON.stringify(theirs)}`,
    )
  }
})

runTest('both copies agree on what counts as a change worth recording', () => {
  for (const before of INPUTS) {
    for (const after of INPUTS) {
      assert.equal(
        deliveryAmountChanged(before, after),
        worker.deliveryAmountChanged(before, after),
        `deliveryAmountChanged disagreed for ${String(before)} -> ${String(after)}`,
      )
    }
  }
})

runTest('the ceiling is one number, not two', () => {
  assert.equal(MAX_DELIVERY_AMOUNT_USD, worker.MAX_DELIVERY_AMOUNT_USD)
})

// The behaviour cases that actually separate a correct rule from a plausible
// wrong one, asserted on their own so a copy that drifts in one direction is
// named rather than merely "different".
runTest('zero is a real amount and blank is a different answer from zero', () => {
  assert.deepEqual(parseDeliveryAmountUsd('0'), { ok: true, usd: 0 })
  assert.deepEqual(parseDeliveryAmountUsd(''), { ok: false, code: 'blank' })
  assert.deepEqual(parseDeliveryAmountUsd('   '), { ok: false, code: 'blank' })
  assert.deepEqual(parseDeliveryAmountUsd(null), { ok: false, code: 'blank' })
})

runTest('a negative amount is refused with its own reason, not lumped in with junk', () => {
  assert.deepEqual(parseDeliveryAmountUsd('-2'), { ok: false, code: 'negative' })
  assert.deepEqual(parseDeliveryAmountUsd('abc'), { ok: false, code: 'not_a_number' })
  assert.deepEqual(parseDeliveryAmountUsd('2500000'), { ok: false, code: 'too_large' })
})

runTest('null is not another way of writing zero, so clearing a recorded cost IS a change', () => {
  assert.equal(deliveryAmountChanged(null, 0), true)
  assert.equal(deliveryAmountChanged(0, null), true)
  assert.equal(deliveryAmountChanged(null, null), false)
  assert.equal(deliveryAmountChanged(1.004, 1.0049), false, 'both store as 1.00, so nothing happened')
  assert.equal(deliveryAmountChanged(1.004, 1.005), true, 'and 1.005 stores as 1.01, so that one did happen')
  assert.equal(deliveryAmountCents('1.0049'), 100)
})

runTest('every refusal has a translation key and a Worker sentence', () => {
  for (const code of ['blank', 'not_a_number', 'negative', 'too_large']) {
    const key = DELIVERY_AMOUNT_ERROR_KEYS[code as keyof typeof DELIVERY_AMOUNT_ERROR_KEYS]
    assert.ok(key, `no translation key for ${code}`)
    assert.ok(worker.DELIVERY_AMOUNT_ERROR_MESSAGES[code], `no Worker sentence for ${code}`)
  }
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const key of [...Object.values(DELIVERY_AMOUNT_ERROR_KEYS), 'delivery_amount_unchanged']) {
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `${key} is not actually translated in km.json`)
  }
})

// A rule nothing calls is decoration. These pin the call sites, on both sides.
runTest('the Worker route validates BOTH delivery money fields through the module', () => {
  const route = read('../../cloudflare/src/routes/sales.ts')
  assert.match(route, /from '\.\.\/lib\/deliveryAmounts'/, 'routes/sales.ts must import the shared rule')
  const feeBranch = route.slice(route.indexOf("if (kind === 'delivery_fee_changed')"))
  assert.match(feeBranch.slice(0, 1400), /parseDeliveryAmountUsd\(body\.delivery_fee_usd\)/, 'the fee branch must parse through the shared rule')
  const costBranch = route.slice(route.indexOf("if (kind === 'delivery_actual_cost_changed')"))
  assert.match(costBranch.slice(0, 1800), /parseDeliveryAmountUsd\(body\.delivery_actual_cost_usd\)/, 'the courier-cost branch must parse through the shared rule')
  assert.doesNotMatch(feeBranch.slice(0, 1400), /Number\(body\.delivery_fee_usd\)/, 'the fee branch must not keep a second, private copy of the rule')
})

runTest('both editors refuse through the module and SAY SO instead of doing nothing', () => {
  const modal = read('../src/components/sales/SaleDetailModal.tsx')
  assert.match(modal, /from '\.\.\/\.\.\/utils\/deliveryAmounts\.ts'/, 'SaleDetailModal must import the shared rule')
  const stages: Array<[string, string]> = [
    ['delivery fee', modal.slice(modal.indexOf('const stageDeliveryFeeAmendment'), modal.indexOf('const stageActualDeliveryCostAmendment'))],
    ['actual delivery cost', modal.slice(modal.indexOf('const stageActualDeliveryCostAmendment'), modal.indexOf('const stageDeliveryAddition'))],
    ['delivery addition', modal.slice(modal.indexOf('const stageDeliveryAddition'), modal.indexOf('const settlementDirty'))],
  ]
  for (const [name, stage] of stages) {
    assert.ok(stage.length > 100, `could not find the ${name} stage function`)
    assert.match(stage, /parseDeliveryAmountUsd\(/, `the ${name} editor must validate through the shared rule`)
    if (name !== 'delivery addition') {
      assert.match(stage, /deliveryAmountChanged\(/, `the ${name} editor must use the shared "did anything change" rule`)
    }
    assert.match(stage, /setAmendMutationError\(/, `the ${name} editor must say why it refused`)
    // The defect this replaced: a refusal that was a bare `return`.
    assert.doesNotMatch(
      stage.replace(/setAmendMutationError\([\s\S]*?\n\s*return/g, 'REPORTED_THEN_RETURN'),
      /\n\s*if \([^\n]*\) return\n/,
      `the ${name} editor still has a silent refusal path`,
    )
  }
  // And the message has somewhere to appear when no confirm dialog opens --
  // which is exactly the staging-refusal case.
  const inline = modal.match(/amendMutationError && !amendConfirm \?/g) || []
  assert.equal(inline.length, 2, 'the fee and add-delivery editors must render the refusal beside their own field')
  assert.match(modal, /amendMutationError && actualCostEditing && !amendConfirm \?/, 'the actual-cost editor must render its refusal while that direct editor is active')
})

runTest('both editors are OFFERED under the same test the route accepts them under', () => {
  // The amount rule above is only half of parity. The other half is WHETHER the
  // control is offered at all, and there the two sides disagreed: the modal
  // decided a sale was a delivery if is_delivery was set OR a driver was named
  // (deliberately loose, so a driver still shows on an unflagged sale), while
  // the Worker's guards test is_delivery and nothing else. On a sale with a
  // driver and no flag, both Edit buttons appeared and every Apply came back
  // 400 -- a control that promises what the route is certain to refuse, which
  // no amount of good error text makes acceptable.
  //
  // One rule, one implementation: `canAmendDeliveryMoney` asks the sale the
  // same question the guards ask, and BOTH editors are gated on it.
  const modal = read('../src/components/sales/SaleDetailModal.tsx')
  const guards = read('../../cloudflare/src/lib/saleAmendments.ts')
  for (const guard of ['guardDeliveryFeeAmendment', 'guardDeliveryActualCostAmendment']) {
    const at = guards.indexOf(`export function ${guard}`)
    assert.ok(at > 0, `could not find the Worker's ${guard}`)
    assert.match(
      guards.slice(at, at + 400),
      /if \(!Number\(sale\.is_delivery\)\)/,
      `${guard} no longer tests is_delivery -- the browser gate below must follow it`,
    )
  }
  assert.match(
    modal,
    /const canAmendDeliveryMoney = canAmendThisSale && !!toNumber\(sale\.is_delivery\)/,
    'the browser write gate must ask exactly what the Worker guards ask',
  )
  // Both values are plain by default. Their explicit Edit buttons retain the
  // same route-parity gate, and only the open state mounts a numeric input.
  assert.match(modal, /amount=\{feeEditing \? <span[^>]*><label[\s\S]{0,500}id="amend-delivery-fee"/, 'the delivery-fee input must require its Edit state')
  const feeAmount = modal.slice(modal.indexOf('amount={feeEditing'), modal.indexOf('sub={deliveryFeeKhr'))
  assert.match(feeAmount, /canAmendDeliveryMoney \? <button[\s\S]{0,300}setFeeEditing\(true\)/, 'the delivery-fee Edit button must use the shared write gate')
  assert.match(feeAmount, /deliveryPaidByStore \? \(/, 'a store-paid fee must keep its truthful Free annotation')
  const actualCostRow = modal.slice(modal.indexOf('data-sale-actual-cost=""'), modal.indexOf('{/* The note the cashier'))
  assert.match(actualCostRow, /\{actualCostEditing \? <>[\s\S]*?id="amend-delivery-actual-cost"/, 'the courier-cost input must require its Edit state')
  assert.match(actualCostRow, /canAmendDeliveryMoney \? <button[\s\S]{0,350}setActualCostEditing\(true\)/, 'the courier-cost Edit button must use the shared write gate')
  // The looser DISPLAY test still exists -- it is what keeps a driver visible
  // on an unflagged sale (S4-25). This is about which of the two governs a
  // WRITE, not about deleting the other.
  assert.match(modal, /const isDelivery = !!toNumber\(sale\.is_delivery\) \|\| /, 'the looser display test must survive')
})

runTest('the two copies of the rule are the same text, not merely the same answers', () => {
  const core = (source: string): string => {
    const start = source.indexOf('export type DeliveryAmountError')
    const end = source.indexOf('export function deliveryAmountChanged')
    assert.ok(start > 0 && end > start, 'could not locate the shared core of the rule')
    const tail = source.slice(end)
    return (source.slice(start, end) + tail.slice(0, tail.indexOf('\n}') + 2))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  assert.equal(core(browserSource), core(workerSource), 'the shared core of the two copies has drifted')
})

if (failed) {
  console.error(`${failed} delivery-amount parity case(s) failed`)
  process.exit(1)
}
console.log('delivery amount parity: all cases pass')
