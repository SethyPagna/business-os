// DATE-UI lane, sweep 3b: editing a lot must never resend an unchanged received
// date, must never flip a leftover "03/04/2026" into 3 April, and must never
// let a cleared field reach the Worker (a blank received date means "today").
//
// The discriminating fixtures are the ones where the right and the plausible
// wrong implementation disagree:
//   - '03/04/2026': day-first and month-first are BOTH real dates, so a seed
//     that "helpfully" parses it produces a plausible date either way;
//   - '2026-10-05 18:30:00': the UTC day (5 Oct) is not the business day (6 Oct),
//     so slice(0, 10) and the business-day seed give different answers;
//   - an unreadable stored value + an untouched field: the old code sent
//     `receivedAt: draft.receivedAt || null` -- a blank -- on every save.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildBatchDatePatch, buildSessionHeaderReceivedPatch, seedBatchDateDraft, seedSessionHeaderDates } from '../src/utils/batchDateDraft.ts'
import { buildStockInLineEditBody, stockInLineDraft } from '../src/utils/stockInLineEdit.ts'

let failed = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

check('an ISO date-only lot seeds its own date and an untouched save sends nothing', () => {
  const seed = seedBatchDateDraft({ received_at: '2026-10-05', expiry_date: '2027-01-31' })
  assert.equal(seed.receivedAt, '2026-10-05')
  assert.equal(seed.expiryDate, '2027-01-31')
  assert.deepEqual(seed.unreadable, [])
  const { patch, receivedBlank } = buildBatchDatePatch(seed, seed)
  assert.deepEqual(patch, {}, 'nothing changed, so no date key is written back')
  assert.equal(receivedBlank, false)
})

check('a default-batch UTC timestamp seeds the BUSINESS day, not slice(0, 10)', () => {
  const seed = seedBatchDateDraft({ received_at: '2026-10-05 18:30:00' })
  assert.equal(seed.receivedAt, '2026-10-06', 'the list shows 06/10/2026 for this lot; the editor must open on the same day')
  assert.notEqual(seed.receivedAt, '2026-10-05 18:30:00'.slice(0, 10), 'the old seed took the UTC day')
  assert.deepEqual(buildBatchDatePatch(seed, seed).patch, {}, 'and an untouched save does not rewrite the timestamp as a date')
})

check('a leftover month-first slash value is NOT carried into the day-first field', () => {
  const seed = seedBatchDateDraft({ received_at: '03/04/2026', expiry_date: '2029' })
  assert.equal(seed.receivedAt, '', 'seeded blank: the field would have read it as 3 April')
  assert.equal(seed.expiryDate, '', 'a year-only expiry is not a date either')
  assert.deepEqual(seed.unreadable, ['03/04/2026', '2029'], 'both stored texts are named to the operator')
})

check('saving an unreadable lot without retyping sends NO date at all (the old code sent a blank, which the Worker reads as today)', () => {
  const seed = seedBatchDateDraft({ received_at: '03/04/2026', expiry_date: null })
  const { patch, receivedBlank } = buildBatchDatePatch(seed, seed)
  assert.deepEqual(patch, {})
  assert.equal('receivedAt' in patch, false)
  assert.equal(receivedBlank, false)
})

check('retyping an unreadable date sends exactly that date', () => {
  const seed = seedBatchDateDraft({ received_at: '03/04/2026' })
  const { patch } = buildBatchDatePatch({ receivedAt: '2026-03-04', expiryDate: '' }, seed)
  assert.deepEqual(patch, { receivedAt: '2026-03-04' })
})

check('changing a readable date sends only the changed field', () => {
  const seed = seedBatchDateDraft({ received_at: '2026-10-05', expiry_date: '2027-01-31' })
  assert.deepEqual(buildBatchDatePatch({ receivedAt: '2026-10-07', expiryDate: '2027-01-31' }, seed).patch, { receivedAt: '2026-10-07' })
  assert.deepEqual(buildBatchDatePatch({ receivedAt: '2026-10-05', expiryDate: '2027-02-28' }, seed).patch, { expiryDate: '2027-02-28' })
  assert.deepEqual(buildBatchDatePatch({ receivedAt: '2026-10-05', expiryDate: '' }, seed).patch, { expiryDate: null }, 'clearing an expiry is an explicit null')
})

check('emptying a received date that had a value is flagged so the caller refuses it', () => {
  const seed = seedBatchDateDraft({ received_at: '2026-10-05' })
  const { patch, receivedBlank } = buildBatchDatePatch({ receivedAt: '', expiryDate: '' }, seed)
  assert.equal(receivedBlank, true)
  assert.equal('receivedAt' in patch, false, 'a blank is never placed in the patch')
})

check('the stock-in line editor seeds the same business day, and never a slash value', () => {
  // Sibling surface, same defect: stockInLineDraft seeded slice(0, 10) of the stored value.
  const base = { id: 41, quantity: 10, batch_id: 7, batch_revision: 4, batch_supplier_id: null, batch_supplier_name: '', batch_unit_cost_usd: 2 }
  assert.equal(stockInLineDraft({ ...base, batch_received_at: '2026-10-05 18:30:00' }).receivedDate, '2026-10-06')
  assert.equal(stockInLineDraft({ ...base, batch_received_at: '03/04/2026' }).receivedDate, '')
  assert.equal(stockInLineDraft({ ...base, batch_received_at: '2026-10-05' }).receivedDate, '2026-10-05')
  // An unreadable stored date that the operator does not retype is not sent.
  const untouched = buildStockInLineEditBody({ ...base, batch_received_at: '03/04/2026' }, stockInLineDraft({ ...base, batch_received_at: '03/04/2026' }), 'req-1', false)
  assert.equal(untouched.ok, true)
  if (untouched.ok) assert.equal('received_date' in untouched.body, false)
})

check('the stock-in SESSION header edit follows the same seed / no-resend rule', () => {
  const ok = seedSessionHeaderDates({ receivedDate: '2026-10-05 18:30:00', creditDueDate: '2026-11-01' })
  assert.deepEqual(ok, { receivedAt: '2026-10-06', creditDueDate: '2026-11-01', unreadable: [] }, 'a UTC timestamp seeds its business day; the due date is literal')
  const bad = seedSessionHeaderDates({ receivedDate: '03/04/2026', creditDueDate: '2029' })
  assert.deepEqual(bad, { receivedAt: '', creditDueDate: '', unreadable: ['03/04/2026', '2029'] })
  // Untouched save on an unreadable date: nothing sent, nothing flagged (the old code sent null = today).
  assert.deepEqual(buildSessionHeaderReceivedPatch(bad.receivedAt, bad.receivedAt), { receivedBlank: false })
  assert.deepEqual(buildSessionHeaderReceivedPatch('2026-03-04', bad.receivedAt), { receivedAt: '2026-03-04', receivedBlank: false })
  assert.deepEqual(buildSessionHeaderReceivedPatch('', ok.receivedAt), { receivedBlank: true }, 'clearing a real date is refused, not sent')
  const source = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.doesNotMatch(source, /slice\(0, 10\)/, 'no UTC-day slice left in the session editor')
  assert.doesNotMatch(source, /receivedAt: editDate \|\| null/, 'the unconditional resend is gone')
  assert.match(source, /seedSessionHeaderDates\(session\)/)
  assert.match(source, /buildSessionHeaderReceivedPatch\(editDate, editDateSeed\)/)
})

check('the promotions banner modal sends date-only ISO, never a device-zone instant', () => {
  const source = readFileSync(new URL('../src/components/catalog/ManagePromotionsModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(source, /starts_at: fields\.starts_at \|\| null,/)
  assert.match(source, /ends_at: fields\.ends_at \|\| null,/)
  assert.doesNotMatch(source, /new Date\(fields\.(starts|ends)_at/, 'no device-zone Date construction in the save payload')
  assert.doesNotMatch(source, /T23:59:59/, 'no invented end-of-day clock')
})

check('ManageBatchesModal wires the helpers and no longer slices or resends the date', () => {
  const source = readFileSync(new URL('../src/components/inventory/ManageBatchesModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.match(source, /seedBatchDateDraft\(batch\)/)
  assert.match(source, /buildBatchDatePatch\(draft, draft\)/)
  assert.doesNotMatch(source, /receivedAt: \(batch\.received_at \|\| ''\)\.slice\(0, 10\)/, 'the UTC-day slice seed is gone')
  assert.doesNotMatch(source, /receivedAt: draft\.receivedAt \|\| null/, 'the unconditional resend is gone')
  assert.doesNotMatch(source, /expiryDate: draft\.expiryDate \|\| null,\n/, 'expiry is no longer resent unconditionally either')
  assert.match(source, /\.\.\.datePatch,/, 'only the changed date keys are spread into the PATCH')
})

if (failed > 0) process.exitCode = 1
