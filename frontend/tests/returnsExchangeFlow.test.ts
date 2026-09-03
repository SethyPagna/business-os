// Source-shape lock for the returns exchange flow (receipt typeahead, full
// product names, the standalone replacement search, the damaged tag, and the
// internal-only restock choice).
//
// These are the five things the user asked for by hand; each one is easy to
// regress silently in a JSX refactor (a `truncate` creeping back onto a name,
// a search box migrating back under a row), and none of them is observable
// from the pure Worker tests. Asserting the source shape is the cheapest
// honest lock available without a DOM harness.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

const newReturn = read('../src/components/returns/NewReturnModal.tsx')
const returnDetail = read('../src/components/returns/ReturnDetailModal.tsx')
const returnsList = read('../src/components/returns/ReturnsListSurface.tsx')
const returnsTransport = read('../src/api/returnsReadTransport.ts')
const receipt = read('../src/components/receipt/Receipt.tsx')
const printReceipt = read('../src/utils/printReceipt.ts')
const salesHub = read('../src/components/sales/SalesHubPage.tsx')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

// ---------------------------------------------------------------------------
// 1. "when searching should show the receipt numbers available based on search"
// ---------------------------------------------------------------------------
assert.match(returnsTransport, /lookupReturnReceipts/, 'a receipt lookup transport must exist')
assert.match(returnsTransport, /\/api\/returns\/receipt-lookup/, 'the lookup must call the server endpoint, not filter a client-side page')
assert.match(newReturn, /lookupReceiptSuggestions\(/, 'the new-return search must ask the server for matching receipts')
assert.doesNotMatch(
  newReturn,
  /searchReturnSales\(\{ limit: 500 \}\)/,
  'the old "pull 500 sales and Array.find() them" search must be gone -- a receipt outside that page was simply unfindable',
)
assert.match(newReturn, /RECEIPT_SUGGEST_DEBOUNCE_MS/, 'the typeahead must be debounced, not one request per keystroke')
assert.match(newReturn, /isTrackedRequestCurrent\(suggestRequestRef/, 'a slow early keystroke must not be allowed to overwrite a later answer')
assert.match(newReturn, /RECEIPT_SUGGEST_LIMIT = 20/, 'the suggestion list stays a glanceable 20 rows')
assert.match(newReturn, /role="listbox"/, 'the suggestions must be a real listbox for keyboard and screen-reader users')
assert.match(newReturn, /handleSearchKeyDown/, 'the typeahead must be keyboard navigable')
for (const key of ['ArrowDown', 'ArrowUp', 'Escape', 'Enter']) {
  assert.ok(newReturn.includes(`'${key}'`), `the typeahead must handle ${key}`)
}
// A caller that already knows the receipt (the Return button on a sale) must
// resolve through this same server path -- kept additive so every existing
// caller of the modal is unaffected.
assert.match(newReturn, /initialReceiptQuery\?: string \| null/, 'the receipt prefill prop must stay optional (backward compatible)')
assert.match(newReturn, /autoResolvedRef/, 'a prefilled receipt must resolve exactly once, not fight what the operator types next')

console.log('PASS return search shows matching receipts from the server as you type, debounced and keyboard-navigable')

// ---------------------------------------------------------------------------
// 2. "make the product names fully shown not ellipses"
// ---------------------------------------------------------------------------
// Every place a product name is rendered while deciding what comes back.
for (const [label, source, marker] of [
  ['item picker', newReturn, '{item.product_name || item.name}'],
  ['confirm review', newReturn, '{it.product_name || it.name}'],
  ['replacement line', newReturn, '{line.product_name}'],
] as Array<[string, string, string]>) {
  const at = source.indexOf(marker)
  assert.ok(at > 0, `${label}: product name render not found`)
  // The name's own element must not be clipped. Look at the element that
  // wraps it, not the whole file: `truncate` elsewhere (receipt numbers, the
  // modal title) is fine and deliberate.
  const element = source.slice(source.lastIndexOf('<', at), at)
  assert.doesNotMatch(element, /\btruncate\b/, `${label}: the product name must not be truncated`)
  assert.match(element, /\bbreak-words\b/, `${label}: the product name must wrap in full`)
}
assert.doesNotMatch(
  newReturn,
  /truncate text-sm font-medium text-gray-800/,
  'the old truncated product-name class must be gone from the item picker and replacement lines',
)

console.log('PASS returned and replacement product names wrap in full, never ellipsised')

// ---------------------------------------------------------------------------
// 3. "make a search bar for that section to be able to search for replacement
//     products, any products" -- its OWN section, not below the picked items
// ---------------------------------------------------------------------------
assert.match(newReturn, /data-section="replacement-sale"/, 'the replacement sale must be its own section')
assert.match(newReturn, /Search another product by name, SKU or barcode/, 'the replacement section must carry its own catalog search bar')
assert.match(newReturn, /searchProducts\(\{ query, page: 1, pageSize: 30 \}\)/, 'it must reuse the shared product search transport, as POS does')
assert.match(newReturn, /addReplacementFromCandidate/, 'picking a search result must add a replacement line')
// The search must not be per-already-added-line any more: that forced the
// operator to add a line BEFORE they could look for what belongs on it.
assert.doesNotMatch(newReturn, /line\.search_query/, 'the replacement search must belong to the section, not to each already-added line')
assert.doesNotMatch(newReturn, /searchReplacementCatalog\(line\.key/, 'there must be no per-line catalog search left')
// Project rule: a scan narrows the list, the operator still picks.
assert.match(newReturn, /<ScanSearchButton/, 'the replacement search must accept a barcode scan')
assert.doesNotMatch(newReturn, /if \(exactBarcode\) pickReplacementRow\(/, 'a scan must never auto-pick a replacement -- it only narrows the list')
assert.doesNotMatch(newReturn, /addReplacementFor\(item\)/, 'the replacement entry point must not sit under each returned row any more')

console.log('PASS the replacement sale is its own section with its own any-product search bar')

// ---------------------------------------------------------------------------
// 5. "for damaged products make sure it has a tag label, not editing the name"
// ---------------------------------------------------------------------------
for (const [label, source] of [
  ['new-return item picker', newReturn],
  ['return detail', returnDetail],
  ['returns list', returnsList],
] as Array<[string, string]>) {
  assert.match(source, /data-tag="damaged"/, `${label}: damaged must render as a tag chip`)
}
assert.match(returnsList, /damaged_item_count/, 'the returns list must read the damaged count the list query already carries')
// The name is the catalog name. Nothing may append a state to it.
for (const [label, source] of [
  ['new-return', newReturn],
  ['return detail', returnDetail],
  ['returns list', returnsList],
] as Array<[string, string]>) {
  assert.doesNotMatch(source, /product_name.*\+.*damaged/i, `${label}: a damaged item must not have its name rewritten`)
  assert.doesNotMatch(source, /\(damaged\)/i, `${label}: no "(damaged)" suffix may be pasted onto a product name`)
}

console.log('PASS damaged is a tag beside the name on every returns surface, never a rename')

// ---------------------------------------------------------------------------
// 6. "for damaged restock option, only shown for us, not in receipt"
// ---------------------------------------------------------------------------
// The chooser lives only on the returns surface, which is itself gated on the
// 'returns' permission...
assert.match(newReturn, /STOCK_ACTION_OPTIONS\.map/, 'the restock/damaged chooser lives on the internal returns surface')
assert.match(salesHub, /getPermissionTier\('returns'\) !== 'none'/, "the returns surface is gated on the 'returns' permission")
// ...and nothing about it reaches anything the customer is handed. This is a
// payload fact, not a CSS one: the words are absent from the receipt sources
// entirely, so there is nothing to hide.
for (const [label, source] of [
  ['on-screen receipt', receipt],
  ['printed receipt', printReceipt],
] as Array<[string, string]>) {
  for (const word of ['stock_action', 'restock', 'damaged']) {
    assert.ok(!source.includes(word), `${label}: must not carry "${word}" -- the restock choice is internal`)
  }
}

console.log('PASS the restock/damaged choice is internal only and reaches no customer-facing receipt')

// ---------------------------------------------------------------------------
// i18n: both packs, additive, and the superseded copy retired
// ---------------------------------------------------------------------------
const ADDED = [
  'stock_action_restock', 'stock_action_restock_desc',
  'stock_action_damaged', 'stock_action_damaged_desc',
  'stock_action_none', 'stock_action_none_desc',
  'receipt_matches', 'no_receipts_found', 'receipt_pick_one',
  'replacement_same_item', 'damaged_items_tag',
]
for (const key of ADDED) {
  assert.ok(en[key], `en.json must define ${key}`)
  assert.ok(km[key], `km.json must define ${key}`)
  assert.notStrictEqual(km[key], en[key], `${key} must actually be translated, not the English string copied across`)
}
// The superseded "replacement = same-name stock" model and the per-item add
// button it belonged to are gone from the UI, so their copy goes too.
for (const key of ['replacement_items_label', 'replacement_items_short', 'add_replacement_sale_item']) {
  assert.ok(!(key in en), `en.json must drop the stale key ${key}`)
  assert.ok(!(key in km), `km.json must drop the stale key ${key}`)
}

console.log('PASS returns exchange copy is translated in both packs and the superseded copy is retired')
