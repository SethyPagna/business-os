// The picker option holds the shift header row inside a <button> (board item shiftf3, F8): a button allows phrasing
// content only, so the row there is the span-based variant of the SAME component (one source of truth), with the same
// four values in one wrapping row and the ID never truncated.
//
// Run: node tests/shiftHeaderRowInline.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { transformSync } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const formatters = nodeRequire('../src/utils/formatters.ts')

function load(source: string): any {
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  const shim = (id: string): unknown => {
    if (id.includes('AppContext')) return { useApp: () => ({ t: (key: string) => key }) }
    if (id.includes('formatters')) return formatters
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports
}

const SOURCE = read('../src/components/shifts/ShiftHeaderRow.tsx')
const CODE = 'S-20261122-0807-Za'
const shift = { business_date: '2026-11-22', shift_code: CODE, user_name: 'Za', branch_name: 'LC Store', branch_active: true }
const row = (props: Record<string, unknown>, source = SOURCE) =>
  renderToStaticMarkup(React.createElement(load(source).default, { shift, ...props }, React.createElement('span', null, 'Closed late')))
const BLOCK = /<(div|p|ul|ol|li|table|section|header|footer|h[1-6])[\s>]/

function optionMarkup(props: Record<string, unknown>, source = SOURCE): string {
  // The option the picker draws: button > span > node, exactly as SuggestionTextInput nests it.
  return renderToStaticMarkup(React.createElement('button', { type: 'button' }, React.createElement('span', null,
    React.createElement(load(source).default, { shift, ...props }, React.createElement('span', null, 'Closed late')))))
}

function inlineRow(source = SOURCE) {
  const html = optionMarkup({ inline: true }, source)
  assert.ok(!BLOCK.test(html), 'the rendered option holds no block element')
  return html
}

test('the picker option holds no block element', () => { inlineRow() })

test('the four values and the tag still sit in one wrapping row, the ID whole', () => {
  const html = inlineRow()
  const at = html.indexOf(CODE)
  assert.ok(at > 0, 'the ID is rendered')
  const start = html.lastIndexOf('<span class="-ml-3 flex', at)
  assert.ok(start > 0, 'the four values sit in one flex container')
  const box = html.slice(start, html.indexOf('Closed late'))
  assert.match(box, /^<span class="[^"]*\bflex\b[^"]*\bflex-wrap\b/, 'a wrapping flex row')
  for (const value of ['22/11/2026', CODE, '>Za<', '>LC Store<']) assert.ok(box.includes(value), `${value} is in that one row`)
  const idSpan = html.match(new RegExp(`<span class="([^"]*)">${CODE}</span>`))
  assert.ok(idSpan && !/\btruncate\b|text-ellipsis/.test(idSpan[1]), 'the ID is never truncated')
  assert.ok(html.includes('Closed late'), 'the tag is kept')
})

test('the default row is still the block row (one component, two element kinds)', () => {
  assert.match(row({}), /^<div class="flex min-w-0 items-start/)
  assert.ok(BLOCK.test(row({})))
})

test('the Reports picker asks for the inline row', () => {
  assert.match(read('../src/components/sales/reports/ShiftReport.tsx'), /<ShiftHeaderRow shift=\{row\} inline>/)
})

test('mutant: the inline variant still drawing divs fails the no-block test', () => {
  const mutant = SOURCE.replace("const Box = inline ? 'span' : 'div'", "const Box = 'div'")
  assert.notEqual(mutant, SOURCE, 'the mutant target exists')
  assert.throws(() => inlineRow(mutant), /no block element/)
})
