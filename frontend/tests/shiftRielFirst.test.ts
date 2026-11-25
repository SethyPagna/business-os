// Owner A72 + Q3 (A78): riel first, dollars per SHIFT, on every shift surface.
//   * a pair prints the riel half first: `100,000៛ · $50.00`, never dollars first;
//   * the dollar half prints on EVERY pair row of a shift when the shift has any dollar figure, and on NONE when it has none (a riel-only shift never
//     shows a "$" on a pair row) -- per shift, not per line, so the rows stay in the same columns;
//   * business results (sales, COGS, profit, fees, refunds) stay dollars: canonical revenue, whatever the cash rule says;
//   * the Reports print and CSV: KHR column first, the USD column only when something in it is a dollar figure.
// The real ShiftSummary, ShiftReportFigures, ShiftCashBreakdown and ShiftCloseDriftNote are rendered (react-dom/server) over the real model; only the app
// context, the hint popover, the icons and the sale link are stubbed.
// Run: node tests/shiftRielFirst.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import type { Shift } from '../src/api/shiftTransport.ts'
import { shiftExportRows, shiftHasUsd, shiftMoneyColumns, shiftMoneyText } from '../src/components/shifts/shiftReportModel.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

const fmtUSD = (value: unknown) => `$${Number(value).toFixed(2)}`
const fmtKHR = (value: unknown) => `${Math.round(Number(value)).toLocaleString('en-US')}៛`
let pack = en
function loadTsx(url: URL): any {
  const compiled = transformSync(readFileSync(url, 'utf8'), { loader: url.pathname.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('AppContext')) return { useApp: () => ({ user: { id: 1, role_code: 'admin' }, t: (key: string) => pack[key] ?? key, fmtUSD, fmtKHR }) }
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    if (id.includes('InfoHint')) return { __esModule: true, default: () => null }
    if (id.includes('EntityLink')) return { __esModule: true, default: (props: any) => React.createElement('a', null, props.children) }
    if (id.includes('formatters')) return nodeRequire('../src/utils/formatters.ts')
    if (id.startsWith('.')) return loadTsx(new URL(id, url))
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}
const ShiftSummary = loadTsx(new URL('../src/components/shifts/ShiftSummary.tsx', import.meta.url)).default
const ShiftCountPair = loadTsx(new URL('../src/components/shifts/ShiftCountFields.tsx', import.meta.url)).default

const zero = { usd: 0, khr: 0 }
const shiftRow = (patch: Record<string, unknown> = {}, recon: Record<string, unknown> = {}, figures: Record<string, unknown> = {}, drift: unknown = null): Shift => ({
  id: 9, shift_code: 'S-20261120-0807-za', scope_mode: 'per_account', user_id: 7, user_name: 'za', branch_id: 1, branch_name: 'Shop',
  business_date: '2026-11-20', opened_at: '2026-11-20T01:07:00.000Z', opening_float_usd: 0, opening_float_khr: 100000,
  additional_cash_usd: 0, additional_cash_khr: 0, opening_note: null, closed_at: '2026-11-20T11:30:00.000Z', closing_counted_usd: 0, closing_counted_khr: 240000,
  closing_note: null, closed_by_user_id: 7, closed_by_user_name: 'za', revision: 1, capabilities: { can_edit: false, can_close: false, can_reopen: false, can_cancel: false },
  cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null,
  reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null, reconciliation_source: 'stored',
  reconciliation: {
    opening: { usd: 0, khr: 100000 }, additional_cash: zero, cash_sales: { usd: 0, khr: 160000 }, refunds: zero, expenses: zero, courier: zero,
    expected: { usd: 0, khr: 260000 }, counted: { usd: 0, khr: 240000 }, difference: { usd: 0, khr: -20000 }, needs_review: false, review_codes: [], ...recon,
  },
  figures: {
    opening: { usd: 0, khr: 100000 }, additional_cash: zero, closing: { usd: 0, khr: 240000 }, sales_usd: 40, cogs_usd: 20, profit_usd: 20,
    delivery_fee_usd: 2, credit_usd: 0, refunds_usd: 1, delivery_cost: zero, other_expenses: zero, ...figures,
  },
  close_drift: drift,
  ...patch,
}) as unknown as Shift

/** Every `<dt>label</dt><dd>value</dd>` pair of the rendered detail, by label. */
function pairs(shift: Shift, lang: Record<string, string> = en): Map<string, string[]> {
  pack = lang
  try {
    const html = renderToStaticMarkup(React.createElement(ShiftSummary, { shift, detail: true }))
    const found = new Map<string, string[]>()
    for (const match of html.matchAll(/<dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd>/g)) found.set(match[1], [...(found.get(match[1]) ?? []), match[2]])
    // The registered block (OPEN, Cash used, END) is spans, not a dl.
    for (const match of html.matchAll(/<span class="shrink-0[^"]*">([^<]*)<\/span><span class="min-w-0[^"]*">([^<]*)<\/span>/g)) found.set(match[1], [...(found.get(match[1]) ?? []), match[2]])
    return found
  } finally { pack = en }
}
const L = (key: string) => en[key]
/** The pair rows of a shift surface: the card, the registered block, the breakdown, the business pairs. */
const PAIR_LABELS = ['shift_before', 'shift_recon_additional_cash', 'shift_after', 'shift_registered_open', 'shift_registered_end', 'shift_recon_opening', 'shift_recon_cash_sales',
  'refunds', 'fees', 'courier', 'shift_recon_expected', 'shift_recon_counted', 'shift_difference', 'delivery_actual_cost', 'shift_other_expenses']
const pairValues = (found: Map<string, string[]>): string[] => PAIR_LABELS.flatMap((key) => (key === 'refunds' ? [] : found.get(L(key)) ?? []))

let checks = 0
const ok = (cond: unknown, message: string) => { assert.ok(cond, message); checks += 1; console.log(`  ok - ${message}`) }

// ---- the two pure functions -----------------------------------------------------------------
{
  assert.equal(shiftMoneyText({ usd: 10, khr: 50000 }, true, fmtUSD, fmtKHR), '50,000៛ · $10.00')
  assert.equal(shiftMoneyText({ usd: 10, khr: 50000 }, false, fmtUSD, fmtKHR), '50,000៛')
  assert.equal(shiftMoneyText({ usd: 0, khr: 0 }, false, fmtUSD, fmtKHR), '0៛')
  assert.equal(shiftMoneyText({ usd: 0, khr: 0 }, true, fmtUSD, fmtKHR), '0៛ · $0.00', 'on a dollar shift a zero dollar half still prints, so every row has the same shape')
  assert.equal(shiftMoneyText({ usd: null, khr: null }, true, fmtUSD, fmtKHR), '—')
  assert.equal(shiftMoneyText({ usd: null, khr: null }, false, fmtUSD, fmtKHR), '—')
  assert.equal(shiftMoneyText({ usd: 5, khr: null }, true, fmtUSD, fmtKHR), '— · $5.00', 'an uncounted riel half is a dash, the dollars count stands')
  assert.equal(shiftMoneyText({ usd: null, khr: 7000 }, true, fmtUSD, fmtKHR), '7,000៛ · —')
  assert.equal(shiftMoneyText({ usd: null, khr: 7000 }, false, fmtUSD, fmtKHR), '7,000៛')
  ok(true, 'shiftMoneyText: riel first, the dollar half only when asked, a dash for what was not counted')
}

// ---- shiftHasUsd, row by row ------------------------------------------------------------------
{
  assert.equal(shiftHasUsd(shiftRow()), false, 'zeros everywhere')
  assert.equal(shiftHasUsd(shiftRow({ opening_float_usd: null, closing_counted_usd: null, closing_counted_khr: null }, { counted: { usd: null, khr: null }, difference: { usd: null, khr: null } })), false, 'nulls are not dollars')
  for (const patch of [{ opening_float_usd: 1 }, { additional_cash_usd: 1 }, { closing_counted_usd: 5 }]) assert.equal(shiftHasUsd(shiftRow(patch)), true, JSON.stringify(patch))
  for (const key of ['cash_sales', 'refunds', 'expenses', 'courier', 'expected', 'difference']) assert.equal(shiftHasUsd(shiftRow({}, { [key]: { usd: 2, khr: 0 } })), true, `reconciliation ${key}`)
  assert.equal(shiftHasUsd(shiftRow({}, {}, { delivery_cost: { usd: 1, khr: 0 } })), true, 'figures delivery cost')
  assert.equal(shiftHasUsd(shiftRow({}, {}, { other_expenses: { usd: 1, khr: 0 } })), true, 'figures other expenses')
  assert.equal(shiftHasUsd(shiftRow({}, {}, {}, { components: [{ key: 'cash_sales', stored: { usd: 0, khr: 0 }, current: { usd: 3, khr: 0 } }], sales: [], sales_total: 0 })), true, 'a dollar that moved after close')
  assert.equal(shiftHasUsd(shiftRow({ reconciliation: null, figures: null })), false, 'an employee view with no dollar count')
  assert.equal(shiftHasUsd(shiftRow({ reconciliation: null, figures: null, closing_counted_usd: 5 })), true, 'an employee view with a $5 count')
  assert.equal(shiftHasUsd(shiftRow({ sales_usd: 999 } as never)), false, 'business results are not cash')
  ok(true, 'shiftHasUsd: any non-zero, non-null dollar figure of the shift, and nothing else')
}

// ---- 1. a riel-only shift: no "$" on any pair row of any surface; business results stay dollars ----------
{
  const found = pairs(shiftRow())
  const values = pairValues(found)
  assert.ok(values.length >= 12, `every pair row is on screen (${values.length})`)
  assert.deepEqual(values.filter((value) => value.includes('$')), [], 'no dollar sign on a pair row')
  assert.deepEqual(found.get(L('shift_before')), ['100,000៛'])
  assert.deepEqual(found.get(L('shift_after')), ['240,000៛'])
  assert.deepEqual(found.get(L('shift_recon_additional_cash')), ['0៛', '0៛', '0៛'], 'card, registered block and breakdown')
  assert.deepEqual(found.get(L('shift_difference')), ['-20,000៛'], 'signed per currency')
  assert.deepEqual(found.get(L('delivery_actual_cost')), ['0៛'])
  assert.deepEqual(found.get(L('shift_other_expenses')), ['0៛'])
  assert.deepEqual(found.get(L('sales')), ['$40.00'], 'business results stay dollars')
  assert.deepEqual(found.get(L('cogs')), ['$20.00'])
  assert.deepEqual(found.get(L('profit')), ['$20.00'])
  assert.deepEqual(found.get(L('delivery_fees')), ['$2.00'])
  ok(true, 'riel-only shift: every pair row is riel alone; Sales, COGS, Profit and Delivery fees stay dollars')
}

// ---- 2. only a $5 closing count: riel then dollars on EVERY pair row ----------------------------------------
{
  const found = pairs(shiftRow({ closing_counted_usd: 5 }, { counted: { usd: 5, khr: 240000 }, difference: { usd: 5, khr: -20000 } }, { closing: { usd: 5, khr: 240000 } }))
  const values = pairValues(found)
  assert.ok(values.length >= 12)
  for (const value of values) assert.match(value, /^[+-]?(\d[\d,]*៛|—) · [+-]?(\$-?\d+\.\d\d|—)$/, `riel then dollars: ${value}`)
  assert.deepEqual(found.get(L('shift_before')), ['100,000៛ · $0.00'])
  assert.deepEqual(found.get(L('shift_after')), ['240,000៛ · $5.00'])
  assert.deepEqual(found.get(L('shift_recon_additional_cash')), ['0៛ · $0.00', '0៛ · $0.00', '0៛ · $0.00'])
  assert.deepEqual(found.get(L('shift_recon_expected')), ['260,000៛ · $0.00'])
  assert.deepEqual(found.get(L('delivery_actual_cost')), ['0៛ · $0.00'])
  assert.deepEqual(found.get(L('sales')), ['$40.00'])
  ok(true, 'a $5 closing count only: every pair row reads riel then dollars, in the same shape')
}

// ---- 3. a $2 cash sale only, administrator view ---------------------------------------------------------------
{
  const found = pairs(shiftRow({}, { cash_sales: { usd: 2, khr: 160000 }, expected: { usd: 2, khr: 260000 }, difference: { usd: -2, khr: -20000 } }))
  const values = pairValues(found)
  for (const value of values) assert.match(value, /^[+-]?(\d[\d,]*៛|—) · [+-]?(\$-?\d+\.\d\d|—)$/, `riel then dollars: ${value}`)
  assert.deepEqual(found.get(L('shift_before')), ['100,000៛ · $0.00'], 'the card follows the shift, not its own line')
  assert.deepEqual(found.get(L('shift_recon_cash_sales')), ['160,000៛ · $2.00'])
  ok(true, 'a $2 cash sale only: the whole shift is a dollar shift, riel first')
}

// ---- 3b. the employee's view of that same shift: no dollar figure, so no "$" ------------------------------
{
  const received = shiftRow({}, { cash_sales: { usd: 2, khr: 160000 } })
  const employeeView = { ...received, reconciliation: null, figures: null, close_drift: null } as Shift
  const values = pairValues(pairs(employeeView))
  assert.ok(values.length >= 3)
  assert.deepEqual(values.filter((value) => value.includes('$')), [], 'an answer with no dollar figure shows none')
  ok(true, 'the employee view of that shift holds no dollar figure and shows no "$"')
}

// ---- 4. the drift note follows the shift ----------------------------------------------------------------------
{
  const drift = { components: [{ key: 'cash_sales', stored: { usd: 0, khr: 160000 }, current: { usd: 0, khr: 150000 } }], sales: [], sales_total: 0, sales_unavailable: false }
  const html = (shift: Shift) => { pack = en; return renderToStaticMarkup(React.createElement(ShiftSummary, { shift, detail: true })) }
  const riel = html(shiftRow({}, {}, {}, drift))
  assert.match(riel, /160,000៛ → 150,000៛/, 'riel-only drift: riel alone')
  const dollars = html(shiftRow({ closing_counted_usd: 5 }, {}, {}, drift))
  assert.match(dollars, /160,000៛ · \$0\.00 → 150,000៛ · \$0\.00/, 'a dollar shift: riel then dollars')
  ok(true, 'the Changed after close note prints the same shape as the rows above it')
}

// ---- 5. Khmer: the same rule, the pack's own words ------------------------------------------------------------
{
  const found = pairs(shiftRow({ closing_counted_usd: 5 }), km)
  assert.deepEqual(found.get(km.shift_after), ['240,000៛ · $5.00'])
  assert.deepEqual(found.get(km.shift_before), ['100,000៛ · $0.00'])
  ok(true, 'KM card: the same order and shape')
}

// ---- 6. print and CSV: KHR column first, USD column only when something is in dollars --------------------------
{
  const pairRow = (shift: Shift, line: string, pair: { usd: number | null; khr: number | null }) => ({ Section: 'S', Line: line, ...shiftMoneyColumns(pair, shiftHasUsd(shift)) })
  const riel = shiftRow()
  const rielRows = shiftExportRows([pairRow(riel, 'Opening', { usd: 0, khr: 100000 }), pairRow(riel, 'Closing', { usd: 0, khr: 240000 })])
  assert.deepEqual(rielRows.headers, ['Section', 'Line', 'KHR'])
  assert.deepEqual(rielRows.rows, [{ Section: 'S', Line: 'Opening', KHR: 100000 }, { Section: 'S', Line: 'Closing', KHR: 240000 }])
  const dollar = shiftRow({ closing_counted_usd: 5 })
  const dollarRows = shiftExportRows([pairRow(dollar, 'Opening', { usd: 0, khr: 100000 }), pairRow(dollar, 'Closing', { usd: 5, khr: 240000 })])
  assert.deepEqual(dollarRows.headers, ['Section', 'Line', 'KHR', 'USD'], 'KHR before USD')
  assert.deepEqual(dollarRows.rows, [{ Section: 'S', Line: 'Opening', KHR: 100000, USD: 0 }, { Section: 'S', Line: 'Closing', KHR: 240000, USD: 5 }])
  assert.deepEqual(Object.keys(dollarRows.rows[0]), ['Section', 'Line', 'KHR', 'USD'], 'the object keys carry the CSV column order')
  // Business results are dollars: their column stays, with a blank dollar half on the pair rows of a riel-only shift.
  const withBusiness = shiftExportRows([pairRow(riel, 'Opening', { usd: 0, khr: 100000 }), { Section: 'B', Line: 'Sales', KHR: '', USD: 40 }])
  assert.deepEqual(withBusiness.headers, ['Section', 'Line', 'KHR', 'USD'])
  assert.deepEqual(withBusiness.rows, [{ Section: 'S', Line: 'Opening', KHR: 100000, USD: '' }, { Section: 'B', Line: 'Sales', KHR: '', USD: 40 }], 'sales stay dollars; the riel-only pair row has no dollar cell')
  ok(true, 'print and CSV: KHR column first, USD column only when a row has a dollar figure, business results stay dollars')
}

// ---- 7. every surface goes through the two functions ------------------------------------------------------------
{
  const strip = (text: string) => text.replace(/\r/g, '')
  const gate = strip(read('../src/components/pos/ShiftGate.tsx'))
  const files: Record<string, string> = {
    card: strip(read('../src/components/shifts/ShiftSummary.tsx')), figures: strip(read('../src/components/shifts/ShiftReportFigures.tsx')),
    breakdown: strip(read('../src/components/shifts/ShiftCashBreakdown.tsx')), drift: strip(read('../src/components/shifts/ShiftCloseDriftNote.tsx')), gate,
  }
  for (const [name, text] of Object.entries(files)) {
    assert.match(text, /shiftMoneyText\(/, `${name} prints pairs through shiftMoneyText`)
    assert.doesNotMatch(text, /shiftCountedPairText\(/, `${name} no longer prints dollars first`)
  }
  const report = strip(read('../src/components/sales/reports/ShiftReport.tsx'))
  assert.match(report, /shiftExportRows\(/, 'the print and CSV go through shiftExportRows')
  assert.match(report, /shiftMoneyColumns\(/, 'and the pair rows through shiftMoneyColumns')
  assert.doesNotMatch(report, /headers: \['Section', 'Line', 'USD', 'KHR'\]/, 'no dollars-first print header')
  // The field pair: riel input first.
  pack = en
  const html = renderToStaticMarkup(React.createElement(ShiftCountPair, { label: 'Cash', usd: '', khr: '', onUsd: () => undefined, onKhr: () => undefined, usdLabel: 'Dollars', khrLabel: 'Riel' }))
  assert.ok(html.indexOf('aria-label="Riel"') < html.indexOf('aria-label="Dollars"'), 'the riel field comes first')
  ok(true, 'card, figures, breakdown, drift, close form, print and CSV all use the one rule; the riel field comes first')
}

console.log(`\nshiftRielFirst.test.ts: ${checks} checks passed`)

