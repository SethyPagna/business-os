// One sale's RECORDS list, browser side (N41).
//
// The owner, Sep 6 2026: "i want a row at the bottom of sales each sale rows.
// one line called Records with total records when press it pops up a float
// with who made changes in this sales record (by default should show change
// status / add sale / edit product quantity / change delivery fee / or + for
// matching conditions, and click on specific information/record row can see
// more details before and after."
//
// Four separable claims, each of which can be true while the others are false,
// so each gets its own case:
//   the LINE exists on every sale row, at both breakpoints, from one component
//   the FLOAT is the shared float, not a new one, and is read-only
//   the DEFAULT list is unfiltered and every kind has a translated label
//   a RECORD expands to before -> after, with money rendered as money
//
// Run: node tests/saleRecords.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SALE_RECORD_KINDS,
  SALE_RECORD_KIND_KEYS,
  filterSaleRecords,
  normalizeSaleRecordsResponse,
  saleRecordFieldRows,
  saleRecordKind,
  saleRecordKindCounts,
  saleRecordsCount,
  type SaleRecord,
} from '../src/utils/saleRecords.ts'

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

// A sale with one of everything the Worker can emit for it: it was rung up,
// a line moved, the courier cost was corrected, and it was cancelled in a bulk
// action -- the last of which audit_logs alone would report nothing about.
const RECORDS: SaleRecord[] = [
  {
    id: 'sale:77', source: 'sale', at: '2026-09-06T09:00:00Z', at_ms: 1,
    actor_username: 'aza', kind: 'sale_created', via: null, subject: '20260906-090000',
    summary: 'Sale recorded', before: null,
    after: { receipt_number: '20260906-090000', sale_status: 'completed', total_usd: 12.5 },
  },
  {
    id: 'amendment:4', source: 'ledger', at: '2026-09-06 09:30:00', at_ms: 2,
    actor_username: 'dara', kind: 'item_qty_changed', via: 'amend', subject: 'Coca-Cola 330ml',
    summary: 'Coca-Cola 330ml 2 to 1',
    before: { quantity: 2, total_usd: 12.5 },
    after: { quantity: 1, total_usd: 11.5 },
  },
  {
    id: 'amendment:5', source: 'ledger', at: '2026-09-06 09:40:00', at_ms: 3,
    actor_username: 'dara', kind: 'delivery_cost_changed', via: 'amend', subject: 'delivery',
    summary: 'Delivery cost - to $1.20',
    before: { amount_usd: null, total_usd: 11.5 },
    after: { amount_usd: 1.2, total_usd: 11.5 },
  },
  {
    id: 'bulk:op-1', source: 'bulk', at: '2026-09-06 17:00:00', at_ms: 4,
    actor_username: 'aza', kind: 'cancelled', via: null, subject: null,
    summary: 'Bulk status to cancelled',
    before: { sale_status: 'completed' }, after: { sale_status: 'cancelled' },
  },
]

runTest('every kind the Worker can emit has a translated label in BOTH packs', () => {
  const worker = read('../../cloudflare/src/lib/saleRecords.ts')
  const declared = (worker.match(/export const SALE_RECORD_KINDS = \[([\s\S]*?)\] as const/) || [])[1] || ''
  const workerKinds = [...declared.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.ok(workerKinds.length > 5, 'could not read the Worker kind list')
  assert.deepEqual(
    [...workerKinds].sort(),
    [...SALE_RECORD_KINDS].sort(),
    'the browser and the Worker disagree about which kinds exist -- an unknown kind prints raw snake_case in Khmer',
  )
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const kind of SALE_RECORD_KINDS) {
    const key = SALE_RECORD_KIND_KEYS[kind]
    assert.ok(key, `no label key for ${kind}`)
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `${key} is not actually translated`)
  }
})

runTest('an unknown kind lands on "other" rather than reaching the UI raw', () => {
  assert.equal(saleRecordKind('item_added'), 'item_added')
  assert.equal(saleRecordKind('something_invented_later'), 'other')
  assert.equal(saleRecordKind(undefined), 'other')
})

runTest('a record expands to before -> after, with money known to be money', () => {
  const rows = saleRecordFieldRows(RECORDS[2])
  const amount = rows.find((row) => row.field === 'amount_usd')
  assert.ok(amount, 'the courier-cost record must expand its amount')
  assert.equal(amount?.format, 'money', 'an amount rendered as a bare number is unreadable in a money list')
  assert.equal(amount?.before, null)
  assert.equal(amount?.after, 1.2)
  assert.equal(amount?.changed, true)
  // The sale total rides along on every ledger record. A courier cost never
  // touches it, so it is context -- marked unchanged rather than drawn as an
  // arrow from a value to itself.
  const total = rows.find((row) => row.field === 'total_usd')
  assert.equal(total?.changed, false, 'an unchanged field must not be presented as a change')
  const qty = saleRecordFieldRows(RECORDS[1]).find((row) => row.field === 'quantity')
  assert.equal(qty?.format, 'quantity')
  assert.equal(qty?.changed, true)
  const status = saleRecordFieldRows(RECORDS[3]).find((row) => row.field === 'sale_status')
  assert.equal(status?.format, 'status', 'a status must be localized, not printed as awaiting_payment')
})

runTest('a field present on only one side still gets a row', () => {
  const rows = saleRecordFieldRows({
    id: 'x', before: { sale_status: 'completed' }, after: { sale_status: 'cancelled', cancel_reason: 'wrong item' },
  })
  const reason = rows.find((row) => row.field === 'cancel_reason')
  assert.ok(reason, 'a value that appeared from nothing is exactly the change someone opened this to see')
  assert.equal(reason?.changed, true)
})

runTest('the default list is unfiltered, and clearing the filter means all again', () => {
  assert.equal(filterSaleRecords(RECORDS, new Set()).length, RECORDS.length, 'an empty selection means ALL, never none')
  assert.deepEqual(
    filterSaleRecords(RECORDS, new Set(['delivery_cost_changed'])).map((r) => r.id),
    ['amendment:5'],
  )
  assert.deepEqual(
    filterSaleRecords(RECORDS, new Set(['cancelled', 'item_qty_changed'])).map((r) => r.id),
    ['amendment:4', 'bulk:op-1'],
  )
})

runTest('the filter offers only the kinds this sale actually has, in the declared order', () => {
  const counts = saleRecordKindCounts([...RECORDS, { id: 'dup', kind: 'item_qty_changed' }])
  assert.deepEqual(counts, [
    { kind: 'sale_created', count: 1 },
    { kind: 'item_qty_changed', count: 2 },
    { kind: 'delivery_cost_changed', count: 1 },
    { kind: 'cancelled', count: 1 },
  ])
})

runTest('a missing count is an em dash, never 0 -- "nothing ever happened" is never true', () => {
  assert.equal(saleRecordsCount({ records_count: 4 }), 4)
  assert.equal(saleRecordsCount({ records_count: '4' }), 4)
  assert.equal(saleRecordsCount({}), null, 'an older cached row must not claim zero')
  assert.equal(saleRecordsCount(null), null)
  assert.equal(saleRecordsCount({ records_count: -1 }), null)
  const surface = read('../src/components/sales/SalesListSurface.tsx')
  assert.match(surface, /count === null \? '—' : count/, 'the line must print an em dash for a missing count')
})

runTest('a malformed response degrades to visible rows rather than an empty list', () => {
  const parsed = normalizeSaleRecordsResponse({ saleId: 77, records: [{ kind: 'item_added' }, null, 'nope'] })
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].id, 'record-0', 'a record with no id still needs a key')
  assert.deepEqual(normalizeSaleRecordsResponse(null), [])
  assert.deepEqual(normalizeSaleRecordsResponse({}), [])
})

// ---- the surfaces -------------------------------------------------------

runTest('the Records line is on EVERY sale row, at both breakpoints, from one component', () => {
  const surface = read('../src/components/sales/SalesListSurface.tsx')
  assert.match(surface, /function SaleRecordsLine\(/, 'the line must be one component, not a copy per layout')
  const uses = surface.match(/<SaleRecordsLine\b/g) || []
  assert.equal(uses.length, 2, 'the desktop table row and the phone card must BOTH render it')
  // Desktop: its own row under the sale's row. A bare <div> inside <tbody> is
  // hoisted out of the table box by the browser.
  assert.match(surface, /<td colSpan=\{columnCount - 1\}[\s\S]{0,200}<SaleRecordsLine/, 'the desktop line must be a row of the table')
  assert.match(surface, /openSaleRecords\?: \(sale: SaleRecord\) => void/, 'the surface must take the open callback')
  // Opening the float must not also toggle selection or open the detail modal.
  assert.match(surface, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); onOpen\(sale\) \}\}/, 'the line must not fall through to the row click')
})

runTest('the float is the SHARED float, read-only, with one close affordance', () => {
  const float = read('../src/components/sales/SaleRecordsFloat.tsx')
  assert.match(float, /import Modal from '\.\.\/shared\/Modal\.tsx'/, 'a second float primitive would be a second set of escape/backdrop bugs')
  assert.match(float, /unsavedChanges="read-only"/, 'a records list can lose nothing')
  assert.doesNotMatch(float, /onClose=\{onClose\}[\s\S]*<button[^>]*onClose/, 'the header X is the only close affordance')
  assert.match(float, /import FilterMenu from '\.\.\/shared\/FilterMenu\.tsx'/, 'the filter must be the shared FilterMenu')
  // Chosen filters live inside the menu -- never as chips in the header row.
  // Pinned structurally: the float's toolbar row holds the count and the menu
  // and nothing else, so a selected kind has nowhere to spill to.
  assert.match(
    float,
    /<div className="flex items-center justify-between gap-2">\s*<span[\s\S]*?<\/span>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<FilterMenu[\s\S]*?\/>\s*<\/div>/,
    'chosen filters must not spill out of the FilterMenu into the toolbar row',
  )
  assert.doesNotMatch(float, /\[\.\.\.kinds\]|Array\.from\(kinds\)/, 'the selection must not be rendered as its own list')
  assert.match(float, /aria-expanded=\{isOpen\}/, 'selecting a record must announce that it expands')
  assert.match(float, /fmtDateTime24\(record\.at\)/, 'records read dd/mm/yyyy HH:mm like every other history surface')
  assert.match(float, /record\.actor_username/, 'the acting USERNAME leads every row')
})

runTest("a return's record renders its refund as money, not as a raw field name", () => {
  // The returns source (lib/saleRecords.ts, source 5) emits a field no other
  // source does. A field with no rule falls through to plain text UNDER ITS OWN
  // RAW NAME, so the row would read "refund_usd  -  3" in both languages.
  const record: SaleRecord = {
    id: 'return:5', source: 'return', at: '2026-09-06 14:00:00', at_ms: 9,
    actor_username: 'dara', kind: 'status_changed', via: null, subject: 'R-0005',
    summary: 'Partial return',
    before: { sale_status: 'completed' },
    after: { sale_status: 'partial_return', refund_usd: 3 },
  }
  const rows = saleRecordFieldRows(record)
  const refund = rows.find((row) => row.field === 'refund_usd')
  assert.ok(refund, 'the refund must expand')
  assert.equal(refund?.format, 'money', 'a refund rendered as a bare number reads as a quantity')
  assert.ok(refund?.labelKey, 'and it must have a label key rather than printing refund_usd')
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  assert.ok(en[refund!.labelKey!], 'en.json is missing the refund label')
  assert.ok(km[refund!.labelKey!], 'km.json is missing the refund label')
  assert.notEqual(km[refund!.labelKey!], en[refund!.labelKey!], 'the refund label is not actually translated')
  // The status pair still reads as a status, so the row is a transition and
  // not two opaque strings.
  const status = rows.find((row) => row.field === 'sale_status')
  assert.equal(status?.format, 'status')
  assert.equal(status?.changed, true)
})

runTest('the "how" badge is translated, not the Worker enum printed raw', () => {
  // `via` is a Worker enum -- 'amend' | 'undo' | 'redo' -- and the float is the
  // one surface whose whole job is explaining what happened, so printing it raw
  // put the English words "undo" and "redo" into the Khmer pack. Both words are
  // already in both packs.
  const float = read('../src/components/sales/SaleRecordsFloat.tsx')
  assert.doesNotMatch(float, /\{record\.via\}<\/span>/, 'the raw enum must not reach the DOM')
  assert.match(float, /record\.via === 'undo' \? label\('undo', 'Undo'\)/, 'undo reads from the pack')
  assert.match(float, /record\.via === 'redo' \? label\('redo', 'Redo'\)/, 'redo reads from the pack')
  assert.match(float, /\{viaLabel\(record\) \?/, 'and the badge renders the looked-up label')
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const key of ['undo', 'redo']) {
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `${key} is not actually translated`)
    // The tell the raw render leaves behind: the Khmer pack showing the
    // English identifier is exactly the failure this pins.
    assert.notEqual(km[key], key, `km.json's ${key} is the identifier, not a translation`)
  }
  // 'amend' deliberately has NO badge: it is how nearly every record was made.
  assert.doesNotMatch(float, /label\('amend'/, "the common case must not badge every row")
})

runTest('the float is wired into the Sales page and fetches the union endpoint', () => {
  const sales = read('../src/components/sales/Sales.tsx')
  assert.match(sales, /import\('\.\/SaleRecordsFloat'\)/, 'the float must be code-split like the other sale modals')
  assert.match(sales, /openSaleRecords=\{\(sale\) => setRecordsSale\(sale as SaleRecord\)\}/, 'the list must be able to open it')
  assert.match(sales, /\{recordsSale \?/, 'and the page must render it')
  const transport = read('../src/api/salesTransport.ts')
  assert.match(transport, /\/api\/sales\/\$\{encodeId\(id\)\}\/records/, 'the float reads the union endpoint, not /amendments')
  assert.match(transport, /raceLocalFallback: false/, 'an empty list fabricated offline would read as "nobody ever touched this sale"')
  const float = read('../src/components/sales/SaleRecordsFloat.tsx')
  assert.match(float, /getSaleRecords\(sale\.id\)/)
  assert.match(float, /setError\(/, 'a failed read must say it failed rather than show an empty list')
})

runTest('the Worker delivers the count with the list page, not one query per row', () => {
  const route = read('../../cloudflare/src/routes/sales.ts')
  assert.match(route, /records_count: \(recordsBySale\.get\(sale\.id\) \|\| 0\) \+ SALE_RECORDS_SELF_COUNT/, 'every listed sale carries its count')
  assert.match(route, /for \(const chunk of chunkForBinding\(saleIds, 0, SALE_RECORDS_COUNT_BINDS_PER_ID\)\)/, 'one statement per chunk, with the real bind cost declared')
})

if (failed) {
  console.error(`${failed} sale-records case(s) failed`)
  process.exit(1)
}
console.log('sale records (browser): all cases pass')
