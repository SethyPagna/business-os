// The compact shift card (ShiftSummary, used by the shift history list and the
// segment list): Before -> Additional -> After, ALWAYS all three, $0 included
// (owner, 13 Oct 2026, item 14: the shift cash lines are shown everywhere; refuter S1
// found the card still showed Before and After with the middle figure missing).
//
// The real ShiftSummary is rendered (react-dom/server) with the real shiftReportModel;
// only the app context, the heavy detail blocks, the hint popover and the icons are
// stubbed. The card is compact on purpose and a phone is 360px wide, so the layout is
// pinned by what no layout engine is needed to see: the five cells share ONE grid whose
// cash cells are allowed to shrink and wrap (min-w-0 / break-words, never nowrap), and
// the label is the short pack word with the full "Additional change used" behind it.
//
// Run: node tests/shiftSummaryCardAdditional.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import type { Shift } from '../src/api/shiftTransport.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string
type AnyProps = Record<string, any>

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const cardSource = read('../src/components/shifts/ShiftSummary.tsx')

let pack = en
function loadTsx(url: URL): any {
  const compiled = transformSync(readFileSync(url, 'utf8'), { loader: url.pathname.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('AppContext')) {
      return {
        useApp: () => ({
          user: { id: 1, role_code: 'admin' }, t: (key: string) => pack[key] ?? key,
          fmtUSD: (value: unknown) => `$${Number(value).toFixed(2)}`,
          fmtKHR: (value: unknown) => `${Math.round(Number(value)).toLocaleString('en-US')}៛`,
        }),
      }
    }
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    if (id.includes('InfoHint')) return { __esModule: true, default: () => null }
    if (id.includes('ShiftCashBreakdown') || id.includes('ShiftReportFigures') || id.includes('ShiftCloseDriftNote')) return { __esModule: true, default: () => null }
    if (id.includes('utils/permissions')) return { isAdminControlUser: () => true }
    if (id.includes('formatters')) return nodeRequire('../src/utils/formatters.ts')
    if (id.startsWith('.')) return loadTsx(new URL(id, url))
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}
const ShiftSummary = loadTsx(new URL('../src/components/shifts/ShiftSummary.tsx', import.meta.url)).default

const shiftRow = (patch: Partial<Shift> = {}): Shift => ({
  id: 9, shift_code: 'S-20261013-0807-za', scope_mode: 'per_account', user_id: 7, user_name: 'za', branch_id: 1, branch_name: 'Shop',
  business_date: '2026-10-13', opened_at: '2026-10-13T01:07:00.000Z', opening_float_usd: 10, opening_float_khr: 10000,
  additional_cash_usd: 0, additional_cash_khr: 0,
  opening_note: null, closed_at: '2026-10-13T11:30:00.000Z', closing_counted_usd: 120, closing_counted_khr: 50000, closing_note: null,
  closed_by_user_id: 7, closed_by_user_name: 'za', revision: 1, capabilities: { can_edit: false, can_close: false, can_reopen: false, can_cancel: false },
  cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null,
  reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null, ...patch,
}) as unknown as Shift

/** The compact card's cells, in order: [label, value, title]. */
function cells(shift: Shift): Array<[string, string, string | null]> {
  const html = renderToStaticMarkup(React.createElement(ShiftSummary, { shift }))
  return [...html.matchAll(/<div class="([^"]*)"(?: title="([^"]*)")?><dt[^>]*>([^<]*)<\/dt><dd[^>]*>([^<]*)<\/dd><\/div>/g)]
    .map((match): [string, string, string | null] => [match[3], match[4], match[2] ?? null])
}

let checks = 0
const ok = (cond: unknown, message: string) => { assert.ok(cond, message); checks += 1; console.log(`  ok - ${message}`) }

// ---- nothing added: the middle cell is there, as a measured zero ------------------
{
  pack = en
  const rows = cells(shiftRow())
  assert.deepEqual(rows.map(([label]) => label), [en.shift_open_time, en.shift_close_time, en.shift_before, en.shift_additional_short, en.shift_after])
  const value = Object.fromEntries(rows.map(([label, text]) => [label, text]))
  assert.equal(value[en.shift_before], '$10.00 · 10,000៛')
  assert.equal(value[en.shift_additional_short], '$0.00 · 0៛', 'a zero, with no (+) because nothing was added')
  assert.equal(value[en.shift_after], '$120.00 · 50,000៛')
  ok(true, 'EN card: Open, Close, Before, Additional, After, with Additional reading $0.00 · 0៛ between Before and After')
}

// ---- an amount keeps its (+) and its own figures ----------------------------------
{
  pack = en
  const value = Object.fromEntries(cells(shiftRow({ additional_cash_usd: 12.5, additional_cash_khr: 8000 } as Partial<Shift>)).map(([label, text]) => [label, text]))
  assert.equal(value[en.shift_additional_short], '+ $12.50 · 8,000៛')
  const khrOnly = Object.fromEntries(cells(shiftRow({ additional_cash_usd: 0, additional_cash_khr: 20000 } as Partial<Shift>)).map(([label, text]) => [label, text]))
  assert.equal(khrOnly[en.shift_additional_short], '+ $0.00 · 20,000៛')
  ok(true, 'an amount reads "+ $12.50 · 8,000៛", one currency is enough for the (+)')
}

// ---- other shapes of the same card -------------------------------------------------
{
  pack = en
  const open = Object.fromEntries(cells(shiftRow({ closed_at: null, closing_counted_usd: null, closing_counted_khr: null } as Partial<Shift>)).map(([label, text]) => [label, text]))
  assert.equal(open[en.shift_additional_short], '$0.00 · 0៛', 'an open shift still shows the row')
  assert.equal(open[en.shift_after], '—', 'and its uncounted closing stays unknown, not zero')
  const bare = Object.fromEntries(cells(shiftRow({ additional_cash_usd: undefined, additional_cash_khr: undefined } as Partial<Shift>)).map(([label, text]) => [label, text]))
  assert.equal(bare[en.shift_additional_short], '$0.00 · 0៛', 'a response that does not carry the columns is none added')
  ok(true, 'open shift and a response without the columns: the Additional cell is still a zero, the uncounted closing stays a dash')
}

// ---- Khmer -------------------------------------------------------------------------
{
  pack = km
  try {
    const rows = cells(shiftRow())
    assert.deepEqual(rows.map(([label]) => label), [km.shift_open_time, km.shift_close_time, km.shift_before, km.shift_additional_short, km.shift_after])
    assert.match(km.shift_additional_short, /[ក-៿]/)
    assert.notEqual(km.shift_additional_short, en.shift_additional_short, 'km.json carries Khmer, not the English value')
    assert.equal(rows[3][1], '$0.00 · 0៛')
    ok(true, `KM card: the same five cells; the short label is ${km.shift_additional_short}`)
  } finally { pack = en }
}

// ---- the short label has the full wording behind it ---------------------------------
{
  pack = en
  const additional = cells(shiftRow())[3]
  assert.equal(additional[2], en.shift_recon_additional_cash, 'the cell carries the full "Additional change used" as its title')
  assert.equal(en.shift_recon_additional_cash, 'Additional change used')
  ok(true, 'the abbreviated label keeps "Additional change used" as its tooltip, so the card does not invent a second name')
}

// ---- layout at 360px, without a layout engine ----------------------------------------
{
  const dl = cardSource.match(/<dl className="(mt-2 grid[^"]*)">\s*<div[^>]*>\s*<dt[^>]*>\{tr\('shift_open_time'/)
  assert.ok(dl, 'the compact grid is the dl that holds Open')
  assert.match(dl![1], /\bgrid-cols-6\b/, 'phone: six units so Open|Close take three each and Before|Additional|After two each, in two rows')
  assert.match(dl![1], /\bsm:grid-cols-5\b/, 'from sm: one row of the five cells')
  const cellClasses = [...renderToStaticMarkup(React.createElement(ShiftSummary, { shift: shiftRow() })).matchAll(/<div class="([^"]*)"(?: title="[^"]*")?><dt/g)].map((match) => match[1])
  assert.equal(cellClasses.length, 5)
  assert.deepEqual(cellClasses.slice(0, 2).map((cls) => /\bcol-span-3\b/.test(cls) && /\bsm:col-span-1\b/.test(cls)), [true, true], 'Open and Close span three of six on a phone')
  assert.deepEqual(cellClasses.slice(2).map((cls) => /\bcol-span-2\b/.test(cls) && /\bsm:col-span-1\b/.test(cls) && /\bmin-w-0\b/.test(cls)), [true, true, true],
    'the three cash cells span two of six on a phone and may shrink (min-w-0)')
  assert.ok(!/whitespace-nowrap/.test(cardSource.slice(cardSource.indexOf('<dl className="mt-2 grid'), cardSource.indexOf('{detail ?'))), 'no cell refuses to wrap')
  assert.equal((cardSource.match(/break-words font-medium/g) || []).length >= 3, true, 'the cash values wrap instead of overflowing')
  ok(true, 'one grid of five cells: 6-unit phone grid (3+3 then 2+2+2), 5-up from sm, cash cells shrink and wrap')
}

console.log(`\nshiftSummaryCardAdditional.test.ts: ${checks} checks passed`)
