// The staff-facing half of an amended sale (S4-30).
//
// The owner asked for two views of one sale that deliberately disagree: the
// receipt shows the net result as one finalized sale, and the detail shows the
// original plus every add-on-top with who and when. The receipt half needs no
// code -- the backend keeps sale_items and the sales row at net state, and the
// existing renderer already reads those. This file pins the OTHER half: that
// the detail view says "1 -> 2 (+1)" rather than just "2", that a removal is
// still described after the line it describes is gone, and that a quantity
// change which moved no stock says WHY rather than looking like a bug.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  formatSignedUnits,
  formatUnits,
  pairReplacements,
  saleLooksAmendable,
  toAmendmentDisplayRow,
  toAmendmentDisplayRows,
  type SaleAmendmentRow,
} from '../src/utils/saleAmendments.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const usd = (value: number): string => `$${value.toFixed(2)}`

const ROW = (overrides: Partial<SaleAmendmentRow> = {}): SaleAmendmentRow => ({
  id: 1,
  kind: 'line_quantity_increased',
  sale_item_id: 5,
  product_id: 10,
  product_name: 'Serum',
  quantity_before: 1,
  quantity_after: 2,
  quantity_delta: 1,
  total_before_usd: 6,
  total_after_usd: 9,
  units_moved: -1,
  stock_skipped: 0,
  via: 'amend',
  user_name: 'Sokha',
  created_at: '2026-09-04 14:22:00',
  ...overrides,
})

await runTest('an increase reads as "1 -> 2 (+1)", which is the add-on-top the owner asked for', () => {
  const row = toAmendmentDisplayRow(ROW(), usd)
  assert.equal(row.family, 'quantity')
  assert.equal(row.subject, 'Serum')
  assert.equal(row.beforeText, '1')
  assert.equal(row.afterText, '2')
  assert.equal(row.deltaText, '+1', 'the sign IS the information')
  assert.equal(row.isIncrease, true)
  assert.equal(row.isRemoval, false)
  assert.equal(row.actor, 'Sokha', 'who')
  assert.equal(row.at, '2026-09-04 14:22:00', 'and when')
  assert.equal(row.stockNote, null, 'stock moved, so there is nothing to explain')
})

await runTest('a decrease is signed the other way, and never loses the minus', () => {
  const row = toAmendmentDisplayRow(ROW({ kind: 'line_quantity_decreased', quantity_before: 3, quantity_after: 1, quantity_delta: -2, units_moved: 2 }), usd)
  assert.equal(row.deltaText, '-2')
  assert.equal(row.isIncrease, false)
  assert.equal(row.unitsMoved, 2, 'two units came back to the shelf')
})

await runTest('the delivery fee reads as "$1.50 -> $2.00 (+$0.50)"', () => {
  const row = toAmendmentDisplayRow(ROW({
    kind: 'delivery_fee_changed',
    product_id: null, product_name: null, sale_item_id: null,
    quantity_before: null, quantity_after: null, quantity_delta: null,
    amount_before_usd: 1.5, amount_after_usd: 2, amount_delta_usd: 0.5,
    units_moved: 0,
  }), usd, 'Delivery')
  assert.equal(row.family, 'money')
  assert.equal(row.subject, 'Delivery')
  assert.equal(row.beforeText, '$1.50')
  assert.equal(row.afterText, '$2.00')
  assert.equal(row.deltaText, '+$0.50')
  assert.equal(row.stockNote, null, 'a fee change is not expected to move stock')
})

await runTest('a fee that went DOWN prints one minus, not a minus inside the money format', () => {
  const row = toAmendmentDisplayRow(ROW({
    kind: 'delivery_fee_changed',
    quantity_before: null, quantity_after: null, quantity_delta: null,
    amount_before_usd: 2, amount_after_usd: 1.5, amount_delta_usd: -0.5,
    units_moved: 0,
  }), usd)
  assert.equal(row.deltaText, '-$0.50', 'not "-$-0.50" and not "$-0.50"')
  assert.equal(row.isIncrease, false)
})

await runTest('the actual courier cost is a distinct money history row', () => {
  const row = toAmendmentDisplayRow(ROW({
    kind: 'delivery_actual_cost_changed',
    product_id: null, product_name: null, sale_item_id: null,
    quantity_before: null, quantity_after: null, quantity_delta: null,
    amount_before_usd: 2, amount_after_usd: 2.5, amount_delta_usd: 0.5,
    total_before_usd: 7.5, total_after_usd: 7.5, units_moved: 0,
  }), usd, 'Delivery')
  assert.equal(row.family, 'money')
  assert.equal(row.subject, 'Delivery actual cost')
  assert.equal(row.beforeText, '$2.00')
  assert.equal(row.afterText, '$2.50')
  assert.equal(row.deltaText, '+$0.50')
})

await runTest('a removal is still fully described after the line it describes is gone', () => {
  // This is the case the ledger exists for: sale_items no longer holds this
  // row at all, so the receipt cannot print it and the detail view has only
  // this entry to work from.
  const row = toAmendmentDisplayRow(ROW({
    kind: 'line_removed', quantity_before: 2, quantity_after: 0, quantity_delta: -2, units_moved: 2,
  }), usd)
  assert.equal(row.isRemoval, true)
  assert.equal(row.subject, 'Serum', 'the product name was snapshotted, not looked up')
  assert.equal(row.beforeText, '2')
  assert.equal(row.afterText, '0')
  assert.equal(row.deltaText, '-2')
  assert.equal(row.actor, 'Sokha')
})

await runTest('a quantity change that moved no stock says WHY, and the specific reason wins', () => {
  // Awaiting payment: nothing has left the shelf for this sale yet.
  const notDeducted = toAmendmentDisplayRow(ROW({ units_moved: 0, stock_skipped: 0 }), usd)
  assert.equal(notDeducted.stockNote, 'not_deducted')

  // S4-2's sticky flag: the sale was completed WITHOUT moving stock, so an
  // amendment must not move any either. More specific, so it wins.
  const skipped = toAmendmentDisplayRow(ROW({ units_moved: 0, stock_skipped: 1 }), usd)
  assert.equal(skipped.stockNote, 'stock_skipped', 'the sticky flag is the more specific answer')

  // A row where nothing changed at all has nothing to explain.
  const noChange = toAmendmentDisplayRow(ROW({ quantity_before: 2, quantity_after: 2, quantity_delta: 0, units_moved: 0 }), usd)
  assert.equal(noChange.stockNote, null)
})

await runTest('the stored delta is the authority; it is only computed as a fallback', () => {
  // The database derived quantity_delta at write time. Trusting it means the
  // screen can never disagree with the ledger about which way a number moved.
  const stored = toAmendmentDisplayRow(ROW({ quantity_before: 1, quantity_after: 2, quantity_delta: 1 }), usd)
  assert.equal(stored.deltaText, '+1')
  const legacy = toAmendmentDisplayRow(ROW({ quantity_before: 1, quantity_after: 4, quantity_delta: null }), usd)
  assert.equal(legacy.deltaText, '+3', 'a row with no stored delta still renders')
})

await runTest('an undo appends rather than rewriting, so BOTH entries render', () => {
  const rows = toAmendmentDisplayRows([
    ROW({ id: 1, kind: 'line_added', quantity_before: 0, quantity_after: 2, quantity_delta: 2, via: 'amend' }),
    ROW({ id: 2, kind: 'line_removed', quantity_before: 2, quantity_after: 0, quantity_delta: -2, via: 'undo' }),
  ], usd)
  assert.equal(rows.length, 2, 'the addition is still in the trail after being undone')
  assert.equal(rows[0].via, 'amend')
  assert.equal(rows[1].via, 'undo', 'and the undo says it was an undo')
  assert.equal(rows[0].deltaText, '+2')
  assert.equal(rows[1].deltaText, '-2')
})

await runTest('insertion order is preserved, never re-sorted by timestamp', () => {
  // Two entries written in the same second must not be reordered -- the
  // history is a sequence, and the id is what records it.
  const rows = toAmendmentDisplayRows([
    ROW({ id: 7, product_name: 'First', created_at: '2026-09-04 14:22:00' }),
    ROW({ id: 8, product_name: 'Second', created_at: '2026-09-04 14:22:00' }),
  ], usd)
  assert.deepEqual(rows.map((row) => row.subject), ['First', 'Second'])
})

await runTest('a replace renders as ONE act, not two entries to reassemble', () => {
  const rows = toAmendmentDisplayRows([
    ROW({ id: 1, group_id: 'g1', kind: 'line_removed', product_name: 'Serum', quantity_before: 1, quantity_after: 0, quantity_delta: -1 }),
    ROW({ id: 2, group_id: 'g1', kind: 'line_added', product_name: 'Tonic', quantity_before: 0, quantity_after: 1, quantity_delta: 1 }),
  ], usd)
  const paired = pairReplacements(rows)
  assert.equal(paired.length, 1)
  assert.equal(paired[0].type, 'replacement')
  if (paired[0].type !== 'replacement') throw new Error('unreachable')
  assert.equal(paired[0].removed.subject, 'Serum')
  assert.equal(paired[0].added.subject, 'Tonic')
})

await runTest('a group that is not actually a replace is left as separate rows, not guessed at', () => {
  // One entry in a group: an ordinary addition that happened to carry a group
  // id (every multi-line addition does).
  const single = pairReplacements(toAmendmentDisplayRows([
    ROW({ id: 1, group_id: 'g1', kind: 'line_added', quantity_before: 0, quantity_after: 1, quantity_delta: 1 }),
  ], usd))
  assert.equal(single.length, 1)
  assert.equal(single[0].type, 'single')

  // Two additions in one group -- a two-line addition, NOT a replace.
  const twoAdds = pairReplacements(toAmendmentDisplayRows([
    ROW({ id: 1, group_id: 'g2', kind: 'line_added', product_name: 'A', quantity_before: 0, quantity_after: 1, quantity_delta: 1 }),
    ROW({ id: 2, group_id: 'g2', kind: 'line_added', product_name: 'B', quantity_before: 0, quantity_after: 1, quantity_delta: 1 }),
  ], usd))
  assert.equal(twoAdds.length, 2, 'two additions are two rows')
  assert.ok(twoAdds.every((entry) => entry.type === 'single'))

  // Entries with no group at all still render.
  const ungrouped = pairReplacements(toAmendmentDisplayRows([ROW({ id: 1, group_id: null })], usd))
  assert.equal(ungrouped.length, 1)
  assert.equal(ungrouped[0].type, 'single')
})

await runTest('the client-side amendable check mirrors the server without pretending to enforce it', () => {
  for (const status of ['completed', 'awaiting_delivery', 'awaiting_payment']) {
    assert.equal(saleLooksAmendable({ sale_status: status }), true, `${status} offers the controls`)
  }
  for (const status of ['cancelled', 'returned', 'partial_return']) {
    assert.equal(saleLooksAmendable({ sale_status: status }), false, `${status} does not`)
  }
  // A sale carrying returns is refused by the server whatever its label says;
  // the client hides the controls too so nobody is offered a button that 400s.
  assert.equal(saleLooksAmendable({ sale_status: 'completed', return_count: 1 }), false)
  assert.equal(saleLooksAmendable({ sale_status: 'completed', return_count: 0 }), true)
  assert.equal(saleLooksAmendable(null), false)
  assert.equal(saleLooksAmendable(undefined), false)
})

await runTest('the number formatters keep a shop counting in whole units', () => {
  assert.equal(formatUnits(2), '2', 'not "2.00"')
  assert.equal(formatUnits(1.5), '1.5')
  assert.equal(formatSignedUnits(1), '+1')
  assert.equal(formatSignedUnits(-2), '-2')
  assert.equal(formatSignedUnits(0), '0', 'a zero carries no sign')
  // -0 must never reach the screen as "-0".
  assert.equal(formatSignedUnits(-0), '0')
})

await runTest('a malformed or empty ledger renders as nothing, never as a crash', () => {
  assert.deepEqual(toAmendmentDisplayRows(null, usd), [])
  assert.deepEqual(toAmendmentDisplayRows(undefined, usd), [])
  assert.deepEqual(toAmendmentDisplayRows([], usd), [])
  const junk = toAmendmentDisplayRow({}, usd)
  assert.equal(junk.kind, '')
  assert.equal(junk.beforeText, '0')
  assert.equal(junk.deltaText, '0')
})

// A live bug, found by S4-33 in review: `at` was reaching the screen raw, so
// each amendment printed "2026-09-04 14:22:00" -- an ISO-ish string, in UTC,
// seven hours off the business day. Fixed at the RENDER site
// (SaleDetailModal formats through formatters.fmtDateTime24), which is why
// this shaper must keep handing back the untouched server value.
//
// Pinned in both directions, because both mistakes are easy to make again:
// formatting here would leave a display string where a timestamp belongs, and
// the render site dropping the formatter would put UTC back on the shop floor.
// S4-33's own posCore bug was the first half of that pair -- a lot sort key
// built by splitting a rendered date moved lots into the wrong year as soon as
// the display went day-first.
await runTest('the shaped row keeps the raw server timestamp, and the screen is what formats it', () => {
  const row = toAmendmentDisplayRow(ROW({ created_at: '2026-09-04 14:22:00' }), usd)
  assert.equal(row.at, '2026-09-04 14:22:00',
    'at must be the untouched D1 value -- anything that sorts these entries has to read a real timestamp, not prose')
  assert.equal(toAmendmentDisplayRow(ROW({ created_at: undefined }), usd).at, null,
    'a missing timestamp stays null rather than becoming the string "undefined"')

  const modal = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
  assert.ok(modal.includes('fmtDateTime24(head.at)'),
    'the amendment history must render its timestamp through the shared formatter, which converts UTC to business time and follows the app-wide date order')
  assert.ok(!/\{\[head\.actor, head\.at\]/.test(modal),
    'and must never print head.at raw again')
})

await runTest('sale mutation reviews carry stable idempotency and exchange-rate fields', () => {
  const modal = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
  const sales = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  const transport = readFileSync(new URL('../src/api/salesTransport.ts', import.meta.url), 'utf8')

  assert.match(transport, /addSaleItems\([\s\S]*?review: \{ client_request_id: string; expected_exchange_rate: number; expected_updated_at\?: string \}/)
  assert.match(transport, /items,\s*notes,\s*\.\.\.review/, 'add-items sends the reviewed request id, rate, and revision')
  assert.match(transport, /interface SaleAmendmentRequest[\s\S]*?client_request_id: string[\s\S]*?expected_exchange_rate: number/, 'amendments require the same mutation envelope')
  assert.match(modal, /client_request_id: addRequestIdRef\.current[\s\S]*?expected_exchange_rate: mutationExchangeRate/, 'add-items retries the frozen review body')
  assert.match(modal, /client_request_id: amendRequestIdRef\.current[\s\S]*?expected_exchange_rate: mutationExchangeRate/, 'amendment retries the frozen review body')
  assert.match(modal, /setMutationExchangeRate\(changedRate\)[\s\S]*?sale_mutation_rate_changed/, 'a stale quote keeps the review open with the server rate')
  assert.match(modal, /addMutationError[\s\S]*?t\('error'\)/, 'add-items failures remain visible in the review')
  assert.match(modal, /amendMutationError[\s\S]*?t\('error'\)/, 'amendment failures remain visible in the review')
  assert.match(sales, /code\?: unknown \}\)\.code === 'exchange_rate_changed'[\s\S]*?exchangeRateChanged/, 'the page returns stale-rate details instead of closing the review')
})

if (failed > 0) {
  process.exitCode = 1
}
