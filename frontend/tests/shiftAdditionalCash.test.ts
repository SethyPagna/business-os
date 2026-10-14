// The shift's "additional" field: ONE wording on every surface, and asked for
// BEFORE the closing count.
//
// The register holds change money. The opening count is the change float, the
// closing count is what is left of it, and "additional" is the extra change
// put into the drawer mid-shift when that float ran out -- in the owner's own
// example, opening 10k all used -> closing 0, another 10k added and used ->
// closing 0, additional 10k. It is neither sales cash nor a second closing
// count, and (like the whole registration) it is report-only.
//
// Three things this locks:
//   1. one field, three names -- the form said "Additional cash added" with
//      "USD added" / "KHR added" inputs while the report row said "Additional
//      cash", so nothing on screen said what the figure is for;
//   2. every surface listed it AFTER the closing count, which is not the order
//      the drawer moves in or the order the cashier knows the figures;
//   3. (owner, 13 Oct 2026, item 14: "shift cash lines everywhere") the row is
//      ALWAYS there, so a shift that never needed more change does not show
//      Opening and Closing with the middle line missing. None added is a fact,
//      `$0.00 · 0៛`, on the on-screen report, the CSV, the print and the summary
//      after a close.
//
// Run: node tests/shiftAdditionalCash.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { transformSync } from 'esbuild'
import type { Shift } from '../src/api/shiftTransport.ts'
import {
  shiftAdditionalCash,
  shiftExpectedWithTypedAdditional,
  shiftRegisteredRows,
  type ShiftFiguresShape,
} from '../src/components/shifts/shiftReportModel.ts'
import { buildCSV } from '../src/utils/csv.ts'
import { buildPrintDocument } from '../src/utils/exportOptions.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const read = (rel: string): string => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const enText = read('../src/lang/en.json')
const kmText = read('../src/lang/km.json')
const en = JSON.parse(enText) as Record<string, string>
const km = JSON.parse(kmText) as Record<string, string>

const figuresWith = (additional?: { usd: number; khr: number }): ShiftFiguresShape => ({
  opening: { usd: 10, khr: 40000 },
  ...(additional ? { additional_cash: additional } : {}),
  closing: { usd: 0, khr: 0 },
  sales_usd: 0,
  cogs_usd: 0,
  profit_usd: 0,
  delivery_fee_usd: 0,
  credit_usd: 0,
  refunds_usd: 0,
  delivery_cost: { usd: 0, khr: 0 },
  other_expenses: { usd: 0, khr: 0 },
})
const shiftWith = (figures: ShiftFiguresShape): Shift => ({ shift_code: 'S-1', figures } as unknown as Shift)

// ---- order ----------------------------------------------------------------

test('registration rows run opening -> additional -> closing', () => {
  // The owner's own case: the float was spent to zero, 10,000៛ more change
  // went in and was spent too, so the CLOSING count is the smallest number of
  // the three. An implementation that appends the additional last would order
  // these rows identically by value -- only the keys discriminate.
  const rows = shiftRegisteredRows(shiftWith(figuresWith({ usd: 0, khr: 10000 })))
  assert.deepEqual(rows.map((row) => row.key), [
    'shift_registered_open', 'shift_recon_additional_cash', 'shift_registered_end',
  ])
  assert.equal(rows[1].khr, 10000, 'the middle row carries the additional, not the closing count')
  assert.equal(rows[2].khr, 0, 'the closing count stays last even when it is zero')
  assert.equal(rows[1].added, true, 'only the additional row is rendered as an inflow (+)')
  assert.equal(rows[0].added, undefined)
})

test('a shift that never needed more change still prints open, additional ($0) and end', () => {
  // Owner, 13 Oct 2026 (item 14): the middle row is always there. Both shapes of
  // "none": the admin figures block without an additional, and one that says 0.
  for (const figures of [figuresWith(), figuresWith({ usd: 0, khr: 0 })]) {
    const rows = shiftRegisteredRows(shiftWith(figures))
    assert.deepEqual(rows.map((row) => row.key), ['shift_registered_open', 'shift_recon_additional_cash', 'shift_registered_end'])
    assert.equal(rows[1].usd, 0, 'a measured zero, not a missing value')
    assert.equal(rows[1].khr, 0)
    assert.equal(rows[1].added, undefined, 'nothing was added, so the row is not rendered as an inflow (+)')
  }
  // A cashier's response has no admin figures block; the shift row's own columns decide.
  const cashier = shiftRegisteredRows({ shift_code: 'S-1', opening_float_usd: 10, opening_float_khr: 40000, additional_cash_usd: 0, additional_cash_khr: 0, closing_counted_usd: 0, closing_counted_khr: 0 } as unknown as Shift)
  assert.deepEqual(cashier.map((row) => [row.key, row.usd, row.khr]), [
    ['shift_registered_open', 10, 40000], ['shift_recon_additional_cash', 0, 0], ['shift_registered_end', 0, 0],
  ])
  // ... and a row that does not carry the columns at all is none added too
  // (stored NOT NULL DEFAULT 0), the way the Worker's Telegram report reads it.
  const bare = shiftRegisteredRows({ shift_code: 'S-2' } as unknown as Shift)
  assert.deepEqual(bare.map((row) => [row.key, row.usd, row.khr]), [
    ['shift_registered_open', null, null], ['shift_recon_additional_cash', 0, 0], ['shift_registered_end', null, null],
  ], 'unknown opening/closing stay unknown; the additional is a zero')
})

test('a one-currency top-up keeps its (+) and its zero half', () => {
  const rows = shiftRegisteredRows(shiftWith(figuresWith({ usd: 0, khr: 5000 })))
  assert.deepEqual([rows[1].usd, rows[1].khr, rows[1].added], [0, 5000, true])
})

test('the figures block and the Reports export share that one order', () => {
  for (const rel of ['../src/components/shifts/ShiftReportFigures.tsx', '../src/components/sales/reports/ShiftReport.tsx']) {
    const source = read(rel)
    assert.match(source, /shiftRegisteredRows\(shift\)/, `${rel} reads the shared row order`)
    assert.doesNotMatch(source, /shift_registered_end[\s\S]*shift_recon_additional_cash/, `${rel} must not hand-order the additional after END again`)
  }
})

test('the POS close form asks for the additional before the counted drawer', () => {
  const gate = read('../src/components/pos/ShiftGate.tsx')
  const additional = gate.indexOf("label={t('shift_additional_cash')}")
  const counted = gate.indexOf("label={t('shift_counted_cash')}")
  assert.ok(additional > 0 && counted > additional, 'the additional pair renders before the closing count')
  // The first field of the form is the one that takes the focus, so the
  // cashier is not typed into a field the form already scrolled past.
  assert.match(gate.slice(gate.lastIndexOf('<ShiftCountPair', additional), additional), /autoFocus/)
  assert.doesNotMatch(gate.slice(gate.lastIndexOf('<ShiftCountPair', counted), counted), /autoFocus/)
  // ... and the post-close summary chain reads in the same direction.
  const openedWith = gate.indexOf("t('shift_opened_with')")
  const additionalFact = gate.indexOf("t('shift_recon_additional_cash')")
  const countedFact = gate.indexOf("t('shift_counted_close')")
  assert.ok(openedWith > 0 && openedWith < additionalFact && additionalFact < countedFact,
    'the summary strip runs Opened with -> Additional change used -> Counted at close')
})

test('the Shifts popup amend and historic-close forms use the same order', () => {
  const modal = read('../src/components/shifts/ShiftHistoryModal.tsx')
  for (const draft of ['edit', 'close']) {
    const additional = modal.indexOf(`usd={${draft}.additionalUsd}`)
    const counted = modal.indexOf(`usd={${draft}.closingUsd}`)
    assert.ok(additional > 0 && counted > additional, `the ${draft} form asks for the additional first`)
  }
})

// ---- wording --------------------------------------------------------------

test('the form label, the report row and the breakdown say one thing, in both packs', () => {
  for (const [lang, pack] of [['en', en], ['km', km]] as const) {
    assert.equal(pack.shift_additional_cash, pack.shift_recon_additional_cash,
      `${lang}: the close form and the report/breakdown row must not say different things`)
  }
  assert.equal(en.shift_additional_cash, 'Additional change used')
  assert.equal(km.shift_additional_cash, 'ប្រាក់អាប់បន្ថែមដែលបានប្រើ')
  // The Khmer reuses the packs' own word for change money rather than minting
  // a rival one, and repeats the label's verb on the two inputs.
  assert.equal(km.change, 'ប្រាក់អាប់')
  assert.ok(km.shift_additional_cash.includes(km.change))
  for (const key of ['shift_additional_usd', 'shift_additional_khr']) {
    assert.ok(km[key].includes('បានប្រើ'), `km ${key} says used, like its label`)
  }
  assert.match(en.shift_additional_usd, /USD/)
  assert.match(en.shift_additional_khr, /KHR/)
})

test('the owner\'s example and the report-only rule live behind the InfoHint, not inline', () => {
  // Standing density rule: an explanation goes into the tooltip, not into the
  // layout. The inline hint had grown to ~232 characters -- about three lines
  // of prose under one field on a 375px till, pushing the End button off the
  // screen the cashier is trying to finish.
  for (const [lang, hint] of [['en', en.shift_additional_cash_hint], ['km', km.shift_additional_cash_hint]] as const) {
    assert.ok(hint.length <= 80, `${lang}: the inline hint is one short line, not a paragraph (${hint.length} chars)`)
    assert.ok(!hint.includes('10,000'), `${lang}: the worked example belongs in the InfoHint`)
  }
  for (const example of [en.shift_additional_cash_example, km.shift_additional_cash_example]) {
    assert.ok(example.includes('10,000'), 'the detail shows the opening-spent-then-topped-up example')
    assert.ok(/0/.test(example), 'and the closing 0 that goes with it')
  }
  assert.match(en.shift_additional_cash_example, /Report only/)
  assert.match(en.shift_additional_cash_example, /never changes sales/)
  assert.ok(km.shift_additional_cash_example.includes('សម្រាប់របាយការណ៍តែប៉ុណ្ណោះ'))
  // Every surface that shows the short hint also offers the detail, or the
  // owner's example would simply be gone from the app.
  for (const rel of ['../src/components/pos/ShiftGate.tsx', '../src/components/shifts/ShiftHistoryModal.tsx']) {
    const source = read(rel)
    const hints = source.split("hint={t('shift_additional_cash_hint')}").length - 1
    const details = source.split("hintDetail={t('shift_additional_cash_example')}").length - 1
    assert.ok(hints > 0 && hints === details, `${rel}: ${hints} additional hints but ${details} InfoHints`)
  }
  assert.match(read('../src/components/shifts/ShiftCountFields.tsx'), /hintDetail \? <InfoHint/, 'the pair renders the detail as an InfoHint')
  // The difference formula names the same term as the field it sums.
  assert.match(en.shift_difference_hint, /additional change used/)
  assert.ok(km.shift_difference_hint.includes(km.shift_additional_cash))
})

// ---- one rule for "was there a top-up" ------------------------------------

test('a shift with no top-up has an additional of zero everywhere, never a missing line', () => {
  // ONE rule, shared by every surface, so the till and the report cannot disagree
  // (owner, 13 Oct 2026, item 14): it answers the figure itself, zero when nothing
  // was added, and every surface prints it.
  assert.deepEqual(shiftAdditionalCash({ additional_cash_usd: 0, additional_cash_khr: 0 } as Shift), { usd: 0, khr: 0 })
  assert.deepEqual(shiftAdditionalCash({} as Shift), { usd: 0, khr: 0 }, 'a row that does not carry the field is none added')
  assert.deepEqual(shiftAdditionalCash({ additional_cash_usd: 0, additional_cash_khr: 5000 } as Shift), { usd: 0, khr: 5000 },
    'one currency is enough for a non-zero line')
  // The cashier's own close response carries no admin `figures` block, so the
  // rule has to fall back to the shift row or their top-up would vanish.
  assert.deepEqual(shiftAdditionalCash({ additional_cash_usd: 3, additional_cash_khr: 0, figures: null } as unknown as Shift), { usd: 3, khr: 0 })
  assert.deepEqual(shiftAdditionalCash(shiftWith(figuresWith({ usd: 7, khr: 0 }))), { usd: 7, khr: 0 }, 'the admin figures win when present')
  const gate = read('../src/components/pos/ShiftGate.tsx')
  assert.match(gate, /closedAdditional = closed \? shiftAdditionalCash\(closed\)/, 'the POS strip reads the shared rule')
  assert.doesNotMatch(gate, /additional_cash_usd \?\? 0/, 'and never prints a fabricated zero of its own')
})

test('the POS summary after a close always carries the additional row, with (+) only for an amount', () => {
  const gate = read('../src/components/pos/ShiftGate.tsx')
  // closedAdditional is null only while the shift is still open (no summary yet).
  assert.match(gate, /!!closedAdditional && \{ label: t\('shift_recon_additional_cash'\)/, 'the row is gated on the close, not on an amount')
  assert.match(gate, /closedAdditional\.usd \|\| closedAdditional\.khr \? '\+ ' : ''/, 'the (+) marks an inflow only when something was added')
  assert.doesNotMatch(gate, /Only when some was actually put in/, 'the retired "only when some was added" rule is gone from the comment')
})

// ---- the rendered report, the CSV and the print --------------------------------

let pack: Record<string, string> = en
function loadTsx(url: URL): any {
  const compiled = transformSync(fs.readFileSync(url, 'utf8'), { loader: url.pathname.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('AppContext')) {
      return {
        useApp: () => ({
          t: (key: string) => pack[key] ?? key,
          fmtUSD: (value: unknown) => `$${Number(value).toFixed(2)}`,
          fmtKHR: (value: unknown) => `${Math.round(Number(value)).toLocaleString('en-US')}៛`,
        }),
      }
    }
    if (id.includes('InfoHint')) return { __esModule: true, default: () => null }
    if (id.startsWith('.')) return loadTsx(new URL(id, url))
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}
const ShiftReportFigures = loadTsx(new URL('../src/components/shifts/ShiftReportFigures.tsx', import.meta.url)).default

const closedShiftRow = (additional: { usd: number; khr: number }): Shift => ({
  shift_code: 'S-20261013-0807-Za', opening_float_usd: 10, opening_float_khr: 10000,
  additional_cash_usd: additional.usd, additional_cash_khr: additional.khr,
  closing_counted_usd: 120, closing_counted_khr: 50000, closed_at: '2026-10-13T11:30:00.000Z',
} as unknown as Shift)
const registeredBlock = (shift: Shift): string[] => {
  const html = renderToStaticMarkup(React.createElement(ShiftReportFigures, { shift }))
  // The three rows of the Registered cash block: label span then value span.
  return [...html.matchAll(/<span class="shrink-0[^"]*">([^<]*)<\/span><span class="min-w-0[^"]*">([^<]*)<\/span>/g)].map((m) => `${m[1]}: ${m[2]}`)
}

test('the on-screen report prints Open -> Additional change used -> End, with $0 when nothing was added (EN and KM)', () => {
  pack = en
  assert.deepEqual(registeredBlock(closedShiftRow({ usd: 0, khr: 0 })), [
    `${en.shift_registered_open}: $10.00 · 10,000៛`,
    `${en.shift_recon_additional_cash}: $0.00 · 0៛`,
    `${en.shift_registered_end}: $120.00 · 50,000៛`,
  ])
  assert.deepEqual(registeredBlock(closedShiftRow({ usd: 12.5, khr: 8000 })).map((row) => row.replace(/^[^:]*: /, '')), [
    '$10.00 · 10,000៛', '+ $12.50 · 8,000៛', '$120.00 · 50,000៛',
  ], 'an amount keeps its (+) and its own figures')
  pack = km
  try {
    const rows = registeredBlock(closedShiftRow({ usd: 0, khr: 0 }))
    assert.equal(rows.length, 3, 'the Khmer report has all three rows too')
    assert.equal(rows[1], `${km.shift_recon_additional_cash}: $0.00 · 0៛`)
    assert.match(rows[1], /ប្រាក់អាប់បន្ថែមដែលបានប្រើ/)
  } finally { pack = en }
})

test('the CSV and the print carry the additional row as a zero line', () => {
  // ShiftReport.tsx builds one `rows` list for both exports from shiftRegisteredRows.
  // `row.usd ?? ''` keeps a 0 as 0 -- the same expression is asserted in the source below.
  const source = read('../src/components/sales/reports/ShiftReport.tsx')
  assert.match(source, /\.\.\.shiftRegisteredRows\(shift\)\.map\(\(row\) => \(\{[\s\S]*?USD: row\.usd \?\? '',[\s\S]*?KHR: row\.khr \?\? '',/, 'a zero stays a zero in the export rows')
  const rows = shiftRegisteredRows(closedShiftRow({ usd: 0, khr: 0 })).map((row) => ({
    Section: 'Registered cash', Line: en[row.key] ?? row.fallback, USD: row.usd ?? '', KHR: row.khr ?? '',
  }))
  const csv = buildCSV(rows).split('\n')
  assert.deepEqual(csv, [
    'Section,Line,USD,KHR',
    `Registered cash,${en.shift_registered_open},10,10000`,
    'Registered cash,Additional change used,0,0',
    `Registered cash,${en.shift_registered_end},120,50000`,
  ])
  // The print goes through the SAME rows into the real document builder: a 0 must
  // survive as a printed 0 in its own table row, not be dropped or blanked.
  const html = buildPrintDocument({ title: 'Shift Report · S-20261013-0807-Za', headers: ['Section', 'Line', 'USD', 'KHR'], rows, autoPrint: false })
  const tableRows = [...html.matchAll(/<tr>(.*?)<\/tr>/g)].map((match) => [...match[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((cell) => cell[1])).filter((cells) => cells.length)
  assert.deepEqual(tableRows, [
    ['Registered cash', en.shift_registered_open, '10', '10000'],
    ['Registered cash', 'Additional change used', '0', '0'],
    ['Registered cash', en.shift_registered_end, '120', '50000'],
  ], 'the printed table carries the Additional change used row as 0 / 0')
})

// ---- what the drawer should hold BEFORE the close is written --------------

test('the pre-close expected drawer moves with the additional being typed', () => {
  // The stored reconciliation was computed from the additional RECORDED on the
  // shift (none, on an open one). A cashier who puts another 20,000 riel of
  // change in and types it must see Expected move, or they will be told the
  // till is 20,000 over.
  const reconciliation = { expected: { usd: 250.5, khr: 105_000 }, additional_cash: { usd: 10, khr: 5_000 } }
  assert.deepEqual(shiftExpectedWithTypedAdditional(reconciliation, { usd: 10, khr: 5_000 }), { usd: 250.5, khr: 105_000 },
    'retyping what was already recorded changes nothing')
  assert.deepEqual(shiftExpectedWithTypedAdditional(reconciliation, { usd: 12.25, khr: 25_000 }), { usd: 252.75, khr: 125_000 },
    'only the additional term moves: expected - recorded + typed')
  assert.deepEqual(shiftExpectedWithTypedAdditional(reconciliation, { usd: null, khr: null }), { usd: 240.5, khr: 100_000 },
    'clearing the field takes the recorded amount back out, it does not keep it')
  assert.deepEqual(shiftExpectedWithTypedAdditional({ expected: { usd: null, khr: 100_000 } }, { usd: 5, khr: 0 }), { usd: null, khr: 100_000 },
    'a currency the shift never registered stays unknown instead of becoming a number')
  assert.deepEqual(shiftExpectedWithTypedAdditional(null, { usd: 5, khr: 0 }), { usd: null, khr: null },
    'and no reconciliation at all is not an expectation of zero')
  assert.equal(shiftExpectedWithTypedAdditional({ expected: { usd: 0.1, khr: 0 }, additional_cash: { usd: 0.3, khr: 0 } }, { usd: 0.2, khr: 0 }).usd, 0,
    'cents do not drift into binary noise')
  const gate = read('../src/components/pos/ShiftGate.tsx')
  assert.match(gate, /shiftExpectedWithTypedAdditional\(shift\?\.reconciliation, typedAdditional\)/, 'the close form shows the adjusted figure')
  assert.doesNotMatch(gate, /reconciliation\.expected\.usd/, 'and no longer prints the stored expected beside the field that changes it')
})

test('the retired "added" wording is gone from both packs and both fallbacks', () => {
  for (const retired of ['Additional cash added', 'USD added', 'KHR added', 'Additional cash']) {
    assert.ok(!enText.includes(retired), `en.json still contains the retired "${retired}"`)
  }
  for (const retired of ['សាច់ប្រាក់បន្ថែមចូលថត', 'បន្ថែម USD', 'បន្ថែម KHR', 'សាច់ប្រាក់បន្ថែម']) {
    assert.ok(!kmText.includes(retired), `km.json still contains the retired "${retired}"`)
  }
  // Inline English fallbacks shadow the pack when a key is missing, so they
  // are a surface of their own.
  for (const rel of [
    '../src/components/pos/ShiftGate.tsx',
    '../src/components/shifts/ShiftHistoryModal.tsx',
    '../src/components/shifts/ShiftReportFigures.tsx',
    '../src/components/shifts/ShiftCashBreakdown.tsx',
    '../src/components/shifts/shiftReportModel.ts',
    '../src/components/sales/reports/ShiftReport.tsx',
  ]) {
    assert.doesNotMatch(read(rel), /Additional cash|cash added/i, `${rel} still carries the retired wording`)
  }
})
