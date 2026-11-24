// "Not counted (closed late)" on the shift card and detail, and the Reports on-screen "Closed late" reason line
// (board item shiftf3, F2 and F3). The REAL ShiftSummary, ShiftReportFigures, ShiftCashBreakdown and ShiftHeaderRow are
// rendered (react-dom/server) with the real pack text. Mutants of the real sources each turn their own test red.
//
// Run: node tests/shiftNotCountedMounted.test.ts
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
const NOT_COUNTED = en.shift_late_not_counted
assert.equal(NOT_COUNTED, 'Not counted (closed late)')

type Mutation = { file: string; from: string; to: string }

function loadTsx(url: URL, mutations: Mutation[]): any {
  let source = readFileSync(url, 'utf8').replace(/\r\n/g, '\n')
  for (const m of mutations) {
    if (!url.pathname.endsWith(m.file)) continue
    assert.ok(source.includes(m.from), `the mutant target exists: ${m.from.slice(0, 50)}`)
    source = source.replace(m.from, m.to)
  }
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
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
    if (id.includes('lucide-react') || id.includes('InfoHint') || id.includes('ShiftCloseDriftNote')) return { __esModule: true, default: () => null }
    if (id.includes('utils/permissions')) return { isAdminControlUser: () => true }
    if (id.includes('formatters')) return formatters
    if (id.startsWith('.')) return loadTsx(new URL(id, url), mutations)
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}
const summaryOf = (mutations: Mutation[] = []) => loadTsx(new URL('../src/components/shifts/ShiftSummary.tsx', import.meta.url), mutations).default

const CODE = 'S-20261122-0807-Za'
const shiftRow = (patch: Partial<Shift> = {}): Shift => ({
  id: 9, shift_code: CODE, scope_mode: 'per_account', user_id: 7, user_name: 'Za', branch_id: 1, branch_name: 'LC Store',
  business_date: '2026-11-22', opened_at: '2026-11-22T01:07:00.000Z', opening_float_usd: 10, opening_float_khr: 10000,
  additional_cash_usd: 0, additional_cash_khr: 0,
  opening_note: null, closed_at: '2026-11-23T03:30:00.000Z', closing_counted_usd: null, closing_counted_khr: null, closing_note: null,
  closed_by_user_id: 7, closed_by_user_name: 'Za', revision: 1, capabilities: { can_edit: false, can_close: false, can_reopen: false, can_cancel: false },
  cancelled_at: null, cancelled_by_user_id: null, cancelled_by_user_name: null, cancel_reason: null, parent_shift_id: null,
  reopen_reason: null, reopened_by_user_id: null, reopened_by_user_name: null, ...patch,
}) as unknown as Shift

const render = (shift: Shift, props: Record<string, unknown>, mutations: Mutation[] = []) =>
  renderToStaticMarkup(React.createElement(summaryOf(mutations), { shift, ...props }))
const count = (html: string) => html.split(NOT_COUNTED).length - 1
const CARD_MUTANT: Mutation = { file: 'ShiftSummary.tsx', from: "shiftNotCounted(shift, closedLate) ? tr('shift_late_not_counted', 'Not counted (closed late)') : afterText", to: 'afterText' }
const DETAIL_MUTANT: Mutation = { file: 'ShiftSummary.tsx', from: '<ShiftReportFigures shift={shift} closedLate={closedLate} />', to: '<ShiftReportFigures shift={shift} />' }

function cardAfter(html: string): string {
  const match = html.match(/<dt[^>]*>After<\/dt><dd[^>]*>([^<]*)<\/dd>/)
  assert.ok(match, 'the After cell')
  return match[1]
}
function endRow(html: string): string {
  const match = html.match(/<span[^>]*>END<\/span><span[^>]*>(.*?)<\/span><\/div>/)
  assert.ok(match, 'the END row of the registered cash block')
  return match[1]
}

async function cardText(mutations: Mutation[] = []) {
  assert.equal(cardAfter(render(shiftRow(), { closedLate: true }, mutations)), NOT_COUNTED, 'the card After cell says Not counted (closed late)')
  assert.equal(cardAfter(render(shiftRow(), { closedLate: false }, mutations)), '—', 'a same-day close with no count keeps the dash')
}
async function detailText(mutations: Mutation[] = []) {
  assert.equal(endRow(render(shiftRow(), { detail: true, closedLate: true }, mutations)), NOT_COUNTED, 'the detail END row says Not counted (closed late)')
  assert.equal(endRow(render(shiftRow(), { detail: true, closedLate: false }, mutations)), '—', 'a same-day close with no count keeps the dash in the detail')
}

test('the card says Not counted (closed late) on a late close with no count', async () => { await cardText() })
test('the detail END row says Not counted (closed late) on a late close with no count', async () => { await detailText() })
test('a late close that was counted shows the count, never the late text', () => {
  const html = render(shiftRow({ closing_counted_usd: 120, closing_counted_khr: 50000 }), { detail: true, closedLate: true })
  assert.equal(count(html), 0)
})

test('mutant: the card text removed fails the card test', async () => {
  await assert.rejects(() => cardText([CARD_MUTANT]), /the card After cell says Not counted/)
})
test('mutant: the detail text removed fails the detail test', async () => {
  await assert.rejects(() => detailText([DETAIL_MUTANT]), /the detail END row says Not counted/)
  await cardText([DETAIL_MUTANT])
})
test('each mutant is seen only by its own test: the card mutant leaves the detail text', async () => {
  await detailText([CARD_MUTANT])
})

// F3 (shiftf3): the breakdown's "Closing cash" row, through the same rule as the END row.
const money = (usd: number | null, khr: number | null) => ({ usd, khr })
const reconciliation = {
  opening: money(10, 10000), additional_cash: money(0, 0), cash_sales: money(50, 0), refunds: money(0, 0), expenses: money(0, 0), courier: money(0, 0),
  expected: money(60, 10000), counted: money(null, null), difference: money(null, null), needs_review: false, review_codes: [],
}
const withDrawer = (patch: Partial<Shift> = {}) => shiftRow({ reconciliation, reconciliation_source: 'stored', ...patch } as Partial<Shift>)
function closingCash(html: string): string {
  const match = html.match(/<dt[^>]*>Closing cash<\/dt><dd[^>]*>(.*?)<\/dd>/)
  assert.ok(match, 'the Closing cash row of the breakdown')
  return match[1]
}
const BREAKDOWN_MUTANT: Mutation = { file: 'ShiftSummary.tsx', from: 'notCounted={shiftNotCounted(shift, closedLate)}', to: 'notCounted={!!shift.closed_at}' }

async function breakdownText(mutations: Mutation[] = []) {
  assert.equal(closingCash(render(withDrawer(), { detail: true, closedLate: true }, mutations)), NOT_COUNTED, 'a late close with no count says Not counted (closed late) in the breakdown')
  assert.equal(closingCash(render(withDrawer(), { detail: true, closedLate: false }, mutations)), '—', 'a same-day close with no count keeps the dash in the breakdown')
}
test('the breakdown Closing cash row says Not counted (closed late) on a late close with no count', async () => { await breakdownText() })
test('the breakdown shows a count that was taken, late or not', () => {
  const counted = withDrawer({ closing_counted_usd: 60, closing_counted_khr: 10000, reconciliation: { ...reconciliation, counted: money(60, 10000) } } as Partial<Shift>)
  assert.match(closingCash(render(counted, { detail: true, closedLate: true })), /\$60\.00/)
})
test('mutant: the same-day close shows the late text in the breakdown', async () => {
  await assert.rejects(() => breakdownText([BREAKDOWN_MUTANT]), /same-day close with no count keeps the dash in the breakdown/)
})
test('mutant: the breakdown prop removed fails the breakdown test', async () => {
  await assert.rejects(() => breakdownText([{ ...BREAKDOWN_MUTANT, to: '' }]), /late close with no count says Not counted \(closed late\) in the breakdown/)
})
