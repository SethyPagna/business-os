// One boundary for "may this sale be BORN with a paid status" (Completed /
// Awaiting Delivery), asked by BOTH the POS checkout gate and the Worker's
// POST /sales: tenderAllowsPaidStatus in saleStatusResolution.ts (covered
// within half a cent, exact integer units).
//
// The defect this pins: the POS gate was a float comparison
// (`totalPaid < totalUsd - 0.005`) while the Worker used the EXACT coverage
// formula. 39,400 riel for a $9.61 sale at 4,100 (one riel short) passed the
// POS and was answered 400 by the Worker -- and a sale queued offline on that
// tender replayed into a non-retryable 400 and was lost.
//
// The status picker reads the same answer: an option the tender rules out
// stays visible, greyed, under its own name with the reason -- Not Paid once
// the tender covers the sale, a paid status while it is short. The picker
// used to relabel Not Paid as the status it resolves to, so a fully-paid sale
// listed "Completed" twice (and the system spec's /^Completed/ click matched
// two buttons).
//
// DISCRIMINATING. On the pre-fix tree the POS gate does not call
// tenderAllowsPaidStatus (and still compares the float `totalPaid`), the
// Worker gate calls paymentCoversSaleTotal, and the picker relabels instead of
// disabling: every source assertion below is red there. The behavioural half
// runs the owner's tender through the same kernel both gates now import.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { paymentCoversSaleTotal, resolvePaidSaleStatus, tenderAllowsPaidStatus } from '../src/utils/saleStatusResolution.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pos = read('../src/components/pos/POS.tsx')
const worker = read('../../cloudflare/src/routes/sales.ts')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

/** The one POS answer to "may this sale be recorded with a paid status". */
function posAnswer(): string {
  const start = pos.indexOf('const posTenderAllowsPaidStatus = (() => {')
  assert.ok(start > 0, 'the POS computes the paid-status answer once')
  const end = pos.indexOf('})()', start)
  assert.ok(end > start)
  return pos.slice(start, end)
}

/** One status-picker option, from the map over the three statuses to its closing tag. */
function pickerOption(): string {
  const anchor = pos.indexOf('data-pos-status-option={status}')
  assert.ok(anchor > 0, 'the status picker still renders one button per status')
  const start = pos.lastIndexOf('.map(([status, label, desc]) => {', anchor)
  const end = pos.indexOf('</button>', anchor)
  assert.ok(start > 0 && end > anchor)
  return pos.slice(start, end)
}

/** The POS checkout's paid-status gate: from its `if` to the resolver call right after it. */
function posGate(): string {
  const end = pos.indexOf('const recordedSaleStatus = resolvePosSaleStatus(saleStatus)')
  assert.ok(end > 0, 'the checkout still resolves the recorded status')
  const start = pos.lastIndexOf("if (saleStatus !== 'awaiting_payment'", end)
  assert.ok(start > 0, 'the checkout still gates the paid statuses')
  return pos.slice(start, end)
}

/** The POST /sales paid-status gate: the block that answers the first insufficient_payment_for_status. */
function workerGate(): string {
  const code = worker.indexOf("code: 'insufficient_payment_for_status'")
  assert.ok(code > 0, 'POST /sales still refuses an uncovered paid status')
  const start = worker.lastIndexOf("if (saleStatus === 'completed' || saleStatus === 'awaiting_delivery')", code)
  assert.ok(start > 0, 'the POST /sales gate is still keyed on the two paid statuses')
  return worker.slice(start, code)
}

const ownerTender = { paidUsd: 0, paidKhr: 39400, totalUsd: 9.61, exchangeRate: 4100, moneyPrecisionVersion: 1 }

runTest('the POS asks tenderAllowsPaidStatus once, with the resolver\'s own inputs', () => {
  const answer = posAnswer()
  assert.match(answer, /tenderAllowsPaidStatus\(\{ paidUsd: paidUsdNum, paidKhr: paidKhrNum, totalUsd, exchangeRate, moneyPrecisionVersion: 1 \}\)/,
    'the answer must use the same tender, total and rate the status resolver sees')
  assert.match(answer, /catch\s*\{\s*return false\s*\}/, 'an unreadable rate must answer no, not throw out of the render')
  assert.equal(pos.match(/tenderAllowsPaidStatus\(/g)?.length, 1, 'the gate and the picker share one answer, not two copies of the call')
  assert.match(pos, /import \{[^}]*\btenderAllowsPaidStatus\b[^}]*\} from '\.\.\/\.\.\/utils\/saleStatusResolution\.ts'/)
})

runTest('the checkout gate refuses a paid status on that answer', () => {
  assert.match(posGate(), /^if \(saleStatus !== 'awaiting_payment' && !posTenderAllowsPaidStatus\) return notify\(t\('insufficient_amount'\), 'error'\)/)
})

runTest('the status picker greys out the options the tender rules out, under their own names', () => {
  const option = pickerOption()
  assert.match(option, /const paidInFull = resolved !== status/)
  assert.match(option, /const unavailable = paidInFull \|\| \(status !== 'awaiting_payment' && !posTenderAllowsPaidStatus\)/)
  assert.match(option, /disabled=\{loading \|\| unavailable\}/, 'a ruled-out option cannot be tapped')
  assert.match(option, /disabled:cursor-not-allowed/)
  assert.match(option, /<div className="font-semibold[^"]*">\{label\}<\/div>/, 'every option keeps its own name')
  assert.doesNotMatch(option, /getPosStatusLabel\(resolved/, 'relabelling Not Paid listed "Completed" twice')
  assert.match(option, /\{paidInFull\s*\?\s*\(t\('pos_status_paid_resolved_desc'\)/)
  assert.match(option, /: unavailable \? \(t\('insufficient_amount'\)/)
})

runTest('both packs explain a greyed Not Paid in the pack\'s own Not Paid words', () => {
  const notPaid = (pack: Record<string, string>) => pack.status_awaiting_payment.replace(/^\P{L}+/u, '').trim()
  assert.equal(notPaid(en), 'Not Paid')
  for (const [name, pack] of [['en', en], ['km', km]] as const) {
    assert.ok(pack.pos_status_paid_resolved_desc.includes(notPaid(pack)),
      `${name}: the reason must name the option it greys out (${notPaid(pack)})`)
  }
  assert.doesNotMatch(en.pos_status_paid_resolved_desc, /recorded as paid/, 'the option is no longer rewritten')
})

runTest('which options each tender leaves open', () => {
  const statuses = ['completed', 'awaiting_payment', 'awaiting_delivery'] as const
  const open = (tender: typeof ownerTender) => statuses.filter((status) => {
    const paidInFull = resolvePaidSaleStatus({ ...tender, requestedStatus: status, isDelivery: false }) !== status
    return !(paidInFull || (status !== 'awaiting_payment' && !tenderAllowsPaidStatus(tender)))
  })
  assert.deepEqual(open({ ...ownerTender, paidKhr: 0 }), ['awaiting_payment'], 'no tender: only Not Paid')
  assert.deepEqual(open({ ...ownerTender, paidKhr: 39401 }), ['completed', 'awaiting_delivery'], 'paid in full: Not Paid is greyed')
  // One riel short: inside the creation band, and exact coverage still calls
  // it short, so the cashier may record it either way.
  assert.deepEqual(open(ownerTender), ['completed', 'awaiting_payment', 'awaiting_delivery'])
})

runTest('the float half-cent comparison is gone from the POS', () => {
  assert.doesNotMatch(pos, /totalPaid\s*<\s*totalUsd/, 'a float gate can disagree with the Worker on a one-riel tender')
})

runTest('the Worker POST /sales gate asks the same function', () => {
  const gate = workerGate()
  assert.match(gate, /tenderAllowsPaidStatus\(\{/, 'POST /sales must use the shared creation boundary')
  assert.doesNotMatch(gate, /paymentCoversSaleTotal\(/, 'the exact formula refuses tenders the POS accepts')
  assert.match(gate, /catch\s*\{\s*coveredForStatus = false\s*\}/, 'a bad rate still refuses')
})

runTest('the owner\'s tender (39,400 riel for $9.61 at 4,100) passes the shared boundary', () => {
  assert.equal(tenderAllowsPaidStatus(ownerTender), true)
  // ...while exact coverage still calls it short, so the Not-Paid resolver and
  // settlement keep their exact answers.
  assert.equal(paymentCoversSaleTotal(ownerTender), false)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
