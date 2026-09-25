// U-records (owner, 25 Sep 2026): opening a stock-in record line "goes back
// to the default view ... with no before/after".
//
// Two defects on the Stock-in Sessions surface, both pinned here:
//   1. The line's detail rendered INLINE at the top of the session modal. On a
//      phone the operator taps a row far down the list, the panel opens far
//      above it, and nothing visibly happens. It is now its own float
//      (a Modal) rendered BESIDE the session modal, never inside it.
//   2. The line carried no before/after at all. The Worker now returns the
//      stock before -> after the receipt (cloudflare/scripts/
//      test-stock-in-line-balance-pure.cjs) and the line's figures as
//      received; the float shows both, and an edited line's costs only to a
//      cost viewer.
// Real TypeScript JSX parse, not a regex over the markup.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const file = path.join(here, '..', 'src', 'components', 'products', 'StockInSessionsSection.tsx')
const source = fs.readFileSync(file, 'utf8')
const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const en = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'en.json'), 'utf8')) as Record<string, string>
const km = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', 'km.json'), 'utf8')) as Record<string, string>

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function jsxElements(tag: string): ts.JsxElement[] {
  const found: ts.JsxElement[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === tag) found.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}
function titleOf(element: ts.JsxElement): string {
  const title = element.openingElement.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === 'title')
  return title ? title.getText() : ''
}
function hasModalAncestor(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === 'Modal') return true
  }
  return false
}
function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} exists`)
  const end = /\r?\n\}\r?\n/.exec(source.slice(start))
  assert.ok(end, `${name} has a closing brace`)
  return source.slice(start, start + end.index)
}

const lineModal = jsxElements('Modal').find((element) => titleOf(element).includes('selectedLine.product_name'))

runTest('a line opens as its own float', () => {
  assert.ok(lineModal, 'the selected line renders through a Modal titled with its product')
})

runTest('the line float is a sibling of the session modal, not inline inside it', () => {
  assert.equal(hasModalAncestor(lineModal!), false)
  // The old inline panel carried its own "Close" button inside the session modal.
  assert.doesNotMatch(source, /onClick=\{\(\) => setSelectedLine\(null\)\}>\{tr\('close'/)
})

runTest('the float leads with stock before -> after and the as-received -> now change', () => {
  const float = lineModal!.getText()
  assert.match(float, /<StockInLineChange row=\{selectedLine\}/)
  const block = functionBody('StockInLineChange')
  for (const field of ['row.before_qty', 'row.after_qty', 'row.received_quantity', 'row.received_unit_cost_usd', 'row.received_total_cost_usd']) {
    assert.ok(block.includes(field), `the change block reads ${field}`)
  }
  assert.match(block, /tr\('before_qty', 'Before'\)/)
  assert.match(block, /tr\('after_qty', 'After'\)/)
})

runTest('an edited line shows its costs only to a cost viewer', () => {
  const block = functionBody('StockInLineChange')
  const costs = block.indexOf('received_unit_cost_usd')
  const guard = block.lastIndexOf('canViewCosts ?', costs)
  assert.ok(guard >= 0 && guard < costs, 'the as-received cost rows sit behind canViewCosts')
  assert.match(source, /<StockInLineChange row=\{selectedLine\} canViewCosts=\{canViewCosts\}/)
})

runTest('a missing balance or cost reads as a dash, never a guessed zero', () => {
  assert.match(functionBody('formatQty'), /value == null \|\| value === ''\) return '—'/)
  assert.match(functionBody('formatRecordedUsd'), /value == null \|\| value === '' \? '—'/)
})

runTest('both language packs carry the new labels, and km is not English', () => {
  for (const key of ['stock_in_line_changed_since', 'stock_in_line_as_received', 'stock_in_line_now', 'before_qty', 'after_qty']) {
    assert.ok(en[key], `en.${key}`)
    assert.ok(km[key], `km.${key}`)
    assert.notEqual(km[key], en[key], `km.${key} is translated`)
  }
})

if (failed) { console.error(`\n${failed} stock-in line detail test(s) failed`); process.exit(1) }
console.log('PASS stockInLineRecordDetail')
