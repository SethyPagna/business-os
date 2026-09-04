// Replace mode (column-level) -- Part 320/321 (chat). Grouped into a
// handful of labeled clusters, same "compact by default" reasoning
// CONFLICT_FILTER_OPTIONS already uses in BulkImportModal.tsx, rather
// than one checkbox per column. Extracted into its own pure module
// (instead of living inline in the component) so the one property that
// actually matters -- every column on the backend's own allow-list
// (`PRODUCT_REPLACE_COLUMNS` in cloudflare/src/lib/importEngine.ts)
// appears in exactly one group here, nothing more and nothing less --
// can be asserted by a real test instead of only by this file's own
// comment. If a future edit adds/removes a column from either list
// without mirroring it in the other, an operator picking a group could
// silently stop actually overwriting a field the backend no longer
// recognizes (it drops unrecognized columns rather than erroring).
//
// This is the single source of truth for the group data -- imported by
// BulkImportModal.tsx, not duplicated there. See
// frontend/tests/productReplaceColumnGroups.test.ts for the partition
// guard test this comment promises.

export interface ReplaceColumnGroup {
  key: string
  label: string
  hint: string
  columns: string[]
}

export const REPLACE_COLUMN_GROUPS: ReplaceColumnGroup[] = [
  { key: 'basic', label: 'Name, SKU, barcode', hint: 'Core identity fields', columns: ['name', 'sku', 'barcode'] },
  { key: 'category', label: 'Category & brand', hint: 'Category, brand, unit, supplier', columns: ['category', 'categories', 'brand', 'brands', 'unit', 'supplier'] },
  { key: 'description', label: 'Description', hint: '', columns: ['description'] },
  { key: 'pricing', label: 'Pricing', hint: 'Selling, wholesale, and cost price (USD/KHR)', columns: ['selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'cost_price_usd', 'cost_price_khr'] },
  { key: 'thresholds', label: 'Stock thresholds', hint: 'Low stock / out of stock alert levels', columns: ['low_stock_threshold', 'out_of_stock_threshold'] },
  { key: 'discount', label: 'Discount', hint: 'Promotion settings and badge', columns: ['discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd', 'discount_amount_khr', 'discount_label', 'discount_badge_color', 'discount_starts_at', 'discount_ends_at'] },
  { key: 'expiry', label: 'Expiry', hint: '', columns: ['expiry_date', 'expiry_alert_days'] },
  { key: 'status', label: 'Active status', hint: '', columns: ['is_active'] },
  { key: 'image', label: 'Image', hint: 'Main product image only', columns: ['image_path'] },
]

// Mirrors cloudflare/src/lib/importEngine.ts's own PRODUCT_REPLACE_COLUMNS
// exactly -- kept as a literal copy rather than importing across the
// frontend/backend boundary (this project's frontend and cloudflare
// packages don't share a module graph), with the partition test in
// productReplaceColumnGroups.test.ts as the guard against the two ever
// drifting apart silently.
export const BACKEND_PRODUCT_REPLACE_COLUMNS = [
  'name', 'sku', 'barcode', 'category', 'categories', 'unit', 'description',
  'brand', 'brands', 'supplier',
  'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr',
  'cost_price_usd', 'cost_price_khr',
  'low_stock_threshold', 'out_of_stock_threshold',
  'discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd', 'discount_amount_khr',
  'discount_label', 'discount_badge_color', 'discount_starts_at', 'discount_ends_at',
  'expiry_date', 'expiry_alert_days', 'is_active', 'image_path',
]

export function flattenReplaceColumnGroups(selectedKeys: Set<string> | string[]): string[] {
  const keys = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys)
  return REPLACE_COLUMN_GROUPS
    .filter((group) => keys.has(group.key))
    .flatMap((group) => group.columns)
}
