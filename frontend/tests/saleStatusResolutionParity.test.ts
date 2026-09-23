// "Paid means it is not Not-Paid" is ONE rule that has to be enforced in two
// packages, because neither imports the other: the POS resolves the status
// before it submits (src/utils/saleStatusResolution.ts) and the Worker
// resolves it again on POST /sales (cloudflare/src/lib/saleStatusResolution.ts).
// Two copies of a money rule is exactly how a picker that promises
// "Completed" ends up in front of a server that writes "Not Paid".
//
// This test runs BOTH copies over the same fixture table and fails if they
// ever answer differently, and it additionally pins the answers themselves so
// a change that breaks both copies identically is still caught.
//
// DISCRIMINATING. The fixtures are chosen so the OLD behaviour (no resolver
// at all -- whatever status the caller asked for was recorded verbatim) and
// the NEW behaviour disagree on real rows:
//   * fully paid + awaiting_payment  -> old: 'awaiting_payment'  new: 'completed'
//   * fully paid + awaiting_payment + delivery
//                                    -> old: 'awaiting_payment'  new: 'awaiting_delivery'
// and so the boundary cannot be moved without a red:
//   * short by ONE riel              -> stays 'awaiting_payment' (a debt is a debt)
//   * covered by exactly one riel of KHR against a USD total -> resolves
// A float implementation passes the first two and fails the last two, which
// is the whole reason the kernel compares exact integers.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'

import * as uiCopy from '../src/utils/saleStatusResolution.ts'

let failed = 0
function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`PASS ${name}`) })
    .catch((error) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) })
}

const here = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'saleStatusResolution.ts')
const uiPath = path.join(here, '..', 'src', 'utils', 'saleStatusResolution.ts')

const read = (file: string): string => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

// Load the WORKER copy for real. Its relative import is extensionless (the
// Worker build resolves that; Node does not), so the specifier is rewritten
// to an absolute file URL and the result is written to a temp file outside
// the repo -- never into the source tree, which would leave a stray.
async function loadWorkerCopy(): Promise<typeof uiCopy> {
  const workerFinancialPrecision = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'financialPrecision.ts')
  const patched = read(workerPath).replace(
    /from '\.\/financialPrecision'/,
    `from ${JSON.stringify(pathToFileURL(workerFinancialPrecision).href)}`,
  )
  assert.ok(patched.includes('file:///'), 'the worker copy should import financialPrecision relatively')
  const temp = path.join(os.tmpdir(), `saleStatusResolution.worker.${process.pid}.${Date.now()}.ts`)
  writeFileSync(temp, patched)
  try {
    return await import(pathToFileURL(temp).href) as typeof uiCopy
  } finally {
    rmSync(temp, { force: true })
  }
}

type Fixture = {
  name: string
  requestedStatus: string
  paidUsd: number
  paidKhr: number
  totalUsd: number
  exchangeRate: number
  moneyPrecisionVersion: 0 | 1
  isDelivery: boolean
  expected: string
  /** What the pre-S4-41 code recorded: the requested status, verbatim. */
  expectedBeforeFix?: string
}

const FIXTURES: Fixture[] = [
  {
    name: 'fully paid in USD, cashier picked Not Paid -> Completed',
    requestedStatus: 'awaiting_payment',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'fully paid DELIVERY, cashier picked Not Paid -> Awaiting Delivery (queue survives)',
    requestedStatus: 'awaiting_payment',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: true,
    expected: 'awaiting_delivery', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'overpaid stays resolved (change is given, the sale is still paid)',
    requestedStatus: 'awaiting_payment',
    paidUsd: 20, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'covered exactly by KHR against a USD total',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 41000, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'SHORT BY ONE RIEL stays Not Paid -- a debt is a debt',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 40999, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'mixed tender covering exactly',
    requestedStatus: 'awaiting_payment',
    paidUsd: 5, paidKhr: 20500, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'mixed tender one riel short stays Not Paid',
    requestedStatus: 'awaiting_payment',
    paidUsd: 5, paidKhr: 20499, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'nothing paid stays Not Paid (the credit sale the shop actually wants)',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'partial payment stays Not Paid',
    requestedStatus: 'awaiting_payment',
    paidUsd: 4, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'a $0 sale is covered trivially',
    requestedStatus: 'awaiting_payment',
    paidUsd: 0, paidKhr: 0, totalUsd: 0, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  {
    name: 'legacy (v0) money resolves on the quantized rate',
    requestedStatus: 'awaiting_payment',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 0, isDelivery: false,
    expected: 'completed', expectedBeforeFix: 'awaiting_payment',
  },
  // Every other status is returned untouched. The resolver must never grow an
  // opinion about these -- a cancelled sale that quietly became 'completed'
  // because it happened to be paid would resurrect a cancelled sale.
  {
    name: 'completed is never rewritten',
    requestedStatus: 'completed',
    paidUsd: 0, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'completed',
  },
  {
    name: 'awaiting_delivery is never rewritten',
    requestedStatus: 'awaiting_delivery',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: true,
    expected: 'awaiting_delivery',
  },
  {
    name: 'cancelled is never rewritten even when fully paid',
    requestedStatus: 'cancelled',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'cancelled',
  },
  {
    name: 'returned is never rewritten even when fully paid',
    requestedStatus: 'returned',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'returned',
  },
  {
    name: 'partial_return is never rewritten even when fully paid',
    requestedStatus: 'partial_return',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'partial_return',
  },
  // Unreadable money must not assert a payment nobody made.
  {
    name: 'a broken exchange rate leaves the status alone',
    requestedStatus: 'awaiting_payment',
    paidUsd: 10, paidKhr: 0, totalUsd: 10, exchangeRate: 0,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
  {
    name: 'a NaN paid amount leaves the status alone',
    requestedStatus: 'awaiting_payment',
    paidUsd: Number.NaN, paidKhr: 0, totalUsd: 10, exchangeRate: 4100,
    moneyPrecisionVersion: 1, isDelivery: false,
    expected: 'awaiting_payment',
  },
]

await runTest('the UI and Worker copies differ only in the import specifier', () => {
  const workerBody = read(workerPath).replace(/from '\.\/financialPrecision'/, "from './financialPrecision.ts'")
  const uiBody = read(uiPath)
  // The two files carry their own "this file is the mirror of ..." note, which
  // names the other package, so compare with those sentences normalised away
  // rather than demanding identical prose.
  const normalise = (source: string): string => source
    .replace(/\/\/ This file is the mirror of [^\n]*\n(?:\/\/[^\n]*\n)*/, '')
  assert.equal(normalise(workerBody), normalise(uiBody),
    'the resolver bodies have drifted -- a money rule must not have two implementations')
})

await runTest('both copies resolve every fixture identically, and correctly', async () => {
  const worker = await loadWorkerCopy()
  for (const fixture of FIXTURES) {
    const input = {
      requestedStatus: fixture.requestedStatus,
      paidUsd: fixture.paidUsd,
      paidKhr: fixture.paidKhr,
      totalUsd: fixture.totalUsd,
      exchangeRate: fixture.exchangeRate,
      moneyPrecisionVersion: fixture.moneyPrecisionVersion,
      isDelivery: fixture.isDelivery,
    }
    const ui = uiCopy.resolvePaidSaleStatus(input)
    const wk = worker.resolvePaidSaleStatus(input)
    assert.equal(ui, wk, `UI and Worker disagree on "${fixture.name}"`)
    assert.equal(ui, fixture.expected, `wrong resolution for "${fixture.name}"`)
  }
})

await runTest('the fixtures actually discriminate against the pre-fix behaviour', async () => {
  const worker = await loadWorkerCopy()
  // The pre-S4-41 code had no resolver: the requested status was recorded
  // verbatim. If no fixture disagreed with that, this whole file would pass
  // against the broken tree and prove nothing.
  const discriminating = FIXTURES.filter((fixture) => fixture.expectedBeforeFix !== undefined)
  assert.ok(discriminating.length >= 4, 'expected several fixtures that the old code got wrong')
  for (const fixture of discriminating) {
    assert.equal(fixture.expectedBeforeFix, fixture.requestedStatus,
      'the old behaviour is "record what was asked for"')
    assert.notEqual(fixture.expected, fixture.expectedBeforeFix,
      `"${fixture.name}" does not separate the old code from the new`)
    const resolved = worker.resolvePaidSaleStatus({
      requestedStatus: fixture.requestedStatus,
      paidUsd: fixture.paidUsd,
      paidKhr: fixture.paidKhr,
      totalUsd: fixture.totalUsd,
      exchangeRate: fixture.exchangeRate,
      moneyPrecisionVersion: fixture.moneyPrecisionVersion,
      isDelivery: fixture.isDelivery,
    })
    assert.notEqual(resolved, fixture.expectedBeforeFix,
      `"${fixture.name}" still records the old status`)
  }
})

await runTest('coverage is exact integer arithmetic, not floating point', async () => {
  const worker = await loadWorkerCopy()
  // 0.1 + 0.2 in USD against a 0.3 total: a float implementation computes
  // 0.30000000000000004 >= 0.3 and calls it covered by luck; and the riel
  // boundary below is where a float actually goes wrong.
  for (const copy of [uiCopy, worker]) {
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0.3, paidKhr: 0, totalUsd: 0.3, exchangeRate: 4100, moneyPrecisionVersion: 1,
    }), true, 'an exactly-covering USD tender is covered')
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0, paidKhr: 40999, totalUsd: 10, exchangeRate: 4100, moneyPrecisionVersion: 1,
    }), false, 'one riel short is NOT covered')
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0, paidKhr: 41000, totalUsd: 10, exchangeRate: 4100, moneyPrecisionVersion: 1,
    }), true, 'exactly covering in riel IS covered')
    // A non-integer rate must not be quantized away under V1.
    assert.equal(copy.paymentCoversSaleTotal({
      paidUsd: 0, paidKhr: 41000.5, totalUsd: 10, exchangeRate: 4100.05, moneyPrecisionVersion: 1,
    }), true, 'an exact V1 rate keeps its fractional part')
  }
})

await runTest('NOT_PAID_STATUS is the credit status both packages agree on', async () => {
  const worker = await loadWorkerCopy()
  assert.equal(uiCopy.NOT_PAID_STATUS, 'awaiting_payment')
  assert.equal(worker.NOT_PAID_STATUS, uiCopy.NOT_PAID_STATUS)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
