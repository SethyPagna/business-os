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
 *  where the text is still fully readable -- and `dense-cell-truncate` is the
 *  dense-table contract that the shared reveal controller already serves. */
export function hasBareTruncate(classText: string): boolean {
  return classText.split(/\s+/).includes('truncate')
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

/** A lone string literal is static text, not a record's value. */
function isStaticText(expression: string): boolean {
  if (!expression) return true
  if (/^(['"`])[\s\S]*\1$/.test(expression)) return true
  return /^[\s·|/,-]*$/.test(expression)
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
  ['components/utils-settings/AuditLog.tsx', 'formatEntityName(log)'],
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

runTest('a clipping element never wraps a block-level scroller, and the count in main.css is true', () => {
  // main.css:@supports flips `.truncate` to `overflow: clip` for Khmer, which
  // does NOT establish a block formatting context. The comment there rests on
  // a count of truncating elements with no block child; this lane added block
  // children (`.detail-scroll-text` is display:block), so the count and the
  // claim are re-derived here instead of trusted.
  const css = cssText()
  const claimed = Number(/of the (\d+) elements in src\/components/.exec(css)?.[1])
  assert.ok(Number.isFinite(claimed), 'main.css must state how many truncating elements it checked')
  let total = 0
  const blockChildren: string[] = []
  const walk = (dir: URL): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) { walk(next); continue }
      if (!/\.tsx$/.test(entry.name)) continue
      const flat = flatten(fs.readFileSync(next, 'utf8').replace(/\r\n/g, '\n'))
      let at = 0
      while (at < flat.length) {
        if (flat[at] !== '<') { at += 1; continue }
        const tag = parseTag(flat, at)
        if (!tag) { at += 1; continue }
        at = tag.end
        if (tag.closing) continue
        const { classText } = classInfo(tag.attrs)
        if (!/(^|\s)(\w+:)?truncate(\s|$)/.test(classText) && !classText.split(/\s+/).includes('dense-cell-truncate')) continue
        total += 1
        if (tag.selfClosing || !hasBareTruncate(classText)) continue
        const inner = flat.slice(tag.end, flat.indexOf(`</${tag.name}>`, tag.end))
        if (/detail-scroll-text/.test(inner)) blockChildren.push(`${entry.name}: ${classText.slice(0, 50)}`)
      }
    }
  }
  walk(new URL('../src/components/', import.meta.url))
  assert.deepEqual(blockChildren, [],
    'a truncating box must not contain the block-level scroller -- that is the one reflow `overflow: clip` would change')
  // The load-bearing half of that comment -- "none has a block-level child" --
  // is re-derived above on every run, so it can never go stale. The number is
  // provenance for it. A tolerance keeps a sibling lane that adds one ordinary
  // `truncate` from turning this red, while a drift this size means nobody has
  // re-read the claim in a long time.
  assert.ok(Math.abs(total - claimed) <= 10,
    `main.css says ${claimed} truncating elements in src/components; there are ${total}. Refresh the number -- the claim beside it is only as fresh as its count.`)
})

// ---------------------------------------------------------------------------
// 5. Ids keep their own contract: they wrap in full, they do not scroll
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
