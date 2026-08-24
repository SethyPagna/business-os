// Pure column-mapping helpers for DatedStockReconciliationModal.tsx,
// pulled out into their own non-JSX module so a plain node test script can
// import them directly -- node's built-in loader can't parse the .tsx
// file's JSX. See datedStockReconciliationModal.test.ts.

// Target fields this import can use, in the order shown on the mapping
// screen. Mirrors lib/datedStockCountResolve.ts's own RawDatedCountRow
// shape exactly -- these are the only fields the backend understands.
export const TARGET_FIELDS: { key: string; label: string; required: boolean; hint: string }[] = [
  { key: 'date', label: 'Count date', required: true, hint: 'The date this snapshot was taken (any common date format).' },
  { key: 'branchName', label: 'Branch', required: true, hint: 'Branch name -- an unrecognized one is created automatically.' },
  { key: 'count', label: 'Counted quantity', required: true, hint: 'The stock quantity counted on that date.' },
  { key: 'productName', label: 'Product name', required: false, hint: 'At least one of Product name / SKU / Barcode is required.' },
  { key: 'sku', label: 'SKU', required: false, hint: 'Matched first if present.' },
  { key: 'barcode', label: 'Barcode', required: false, hint: 'Matched second, after SKU.' },
  { key: 'sellingPriceUsd', label: 'Selling price (USD)', required: false, hint: 'Optional -- only used to flag a price conflict for review.' },
  { key: 'sellingPriceKhr', label: 'Selling price (KHR)', required: false, hint: 'Optional -- only used to flag a price conflict for review.' },
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
