// Pure column-mapping helpers for DatedStockReconciliationModal.tsx,
// pulled out into their own non-JSX module so a plain node test script can
// import them directly -- node's built-in loader can't parse the .tsx
// file's JSX. See datedStockReconciliationModal.test.ts.

// Target fields this import can use, in the order shown on the mapping
// screen. Mirrors lib/datedStockCountResolve.ts's own RawDatedCountRow
// shape exactly -- these are the only fields the backend understands.
// tKey/hintKey name the pack keys DatedStockReconciliationModal.tsx looks
// up for the label/hint (real Khmer in both frontend/src/lang/*.json) --
// label/hint stay as the English fallback T() falls back to, never rendered
// bare.
export const TARGET_FIELDS: { key: string; label: string; tKey: string; required: boolean; hint: string; hintKey: string }[] = [
  { key: 'date', label: 'Count date', tKey: 'dated_count_field_date', required: true, hint: 'The date this snapshot was taken (any common date format).', hintKey: 'dated_count_field_date_hint' },
  { key: 'branchName', label: 'Branch', tKey: 'dated_count_field_branch', required: true, hint: 'Branch name -- an unrecognized one is created automatically.', hintKey: 'dated_count_field_branch_hint' },
  { key: 'count', label: 'Counted quantity', tKey: 'dated_count_field_count', required: true, hint: 'The stock quantity counted on that date.', hintKey: 'dated_count_field_count_hint' },
  { key: 'productName', label: 'Product name', tKey: 'dated_count_field_product_name', required: false, hint: 'At least one of Product name / SKU / Barcode is required.', hintKey: 'dated_count_field_product_name_hint' },
  { key: 'sku', label: 'SKU', tKey: 'dated_count_field_sku', required: false, hint: 'Matched first if present.', hintKey: 'dated_count_field_sku_hint' },
  { key: 'barcode', label: 'Barcode', tKey: 'dated_count_field_barcode', required: false, hint: 'Matched second, after SKU.', hintKey: 'dated_count_field_barcode_hint' },
  { key: 'sellingPriceUsd', label: 'Selling price (USD)', tKey: 'dated_count_field_price_usd', required: false, hint: 'Optional -- only used to flag a price conflict for review.', hintKey: 'dated_count_field_price_usd_hint' },
  { key: 'sellingPriceKhr', label: 'Selling price (KHR)', tKey: 'dated_count_field_price_khr', required: false, hint: 'Optional -- only used to flag a price conflict for review.', hintKey: 'dated_count_field_price_khr_hint' },
]

// Loose fuzzy match so a header like "Branch Name" or "branch_name" still
// auto-suggests onto the `branchName` target without the person having to
// map every column by hand.
export function normalizeHeaderForMatch(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function autoMapHeaders(headers: string[]): Record<string, string> {
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeaderForMatch(h) }))
  const map: Record<string, string> = {}
  const aliases: Record<string, string[]> = {
    date: ['date', 'countdate', 'snapshotdate'],
    branchName: ['branch', 'branchname', 'store', 'location'],
    count: ['count', 'countedqty', 'quantity', 'qty', 'stockqty', 'stockquantity'],
    productName: ['name', 'productname', 'product', 'item', 'itemname'],
    sku: ['sku'],
    barcode: ['barcode', 'upc', 'ean'],
    sellingPriceUsd: ['sellingpriceusd', 'priceusd', 'usdprice', 'sellingprice'],
    sellingPriceKhr: ['sellingpricekhr', 'pricekhr', 'khrprice'],
  }
  for (const field of TARGET_FIELDS) {
    const candidates = aliases[field.key] || [field.key.toLowerCase()]
    const hit = normalizedHeaders.find((h) => candidates.includes(h.norm))
    if (hit) map[field.key] = hit.raw
  }
  return map
}
