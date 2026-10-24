// The sale payment events money core (lane 6.0.972 slice S2) is ONE rule enforced in two packages, because
// neither imports the other: cloudflare/src/lib/salePayments.ts decides on the Worker and
// frontend/src/utils/salePayments.ts will decide what the Sales page shows (Paid / Part paid / Unpaid tags,
// the status a payment leads to). Two copies of a money rule drift unless a test holds them together.
//
// This test (1) requires the two sources to be identical apart from the mirror header and the import
// specifiers, and (2) runs BOTH copies through the same fixtures, whose answers are pinned so a change that
// breaks both copies identically is still red. The pinned answers are the discriminating ones: the half-cent
// edge, a riel-only payment, a return that lowers the debt to $0 (stays Not Paid), a lowered total (Completed),
// instalments, and an out event reversing an in event. cloudflare/scripts/test-sale-payments-pure.cjs covers
// the rest of the surface on the Worker copy.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'

import * as uiCopy from '../src/utils/salePayments.ts'

let failed = 0
function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`PASS ${name}`) })
    .catch((error) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) })
}

const here = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'salePayments.ts')
const uiPath = path.join(here, '..', 'src', 'utils', 'salePayments.ts')
const read = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

/** Everything but the two mirror-header lines that name the other package and the import specifiers. */
function comparable(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\/\/ This file is the mirror of /.test(line) && !/^\/\/ import specifiers \(/.test(line) && !/^\/\/ the Worker build resolves extensionless\)/.test(line))
    .join('\n')
    .replace(/from '\.\/financialPrecision(?:\.ts)?'/g, "from './financialPrecision'")
    .replace(/from '\.\/saleStatusResolution(?:\.ts)?'/g, "from './saleStatusResolution'")
}

// The Worker copy imports extensionless siblings Node cannot resolve; its imports are pointed at the
// frontend mirrors of those siblings (themselves held to the Worker's by saleStatusResolutionParity.test.ts),
// and the result is written to a temp file outside the repo, never into the source tree.
async function loadWorkerCopy(): Promise<typeof uiCopy> {
  const sibling = (name: string) => JSON.stringify(pathToFileURL(path.join(here, '..', 'src', 'utils', name)).href)
  const patched = read(workerPath)
    .replace(/from '\.\/financialPrecision'/, `from ${sibling('financialPrecision.ts')}`)
    .replace(/from '\.\/saleStatusResolution'/, `from ${sibling('saleStatusResolution.ts')}`)
  assert.equal((patched.match(/from "file:\/\//g) || []).length, 2, 'both sibling imports were rewritten')
  const temp = path.join(os.tmpdir(), `salePayments.worker.${process.pid}.${Date.now()}.ts`)
  writeFileSync(temp, patched)
  try {
    return await import(pathToFileURL(temp).href) as typeof uiCopy
  } finally {
    rmSync(temp, { force: true })
  }
}

await runTest('the two copies are identical apart from the mirror header and the import specifiers', () => {
  const worker = read(workerPath)
  const ui = read(uiPath)
  assert.ok(worker.includes("from './financialPrecision'") && ui.includes("from './financialPrecision.ts'"), 'the specifier difference is the expected one')
  assert.equal(comparable(ui), comparable(worker))
})

const sale = (overrides: Record<string, unknown> = {}) => ({ sale_status: 'awaiting_payment', total_usd: 10, exchange_rate: 4000, money_precision_version: 1, ...overrides })
type Derive = { sale: Record<string, unknown>; paidUsd: number; paidKhr: number; debtLoweredUsd?: number; cause: uiCopy.PaymentStatusCause; expect: [string, number, boolean] }
const DERIVE: Array<Derive & { name: string }> = [
  { name: 'exactly half a cent short is covered', sale: sale(), paidUsd: 9.995, paidKhr: 0, cause: 'payment', expect: ['completed', 0, false] },
  { name: '$0.0051 short is not', sale: sale(), paidUsd: 9.9949, paidKhr: 0, cause: 'payment', expect: ['awaiting_payment', 0.0051, true] },
  { name: 'riel only, covered', sale: sale(), paidUsd: 0, paidKhr: 40000, cause: 'payment', expect: ['completed', 0, false] },
  { name: 'riel only, half is Part paid', sale: sale(), paidUsd: 0, paidKhr: 20000, cause: 'payment', expect: ['awaiting_payment', 5, true] },
  { name: 'a return lowering the debt to $0 stays Not Paid', sale: sale(), paidUsd: 0, paidKhr: 0, debtLoweredUsd: 10, cause: 'return', expect: ['awaiting_payment', 0, false] },
  { name: 'the same debt from a payment write completes', sale: sale(), paidUsd: 0, paidKhr: 0, debtLoweredUsd: 10, cause: 'payment', expect: ['completed', 0, false] },
  { name: 'a lowered total that is covered completes', sale: sale({ total_usd: 8 }), paidUsd: 8, paidKhr: 0, cause: 'amendment', expect: ['completed', 0, false] },
  { name: 'a raised total on a Completed sale is Not Paid with Part paid', sale: sale({ sale_status: 'completed', total_usd: 13 }), paidUsd: 10, paidKhr: 0, cause: 'amendment', expect: ['awaiting_payment', 3, true] },
  { name: 'Cancelled stays', sale: sale({ sale_status: 'cancelled' }), paidUsd: 10, paidKhr: 0, cause: 'payment', expect: ['cancelled', 0, false] },
]

await runTest('both copies derive the status from the money identically, and correctly', async () => {
  const worker = await loadWorkerCopy()
  for (const fixture of DERIVE) {
    for (const [label, copy] of [['UI', uiCopy], ['Worker', worker]] as const) {
      const state = copy.deriveSalePaymentState({ sale: fixture.sale, paidUsd: fixture.paidUsd, paidKhr: fixture.paidKhr, debtLoweredUsd: fixture.debtLoweredUsd, cause: fixture.cause })
      assert.deepEqual([state.saleStatus, state.owedUsd, state.partPaid], fixture.expect, `${label}: ${fixture.name}`)
    }
  }
})

await runTest('both copies add instalments and reverse an out event identically', async () => {
  const worker = await loadWorkerCopy()
  const events = [
    { direction: 'in' as const, amount_paid_usd: 4, amount_paid_khr: 0 },
    { direction: 'in' as const, amount_paid_usd: 0, amount_paid_khr: 12000 },
    { direction: 'in' as const, amount_paid_usd: 3, amount_paid_khr: 0 },
    { direction: 'out' as const, amount_paid_usd: 3, amount_paid_khr: 0 },
  ]
  for (const copy of [uiCopy, worker]) {
    assert.deepEqual(copy.netPaymentTotals(events.slice(0, 3)), { paidUsd: 7, paidKhr: 12000 })
    assert.deepEqual(copy.netPaymentTotals(events), { paidUsd: 4, paidKhr: 12000 }, 'the out event reverses the last in')
    assert.deepEqual(copy.netPaymentTotals([{ direction: 'in', amount_paid_usd: 0.1, amount_paid_khr: 0 }, { direction: 'in', amount_paid_usd: 0.2, amount_paid_khr: 0 }]), { paidUsd: 0.3, paidKhr: 0 })
    assert.equal(copy.salePartPaid('awaiting_payment', 0, 100), true)
    assert.equal(copy.salePartPaid('completed', 10, 0), false)
  }
})

await runTest('both copies allocate payments to operation groups identically, linked first then POS then oldest', async () => {
  const worker = await loadWorkerCopy()
  const groups = [{ id: 'g1', amountUsd: 3 }, { id: null, amountUsd: 10 }, { id: 'g2', amountUsd: 4 }]
  const event = (usd: number, covers: string | null = null, khr = 0) => ({ direction: 'in' as const, amount_paid_usd: usd, amount_paid_khr: khr, covers_operation_id: covers, exchange_rate: 4000 })
  const cases: Array<{ name: string; events: ReturnType<typeof event>[]; expect: string[] }> = [
    { name: 'linked money pays its own group, the pool pays POS before the oldest', events: [event(4, 'g2'), event(11)], expect: ['g1:part_paid:1/2', 'pos:paid:10/0', 'g2:paid:4/0'] },
    { name: 'riel pays the POS group first', events: [event(0, null, 40000)], expect: ['g1:unpaid:0/3', 'pos:paid:10/0', 'g2:unpaid:0/4'] },
  ]
  for (const fixture of cases) {
    for (const [label, copy] of [['UI', uiCopy], ['Worker', worker]] as const) {
      const result = copy.allocatePaymentsToGroups({ groups, events: fixture.events })
      assert.deepEqual(result.groups.map((g) => `${g.id ?? 'pos'}:${g.tag}:${g.paidUsd}/${g.owedUsd}`), fixture.expect, `${label}: ${fixture.name}`)
    }
  }
})

await runTest('both copies build the same event and the same opening event', async () => {
  const worker = await loadWorkerCopy()
  const input = { eventId: 'e1', saleId: 7, direction: 'in' as const, origin: 'late_record' as const, tender: [{ method: 'Cash', amount_usd: 0.1, amount_khr: 0 }, { method: 'ABA', amount_usd: 0.2, amount_khr: 4000 }], exchangeRate: 4000, receivedAt: '2026-09-02 08:00:00' }
  const built = uiCopy.buildPaymentEvent(input)
  assert.deepEqual(worker.buildPaymentEvent(input), built)
  assert.deepEqual([built.amount_paid_usd, built.amount_paid_khr, built.payment_method, built.drawer_effect], [0.3, 4000, 'Cash + ABA', 0])
  const saleRow = { id: 16860, payment_method: 'ABA', payment_details: null, amount_paid_usd: 5, amount_paid_khr: 0, exchange_rate: 4100, created_at: '2026-09-01 02:00:00' }
  const opening = uiCopy.buildOpeningPaymentEvent(saleRow)
  assert.deepEqual(worker.buildOpeningPaymentEvent(saleRow), opening)
  assert.deepEqual([opening?.event_id, opening?.received_at, opening?.amount_paid_usd], ['opening:16860', '2026-09-01 02:00:00', 5])
  assert.equal(uiCopy.buildOpeningPaymentEvent({ ...saleRow, amount_paid_usd: 0 }), null)
  assert.equal(worker.buildOpeningPaymentEvent({ ...saleRow, amount_paid_usd: 0 }), null)
  for (const copy of [uiCopy, worker]) {
    assert.throws(() => copy.buildPaymentEvent({ ...input, origin: 'late_record', drawerEffect: 1 }), { code: 'payment_event_late_drawer' })
    assert.throws(() => copy.buildPaymentEvent({ ...input, tender: [{ method: 'Cash', amount_usd: 0, amount_khr: 0 }] }), { code: 'payment_event_no_money' })
  }
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
