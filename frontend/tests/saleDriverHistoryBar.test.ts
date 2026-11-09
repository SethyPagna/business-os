// G5 (SALE-DELIVERY-EDIT): a one-sale driver change (applier sale.delivery.single) shows in the History bar like the
// group Driver change it replaced: a translated "Driver of #receipt: before -> after" line and the "Affected sales"
// before/after list. Before this lane the row showed only the stored English "1 sales: delivery_contact; 0 unchanged",
// in both languages, with no details.
//
// ActionHistoryBar is rendered for real (menu shell and select stubbed so the run stays a plain node one).
// The details list reads the receipt's action, an OBJECT ({ kind: 'delivery_contact' }): the third test pins that the
// field is taken from its kind, because String(object) is "[object Object]" and every driver rendered as a dash.
//
// DISCRIMINATING: before the change the Khmer render has no Khmer label and neither language has the Affected sales
// button on a sale.delivery.single row.
//
// Run: node tests/saleDriverHistoryBar.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

type AnyProps = Record<string, any>

const barSource = readFileSync(new URL('../src/components/shared/ActionHistoryBar.tsx', import.meta.url), 'utf8')
function loadBar(): React.ComponentType<AnyProps> {
  const compiled = transformSync(barSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('LazyPortalMenu')) {
      return { __esModule: true, default: ({ content }: AnyProps) => React.createElement('div', { 'data-menu': 'open' }, content({ closeMenu: () => {} })) }
    }
    if (id.includes('AppSelect')) return { __esModule: true, default: () => null }
    if (id.includes('history.js')) return { __esModule: true, default: () => null }
    if (id.includes('formatters')) return { fmtDateTime24: (value: unknown) => String(value ?? '') }
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports.default as React.ComponentType<AnyProps>
}

const Bar = loadBar()
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>

const driverRow = (payload: Record<string, unknown>, label = 'Driver of #R2: Driver A -> Driver B') => ({
  id: 41, label, status: 'undoable', reversible: 1, server_replayable: true,
  undo_payload: { applier: 'sale.delivery.single', snapshot_id: 3, operation_id: 'op', generation: 0, action: 'delivery_contact', ...payload },
})
const render = (pack: Record<string, string>, serverItems: unknown[]) => renderToStaticMarkup(React.createElement(Bar, {
  t: (key: string) => pack[key],
  history: {
    undoItems: [], redoItems: [], serverItems, canUndo: false, canRedo: false, undo: () => {}, redo: () => {},
    undoServer: () => {}, redoServer: () => {}, busy: false,
  },
}))

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const SAVED = { receipt_number: 'R2', before_name: 'Driver A', after_name: 'Driver B' }

test('a one-sale driver change reads "Driver of #R2: Driver A -> Driver B" and offers Affected sales, in English', () => {
  const html = render(en, [driverRow(SAVED)])
  assert.ok(html.includes('Driver of #R2: Driver A → Driver B'), html)
  assert.ok(html.includes(en.sale_bulk_history_details), 'the before/after list is offered')
  assert.doesNotMatch(html, /1 sales: delivery_contact/)
})

test('and in Khmer, from the pack, with the same names', () => {
  assert.ok(km.sale_driver_history_label && km.sale_driver_history_label !== en.sale_driver_history_label && /[ក-៿]/.test(km.sale_driver_history_label))
  assert.ok(km.sale_driver_history_label.includes('{receipt}') && km.sale_driver_history_label.includes('{before}') && km.sale_driver_history_label.includes('{after}'))
  const html = render(km, [driverRow(SAVED)])
  assert.ok(html.includes(km.sale_driver_history_label.replace('{receipt}', 'R2').replace('{before}', 'Driver A').replace('{after}', 'Driver B')), html)
  assert.ok(html.includes(km.sale_bulk_history_details))
})

test('a removed or first driver shows the translated "No driver" on that side', () => {
  const html = render(en, [driverRow({ receipt_number: 'R2', before_name: 'Driver A' })])
  assert.ok(html.includes('Driver of #R2: Driver A → No driver'), html)
  assert.ok(render(km, [driverRow({ receipt_number: 'R2', after_name: 'Driver B' })]).includes(km.no_driver))
})

test('a row saved before the receipt and names were stored keeps its stored label, still with the details list', () => {
  const html = render(en, [driverRow({}, '1 sales: delivery_contact; 0 unchanged')])
  assert.ok(html.includes('1 sales: delivery_contact; 0 unchanged'))
  assert.ok(html.includes(en.sale_bulk_history_details))
})

test('CONTROL: a one-sale customer change is not a grouped row and offers no Affected sales', () => {
  const row = { ...driverRow({}, 'Customer of #R2'), undo_payload: { applier: 'sale.customer.single', snapshot_id: 3, operation_id: 'op', generation: 0, action: 'customer' } }
  assert.doesNotMatch(render(en, [row]), /Affected sales/)
})

test('the details list takes the field from the receipt action\'s kind, not from String(object)', () => {
  assert.match(barSource, /typeof result\.action === 'object' && result\.action \? String\(result\.action\.kind \|\| ''\)/)
  assert.match(barSource, /if \(actionKind === 'delivery_contact'\) return/)
  assert.match(barSource, /if \(actionKind === 'customer'\) return/)
  assert.doesNotMatch(barSource, /if \(action === 'delivery_contact'\)/)
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall driver history bar tests passed')
process.exitCode = failed ? 1 : 0
