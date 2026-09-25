// Owner, 25 Sep 2026 (Products page): opening a specific record "goes back to
// the default view instead of showing that record, with no before/after".
//
// Root cause: the product detail sheet rendered its child floats (Field
// history = the Records float, the cost calculation, the description reader)
// INSIDE its backdrop <div onClick={onClose}>. Each float is a portal, so in
// the DOM it sits elsewhere -- but React bubbles synthetic events through the
// COMPONENT tree. Pressing a record row therefore also ran the sheet's
// onClose: the sheet unmounted and took the float (and the before/after the
// row was about to show) with it.
//
// The rule this file pins, as a structural sweep over every component: a
// backdrop that closes on click must not have a float/modal/dialog component
// among its descendants unless something in between stops the click (the
// panel's own `onClick={(event) => event.stopPropagation()}`). Floats belong
// BESIDE the backdrop, the shape Inventory's ProductDetailModal and POS's
// ProductDetailSheet already use.
//
// It is a real parse (TypeScript's own JSX AST), not a regex, and it carries
// its positive control: the pre-fix sheet, verbatim in shape, must be caught.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const componentsRoot = path.join(here, '..', 'src', 'components')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const FLOAT_TAG = /(Float|Modal|Dialog)$/

function attribute(element: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
  )
}

/** Floats reachable from a closing backdrop without crossing a click-stopper. */
function floatsInsideClosingBackdrops(fileName: string, source: string): Array<{ line: number; floats: string[] }> {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: Array<{ line: number; floats: string[] }> = []
  const collect = (node: ts.Node, into: string[]): void => {
    if (ts.isJsxElement(node) && /stopPropagation/.test(attribute(node.openingElement, 'onClick')?.getText() || '')) return
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && FLOAT_TAG.test(node.tagName.getText())) into.push(node.tagName.getText())
    ts.forEachChild(node, (child) => collect(child, into))
  }
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const className = attribute(node.openingElement, 'className')?.getText() || ''
      if (/fixed inset-0/.test(className) && attribute(node.openingElement, 'onClick')) {
        const floats: string[] = []
        node.children.forEach((child) => collect(child, floats))
        if (floats.length) found.push({ line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, floats })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

function componentFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return componentFiles(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

runTest('positive control: the pre-fix product sheet shape is caught', () => {
  const preFix = `
    export default function Sheet({ onClose, open }) {
      return (
        <div className="modal-viewport-safe fixed inset-0 z-[1050]" onClick={onClose}>
          <div className="panel" onClick={(event) => event.stopPropagation()}>
            <ProductDetailReport />
          </div>
          {open ? <EntityRecordsFloat onClose={onClose} /> : null}
          {open ? <CostCalculationFloat onClose={onClose} /> : null}
        </div>
      )
    }`
  const hits = floatsInsideClosingBackdrops('pre-fix.tsx', preFix)
  assert.equal(hits.length, 1)
  assert.deepEqual(hits[0].floats, ['EntityRecordsFloat', 'CostCalculationFloat'])
})

runTest('negative control: floats inside the stopPropagation panel, or beside the backdrop, pass', () => {
  const fixed = `
    export default function Sheet({ onClose, open }) {
      return (
        <>
          <div className="fixed inset-0" onClick={onClose}>
            <div className="panel" onClick={(event) => event.stopPropagation()}>
              <AttributeSupplierModal />
            </div>
          </div>
          {open ? <EntityRecordsFloat onClose={onClose} /> : null}
        </>
      )
    }`
  assert.deepEqual(floatsInsideClosingBackdrops('fixed.tsx', fixed), [])
})

runTest('the product detail sheet renders its floats beside its backdrop', () => {
  const file = path.join(componentsRoot, 'products', 'surfaces', 'ProductDetailModal.tsx')
  const source = fs.readFileSync(file, 'utf8')
  assert.deepEqual(floatsInsideClosingBackdrops(file, source), [])
  // ...and it still HAS them -- an empty sweep over a sheet that lost its
  // floats would pass for the wrong reason.
  for (const float of ['<EntityRecordsFloat', '<CostCalculationFloat', '<ProductDescriptionDetailModal']) {
    assert.ok(source.includes(float), `${float} must still be rendered by the product sheet`)
  }
})

runTest('the description reader stacks above the sheet it now sits beside', () => {
  const source = fs.readFileSync(path.join(componentsRoot, 'products', 'surfaces', 'ProductDescriptionDetailModal.tsx'), 'utf8')
  assert.match(source, /fixed inset-0 z-\[1070\]/, 'a body-level sibling of a z-[1050] sheet needs the nested layer, not z-[60]')
})

// The same defect, found by this sweep in files outside this lane (they are
// owned elsewhere, or by the cost lane, and are reported rather than edited).
// Each hosts a ConfirmDialog inside a backdrop whose onClick asks to close the
// work surface, so a press in the confirm also runs that close request. The
// list is a ratchet: fixing one must remove it from here, and a NEW offender
// fails the test.
const KNOWN_OFFENDERS = [
  'branches/TransferModal.tsx',
  'inventory/FastStockInModal.tsx',
  'inventory/ReceiveBatchModal.tsx',
]

runTest('no other closing backdrop hosts a float that its clicks would close', () => {
  const offenders = componentFiles(componentsRoot)
    .filter((file) => floatsInsideClosingBackdrops(file, fs.readFileSync(file, 'utf8')).length > 0)
    .map((file) => path.relative(componentsRoot, file).split(path.sep).join('/'))
    .sort()
  assert.deepEqual(offenders, KNOWN_OFFENDERS)
})

if (failed) {
  console.error(`\n${failed} overlay-bubbling test(s) failed`)
  process.exit(1)
}
console.log('PASS overlayNestedFloatBubbling')
