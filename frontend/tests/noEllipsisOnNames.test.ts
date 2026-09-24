// A business name is never cut off with an ellipsis. It scrolls sideways.
//
// Owner, 22 Sep 2026: "product names are using elipses when too long, remember
// we don't do that. we do scroll left and right". The Reports surface was
// fixed on its own; a verifier then found the same class open on every sibling
// list, card, picker, modal header and history row. This test closes the class
// and keeps it closed.
//
// The one app-wide scroller is `.detail-scroll-text` (styles/main.css): one
// line, `overflow-x: auto`, `text-overflow: clip`, momentum scrolling on iOS,
// and a Khmer line-height floor because its `overflow-y: hidden` would
// otherwise shear every coeng subscript. No second helper was invented.
//
// THE INSTRUMENT IS THE POINT. A first version of this file matched
// `className="...truncate..."` followed immediately by `{value}` with a regex,
// and it was blind three ways at once: a template-literal or computed
// className was invisible, a value one element deeper than the clipping box
// was invisible, and the pin list was hand-written, so reverting a conversion
// the list did not happen to name stayed green. What follows parses the JSX
// instead -- every className form, every descendant expression -- and walks
// EVERY file this lane touched rather than a curated sample. Three controls at
// the bottom prove it fails when it should.
//
// Run: node tests/noEllipsisOnNames.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(String((error as Error).message))
  }
}

function read(relative: string): string {
  return fs.readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

// ---------------------------------------------------------------------------
// The instrument: a small JSX tag scanner
// ---------------------------------------------------------------------------

/** JSX is written across lines; flatten it and drop comments so prose about
 *  truncation is never mistaken for a truncating element. */
function flatten(source: string): string {
  return source
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
}

/** Index just past the string (or template literal) that starts at `i`. */
function skipString(source: string, i: number): number {
  const quote = source[i]
  let at = i + 1
  while (at < source.length) {
    const char = source[at]
    if (char === '\\') { at += 2; continue }
    if (char === quote) return at + 1
    if (quote === '`' && char === '$' && source[at + 1] === '{') { at = skipBraces(source, at + 1); continue }
    at += 1
  }
  return at
}

/** Index just past the `{...}` that starts at `i`, strings and nesting aside. */
function skipBraces(source: string, i: number): number {
  let depth = 0
  let at = i
  while (at < source.length) {
    const char = source[at]
    if (char === '"' || char === "'" || char === '`') { at = skipString(source, at); continue }
    if (char === '{') { depth += 1; at += 1; continue }
    if (char === '}') { depth -= 1; at += 1; if (depth === 0) return at; continue }
    at += 1
  }
  return at
}

interface Tag { name: string; closing: boolean; selfClosing: boolean; start: number; end: number; attrs: string }

/** Parse the tag that starts at `i`. Attribute values are skipped as whole
 *  strings/braces, so an arrow function (`onClick={() => a > b}`) cannot end
 *  the tag early -- the bug that makes a naive `<[^>]*>` regex lie. */
function parseTag(source: string, i: number): Tag | null {
  let at = i + 1
  const closing = source[at] === '/'
  if (closing) at += 1
  const name = /^[A-Za-z][\w.$]*/.exec(source.slice(at, at + 80))?.[0]
  if (!name) return null
  at += name.length
  const attrStart = at
  while (at < source.length) {
    const char = source[at]
    if (char === '>') return { name, closing, selfClosing: false, start: i, end: at + 1, attrs: source.slice(attrStart, at) }
    if (char === '/' && source[at + 1] === '>') return { name, closing, selfClosing: true, start: i, end: at + 2, attrs: source.slice(attrStart, at) }
    if (char === '"' || char === "'" || char === '`') { at = skipString(source, at); continue }
    if (char === '{') { at = skipBraces(source, at); continue }
    at += 1
  }
  return null
}

/** Every static string a className expression can contribute, whichever shape
 *  it is written in: `"a b"`, `{`a ${x} b`}`, `{cx('a', cond && 'b')}`,
 *  `{cond ? 'a' : 'b'}`. Anything interpolated is another expression, so its
 *  own literals are collected too. */
function staticStrings(expression: string): string[] {
  const out: string[] = []
  let at = 0
  while (at < expression.length) {
    const char = expression[at]
    if (char === '"' || char === "'") {
      const end = skipString(expression, at)
      out.push(expression.slice(at + 1, end - 1))
      at = end
      continue
    }
    if (char === '`') {
      let scan = at + 1
      let literal = ''
      while (scan < expression.length) {
        const inner = expression[scan]
        if (inner === '\\') { scan += 2; continue }
        if (inner === '`') { scan += 1; break }
        if (inner === '$' && expression[scan + 1] === '{') {
          const end = skipBraces(expression, scan + 1)
          out.push(...staticStrings(expression.slice(scan + 2, end - 1)))
          literal += ' '
          scan = end
          continue
        }
        literal += inner
        scan += 1
      }
      out.push(literal)
      at = scan
      continue
    }
    at += 1
  }
  return out
}

/** The class text of an attribute list, plus -- for the one helper in this
 *  codebase that passes classes as an argument -- the value it is printing.
 *  `<div {...getKhmerTextProps(item.batch_label, 'truncate ...')}>` clips a
 *  value just as surely as a className does. */
function classInfo(attrs: string, attributeName = 'className'): { classText: string; helperValue?: string } {
  const helper = /getKhmerTextProps\(\s*([\s\S]*?),\s*(['"`])/.exec(attrs)
  if (helper && attributeName === 'className') {
    const from = attrs.indexOf(helper[2], helper.index + helper[0].length - 1)
    const end = skipString(attrs, from)
    return { classText: staticStrings(attrs.slice(from, end)).join(' '), helperValue: helper[1].trim() }
  }
  const match = new RegExp(`(^|\\s)${attributeName}\\s*=\\s*`).exec(attrs)
  if (!match) return { classText: '' }
  const valueAt = match.index + match[0].length
  const char = attrs[valueAt]
  if (char === '"' || char === "'") return { classText: attrs.slice(valueAt + 1, skipString(attrs, valueAt) - 1) }
  if (char === '{') return { classText: staticStrings(attrs.slice(valueAt + 1, skipBraces(attrs, valueAt) - 1)).join(' ') }
  return { classText: '' }
}

/** A standalone `truncate`. `sm:truncate` wraps below sm -- the narrow screen,
 *  where the text is still fully readable. `dense-cell-truncate` is a SECOND
 *  clip site with the same `text-overflow: ellipsis`, and it is audited by its
 *  own whitelist in section 5 -- for one checkpoint it was audited by nothing
 *  at all, which is how sixteen per-record values on four dense tables went on
 *  being cut while this file reported green. */
export function hasBareTruncate(classText: string): boolean {
  return classText.split(/\s+/).includes('truncate')
}

/** The dense-table clip site. Same ellipsis, different class. */
export function hasDenseCellTruncate(classText: string): boolean {
  return classText.split(/\s+/).includes('dense-cell-truncate')
}

/** Every .tsx under src/components, keyed the way `read()` takes them. */
function walkComponents(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`); continue }
      if (!/\.tsx$/.test(entry.name)) continue
      out.push([`${prefix}${entry.name}`, fs.readFileSync(new URL(entry.name, dir), 'utf8').replace(/\r\n/g, '\n')])
    }
  }
  walk(new URL('../src/components/', import.meta.url), 'components/')
  return out
}

/** Every expression printed as a CHILD of the element whose content starts at
 *  `from` -- at any depth, not just the first child. Attribute expressions are
 *  stepped over with the tag, so `title={x}` is never mistaken for content. */
function childExpressions(source: string, from: number): string[] {
  const out: string[] = []
  let depth = 0
  let at = from
  while (at < source.length) {
    const char = source[at]
    if (char === '{') {
      const end = skipBraces(source, at)
      out.push(source.slice(at + 1, end - 1).trim())
      at = end
      continue
    }
    if (char === '<') {
      const tag = parseTag(source, at)
      if (!tag) { at += 1; continue }
      if (tag.closing) {
        if (depth === 0) return out
        depth -= 1
        at = tag.end
        continue
      }
      if (!tag.selfClosing) depth += 1
      at = tag.end
      continue
    }
    at += 1
  }
  return out
}

export interface ClippedValue { value: string; classText: string; attrs: string }

/** A lone string literal is static text, not a record's value.
 *
 *  A TEMPLATE literal is static only while it interpolates NOTHING. Reading
 *  every backtick string as a literal is how a composed per-record value --
 *  the cost float's `${primaryText} · ${meta}` line, which carries a branch
 *  name or a username -- stayed invisible to this sweep even once its
 *  clipping element was being scanned. */
function isStaticText(expression: string): boolean {
  if (!expression) return true
  if (/^`[\s\S]*`$/.test(expression)) return !/\$\{/.test(expression)
  if (/^(['"])[\s\S]*\1$/.test(expression)) return true
  return /^[\s·|/,-]*$/.test(expression)
}

/** A COMPONENT prints its text through a PROP, not as a child:
 *  `<TruncatedText text={item.name} className="block truncate" />` has no
 *  children at all, so the child scan below walked straight past it and the
 *  sweep reported green on a file (CostCalculationFloat) whose `truncate`
 *  was sitting in plain sight. Only capitalised tags qualify: on a native
 *  element `value` and `name` are form attributes, not printed content, and
 *  reading them would invent findings. A string-valued prop is static text. */
const PRINTED_PROPS = ['text', 'label', 'value']
function printedProps(tag: Tag): string[] {
  if (!/^[A-Z]/.test(tag.name)) return []
  const out: string[] = []
  for (const prop of PRINTED_PROPS) {
    const match = new RegExp(`(^|\\s)${prop}\\s*=\\s*`).exec(tag.attrs)
    if (!match) continue
    const valueAt = match.index + match[0].length
    if (tag.attrs[valueAt] !== '{') continue
    out.push(tag.attrs.slice(valueAt + 1, skipBraces(tag.attrs, valueAt) - 1).trim())
  }
  return out
}

/** Every element that clips unconditionally, with every value it prints. */
export function findClipped(source: string): ClippedValue[] {
  const flat = flatten(source)
  const found: ClippedValue[] = []
  let at = 0
  while (at < flat.length) {
    if (flat[at] !== '<') { at += 1; continue }
    const tag = parseTag(flat, at)
    if (!tag) { at += 1; continue }
    at = tag.end
    if (tag.closing) continue
    const { classText, helperValue } = classInfo(tag.attrs)
    if (!hasBareTruncate(classText)) continue
    const values = helperValue ? [helperValue] : []
    values.push(...printedProps(tag))
    if (!tag.selfClosing) values.push(...childExpressions(flat, tag.end))
    for (const value of values) {
      if (isStaticText(value)) continue
      found.push({ value, classText, attrs: tag.attrs })
    }
  }
  return found
}

export function findClippedValues(source: string): string[] {
  return findClipped(source).map((hit) => hit.value)
}

/** Every opening tag that prints `expression` -- a value is often rendered on
 *  more than one breakpoint's markup, and all of them have to obey the rule. */
function elementsPrinting(source: string, expression: string): string[] {
  const flat = flatten(source)
  const needle = new RegExp(`<[^<>]*>\\s*\\{${expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g')
  return [...flat.matchAll(needle)].map((match) => match[0].slice(0, match[0].lastIndexOf('>') + 1))
}

// ---------------------------------------------------------------------------
// 0. Controls -- the instrument fails when it should
// ---------------------------------------------------------------------------

runTest('control: a clipped name is caught in every className shape and at any depth', () => {
  const fixture = [
    '<div className="truncate text-sm">{product.name}</div>',
    '<span className="min-w-0 flex-1 detail-scroll-text">{product.name}</span>',
    '<span className="sm:truncate">{shop.title}</span>',
    '<span className="dense-cell-truncate" title={x}>{shop.title}</span>',
    // template literal, computed, and a value two elements deep
    '<div className={`truncate ${tone}`}>{customer.name}</div>',
    "<div className={cx('flex', 'truncate')}>{supplier.name}</div>",
    '<div className="truncate"><span className="font-bold"><b>{driver.name}</b></span></div>',
    // an arrow function in an attribute must not end the tag early
    '<button onClick={() => a > b} className="truncate">{branch.name}</button>',
    '<div className="truncate" title={untouched.title}>{" "}{note.text}</div>',
  ].join('\n')
  assert.deepEqual(findClippedValues(fixture), [
    'product.name', 'customer.name', 'supplier.name', 'driver.name', 'branch.name', 'note.text',
  ], 'every className shape, any descendant depth, and nothing static, scrolled or sm:-only')
  const printing = elementsPrinting(fixture, 'product.name')
  assert.equal(printing.length, 2, 'elementsPrinting must find every element that prints the value, not just the first')
  assert.match(printing[0], /truncate/)
  assert.match(printing[1], /detail-scroll-text/)
})

runTest('control: reverting a real conversion turns this file red', () => {
  // Device approvals: `device.device_name` was converted by this lane. Put the
  // ellipsis back and the scan must say so -- the earlier instrument did not.
  const source = read('components/users/DeviceApprovals.tsx')
  const reverted = source.replace('detail-scroll-text', 'truncate')
  assert.notEqual(reverted, source, 'DeviceApprovals no longer uses the scroller -- retarget this control')
  assert.ok(findClippedValues(reverted).length > findClippedValues(source).length,
    'reverting a conversion must be detected')

  // The same revert written as a template literal, in a file that HAS an
  // allowlist entry, so the allowlist cannot hide it either.
  const templated = source.replace(/className="detail-scroll-text([^"]*)"/, 'className={`truncate$1 ${tone}`}')
  assert.notEqual(templated, source, 'template-literal control could not be built')
  assert.ok(findClippedValues(templated).length > findClippedValues(source).length,
    'a computed className must not hide an ellipsis')

  // And one level deeper than the clipping box.
  const nested = '<div className="truncate"><span><em>{device.device_name}</em></span></div>'
  assert.deepEqual(findClippedValues(nested), ['device.device_name'],
    'a value nested inside the clipping element must still be caught')
})

runTest('control: the Khmer-props helper is scanned like a className', () => {
  const fixture = "<div {...getKhmerTextProps(item.batch_label, 'mt-0.5 truncate text-[10px]')} title={item.batch_label} />"
  assert.deepEqual(findClippedValues(fixture), ['item.batch_label'],
    'classes passed as a helper argument clip exactly like a className')
  const live = read('components/pos/CartItem.tsx')
  assert.match(live, /getKhmerTextProps\(item\.batch_label, 'mt-0\.5 detail-scroll-text/,
    'positive control: the live call this fixture models still uses the scroller')
})

runTest('control: a clipping component prints through a prop, and the scan reads it', () => {
  const fixture = [
    // The exact markup CostCalculationFloat carried: the class is on the
    // component, the value is a prop, and there are no children to read.
    '<TruncatedText text={`${primaryText} · ${meta}`} className={`block truncate text-sm ${tone}`} />',
    // Same component, no ellipsis -- not a finding.
    '<TruncatedText text={item.name} className="text-sm font-medium" />',
    // A NATIVE element: `value` and `name` are form attributes, not content.
    '<input className="truncate" value={form.name} name={fieldName} />',
    // A label prop counts as printed content on a component.
    '<StatCard label={stat.label} className="truncate" />',
    // A string-valued prop is static text, like a string child.
    '<TruncatedText text="Category" className="truncate" />',
  ].join('\n')
  assert.deepEqual(findClippedValues(fixture), ['`${primaryText} · ${meta}`', 'stat.label'],
    'a prop-printed value clips like a child, and a form attribute is not printed content')

  // Positive control on the real file: green now, red if the prop shape and
  // its ellipsis come back.
  const live = read('components/shared/CostCalculationFloat.tsx')
  assert.deepEqual(findClippedValues(live), [], 'the live float clips nothing')
  const reverted = live.replace(
    /<span className={`detail-scroll-text text-sm[\s\S]*?<\/span>/,
    '<TruncatedText text={`${primaryText}`} className={`block truncate text-sm`} />',
  )
  assert.notEqual(reverted, live, 'the cost row no longer has the shape this control reverts -- retarget it')
  assert.deepEqual(findClippedValues(reverted), ['`${primaryText}`'],
    'putting the truncating component back must turn this file red')
})

// ---------------------------------------------------------------------------
// 1. Every file this lane touched, not a curated sample
// ---------------------------------------------------------------------------

// Generated from the lane diff (`git diff --name-only dce2654c -- frontend/src/components`).
// A conversion that is reverted in ANY of these files is caught, whether or not
// the value below happens to be named.
const TOUCHED_FILES: string[] = [
  'components/branches/Branches.tsx',
  'components/catalog/CatalogAccountSection.tsx',
  'components/catalog/CatalogEditorSurface.tsx',
  'components/catalog/ManagePromotionsModal.tsx',
  'components/catalog/PortalFilterCombobox.tsx',
  'components/catalog/PortalPromoStrip.tsx',
  'components/contacts/ApInvoicesSection.tsx',
  'components/contacts/ArInvoicesSection.tsx',
  'components/contacts/ContactImportConflictsModal.tsx',
  'components/contacts/ContactPicker.tsx',
  'components/contacts/CustomerPurchasesReportModal.tsx',
  'components/contacts/CustomersTab.tsx',
  'components/contacts/DeliveryTab.tsx',
  'components/contacts/StockInInvoicesSection.tsx',
  'components/contacts/SupplierPurchasesModal.tsx',
  'components/contacts/SuppliersTab.tsx',
  'components/dashboard/Dashboard.tsx',
  'components/fees/ExpenseLabelManagerModal.tsx',
  'components/fees/FeeForm.tsx',
  'components/fees/FeesPage.tsx',
  'components/files/FilePickerModal.tsx',
  'components/files/FilesPage.tsx',
  'components/inventory/InventoryMovementsSurface.tsx',
  'components/inventory/InventoryReasonManagerModal.tsx',
  'components/inventory/InventoryStockModals.tsx',
  'components/inventory/ManageBatchesModal.tsx',
  'components/inventory/ProductHistoryPreviewModal.tsx',
  'components/inventory/ReceiveBatchModal.tsx',
  'components/loyalty-points/LoyaltyPointsPage.tsx',
  'components/navigation/Sidebar.tsx',
  'components/notes/NotesPage.tsx',
  'components/pos/CartItem.tsx',
  'components/pos/POS.tsx',
  'components/pos/ProductCard.tsx',
  'components/pos/ProductDetailSheet.tsx',
  'components/products/CreateProductsSessionModal.tsx',
  'components/products/Products.tsx',
  'components/products/ProductsImageOnlyView.tsx',
  'components/products/StockInSessionsSection.tsx',
  'components/products/TaggedStockRows.tsx',
  'components/products/WireImagesReviewModal.tsx',
  'components/products/forms/ProductForm.tsx',
  'components/products/forms/StockAdjustModal.tsx',
  'components/products/import/BulkImportModal.tsx',
  'components/products/import/ImportHub.tsx',
  'components/products/lookups/ManageBrandsModal.tsx',
  'components/products/lookups/ManageCategoriesModal.tsx',
  'components/products/lookups/ManageUnitsModal.tsx',
  'components/products/surfaces/AttributeSupplierModal.tsx',
  'components/products/surfaces/ProductRowParts.tsx',
  'components/promotions/PromotionsPage.tsx',
  'components/returns/EditReturnModal.tsx',
  'components/returns/ReturnReasonManagerModal.tsx',
  'components/returns/ReturnsListSurface.tsx',
  'components/review/ReviewQueue.tsx',
  'components/sales/CancelSaleModal.tsx',
  'components/sales/ExportModal.tsx',
  'components/sales/SaleCustomerActionModal.tsx',
  'components/sales/SaleRecordsFloat.tsx',
  'components/sales/SaleSettlementEditor.tsx',
  'components/sales/SaleStatusConfirmModal.tsx',
  'components/sales/SalesListSurface.tsx',
  'components/shared/ActionHistoryBar.tsx',
  'components/shared/AppSelect.tsx',
  'components/shared/CategoryFilterOptions.tsx',
  'components/shared/CostCalculationFloat.tsx',
  'components/shared/MinimizedWorkTray.tsx',
  'components/shared/NotesWidget.tsx',
  'components/users/DeviceApprovals.tsx',
  'components/users/UserProfileModal.tsx',
  'components/users/Users.tsx',
  'components/utils-settings/AuditLog.tsx',
]

// Why a value on a touched surface is still allowed to clip. A reason is not
// prose: three of the four are machine-checked below, so a wrong reason fails.
//   'language-pack' -- the text is a translation call with literal arguments
//                      only. It is a caption, never a record's value. CHECKED.
//   'reveal-attr'   -- the element opts into the one shared reveal controller
//                      (textAffordances REVEAL_SELECTOR) and shows the whole
//                      value on hover, click and long-press. CHECKED.
//   'branding'      -- the merchant's own shop name/tagline in the storefront
//                      editor preview, the exception storefrontTruncationReveal
//                      already owns. CHECKED against that test.
//   'static-label'  -- a caption, tab, chip or fixed message held in a
//                      variable or built from the pack, never a record's own
//                      value; the record's value scrolls in the row underneath.
//                      Reviewed by hand, one reason each.
type Mechanism = 'language-pack' | 'reveal-attr' | 'branding' | 'static-label'
const DELIBERATELY_CLIPPED: Record<string, Array<[string, Mechanism, string]>> = {
  'components/branches/Branches.tsx': [
    ['label', 'static-label', 'The stat tile caption ("Total stock"); its value and sub-value scroll one line below.'],
  ],
  'components/catalog/CatalogEditorSurface.tsx': [
    ["editorDraft.business_name || previewConfig.businessName || 'Business OS'", 'branding', "The merchant's own shop name in the editor's live storefront preview."],
    ["editorDraft.business_name || previewConfig.businessName || 'Business OS'", 'branding', "The same shop name on the preview's second breakpoint."],
    ["editorDraft.customer_portal_business_tagline || previewConfig.businessTagline || 'Preview the hero banner on the live header.'", 'branding', "The merchant's own tagline, repeated in full in the About section."],
  ],
  'components/contacts/CustomersTab.tsx': [
    ["tr(t, 'add_customer', 'Add Customer')", 'language-pack', 'A toolbar button label from the language pack, not a contact.'],
  ],
  'components/contacts/DeliveryTab.tsx': [
    ["tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')", 'language-pack', 'A toolbar button label from the language pack, not a contact.'],
  ],
  'components/contacts/SuppliersTab.tsx': [
    ["tr('add_supplier', 'Add Supplier', 'បន្ថែមអ្នកផ្គត់ផ្គង់')", 'language-pack', 'A toolbar button label from the language pack, not a supplier.'],
  ],
  'components/files/FilesPage.tsx': [
    ['compactTabLabel(label)', 'static-label', 'A section tab caption, deliberately shortened for the phone; the files it lists scroll.'],
  ],
  'components/navigation/Sidebar.tsx': [
    ['item.label', 'static-label', 'A navigation entry caption from the language pack; the same word labels the page it opens.'],
    ['label', 'static-label', 'A navigation entry caption from the language pack, mobile rail.'],
    ['label', 'static-label', 'The bottom-bar caption under its icon, capped to the bar cell.'],
    ["t('more') || 'More'", 'language-pack', 'The bottom bar overflow caption from the language pack.'],
  ],
  'components/pos/ProductCard.tsx': [
    ['text', 'reveal-attr', 'The B12 capped promotion badge; it now opts into the shared reveal controller, so the whole deal text is reachable by hover, click and long-press.'],
    ["copy('Deal', 'ប្រូម៉ូសិន')", 'reveal-attr', 'A one-word badge from the pack whose title carries the promotion; the reveal opens that title on touch too.'],
  ],
  'components/pos/ProductDetailSheet.tsx': [
    ["batchesError || posCopy('Could not load received dates', 'មិនអាចផ្ទុកថ្ងៃចូលបានទេ')", 'static-label', 'A load-failure message, not a record; the retry control sits beside it.'],
  ],
  'components/products/CreateProductsSessionModal.tsx': [
    ["tr('create_products_header_step', 'Shared details (entered once)')", 'language-pack', 'A step heading from the language pack.'],
  ],
  'components/products/Products.tsx': [
    ['opt.label', 'static-label', 'A bulk-action chip caption (productChipLabels), the same words as the menu it triggers.'],
  ],
  'components/products/import/BulkImportModal.tsx': [
    ['label', 'static-label', 'The import mapping grid column caption; the mapped value under it scrolls.'],
  ],
  'components/products/import/ImportHub.tsx': [
    ["T('import_hub_classic', 'Use the classic import screens')", 'language-pack', 'A link caption from the language pack.'],
  ],
  'components/products/surfaces/AttributeSupplierModal.tsx': [
    ["tr('attribute_supplier', 'Attribute supplier')", 'language-pack', 'The modal heading from the language pack; the lots it lists scroll.'],
  ],
  'components/sales/SaleStatusConfirmModal.tsx': [
    ['fromLabel', 'static-label', 'A sale status word from the language pack, shown before and after the change.'],
    ['toLabel', 'static-label', 'The same status vocabulary for the after value.'],
  ],
  'components/shared/NotesWidget.tsx': [
    ['label', 'static-label', 'The floating widget header caption; the notes it holds scroll.'],
  ],
  'components/users/UserProfileModal.tsx': [
    ["tr('session_duration', 'Default login duration')", 'language-pack', 'A field caption from the language pack.'],
  ],
  'components/users/Users.tsx': [
    ["t('add_user') || 'Add user'", 'language-pack', 'A toolbar button label from the language pack.'],
    ["t('create_role') || 'Create role'", 'language-pack', 'A toolbar button label from the language pack.'],
  ],
}

runTest('no touched surface clips a per-record value, and no exception is stale', () => {
  const unexpected: string[] = []
  for (const file of TOUCHED_FILES) {
    const allowed = (DELIBERATELY_CLIPPED[file] || []).map((entry) => [...entry] as [string, Mechanism, string])
    for (const hit of findClipped(read(file))) {
      const at = allowed.findIndex((entry) => entry[0] === hit.value)
      if (at < 0) { unexpected.push(`${file}: {${hit.value}}  [${hit.classText.slice(0, 60)}]`); continue }
      const [, mechanism, reason] = allowed[at]
      allowed.splice(at, 1)
      if (mechanism === 'language-pack') {
        assert.match(hit.value, /^[^(]*\b(t|tr|T|copy|translate)\(\s*(\w+\s*,\s*)?['"`]/,
          `${file}: {${hit.value}} is filed as language-pack but is not a translation call`)
        assert.doesNotMatch(hit.value, /\.\w+\b(?!\()/,
          `${file}: {${hit.value}} is filed as language-pack but reads a record field`)
      }
      if (mechanism === 'reveal-attr') {
        assert.match(hit.attrs, /data-reveal-text/,
          `${file}: {${hit.value}} is filed as reveal-attr but does not opt into the shared reveal controller`)
      }
      assert.ok(reason.length >= 20, `${file}: {${hit.value}} needs a real reason, not "${reason}"`)
    }
    assert.deepEqual(allowed.map((entry) => entry[0]), [],
      `${file}: listed exception(s) no longer exist -- remove them before they hide the next real one`)
  }
  assert.deepEqual(unexpected, [], 'a per-record value started clipping again on a surface this lane fixed')
})

runTest('the allowlist mechanisms are the real ones', () => {
  const controller = read('components/shared/textAffordances.ts')
  assert.match(controller, /REVEAL_SELECTOR = `\[data-reveal-text\], \.dense-cell-truncate\[title\]/,
    'the reveal controller only serves [data-reveal-text] and .dense-cell-truncate[title]; a bare title is NOT served')
  const branding = fs.readFileSync(new URL('./storefrontTruncationReveal.test.ts', import.meta.url), 'utf8')
  for (const [file, entries] of Object.entries(DELIBERATELY_CLIPPED)) {
    for (const [value, mechanism] of entries) {
      if (mechanism !== 'branding') continue
      assert.ok(branding.includes('business_name') || branding.includes('businessName'),
        `${file}: {${value}} claims the storefront branding exception, which that test must own`)
    }
  }
})

// ---------------------------------------------------------------------------
// 2. The values this lane converted, named one by one
// ---------------------------------------------------------------------------

// The file walk above catches a revert anywhere; this list says what the lane
// was FOR, surface family by surface family, and fails if a value silently
// stops being rendered at all.
const SCROLLED_VALUES: Array<[string, string]> = [
  // product names
  ['components/contacts/SupplierPurchasesModal.tsx', "batch.product_name || '--'"],
  ['components/catalog/CatalogEditorSurface.tsx', 'product.name'],
  ['components/sales/ExportModal.tsx', 'row.product_name'],
  ['components/returns/EditReturnModal.tsx', 'item.product_name'],
  ['components/dashboard/Dashboard.tsx', 'p.product_name'],
  ['components/products/forms/StockAdjustModal.tsx', 'group.name || String(lead?.id)'],
  ['components/inventory/ReceiveBatchModal.tsx', 'product.name'],
  ['components/inventory/ManageBatchesModal.tsx', 'product.name'],
  ['components/inventory/InventoryStockModals.tsx', 'transferModal.name'],
  // customer / supplier / delivery / cashier / user names
  ['components/contacts/CustomersTab.tsx', 'customerRow.name'],
  ['components/contacts/SuppliersTab.tsx', 'supplier.name'],
  ['components/contacts/DeliveryTab.tsx', 'contact.name'],
  ['components/contacts/ApInvoicesSection.tsx', 'supplierDisplay(row.supplier_name, tr)'],
  ['components/contacts/ArInvoicesSection.tsx', "row.customer_name || '--'"],
  ['components/contacts/StockInInvoicesSection.tsx', 'supplierLabel(group)'],
  ['components/pos/POS.tsx', 'active.customer.name'],
  ['components/pos/POS.tsx', 'active.selectedDelivery.name'],
  ['components/sales/SaleCustomerActionModal.tsx', 'customer.name'],
  ['components/fees/FeesPage.tsx', 'fee.delivery_contact_name'],
  ['components/navigation/Sidebar.tsx', 'user?.name'],
  ['components/users/Users.tsx', 'user.name'],
  ['components/users/UserProfileModal.tsx', 'profile.name'],
  // brand / category / unit / reason / note / branch
  ['components/products/lookups/ManageBrandsModal.tsx', 'entry.name'],
  ['components/products/lookups/ManageCategoriesModal.tsx', 'category.name'],
  ['components/products/lookups/ManageUnitsModal.tsx', 'unit.name'],
  ['components/inventory/InventoryReasonManagerModal.tsx', 'entry.label'],
  ['components/returns/ReturnReasonManagerModal.tsx', 'reason'],
  ['components/inventory/InventoryMovementsSurface.tsx', 'group.reasonPrimary'],
  ['components/inventory/ManageBatchesModal.tsx', 'batch.notes'],
  ['components/branches/Branches.tsx', 'branch.notes'],
  ['components/products/forms/ProductForm.tsx', 'branch.name'],
  ['components/dashboard/Dashboard.tsx', 'branch.branch_name'],
  // ids, file names, picker options, drafts, history labels
  ['components/branches/Branches.tsx', 'formatTransferReference(transfer.id)'],
  ['components/dashboard/Dashboard.tsx', 'sale.receipt_number'],
  ['components/products/import/ImportHub.tsx', 'entry.name'],
  ['components/files/FilePickerModal.tsx', 'asset.original_name'],
  ['components/files/FilesPage.tsx', 'assetUrl'],
  ['components/shared/AppSelect.tsx', 'option.label'],
  ['components/shared/CategoryFilterOptions.tsx', 'child.label'],
  ['components/catalog/PortalFilterCombobox.tsx', 'row.label'],
  ['components/loyalty-points/LoyaltyPointsPage.tsx', 'customer.membership_number'],
  ['components/utils-settings/AuditLog.tsx', 'formatEntityName(log, vocab)'],
  ['components/shared/ActionHistoryBar.tsx', 'item.label'],
  ['components/shared/MinimizedWorkTray.tsx', 'entry.label'],
]

runTest('every business value the sweep covered renders in .detail-scroll-text', () => {
  const broken: string[] = []
  for (const [file, expression] of SCROLLED_VALUES) {
    const elements = elementsPrinting(read(file), expression)
    if (elements.length === 0) { broken.push(`${file}: {${expression}} is no longer rendered -- retarget or retire this pin`); continue }
    if (!elements.some((element) => element.includes('detail-scroll-text'))) broken.push(`${file}: {${expression}} is not inside the shared scroller`)
    for (const element of elements) {
      const { classText } = classInfo(element.slice(1, -1).replace(/^[\w.$]+/, ''))
      if (hasBareTruncate(classText)) broken.push(`${file}: {${expression}} still carries truncate -- ${element.slice(0, 120)}`)
    }
  }
  assert.deepEqual(broken, [], 'a business name must scroll left and right, never end in an ellipsis')
})

// ---------------------------------------------------------------------------
// 3. Compact meta rows scroll as a row; no child clips inside them
// ---------------------------------------------------------------------------

runTest('the Returns and Expenses card meta rows scroll instead of clipping a name', () => {
  for (const [file, marker] of [
    ['components/returns/ReturnsListSurface.tsx', 'data-return-secondary-meta'],
    ['components/fees/FeesPage.tsx', 'data-expense-line="secondary"'],
  ] as Array<[string, string]>) {
    const flat = flatten(read(file))
    const at = flat.indexOf(marker)
    assert.ok(at > 0, `${file}: ${marker} row not found`)
    const row = flat.slice(at, flat.indexOf('</div>', at))
    assert.match(row, /overflow-x-auto/, `${file}: the row itself must scroll, like its sibling receipt/status row`)
    assert.match(row, /\[&::-webkit-scrollbar\]:hidden/, `${file}: the scrollbar stays hidden on the phone`)
    assert.doesNotMatch(row, /(?:^|\s|")truncate(?:\s|")/, `${file}: no child of a scrolling row may clip its own text`)
  }
})

// ---------------------------------------------------------------------------
// 4. The scroller itself gives Khmer its vertical room -- deliberately, and at
//    a cost that is written down
// ---------------------------------------------------------------------------

function cssText(): string {
  return fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
}

runTest('.detail-scroll-text keeps Khmer ink inside its box', () => {
  const css = cssText()
  assert.match(css, /\.detail-scroll-text \{[^}]*overflow-x:\s*auto/, 'the shared scroller must scroll horizontally')
  assert.match(css, /\.detail-scroll-text \{[^}]*text-overflow:\s*clip/, 'a scrolling value must not also grow an ellipsis')
  // `overflow-y: hidden` cannot take an overflow-clip-margin, so a Khmer coeng
  // subscript is sheared off without a line-height floor -- the same floor
  // .scroll-x-clean already carries.
  assert.match(css, /body\.lang-km \.detail-scroll-text,[\s\S]{0,80}line-height:\s*var\(--km-line-height/,
    'the Khmer line-height floor must be restated for the detail scroller')
  // Positive control for the assertion above: the class it is modelled on has
  // the same floor, so a typo in the selector cannot pass silently.
  assert.match(css, /body\.lang-km \.scroll-x-clean,[\s\S]{0,80}line-height:\s*var\(--km-line-height/,
    'positive control: the product-name scroller still carries its own floor')
  assert.match(css, /:root \{ --km-line-height: 1\.6; \}/, 'the floor is one number, defined once')
})

runTest('the Khmer floor is unlayered on purpose, and its cost is recorded', () => {
  const css = cssText()
  // It has to sit OUTSIDE @layer to beat Tailwind's `leading-*` utilities.
  // That is the whole point (a row that sets leading-3 is exactly the row that
  // shears a coeng), and it is also the whole cost, so it is measured below.
  const floorAt = css.indexOf('body.lang-km .detail-scroll-text')
  assert.ok(floorAt > 0, 'the floor must exist')
  const layerAt = css.lastIndexOf('@layer', floorAt)
  const closed = css.slice(layerAt, floorAt).split('\n').some((line) => line === '}')
  assert.ok(closed, 'the Khmer floor must not be inside @layer, or Tailwind leading-* would outrank it')

  // before -> after, in ems of the element's own font-size. Recorded for the
  // two shapes a reviewer measured in the DOM (Branches stat sub-value, and
  // the barcode line of the product report, 14.39px -> 18.42px at lang-km).
  const cases: Array<[string, number, number]> = [
    ['text-[9.5px] leading-3 (Branches stat sub-value)', 12 / 9.5, 1.6],
    ['font-mono text-[10px] leading-tight (ProductDetailReport barcode)', 1.25, 1.6],
    ['text-xs with no leading utility (the common case)', 1.3333, 1.6],
  ]
  for (const [shape, before, after] of cases) {
    assert.ok(after > before, `${shape}: the floor must ADD room, not remove it (${before} -> ${after})`)
    assert.ok(after / before < 1.35, `${shape}: a floor that grows a row by more than a third is not a floor`)
  }
  assert.match(css, /barcode line/, 'the cost of the floor is named in main.css, not only here')
})

runTest('a clipping element never wraps a block-level scroller', () => {
  // main.css:@supports flips `.truncate` to `overflow: clip` for Khmer, which
  // does NOT establish a block formatting context. The comment there rests on
  // a count of truncating elements with no block child; this lane added block
  // children (`.detail-scroll-text` is display:block), so the count and the
  // claim are re-derived here instead of trusted.
  const css = cssText()
  assert.ok(/none has a block-level child/.test(css), 'main.css must state the claim this check re-derives')
  let total = 0
  const blockChildren: string[] = []
  for (const [file, source] of walkComponents()) {
    const flat = flatten(source)
    let at = 0
    while (at < flat.length) {
      if (flat[at] !== '<') { at += 1; continue }
      const tag = parseTag(flat, at)
      if (!tag) { at += 1; continue }
      at = tag.end
      if (tag.closing) continue
      const { classText } = classInfo(tag.attrs)
      if (!/(^|\s)(\w+:)?truncate(\s|$)/.test(classText) && !hasDenseCellTruncate(classText)) continue
      total += 1
      if (tag.selfClosing || !hasBareTruncate(classText)) continue
      const inner = flat.slice(tag.end, flat.indexOf(`</${tag.name}>`, tag.end))
      if (/detail-scroll-text/.test(inner)) blockChildren.push(`${file}: ${classText.slice(0, 50)}`)
    }
  }
  assert.deepEqual(blockChildren, [],
    'a truncating box must not contain the block-level scroller -- that is the one reflow `overflow: clip` would change')
  // The load-bearing half of that comment -- "none has a block-level child" --
  // is re-derived above on every run over every truncating element, so it can
  // never go stale. The comment deliberately carries no element count: two lanes
  // (kit Fold, reports) changed the count in one checkpoint and a tolerance on a
  // number nothing depends on turned the composed tree red.
  assert.ok(total > 0, 'the sweep must have seen at least one truncating element')
})

// ---------------------------------------------------------------------------
// 5. The OTHER clip site: `.dense-cell-truncate`
// ---------------------------------------------------------------------------

// `.dense-cell-truncate` is `text-overflow: ellipsis` (main.css:1186) exactly
// like `truncate` is, but it was outside every check in this file, and a
// verifier found the consequence on the checkpoint the sweep above shipped in:
// Stock Changes, Stock-in Sessions, Returns and Expenses were still cutting
// product, supplier, customer, branch, cashier, user, lot and reason values
// while this file reported the class closed. A blind spot is not fixed by a
// second regex that guesses which identifiers look like names -- `label` and
// `reason` defeat it in both directions. It is fixed by a WHITELIST: every
// value printed inside a dense cell is named below with the kind that earns
// it, so a name-like binding added tomorrow fails simply by not being there.
//
// The kinds, and why each is allowed to keep its ellipsis:
//   'id'            -- a code, not a name. It reveals in full through the
//                      shared controller on hover and press-and-hold.
//   'figure'        -- a formatted number/time whose fuller form is the title.
//   'language-pack' -- a caption from the pack, never a record's value. CHECKED.
//   'enum-label'    -- a word the pack supplies for an ENUM column (a movement
//                      type, a status). The field it reads is a code, so the
//                      rendered text is bounded and belongs to the pack rather
//                      than to the record. CHECKED.
//   'component'     -- the shared TruncatedText span itself, which IS the
//                      reveal; its own contract is tests/truncatedText.test.ts.
type DenseKind = 'id' | 'figure' | 'language-pack' | 'enum-label' | 'component'

interface DenseTag { tagName: string; value: string | null; attrs: string; classText: string }

/** Every element carrying the dense-table clip, with each value it prints.
 *  A tag that prints no value of its own (a component given the class as a
 *  prop) is reported once with `value: null`. */
export function findDenseClipped(source: string): DenseTag[] {
  const flat = flatten(source)
  const found: DenseTag[] = []
  let at = 0
  while (at < flat.length) {
    if (flat[at] !== '<') { at += 1; continue }
    const tag = parseTag(flat, at)
    if (!tag) { at += 1; continue }
    at = tag.end
    if (tag.closing) continue
    const { classText, helperValue } = classInfo(tag.attrs)
    if (!hasDenseCellTruncate(classText)) continue
    const values = helperValue ? [helperValue] : []
    if (!tag.selfClosing) values.push(...childExpressions(flat, tag.end))
    const real = values.filter((value) => !isStaticText(value))
    if (!real.length) { found.push({ tagName: tag.name, value: null, attrs: tag.attrs, classText }); continue }
    for (const value of real) found.push({ tagName: tag.name, value, attrs: tag.attrs, classText })
  }
  return found
}

// A dense cell is only honest if the full value is reachable. The shared
// controller matches `[data-reveal-text]` and `.dense-cell-truncate[title]`
// (components/shared/textAffordances.ts REVEAL_SELECTOR) -- nothing else.
function hasReveal(attrs: string): boolean {
  return /(^|\s)title\s*=/.test(attrs) || /data-reveal-text|REVEAL_ATTR/.test(attrs)
}

// Components that take the dense class as a prop and bring their own
// affordance: CopyableId marks its value with `data-copy-value`, which the
// SAME controller serves with its copy float.
const DENSE_COMPONENTS = new Set(['CopyableId'])

const DENSE_CELL_VALUES: Record<string, Array<[string, DenseKind, string]>> = {
  'components/products/StockChangeSection.tsx': [
    ['model.barcode', 'id', 'The barcode under the (scrolling) product name: a code, on its own muted mono line.'],
    ['translateMovementType(row.movement_type, t)', 'enum-label', 'The movement word the pack supplies for the movement_type code, inside a coloured chip.'],
  ],
  'components/products/StockInSessionsSection.tsx': [
    ["stockSessionId(session.createdAt) || session.key", 'id', 'The session id, which is the receipt an operator quotes back.'],
    ['fmtClock24(session.createdAt)', 'figure', 'The clock; the day divider carries the date and the title carries the full stamp.'],
  ],
  'components/shared/TruncatedText.tsx': [
    ['text', 'component', 'The shared reveal component itself -- it renders this cell contract on purpose.'],
  ],
}

interface DenseAudit { unlisted: string[]; unrevealed: string[]; stale: string[] }

function auditDense(files: Array<[string, string]>): DenseAudit {
  const audit: DenseAudit = { unlisted: [], unrevealed: [], stale: [] }
  for (const [file, source] of files) {
    const allowed = (DENSE_CELL_VALUES[file] || []).map((entry) => [...entry] as [string, DenseKind, string])
    for (const hit of findDenseClipped(source)) {
      if (hit.value == null) {
        if (!DENSE_COMPONENTS.has(hit.tagName)) audit.unrevealed.push(`${file}: <${hit.tagName}> carries the dense clip but owns no affordance`)
        continue
      }
      if (!hasReveal(hit.attrs)) audit.unrevealed.push(`${file}: {${hit.value}} clips with no title and no data-reveal-text -- a dead-end ellipsis`)
      const at = allowed.findIndex((entry) => entry[0] === hit.value)
      if (at < 0) { audit.unlisted.push(`${file}: {${hit.value}}  [${hit.classText.slice(0, 60)}]`); continue }
      const [, kind, reason] = allowed[at]
      allowed.splice(at, 1)
      if (kind === 'language-pack' && !/^[^(]*\b(t|tr|T|copy|translate)\(\s*(\w+\s*,\s*)?['"`]/.test(hit.value)) {
        audit.unlisted.push(`${file}: {${hit.value}} is filed as language-pack but is not a translation call`)
      }
      if (kind === 'enum-label' && !/^(translate\w*|\w+Label)\(/.test(hit.value)) {
        audit.unlisted.push(`${file}: {${hit.value}} is filed as enum-label but is not a label lookup`)
      }
      if (reason.length < 20) audit.unlisted.push(`${file}: {${hit.value}} needs a real reason, not "${reason}"`)
    }
    for (const [value] of allowed) audit.stale.push(`${file}: {${value}} is listed but no longer clips -- remove it before it hides the next one`)
  }
  return audit
}

runTest('control: the dense clip site is scanned, and an unlisted value there fails', () => {
  // What section 0's control deliberately walks past, this scanner sees.
  const fixture = '<span className="dense-cell-truncate" title={x}>{shop.title}</span>'
  assert.deepEqual(findClippedValues(fixture), [], 'the bare-truncate scan does not own this class')
  assert.deepEqual(findDenseClipped(fixture).map((hit) => hit.value), ['shop.title'], 'the dense scan does')

  // Reverting a real conversion must turn this file red. Stock Changes'
  // product name was the value the verifier caught; put its ellipsis back.
  const path = 'components/products/StockChangeSection.tsx'
  const live = read(path)
  const reverted = live.replace(
    '<span className="detail-scroll-text font-semibold text-gray-800 dark:text-gray-100">{row.product_name}</span>',
    '<span className="block dense-cell-truncate font-semibold" title={row.product_name}>{row.product_name}</span>',
  )
  assert.notEqual(reverted, live, 'the product name no longer uses the scroller -- retarget this control')
  const caught = auditDense([[path, reverted]])
  assert.deepEqual(caught.unlisted, [`${path}: {row.product_name}  [block dense-cell-truncate font-semibold]`],
    'a name put back into a dense cell must be reported, title or no title')

  // ...and a dense cell that loses its reveal is reported separately, which is
  // the defect the stock-in received-date cell actually had.
  const untitled = live.replace(/ title=\{model\.barcode\}/, '')
  assert.notEqual(untitled, live, 'the barcode cell no longer carries a title -- retarget this control')
  assert.deepEqual(auditDense([[path, untitled]]).unrevealed,
    [`${path}: {model.barcode} clips with no title and no data-reveal-text -- a dead-end ellipsis`],
    'a dense cell with no reveal must be reported')

  // A control for the control: the live file itself is clean on both counts.
  const clean = auditDense([[path, live]])
  assert.deepEqual([clean.unlisted, clean.unrevealed, clean.stale], [[], [], []], 'the live file passes the same audit')
})

runTest('no dense cell anywhere in src/components clips a record value, and every one reveals', () => {
  const files = walkComponents()
  // A sweep that reports every case the same way is indistinguishable from a
  // broken instrument, so say out loud what it must have seen: the whole
  // component tree, and dense cells inside it.
  assert.ok(files.length > 200, `the walk must reach the whole component tree, saw ${files.length} files`)
  const seen = files.flatMap(([, source]) => findDenseClipped(source))
  assert.ok(seen.length >= 5, `the walk must actually find dense cells, saw ${seen.length}`)
  const audit = auditDense(files)
  assert.deepEqual(audit.unlisted, [],
    'a dense-table cell clips a value that is not an id, a figure or a caption -- names scroll, they do not ellipse')
  assert.deepEqual(audit.unrevealed, [],
    'every .dense-cell-truncate cell must be reachable in full: a title the shared controller serves, or its own affordance')
  assert.deepEqual(audit.stale, [], 'a listed dense exception no longer exists')
})

// ---------------------------------------------------------------------------
// 6. Ids keep their own contract: they wrap in full, they do not scroll
// ---------------------------------------------------------------------------

runTest('a CopyableId caller never re-imposes an ellipsis on the id', () => {
  for (const file of TOUCHED_FILES) {
    const source = read(file)
    for (const value of source.match(/valueClassName=(?:"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})/g) || []) {
      assert.ok(!hasBareTruncate(classInfo(value, 'valueClassName').classText),
        `${file}: CopyableId wraps an id in full (whitespace-normal break-all); a caller must not clip it -- ${value}`)
    }
  }
})

if (failed > 0) {
  console.error(`\n${failed} ellipsis check(s) failed`)
  process.exit(1)
}
console.log('\nAll name/value ellipsis checks passed')
