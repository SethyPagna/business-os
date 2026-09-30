// MERGE-UNBLOCK: a merge closes the Undo of a stock-in session that touches the
// merged products. History must say why the row has no Undo ("Undo closed:
// products were merged"), in both packs, and only on that row: an ordinary
// recorded row keeps the plain "Recorded" word.
//
// ActionHistoryBar is rendered for real (its menu shell and select stubbed so the
// run stays a plain node one) with the row list open, because the status word
// lives inside the menu and a source-text pin would pass with the branch deleted.
//
// Run: node tests/actionHistoryUndoClosedLabel.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

type AnyProps = Record<string, any>

function loadBar(): React.ComponentType<AnyProps> {
  const source = readFileSync(new URL('../src/components/shared/ActionHistoryBar.tsx', import.meta.url), 'utf8')
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
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

const MARKER = 'undo_closed:products_merged'
const row = (id: number, label: string, patch: Record<string, unknown> = {}) => ({ id, label, status: 'recorded', ...patch })
const render = (pack: Record<string, string>, serverItems: unknown[]) => renderToStaticMarkup(React.createElement(Bar, {
  t: (key: string) => pack[key],
  history: {
    undoItems: [], redoItems: [], serverItems, canUndo: false, canRedo: false, undo: () => {}, redo: () => {}, busy: false,
  },
}))

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

test('a recorded session row carrying the merge marker says Undo closed, in English', () => {
  const html = render(en, [row(1, 'Stock-in session A', { last_error: MARKER, reversible: 0 })])
  assert.match(html, /Undo closed: products were merged/)
  assert.doesNotMatch(html, />Recorded</, 'the closed row is not described as merely recorded')
})

test('and in Khmer, from the pack', () => {
  assert.ok(km.history_undo_closed_merged, 'km pack has the key')
  assert.notEqual(km.history_undo_closed_merged, en.history_undo_closed_merged)
  const html = render(km, [row(1, 'Stock-in session A', { last_error: MARKER })])
  assert.ok(html.includes(km.history_undo_closed_merged))
})

test('CONTROL: an ordinary recorded row, and a row with some other last_error, keep the plain word', () => {
  const html = render(en, [row(2, 'Sale 1001'), row(3, 'Transfer 7', { last_error: 'something else' })])
  assert.doesNotMatch(html, /Undo closed/)
  assert.equal((html.match(/>Recorded</g) || []).length, 2)
})

test('CONTROL: the marker on a row that is still undoable is not shown as closed (only a recorded row is)', () => {
  const html = render(en, [row(4, 'Stock-in session B', { status: 'undoable', last_error: MARKER })])
  assert.doesNotMatch(html, /Undo closed/)
})

console.log(failed ? `\n${failed} test(s) failed` : '\nall action history undo-closed label tests passed')
process.exitCode = failed ? 1 : 0
