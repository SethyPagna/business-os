// RET-A (owner 29 Sep 2026: refunds record the currency they were paid in,
// reports add a riel row; verifier 6 Oct: the riel actually paid out, not a
// converted equivalent). The kernel sends refund_paid_khr; the statement
// carries it as a note under the Refunds line, in both packs; the totals
// pipeline keeps it (presence-signalled, all-or-nothing when summed).
//
// Run: node tests/reportRefundRiel.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildIncomeStatement, normalizeTotals, statementNoteText, sumTotals } from '../src/components/sales/reports/reportModel.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const tr = (pack: Record<string, string>) => (key: string, fallback: string) => pack[key] ?? fallback

const base = { gross_sales_usd: 20, revenue_usd: 12, refund_usd: 8, net_sales_usd: 20, collected_total_usd: 12 }
const withRiel = normalizeTotals({ ...base, refund_paid_khr: 20000 })!
const refundsLine = (totals: ReturnType<typeof normalizeTotals>) =>
  buildIncomeStatement({ sales: totals, profitMode: 'net', khrToUsd: (amount) => amount / 4000 }).find((line) => line.key === 'refunds')!

const line = refundsLine(withRiel)
assert.equal(line.usd, 8, 'the Refunds line stays the dollar figure (riel refunds are already in it)')
assert.ok(line.note, 'riel paid out rides under the Refunds line')
assert.equal(statementNoteText(line.note!, tr(en)), 'paid out in riel: 20,000៛')
assert.equal(statementNoteText(line.note!, tr(km)), 'សងប្រាក់វិញជារៀល: 20,000៛')
assert.ok(en.rpt_note_refund_riel && km.rpt_note_refund_riel && en.rpt_note_refund_riel !== km.rpt_note_refund_riel, 'both packs, translated')
console.log('PASS the Refunds line names the riel paid out, in EN and KM')

assert.equal(refundsLine(normalizeTotals({ ...base, refund_paid_khr: 0 })).note, undefined, 'no riel paid out: no note')
assert.equal(refundsLine(normalizeTotals(base)).note, undefined, 'an older Worker that sends nothing: no note, never a made-up 0')
assert.equal(normalizeTotals(base)!.refund_paid_khr, undefined)
console.log('PASS no note without riel paid out, and none invented for an older Worker')

assert.equal(sumTotals([withRiel, normalizeTotals({ ...base, refund_paid_khr: 4000 })!]).refund_paid_khr, 24000, 'rows sum')
assert.equal(sumTotals([withRiel, normalizeTotals(base)!]).refund_paid_khr, undefined, 'one row without it: the sum is not claimed')
console.log('PASS summed rows keep the riel paid out only when every row carries it')

// RET-A verify R2: riel a refund spent on its replacement never left the till.
// The note names it apart from the riel paid out; it is never folded in.
const swap = refundsLine(normalizeTotals({ ...base, refund_paid_khr: 22000, refund_replacement_khr: 2000 })!)
assert.equal(statementNoteText(swap.note!, tr(en)), 'paid out in riel: 22,000៛ · to replacement: 2,000៛')
assert.equal(statementNoteText(swap.note!, tr(km)), 'សងប្រាក់វិញជារៀល: 22,000៛ · ទៅទំនិញប្តូរ: 2,000៛')
assert.ok(en.rpt_note_refund_riel_replacement && km.rpt_note_refund_riel_replacement && en.rpt_note_refund_riel_replacement !== km.rpt_note_refund_riel_replacement)
assert.equal(statementNoteText(refundsLine(normalizeTotals({ ...base, refund_paid_khr: 22000, refund_replacement_khr: 0 })!).note!, tr(en)), 'paid out in riel: 22,000៛',
  'CONTROL: without a replacement the note is the plain riel paid out')
assert.equal(sumTotals([normalizeTotals({ ...base, refund_paid_khr: 1, refund_replacement_khr: 2000 })!, normalizeTotals({ ...base, refund_paid_khr: 1, refund_replacement_khr: 500 })!]).refund_replacement_khr, 2500)
console.log('PASS the Refunds note names riel that paid a replacement apart from riel paid out, in EN and KM')
