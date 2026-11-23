// One compact header row on every shift header (owner ask A73): date · ID · cashier · branch in ONE wrapping
// flex row, the tags and status pill at the right edge, the ID never truncated, and the detail's
// Opened / Closed / Duration row folded into the Open and Close cells.
//
// The real ShiftSummary is rendered (react-dom/server); the POS gate and the report are source-shape, like the
// rest of the shift suite.
//
// Run: node tests/shiftHeaderRow.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { transformSync } from 'esbuild'
import type { Shift } from '../src/api/shiftTransport.ts'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const formatters = nodeRequire('../src/utils/formatters.ts')

function loadTsx(url: URL): any {
  const compiled = transformSync(readFileSync(url, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('AppContext')) {
      return {
        useApp: () => ({
          user: { id: 1, role_code: 'admin' }, t: (key: string) => en[key] ?? key,
          fmtUSD: (value: unknown) => `$${Number(value).toFixed(2)}`,
          fmtKHR: (value: unknown) => `${Math.round(Number(value)).toLocaleString('en-US')}៛`,
        }),
      }
    }
    if (id.includes('lucide-react') || id.includes('InfoHint')) return { __esModule: true, default: () => null }
    if (id.includes('ShiftCashBreakdown') || id.includes('ShiftReportFigures') || id.includes('ShiftCloseDriftNote')) return { __esModule: true, default: () => null }
    if (id.includes('utils/permissions')) return { isAdminControlUser: () => true }
    if (id.includes('formatters')) return formatters
    if (id.startsWith('.')) return loadTsx(new URL(id, url))
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}
const ShiftSummary = loadTsx(new URL('../src/components/shifts/ShiftSummary.tsx', import.meta.url)).default

const CODE = 'S-20261122-0807-Za'
const shiftRow = (patch: Partial<Shift> = {}): Shift => ({
  id: 9, shift_code: CODE, scope_mode: 'per_account', user_id: 7, user_name: 'Za', branch_id: 1, branch_name: 'LC Store',
  business_date: '2026-11-22', opened_at: '2026-11-22T01:07:00.000Z', opening_float_usd: 10, opening_float_khr: 10000,
  additional_cash_usd: 0, additional_cash_khr: 0,
  opening_note: null, closed_at: '2026-11-22T10:19:00.000Z', closing_counted_usd: 120, closing_counted_khr: 50000, closing_note: null,
  closed_by_user_id: 7, closed_by_user_name: 'Za', revision: 1, capabilities: { can_edit: false, can_close: false, can_reopen: false, can_cancel: false },
  cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null,
  reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null, ...patch,
}) as unknown as Shift

const render = (shift: Shift, props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(ShiftSummary, { shift, ...props }))

/** The innermost div whose markup holds the ID: the header row's value container. */
function headerContainer(html: string): string {
  const at = html.indexOf(CODE)
  assert.ok(at > 0, 'the ID is rendered')
  const start = html.lastIndexOf('<div', at)
  const end = html.indexOf('</div>', at)
  return html.slice(start, end + 6)
}

/** The cell (label, value html) the card draws for one dt label. */
function cell(html: string, label: string): string {
  const match = html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>([^<]*)</dd>`))
  assert.ok(match, `a cell labelled ${label}`)
  return match[1]
}

const late = () => shiftRow({ closed_at: '2026-11-23T03:30:00.000Z' })

test('the card puts date, ID, cashier and branch in one flex container', () => {
  const box = headerContainer(render(shiftRow()))
  assert.match(box, /^<div class="[^"]*\bflex\b[^"]*\bflex-wrap\b/, 'a wrapping flex row')
  for (const value of ['22/11/2026', CODE, '>Za<', '>LC Store<']) assert.ok(box.includes(value), `${value} sits in that one row`)
})

test('no element puts the cashier or the branch on a row of its own', () => {
  const html = render(shiftRow())
  assert.ok(!/<div[^>]*>\s*Za\s*·\s*LC Store/.test(html), 'no separate "cashier · branch" line')
  assert.ok(!/<div[^>]*>(Za|LC Store)<\/div>/.test(html), 'no div holds only the cashier or only the branch')
  const retired = headerContainer(render(shiftRow({ branch_active: false } as Partial<Shift>)))
  assert.ok(retired.includes(en.shift_branch_inactive), 'the retired-branch tag follows the branch on the same row')
})

test('the ID is never truncated', () => {
  const html = render(shiftRow())
  const span = html.match(new RegExp(`<span class="([^"]*)">${CODE}</span>`))
  assert.ok(span, 'the ID span')
  assert.ok(!/\btruncate\b|text-ellipsis|overflow-hidden/.test(span[1]), 'no truncate, ellipsis or clipping on the ID')
})

test('the detail has no Opened / Closed / Duration row; its values live in the Open and Close cells', () => {
  const html = render(shiftRow(), { detail: true })
  for (const key of ['shift_opened_at', 'shift_closed_at', 'shift_duration']) assert.ok(!html.includes(`>${en[key]}</dt>`), `${key} row is gone`)
  assert.equal(cell(html, en.shift_open_time), formatters.fmtClock24('2026-11-22T01:07:00.000Z'))
  assert.equal(cell(html, en.shift_close_time), `${formatters.fmtClock24('2026-11-22T10:19:00.000Z')} · 9 ${en.shift_hours_short} 12 ${en.shift_minutes_short}`, 'Duration joins the Close cell')
  const detail = render(shiftRow(), { detail: true })
  assert.ok(detail.includes('<dl'), 'the detail still renders its cells')
})

test('the date shows in the Close cell only when it differs from the shift day', () => {
  const sameDay = cell(render(shiftRow()), en.shift_close_time)
  assert.ok(!sameDay.includes('/'), 'a same-day close shows the clock alone')
  const lateCell = cell(render(late()), en.shift_close_time)
  assert.ok(lateCell.startsWith(`${formatters.fmtDate('2026-11-23T03:30:00.000Z')} `), 'a close on another day leads with that day')
  assert.ok(!cell(render(shiftRow()), en.shift_open_time).includes('/'), 'the Open cell stays a clock on its own day')
})

test('the five cells keep their order', () => {
  const html = render(shiftRow())
  const labels = [...html.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((m) => m[1])
  assert.deepEqual(labels, [en.shift_open_time, en.shift_close_time, en.shift_before, en.shift_additional_short, en.shift_after])
})

test('a late close shows its Closed late tag beside Edited on the card', () => {
  const html = render(late(), { closedLate: true })
  assert.ok(html.includes(en.shift_closed_late), 'the tag')
  assert.ok(!render(late()).includes(en.shift_closed_late), 'no tag unless the review says so')
})

test('the POS carry-over strip and close summary use the one header row, not their own code and branch cells', () => {
  const gate = read('../src/components/pos/ShiftGate.tsx')
  assert.equal((gate.match(/<ShiftHeaderRow\b/g) ?? []).length, 2, 'carry-over strip and close summary')
  assert.ok(!/label: t\('shift_code'\)/.test(gate), 'no separate code cell')
  assert.ok(!/label: t\('shift_opened_by'\)/.test(gate), 'no separate opened-by cell')
  assert.ok(!/label: t\('branch'\), value: `\$\{shift\.branch_name/.test(gate), 'no separate retired-branch cell')
})

test('the Reports shift print subtitle is date · ID · cashier · branch', () => {
  const report = read('../src/components/sales/reports/ShiftReport.tsx')
  assert.match(report, /subtitle: \[fmtDateOnly\(shift\.business_date\), shift\.shift_code, /)
})
