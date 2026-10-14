import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import * as costDisplay from '../src/utils/costDisplay.ts'
import { allUnknownCostNote, costTotal, formatCostOrUnknown, isKnownCost, knownCost, partialCostNote } from '../src/utils/costDisplay.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const read = (file: string) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n')
const en: Record<string, string> = JSON.parse(read('../src/lang/en.json'))
const km: Record<string, string> = JSON.parse(read('../src/lang/km.json'))
const t = (key: string) => en[key]
const fmt = (amount: number) => `$${amount.toFixed(2)}`
const UNKNOWN = en.cost_unknown

type Format = (value: unknown, fmt: (amount: number) => string, t: (key: string) => string | undefined) => string
function checkFormat(format: Format) {
  assert.equal(format(0, fmt, t), '$0.00', 'a recorded zero is a real zero')
  assert.equal(format('0', fmt, t), '$0.00', 'a zero stored as text is a real zero')
  assert.equal(format(1.5, fmt, t), '$1.50')
  assert.equal(format(null, fmt, t), UNKNOWN, 'null is unknown, never $0.00')
  assert.equal(format(undefined, fmt, t), UNKNOWN)
  assert.equal(format('', fmt, t), UNKNOWN)
  assert.equal(format('  ', fmt, t), UNKNOWN)
  assert.equal(format(NaN, fmt, t), UNKNOWN)
  assert.equal(format(-1, fmt, t), UNKNOWN)
}
checkFormat(formatCostOrUnknown)
assert.throws(() => checkFormat((value, f) => f(Number(value) || 0)), 'an || 0 formatter turns unknown into $0.00')
assert.throws(() => checkFormat((value, f, tr) => (Number(value) > 0 ? f(Number(value)) : tr('cost_unknown') ?? '')), 'a > 0 formatter turns a real zero into unknown')
assert.throws(() => checkFormat((value, f, tr) => (value == null ? tr('cost_unknown') ?? '' : f(Number(value)))), 'a null-only formatter lets blank text and NaN through')
assert.equal(formatCostOrUnknown(null, fmt, () => undefined), 'Unknown cost', 'inline English fallback when a pack lacks the key')

assert.equal(knownCost(0), 0)
assert.ok(Object.is(knownCost(-0), 0), 'negative zero is normalised')
assert.equal(knownCost('0'), 0)
assert.equal(knownCost('2.5'), 2.5)
assert.equal(knownCost(' 3 '), 3)
for (const bad of ['', '   ', undefined, null, NaN, Infinity, -1, '-1', 'abc', true, false, {}, [], 1e12]) assert.equal(knownCost(bad), null, `knownCost(${String(bad)})`)
assert.equal(isKnownCost(0), true)
assert.equal(isKnownCost(null), false)
assert.equal(isKnownCost(''), false)

assert.deepEqual(costTotal([1, null, 0]), { total: 1, unknown: 1 })
assert.deepEqual(costTotal([null, undefined, '']), { total: null, unknown: 3 }, 'all unknown is unknown, not zero')
assert.deepEqual(costTotal([0, 0]), { total: 0, unknown: 0 }, 'all recorded zeros total a real zero')
assert.deepEqual(costTotal([]), { total: null, unknown: 0 })
assert.deepEqual(costTotal([{ c: 0.1 }, { c: 0.2 }, { c: null }], (row) => row.c), { total: 0.3, unknown: 1 }, 'known rows sum exactly')
assert.deepEqual(costTotal([{ c: '1.2345' }, { c: 2 }], (row) => row.c), { total: 3.2345, unknown: 0 })

assert.equal(partialCostNote(0, t), null)
assert.equal(partialCostNote(3, t), 'Partial — 3 unknown cost')
assert.equal(allUnknownCostNote(3, t), 'Unknown — no cost recorded on 3')
assert.equal(partialCostNote(2, () => undefined), 'Partial — 2 unknown cost')

const NEW_KEYS = [
  'cost_unknown', 'cost_partial_count', 'cost_all_unknown', 'cost_zero_unconfirmed', 'cost_input_unknown_placeholder',
  'stock_value_partial', 'rpt_unknown_cost_lines', 'tg_unknown_cost_suffix', 'conflict_type_unknown_cost',
  'conflict_type_empty_barcode', 'conflict_unknown_cost_catalog', 'conflict_unknown_cost_lots', 'conflict_unknown_cost_held',
  'conflict_enter_cost_hint', 'conflict_confirm_zero', 'conflict_enter_barcode', 'conflict_mark_no_barcode',
  'conflict_issue_saved', 'conflict_issue_queued', 'conflict_cost_permission_needed', 'conflict_cost_already_set',
  'cost_breakdown_excluded_unknown',
]
const placeholders = (text: string) => (text.match(/\{[a-z_]+\}/g) ?? []).sort().join(',')
for (const key of NEW_KEYS) {
  assert.ok(en[key]?.trim(), `en.json has ${key}`)
  assert.ok(km[key]?.trim(), `km.json has ${key}`)
  assert.equal(placeholders(km[key]), placeholders(en[key]), `${key} keeps the same placeholders in both packs`)
}
assert.equal(en.cost_partial_count, 'Partial — {count} unknown cost')
assert.equal(en.conflict_unknown_cost_lots, '{count} received date(s), {units} pcs with unknown cost')
assert.equal('password_min_6' in en || 'password_min_6' in km, false, 'retired keys stay retired')
for (const key of ['merge_cost_fill_hint', 'merge_cost_average_title', 'selected_conflict_group_cost_rule', 'merge_duplicates_what_counts_body']) {
  for (const pack of [en, km]) assert.doesNotMatch(pack[key], /nobody entered|គ្មាននរណាបញ្ចូល/, `${key} no longer teaches the old zero-means-missing rule`)
}
// Owner Q2 (15 Oct, 6.0.438): a $0 lot stays out of the average, so only the fill hint dropped "non-zero".
for (const pack of [en, km]) assert.doesNotMatch(pack.merge_cost_fill_hint, /non-zero|មិនសូន្យ/, 'the fill hint no longer says non-zero')
assert.match(en.merge_cost_fill_hint, /A recorded \$0 is a real cost/)

const source = read('../src/components/shared/CostValue.tsx')
assert.match(source, /from '\.\/ConflictIcon\.ts'/, 'the unknown marker is the shared conflict icon')
assert.match(source, /CONFLICT_ICON_CLASS/)
assert.doesNotMatch(read('../src/utils/costDisplay.ts'), /\|\|\s*0\b|\?\?\s*0\b/, 'no default-to-zero in the cost helpers')

function renderCost(props: Record<string, unknown>): string {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} as { default: React.ComponentType<Record<string, unknown>> } }
  const mockedRequire = (id: string) => {
    if (id === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime')
    if (id.includes('ConflictIcon')) return { ConflictIcon: (p: Record<string, unknown>) => React.createElement('svg', { 'data-conflict-icon': 'true', className: p.className }), CONFLICT_ICON_CLASS: 'conflict-class' }
    if (id.includes('costDisplay')) return costDisplay
    throw new Error(`Unexpected dependency: ${id}`)
  }
  new Function('require', 'module', 'exports', code)(mockedRequire, module, module.exports)
  return renderToStaticMarkup(React.createElement(module.exports.default, { fmt, t, ...props }))
}

const zero = renderCost({ value: 0 })
assert.match(zero, />\$0\.00</)
assert.doesNotMatch(zero, /data-conflict-icon|Unknown cost/, 'a recorded zero is not flagged')
const missing = renderCost({ value: null })
assert.match(missing, /data-conflict-icon/)
assert.match(missing, />Unknown cost</)
assert.doesNotMatch(missing, /\$0\.00/, 'unknown is never printed as $0.00')
const partial = renderCost({ value: 12.5, unknownCount: 2 })
assert.match(partial, />\$12\.50</)
assert.match(partial, /Partial — 2 unknown cost/)
const allUnknown = renderCost({ value: null, unknownCount: 3 })
assert.match(allUnknown, />Unknown cost</)
assert.match(allUnknown, /title="Unknown — no cost recorded on 3"/)
assert.doesNotMatch(allUnknown, /\$0\.00/)
assert.doesNotMatch(renderCost({ value: 5 }), /Partial/, 'no chip without unknown rows')

console.log('PASS cost display: zero is real, null is unknown, totals are partial, keys paired in both packs')
