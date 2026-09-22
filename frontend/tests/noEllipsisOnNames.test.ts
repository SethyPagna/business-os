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
// Three shapes are deliberately NOT converted and are listed by expression
// below rather than skipped by a rule, so the next reader can disagree:
//   * chrome -- a button label, a tab, a section heading, a status word. It
//     comes from the language pack, is short, and repeats elsewhere.
//   * shop branding -- the business name/tagline in the storefront editor
//     preview, which is the merchant's own copy and repeats in About.
//   * a capped promotion badge that already carries `title` and is served by
//     the shared reveal controller (the +N/cap contract from the B12 spec).
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
// The instrument
// ---------------------------------------------------------------------------

/** JSX is written across lines; flatten it and drop comments so prose about
 *  truncation is never mistaken for a truncating element. */
function flatten(source: string): string {
  return source
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
}

/** Every element that clips unconditionally and prints one dynamic value. */
export function findClippedValues(source: string): string[] {
  const found: string[] = []
  for (const match of flatten(source).matchAll(/className="([^"]*\btruncate\b[^"]*)"([^>]*)>\s*\{([^}]+)\}/g)) {
    // `sm:truncate` alone wraps below sm -- the narrow screen -- so the text is
    // still reachable there and it is not a dead end.
    if (!/(?:^|\s)truncate(?:\s|$)/.test(match[1])) continue
    found.push(match[3].trim())
  }
  return found
}

/** Every opening tag that prints `expression` -- a value is often rendered on
 *  more than one breakpoint's markup, and all of them have to obey the rule. */
function elementsPrinting(source: string, expression: string): string[] {
  const flat = flatten(source)
  const needle = new RegExp(`<[^<>]*>\\s*\\{${expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g')
  return [...flat.matchAll(needle)].map((match) => match[0].slice(0, match[0].lastIndexOf('>') + 1))
}

runTest('positive control: the scan flags a truncated product name and spares chrome', () => {
  // Without this the whole file could pass on an empty scan.
  const fixture = [
    '<div className="truncate text-sm">{product.name}</div>',
    '<span className="min-w-0 flex-1 detail-scroll-text">{product.name}</span>',
    '<span className="sm:truncate">{shop.title}</span>',
    '<span className="truncate">',
    '  {customer.name}',
    '</span>',
  ].join('\n')
  assert.deepEqual(findClippedValues(fixture), ['product.name', 'customer.name'],
    'the scan must flag an ellipsised name, across lines too, and must not flag the scroller or sm:truncate')
  const printing = elementsPrinting(fixture, 'product.name')
  assert.equal(printing.length, 2, 'elementsPrinting must find every element that prints the value, not just the first')
  assert.match(printing[0], /truncate/)
  assert.match(printing[1], /detail-scroll-text/)
})

// ---------------------------------------------------------------------------
// 1. Every converted value now renders inside the shared scroller
// ---------------------------------------------------------------------------

// One representative value per data kind per surface family. Each of these
// carried a bare `truncate` at dce2654c, so this list fails on the old tree.
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
  // customer / supplier / delivery / cashier names
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
  // ids, file names, user names, picker options
  ['components/branches/Branches.tsx', 'formatTransferReference(transfer.id)'],
  ['components/dashboard/Dashboard.tsx', 'sale.receipt_number'],
  ['components/products/import/ImportHub.tsx', 'entry.name'],
  ['components/files/FilePickerModal.tsx', 'asset.original_name'],
  ['components/files/FilesPage.tsx', 'assetUrl'],
  ['components/users/Users.tsx', 'user.name'],
  ['components/users/UserProfileModal.tsx', 'profile.name'],
  ['components/shared/AppSelect.tsx', 'option.label'],
  ['components/shared/CategoryFilterOptions.tsx', 'child.label'],
  ['components/catalog/PortalFilterCombobox.tsx', 'row.label'],
  ['components/loyalty-points/LoyaltyPointsPage.tsx', 'customer.membership_number'],
  ['components/utils-settings/AuditLog.tsx', 'formatEntityName(log)'],
]

runTest('every business value the sweep covered renders in .detail-scroll-text', () => {
  const broken: string[] = []
  for (const [file, expression] of SCROLLED_VALUES) {
    const elements = elementsPrinting(read(file), expression)
    if (elements.length === 0) { broken.push(`${file}: {${expression}} is no longer rendered -- retarget or retire this pin`); continue }
    if (!elements.some((element) => element.includes('detail-scroll-text'))) broken.push(`${file}: {${expression}} is not inside the shared scroller`)
    for (const element of elements) {
      if (/(?:^|\s|")truncate(?:\s|")/.test(element)) broken.push(`${file}: {${expression}} still carries truncate -- ${element.slice(0, 120)}`)
    }
  }
  assert.deepEqual(broken, [], 'a business name must scroll left and right, never end in an ellipsis')
})

// ---------------------------------------------------------------------------
// 2. Nothing new may start clipping on a surface this sweep touched
// ---------------------------------------------------------------------------

// Every remaining clipped value on a touched file, named one by one. All of
// them are chrome, branding or a capped badge with a working reveal. A new
// entry here means a per-record value started clipping again.
const DELIBERATELY_CLIPPED: Record<string, string[]> = {
  // A stat tile's caption ("Total stock"); its value and sub-value scroll.
  'components/branches/Branches.tsx': ['label'],
  // The merchant's own shop name and tagline in the editor's live preview --
  // the same two exceptions storefrontTruncationReveal.test.ts already names.
  'components/catalog/CatalogEditorSurface.tsx': [
    "editorDraft.business_name || previewConfig.businessName || 'Business OS'",
    "editorDraft.business_name || previewConfig.businessName || 'Business OS'",
    "editorDraft.customer_portal_business_tagline || previewConfig.businessTagline || 'Preview the hero banner on the live header.'",
  ],
  // The filter chip's own caption ("Brand", "Category"); the menu it opens
  // lists every option in a scroller.
  'components/catalog/PortalFilterCombobox.tsx': ['label'],
  'components/contacts/CustomersTab.tsx': ["tr(t, 'manage', 'Manage')", "tr(t, 'add_customer', 'Add Customer')"],
  'components/contacts/DeliveryTab.tsx': ["tr('manage', 'Manage', 'គ្រប់គ្រង')", "tr('add_delivery_contact', 'Add Delivery', 'បន្ថែមអ្នកដឹកជញ្ជូន')"],
  'components/contacts/SuppliersTab.tsx': ["tr('manage', 'Manage', 'គ្រប់គ្រង')", "tr('add_supplier', 'Add Supplier', 'បន្ថែមអ្នកផ្គត់ផ្គង់')"],
  'components/files/FilesPage.tsx': ['compactTabLabel(label)'],
  // Promotion badges: capped on purpose (B12 spec -- a cap plus a counter, not
  // an ellipsis on the list) and both carry `title`, which the shared reveal
  // controller opens on hover, click and long-press.
  'components/pos/ProductCard.tsx': ['text', "copy('Deal', 'ប្រូម៉ូសិន')"],
  // A load failure message, not a record.
  'components/pos/ProductDetailSheet.tsx': ["batchesError || posCopy('Could not load received dates', 'មិនអាចផ្ទុកថ្ងៃចូលបានទេ')"],
  'components/products/CreateProductsSessionModal.tsx': ["tr('create_products_header_step', 'Shared details (entered once)')"],
  'components/products/Products.tsx': ["tr('adjust', 'Adjust')", 'opt.label'],
  // The import mapping grid's column caption; the value under it scrolls.
  'components/products/import/BulkImportModal.tsx': ['label'],
  'components/products/import/ImportHub.tsx': ["T('import_hub_classic', 'Use the classic import screens')"],
  'components/promotions/PromotionsPage.tsx': ["(t('promo_label_preview') || 'Shown as:')", "(t('promo_discount_for') || 'Discount for')"],
  // Status words from the language pack, shown before and after the change.
  'components/sales/SaleStatusConfirmModal.tsx': ['fromLabel', 'toLabel'],
  'components/shared/NotesWidget.tsx': ['label'],
  'components/users/UserProfileModal.tsx': ["tr('session_duration', 'Default login duration')"],
  'components/users/Users.tsx': ["t('add_user') || 'Add user'", "t('create_role') || 'Create role'"],
  'components/utils-settings/AuditLog.tsx': ['section.label', 'section.label', 'group.label'],
}

runTest('no touched surface clips a per-record value, and no exception is stale', () => {
  const unexpected: string[] = []
  for (const [file, allowed] of Object.entries(DELIBERATELY_CLIPPED)) {
    const found = findClippedValues(read(file))
    const remaining = [...allowed]
    for (const hit of found) {
      const at = remaining.indexOf(hit)
      if (at < 0) unexpected.push(`${file}: {${hit}}`)
      else remaining.splice(at, 1)
    }
    // A stale exception hides the next real one.
    assert.deepEqual(remaining, [], `${file}: listed exception(s) no longer exist -- remove them`)
  }
  assert.deepEqual(unexpected, [], 'a value that is not chrome started clipping again')
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
// 4. The scroller itself gives Khmer its vertical room
// ---------------------------------------------------------------------------

runTest('.detail-scroll-text keeps Khmer ink inside its box', () => {
  const css = fs.readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
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
})

// ---------------------------------------------------------------------------
// 5. Ids keep their own contract: they wrap in full, they do not scroll
// ---------------------------------------------------------------------------

runTest('a CopyableId caller never re-imposes an ellipsis on the id', () => {
  for (const file of [
    'components/contacts/CustomerPurchasesReportModal.tsx',
    'components/returns/ReturnsListSurface.tsx',
    'components/contacts/ApInvoicesSection.tsx',
    'components/contacts/ArInvoicesSection.tsx',
  ]) {
    const values = read(file).match(/valueClassName="[^"]*"/g) || []
    for (const value of values) {
      assert.doesNotMatch(value, /(?:^|\s|")truncate(?:\s|")/,
        `${file}: CopyableId wraps an id in full (whitespace-normal break-all); a caller must not clip it -- ${value}`)
    }
  }
})

if (failed > 0) {
  console.error(`\n${failed} ellipsis check(s) failed`)
  process.exit(1)
}
console.log('\nAll name/value ellipsis checks passed')
