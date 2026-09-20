// P3-2: clicking an invoice row opens a FLOAT with that invoice's details and
// its sections.
//
// User: "i meant float when clicked on the invoice rows click to view details
// and sections etc...". Before this, the AP and AR ledgers had no per-invoice
// view at all (a row was a dead end) and the Stock-In ledger pushed its product
// lines INLINE, shoving the rest of the list down the page.
//
// Two halves are pinned here, because each one alone passes on broken code:
//
//   1. The shell. InvoiceDetailFloat is rendered for real (Modal and CopyableId
//      stubbed so the check stays a plain node run) and must produce every
//      section, every fact label and every fact value on its FIRST render --
//      the standing rule that a float never opens as a stub that fills in once
//      some prerequisite is answered -- with exactly one close affordance.
//   2. The wiring. Each of the four invoice lists must hold a null detail slot,
//      set it from a row click, and render the float only when the slot is
//      filled. A shell nobody opens would otherwise pass half 1 forever.
//
// Run: node tests/contactsInvoiceRowFloat.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import ts from 'typescript'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

const read = (file: string): string =>
  readFileSync(new URL(`../src/components/contacts/${file}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n')

// --- 1. the shell renders its real content from the first paint --------------

type AnyProps = Record<string, any>

function loadFloat(): React.ComponentType<AnyProps> {
  const compiled = transformSync(read('InvoiceDetailFloat.tsx'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  // Modal portals into document.body and CopyableId registers global copy
  // affordances; both are exercised by their own tests. Stubbing them keeps
  // this a DOM-free run while still proving what THIS component renders.
  const shim = (id: string): unknown => {
    if (id.includes('shared/Modal')) {
      return {
        __esModule: true,
        default: ({ title, onClose, children, layer, wide }: AnyProps) => React.createElement(
          'div',
          {
            'data-modal': 'true',
            'data-title': String(title),
            'data-close': typeof onClose === 'function' ? 'wired' : 'missing',
            'data-layer': layer || 'default',
            'data-wide': wide ? 'true' : 'false',
          },
          children,
        ),
      }
    }
    if (id.includes('CopyableId')) {
      return {
        __esModule: true,
        default: ({ value, copyLabel }: AnyProps) => React.createElement(
          'span',
          { 'data-copyable-id': 'true', 'data-copy-value': String(value), 'aria-label': String(copyLabel) },
          String(value),
        ),
      }
    }
    return nodeRequire(id)
  }
  new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
  return mod.exports.default as React.ComponentType<AnyProps>
}

const InvoiceDetailFloat = loadFloat()
const html = renderToStaticMarkup(React.createElement(InvoiceDetailFloat, {
  t: (key: string) => (key === 'copy' ? 'Copy' : key === 'copied' ? 'Copied' : undefined),
  onClose: () => {},
  title: 'Invoice details -- Acme Supply',
  idLabel: 'Invoice #',
  idValue: 'INV-2026-0042',
  badge: React.createElement('span', null, 'Not Yet Paid'),
  sections: [
    {
      key: 'document',
      title: 'Details',
      facts: [
        { key: 'invoice_date', label: 'Invoice date', value: '03/09/2026' },
        { key: 'supplier', label: 'Supplier', value: 'Acme Supply' },
      ],
    },
    {
      key: 'amounts',
      title: 'Amounts',
      facts: [{ key: 'total', label: 'Total', value: '$120.00' }],
    },
    { key: 'lines', title: 'Lines', note: 'This document carries no product lines.' },
  ],
}))

assert.match(html, /data-modal="true"/, 'the detail view is a float, not an inline expander')
assert.match(html, /data-title="Invoice details -- Acme Supply"/, 'the float names the invoice it belongs to')
assert.equal((html.match(/data-close="wired"/g) || []).length, 1, 'exactly one close affordance -- the shared header X')
assert.doesNotMatch(html, />\s*Close\s*</, 'no second Close dressed as a footer action')
for (const text of ['Details', 'Amounts', 'Lines', 'Invoice date', '03/09/2026', 'Supplier', 'Acme Supply', 'Total', '$120.00', 'This document carries no product lines.', 'Not Yet Paid']) {
  assert.ok(html.includes(text), `first paint must already contain "${text}" -- a float never opens as a stub`)
}
assert.match(html, /data-copyable-id="true"[^>]*data-copy-value="INV-2026-0042"/, 'the invoice id is shown in full and copyable')
assert.equal((html.match(/<dt/g) || []).length, 3, 'every fact label is a description term')
assert.equal((html.match(/<dd/g) || []).length, 3, 'every fact value is a description detail')
// Khmer glyphs stack marks above and below the base letter; a line box sized to
// Latin text clips them, so the fact rows declare explicit line heights.
assert.match(html, /<dt[^>]*class="[^"]*leading-5/, 'fact labels reserve vertical room for Khmer marks')
assert.match(html, /<dd[^>]*class="[^"]*leading-6/, 'fact values reserve vertical room for Khmer marks')

// A float that renders nothing would satisfy several of the checks above by
// omission, so confirm the instrument reacts to content it was not given.
assert.ok(!html.includes('Barcode'), 'positive control: the render only contains the sections it was handed')

console.log('PASS the invoice detail float renders every section, fact and id on first paint with one close affordance')

// --- 2. every invoice list opens it from a row click -------------------------

const parse = (source: string) => ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(source: string, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = []
  const visit = (node: ts.Node) => { if (predicate(node)) found.push(node); ts.forEachChild(node, visit) }
  visit(parse(source))
  return found
}
function variable(source: string, name: string): string {
  const node = find(source, (node) => ts.isVariableDeclaration(node) && node.name.getText() === name)[0] as ts.VariableDeclaration
  assert.ok(node?.initializer, `production variable ${name} exists`)
  return node.initializer.getText()
}
function evaluate(code: string, context: Record<string, unknown> = {}) {
  const compiled = transformSync(`return (${code})`, { loader: 'tsx', format: 'cjs' }).code
  return new Function(...Object.keys(context), compiled)(...Object.values(context))
}
/** Run the production `const [x, setX] = useState(...)` declaration for real. */
function stateCell(source: string, declaration: string) {
  let current: unknown
  const useState = (initializer: unknown) => {
    current = typeof initializer === 'function' ? (initializer as () => unknown)() : initializer
    return [current, (next: unknown) => { current = next }]
  }
  const [initial, set] = evaluate(variable(source, declaration), { useState })
  return { initial, set: set as (next: unknown) => void, current: () => current }
}

const surfaces = [
  { file: 'ApInvoicesSection.tsx', cell: '[detail, setDetail]', opener: 'setDetail(row)' },
  { file: 'ArInvoicesSection.tsx', cell: '[detail, setDetail]', opener: 'setDetail(row)' },
  { file: 'StockInInvoicesSection.tsx', cell: '[detailGroup, setDetailGroup]', opener: 'openGroup(group)' },
  { file: 'SupplierPurchasesModal.tsx', cell: '[detailBatch, setDetailBatch]', opener: 'setDetailBatch(batch)' },
] as const

for (const surface of surfaces) {
  const source = read(surface.file)
  assert.match(source, /import InvoiceDetailFloat from '\.\/InvoiceDetailFloat\.tsx'/, `${surface.file}: uses the shared float, not a private copy`)

  if (surface.file === 'StockInInvoicesSection.tsx') {
    const hook = read('useStockInInvoiceReport.ts')
    let view = evaluate(variable(hook, 'emptyView'))()
    assert.equal(view.detailGroup, null, 'Stock-In starts with no float')
    const row = { supplier_key: 'id:1', received_day: '2026-09-20' }
    const requests: unknown[] = []
    const update = (fn: (v: any) => any) => { view = fn(view) }
    evaluate(variable(hook, 'openGroup'), { current: () => true, update, view,
      groupKeyOf: (g: typeof row) => `${g.supplier_key}|${g.received_day}`,
      loadLines: (...args: unknown[]) => requests.push(args),
    })(row)
    assert.equal(view.detailGroup, row, 'executed hook opens the clicked invoice')
    assert.deepEqual(requests, [[row, 1]], 'opening uncached invoice loads its first page')
    const close = find(hook, n => ts.isPropertyAssignment(n) && n.name.getText() === 'closeGroup')[0] as ts.PropertyAssignment
    evaluate(close.initializer.getText(), { update })()
    assert.equal(view.detailGroup, null, 'executed close clears the selected invoice')
  } else {
    const cell = stateCell(source, surface.cell)
    assert.equal(cell.initial, null, `${surface.file}: the list opens with no float`)
  }

  // The row's own click handler, executed. A grep for the component name would
  // pass on a float that nothing can open.
  assert.ok(
    source.includes(`onClick={() => ${surface.opener}}`),
    `${surface.file}: a row click must open the detail float (looked for onClick={() => ${surface.opener}})`,
  )

  // ...and the float is rendered only while that slot is filled. Compared by
  // position rather than by a bounded regex: Stock-In computes its line state
  // inside the guard before reaching the element.
  const slot = surface.cell.slice(1).split(',')[0].trim()
  const guard = source.indexOf(`{${slot} ? `)
  const element = source.indexOf('<InvoiceDetailFloat')
  assert.ok(guard >= 0, `${surface.file}: the float must be guarded by the ${slot} slot`)
  assert.ok(element > guard, `${surface.file}: the float must render inside the ${slot} guard, never unconditionally`)
  assert.match(source, surface.file === 'StockInInvoicesSection.tsx' ? /onClose=\{closeGroup\}/ : /onClose=\{\(\) => set\w+\(null\)\}/, `${surface.file}: closing the float clears its slot`)
}

// The four ledgers must also stop hiding their rows behind a sideways scroll
// on a phone: the wide table is large-screen only and a wrapped card list takes
// its place below md, both opening the same float.
//
// P10-15 (owner: "the supplier display is not consistent like excel style in
// large screens") brought StockInInvoicesSection into this same table/card
// split, matching its AP-invoices sibling -- it used to be the one ledger with
// no sideways-scroll table (a bare stacked list of buttons at every width),
// which is why an earlier version of this test pinned it as a "positive
// control" that must NOT match md:hidden. That control is stale now that the
// rule applies to all four surfaces; folding it into the same sweep instead of
// carving it out.
for (const file of ['ApInvoicesSection.tsx', 'ArInvoicesSection.tsx', 'SupplierPurchasesModal.tsx', 'StockInInvoicesSection.tsx']) {
  const source = read(file)
  assert.match(source, /className="hidden [^"]*\bmd:block\b/, `${file}: the wide ledger table is large-screen only`)
  assert.match(source, /className="space-y-2 md:hidden"/, `${file}: the phone gets a wrapped card list instead`)
}

// A row opens the float and does NOTHING else. The owner asked for this
// twice -- "the invoice is doing click to expand. instead it should be click
// to open view detail float" -- so the inline expanded region is gone, not
// merely hidden beside the float: no aria-expanded on the row, no second
// place that renders the same lines, and no `expanded` open/closed state
// left to drift out of sync with what the float shows.
for (const file of ['StockInInvoicesSection.tsx', 'ApInvoicesSection.tsx', 'ArInvoicesSection.tsx', 'SupplierPurchasesModal.tsx']) {
  const source = read(file)
  assert.doesNotMatch(source, /aria-expanded/, `${file}: a row announces a dialog, never an expanded region`)
  assert.doesNotMatch(source, /const \[expanded, setExpanded\]/, `${file}: no inline expand state survives`)
  assert.doesNotMatch(source, /toggleGroup|toggleRow|toggleInvoice/, `${file}: a row has no toggle -- it opens the float`)
  // The invoice LINES may only be rendered inside the float. Measured against
  // the float GUARD rather than the element, because Stock-In computes its
  // line state inside the guard before reaching the element. AP/AR's own
  // ledger table is not invoice lines, which is why only line markers count.
  const float = source.indexOf('<InvoiceDetailFloat')
  const guard = source.search(/\{detail\w* \? /)
  assert.ok(float >= 0 && guard >= 0 && guard < float, `${file}: renders the shared float behind its own slot guard`)
  for (const marker of ['linesState', '.lines.map(']) {
    const at = source.indexOf(marker)
    if (at < 0) continue
    assert.ok(at > guard, `${file}: "${marker}" renders the invoice's lines outside the float -- the inline expand is back`)
  }
}

// Positive control: the float itself is what holds the lines, so the Stock-In
// lines table and its pager must genuinely be inside it (an assertion that
// only ever says "no inline block" would pass on a section with no lines at
// all).
{
  const stockIn = read('StockInInvoicesSection.tsx')
  const float = stockIn.indexOf('<InvoiceDetailFloat')
  // P10-15 gave the OUTER invoice-group table (large-screen list, before the
  // float) the same `data-invoice-ledger-scroll` marker as a styling match for
  // its AP-invoices sibling, so a bare indexOf now finds that first, unrelated
  // occurrence instead of the lines table inside the float. Searching from the
  // float's own position keeps the property this control actually checks: the
  // lines table (its second, inner occurrence) still lives inside the float.
  assert.ok(stockIn.indexOf('data-invoice-ledger-scroll', float) > float, 'the Stock-In lines table is the float\'s content')
  assert.ok(stockIn.indexOf('loadLines(detailGroup, nextPage)') > float, 'and its line pager pages the lines inside the float')
  assert.match(read('useStockInInvoiceReport.ts'), /lineCache: Record<string, LinesState>/, 'the scoped per-group line cache is named for what it is, not for an expand that no longer exists')
}

console.log(`PASS ${surfaces.length} invoice lists open the shared float from a row click and clear it on close`)
