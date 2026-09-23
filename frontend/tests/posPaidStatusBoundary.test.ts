// One definition of paid, asked by the POS checkout gate, its status picker
// and its change / short panel, and by the Worker's POST /sales:
// paymentCoversSaleTotal in saleStatusResolution.ts (covered within half a
// cent, exact integer units) -- the same answer the Not-Paid resolver,
// statusChangeNeedsPayment, settlement and every balance-due figure give.
//
// The defects this pins: the POS gate was a float comparison
// (`totalPaid < totalUsd - 0.005`) while the Worker used the EXACT coverage
// formula, so 39,400 riel for a $9.61 sale at 4,100 (one riel short) passed
// the POS and was answered 400 by the Worker. The first fix gave CREATION a
// half-cent band and left everything else exact: the same tender was then
// recorded Completed yet could also be recorded Not Paid, and the tender
// panel called it "$0.00 short". Now the band is the only coverage answer.
//
// The status picker reads the same answer: an option the tender rules out
// stays visible, greyed, under its own name with the reason -- Not Paid once
// the tender covers the sale, a paid status while it is short. The picker
// used to relabel Not Paid as the status it resolves to, so a fully-paid sale
// listed "Completed" twice (and the system spec's /^Completed/ click matched
// two buttons).
//
// DISCRIMINATING. On the float tree the POS gate compares `totalPaid` and the
// picker relabels instead of disabling; on the creation-only-band tree
// (1734ecd5) the gates call tenderAllowsPaidStatus, the tender panel keys on
// the float `changeUsd >= 0`, and the owner's tender leaves all three options
// open because the exact resolver still calls it short: the source and
// behaviour assertions below are red on each. The behavioural half runs the
// owner's tender through the same kernel both gates import.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import * as kernel from '../src/utils/saleStatusResolution.ts'

const { paymentCoversSaleTotal, resolvePaidSaleStatus, saleOutstandingUsd } = kernel

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

/** The one POS answer to "does this tender pay for the sale". */
function posAnswer(): string {
  const start = pos.indexOf('const posTenderCovers = (() => {')
  assert.ok(start > 0, 'the POS computes the coverage answer once')
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

runTest('the POS asks paymentCoversSaleTotal once, with the resolver\'s own inputs', () => {
  const answer = posAnswer()
  assert.match(answer, /paymentCoversSaleTotal\(\{ paidUsd: paidUsdNum, paidKhr: paidKhrNum, totalUsd, exchangeRate, moneyPrecisionVersion: 1 \}\)/,
    'the answer must use the same tender, total and rate the status resolver sees')
  assert.match(answer, /catch\s*\{\s*return false\s*\}/, 'an unreadable rate must answer no, not throw out of the render')
  assert.equal(pos.match(/paymentCoversSaleTotal\(/g)?.length, 1, 'the gate, the picker and the panel share one answer, not copies of the call')
  assert.match(pos, /import \{[^}]*\bpaymentCoversSaleTotal\b[^}]*\} from '\.\.\/\.\.\/utils\/saleStatusResolution\.ts'/)
  assert.doesNotMatch(pos, /tenderAllowsPaidStatus/, 'the creation-only coverage function is gone')
})

runTest('the checkout gate refuses a paid status on that answer', () => {
  assert.match(posGate(), /^if \(saleStatus !== 'awaiting_payment' && !posTenderCovers\) return notify\(t\('insufficient_amount'\), 'error'\)/)
})

runTest('the tender panel shows short only when the tender does not cover the sale', () => {
  // Keyed on the float change it called the owner's full riel payment
  // "$0.00 short" in red.
  assert.match(pos, /\$\{posTenderCovers \? 'bg-green-50 dark:bg-green-900\/20' : 'bg-red-50 dark:bg-red-900\/20'\}/)
  assert.match(pos, /\{posTenderCovers \? \(/)
  assert.doesNotMatch(pos, /changeUsd >= 0 \?/, 'the float change must not decide short versus paid')
  assert.match(pos, /fmtUSD\(Math\.max\(0, changeUsd\)\)/, 'a tender inside the band has no change, never a negative one')
})

runTest('the status picker greys out the options the tender rules out, under their own names', () => {
  const option = pickerOption()
  assert.match(option, /const paidInFull = resolved !== status/)
  assert.match(option, /const unavailable = paidInFull \|\| \(status !== 'awaiting_payment' && !posTenderCovers\)/)
  assert.match(option, /disabled=\{loading \|\| unavailable\}/, 'a ruled-out option cannot be tapped')
  assert.match(option, /disabled:cursor-not-allowed/)
  assert.match(option, /<div className=\{`font-semibold text-sm \$\{unavailable \? 'text-gray-400 dark:text-gray-500' : [^}]*\}`\}>\{label\}<\/div>/,
    'every option keeps its own name, faded when ruled out')
  // The reason is why the option stays visible: gray-400 under a whole-button
  // opacity-50 fade works out to about 1.5:1 against the white sheet.
  assert.doesNotMatch(option, /disabled:opacity-/, 'a whole-button fade takes the reason down with it')
  assert.match(option, /\$\{unavailable \? 'font-medium text-amber-700 dark:text-amber-300' : 'text-gray-400'\}/,
    'the reason reads in the warning colours at full strength')
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
    return !(paidInFull || (status !== 'awaiting_payment' && !paymentCoversSaleTotal(tender)))
  })
  assert.deepEqual(open({ ...ownerTender, paidKhr: 0 }), ['awaiting_payment'], 'no tender: only Not Paid')
  assert.deepEqual(open({ ...ownerTender, paidKhr: 39401 }), ['completed', 'awaiting_delivery'], 'paid in full: Not Paid is greyed')
  // One riel short is a full payment: Not Paid is greyed as "already paid in
  // full", exactly as for 39,401. (On the creation-only band it left all three
  // open, so the same money could be recorded paid or unpaid.)
  assert.deepEqual(open(ownerTender), ['completed', 'awaiting_delivery'])
  // One unit past the band ($0.0051 short on $10) is a debt: only Not Paid.
  assert.deepEqual(open({ paidUsd: 9.9949, paidKhr: 0, totalUsd: 10, exchangeRate: 4100, moneyPrecisionVersion: 1 }), ['awaiting_payment'])
  // Exactly half a cent short is still paid.
  assert.deepEqual(open({ paidUsd: 9.995, paidKhr: 0, totalUsd: 10, exchangeRate: 4100, moneyPrecisionVersion: 1 }), ['completed', 'awaiting_delivery'])
})

runTest('the float half-cent comparison is gone from the POS', () => {
  assert.doesNotMatch(pos, /totalPaid\s*<\s*totalUsd/, 'a float gate can disagree with the Worker on a one-riel tender')
})

runTest('the Worker POST /sales gate asks the same function', () => {
  const gate = workerGate()
  assert.match(gate, /paymentCoversSaleTotal\(\{/, 'POST /sales must use the one definition of paid')
  assert.doesNotMatch(worker, /tenderAllowsPaidStatus/, 'the creation-only coverage function is gone')
  assert.match(gate, /catch\s*\{\s*coveredForStatus = false\s*\}/, 'a bad rate still refuses')
})

runTest('the owner\'s tender (39,400 riel for $9.61 at 4,100) is paid everywhere', () => {
  assert.equal(paymentCoversSaleTotal(ownerTender), true)
  assert.equal(saleOutstandingUsd(ownerTender), 0, 'nothing is still owed')
  assert.equal(resolvePaidSaleStatus({ ...ownerTender, requestedStatus: 'awaiting_payment', isDelivery: false }), 'completed')
  assert.equal(resolvePaidSaleStatus({ ...ownerTender, requestedStatus: 'awaiting_payment', isDelivery: true }), 'awaiting_delivery')
  assert.equal('tenderAllowsPaidStatus' in kernel, false, 'one coverage function, not a creation-only second one')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
