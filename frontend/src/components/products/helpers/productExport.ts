import { formatPriceNumber } from '../../../utils/pricing.ts'

interface BranchStockRecord {
  branch_id?: unknown
  branch_name?: unknown
  quantity?: unknown
}

interface ProductRecord {
  barcode?: unknown
  branch_stock?: BranchStockRecord[]
  brand?: unknown
  category?: unknown
  cost_price_khr?: unknown
  cost_price_usd?: unknown
  created_at?: unknown
  description?: unknown
  discount_amount_khr?: unknown
  discount_amount_usd?: unknown
  discount_badge_color?: unknown
  discount_enabled?: unknown
  discount_ends_at?: unknown
  discount_label?: unknown
  discount_percent?: unknown
  discount_starts_at?: unknown
  discount_type?: unknown
  image_gallery?: unknown[]
  image_path?: unknown
  is_active?: unknown
  is_group?: unknown
  low_stock_threshold?: unknown
  name?: unknown
  parent_id?: unknown
  selling_price_khr?: unknown
  selling_price_usd?: unknown
  sku?: unknown
  special_price_khr?: unknown
  special_price_usd?: unknown
  stock_quantity?: unknown
  supplier?: unknown
  unit?: unknown
  [key: string]: unknown
}

type ProductExportRow = Record<string, string | number>

export type ExportFieldGroup = 'basic' | 'pricing' | 'discount' | 'stock' | 'supplier' | 'images'

// Column membership per group, used to build an optional field picker
// (ExportFieldsModal.tsx) so users aren't forced to export every column
// every time. Name/SKU/Barcode/Category/Brand/Unit/Description/Created_At/
// Active/Is_Group/Parent_ID live in 'basic' and stay in the export even if
// a caller narrows the group set to something that would otherwise leave no
// usable identifying columns -- see ALWAYS_INCLUDED_COLUMNS below.
export const EXPORT_FIELD_GROUPS: Array<{ key: ExportFieldGroup; columns: string[] }> = [
  { key: 'basic', columns: ['Name', 'SKU', 'Barcode', 'Category', 'Brand', 'Unit', 'Description', 'Created_At', 'Active', 'Is_Group', 'Parent_ID'] },
  { key: 'pricing', columns: ['Selling_Price_USD', 'Selling_Price_KHR', 'Special_Price_USD', 'Special_Price_KHR', 'Cost_Price_USD', 'Cost_Price_KHR'] },
  { key: 'discount', columns: ['Discount_Enabled', 'Discount_Type', 'Discount_Percent', 'Discount_Amount_USD', 'Discount_Amount_KHR', 'Discount_Label', 'Discount_Badge_Color', 'Discount_Starts_At', 'Discount_Ends_At'] },
  { key: 'stock', columns: ['Stock_Quantity', 'Low_Stock_Threshold', 'Branch', 'Branch_Stock_JSON'] },
  { key: 'supplier', columns: ['Supplier'] },
  { key: 'images', columns: ['Image_Filename_1', 'Image_Filename_2', 'Image_Filename_3', 'Image_Filename_4', 'Image_Filename_5', 'Image_URL_1', 'Image_URL_2', 'Image_URL_3', 'Image_URL_4', 'Image_URL_5', 'Image_Filenames', 'Image_URLs', 'Image_Conflict_Mode'] },
]

// Never dropped regardless of which groups are selected -- without at
// least the product name, an exported row is unusable/unidentifiable.
const ALWAYS_INCLUDED_COLUMNS = new Set(['Name'])

export type BuildProductExportRowsOptions = {
  groups?: ExportFieldGroup[]
  // When set (a branch id, as the export scope's own branch filter -- see
  // Products.tsx's exportProductsCsv), Stock_Quantity and Branch reflect
  // THAT branch's own row, not the cross-branch aggregate/first-nonzero-
  // branch fallback below. Without this, exporting "Current filtered
  // results" while filtered to one branch still wrote the OTHER branches'
  // stock into every row's Stock_Quantity (it's products.stock_quantity,
  // a SUM across every branch -- see importEngine.ts's own comment on why
  // that column is never branch-specific) -- reimporting that file against
  // the filtered branch would have overwritten it with every branch's
  // combined total instead of just its own, silently duplicating stock
  // that already existed at other branches. Mirrors the same
  // branch-lookup getProductBranchQuantity in productFilterHelpers.ts
  // already uses for on-screen branch-filtered stock display, so the
  // exported number always matches what the page showed when exporting.
  branchId?: string | number | null
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function getImageGallery(product: ProductRecord): unknown[] {
  return Array.isArray(product?.image_gallery) ? product.image_gallery : []
}

export function buildProductExportRows(products: ProductRecord[] = [], options: BuildProductExportRowsOptions = {}): ProductExportRow[] {
  const toImageName = (value: unknown) => String(value || '').split(/[\\/]/).pop() || ''
  const toImageUrl = (value: unknown) => String(value || '').trim()
  const priceCsv = (value: unknown) => formatPriceNumber(value || 0)
  const branchId = options.branchId != null && String(options.branchId) !== 'all' ? options.branchId : null
  const allowedColumns = options.groups
    ? new Set([
      ...ALWAYS_INCLUDED_COLUMNS,
      ...EXPORT_FIELD_GROUPS.filter((group) => options.groups!.includes(group.key)).flatMap((group) => group.columns),
    ])
    : null

  return products.map((product) => {
    const imageGallery = getImageGallery(product)
    const row: ProductExportRow = {
      Name: String(product.name || ''),
      SKU: String(product.sku || ''),
      Barcode: String(product.barcode || ''),
      Category: String(product.category || ''),
      Brand: String(product.brand || ''),
      Unit: String(product.unit || ''),
      Description: String(product.description || ''),
      Created_At: String(product.created_at || ''),
      Selling_Price_USD: priceCsv(product.selling_price_usd),
      Selling_Price_KHR: priceCsv(product.selling_price_khr),
      Special_Price_USD: priceCsv(product.special_price_usd || product.selling_price_usd || 0),
      Special_Price_KHR: priceCsv(product.special_price_khr || product.selling_price_khr || 0),
      Discount_Enabled: product.discount_enabled ? 'Yes' : 'No',
      Discount_Type: String(product.discount_type || 'percent'),
      Discount_Percent: priceCsv(product.discount_percent || 0),
      Discount_Amount_USD: priceCsv(product.discount_amount_usd || 0),
      Discount_Amount_KHR: priceCsv(product.discount_amount_khr || 0),
      Discount_Label: String(product.discount_label || ''),
      Discount_Badge_Color: String(product.discount_badge_color || ''),
      Discount_Starts_At: String(product.discount_starts_at || ''),
      Discount_Ends_At: String(product.discount_ends_at || ''),
      Cost_Price_USD: priceCsv(product.cost_price_usd || 0),
      Cost_Price_KHR: priceCsv(product.cost_price_khr || 0),
      Stock_Quantity: branchId != null
        ? toNumber((product.branch_stock || []).find((stock) => String(stock.branch_id) === String(branchId))?.quantity)
        : toNumber(product.stock_quantity),
      Low_Stock_Threshold: toNumber(product.low_stock_threshold),
      Supplier: String(product.supplier || ''),
      Image_Filename_1: toImageName(imageGallery[0] || product.image_path || ''),
      Image_Filename_2: toImageName(imageGallery[1] || ''),
      Image_Filename_3: toImageName(imageGallery[2] || ''),
      Image_Filename_4: toImageName(imageGallery[3] || ''),
      Image_Filename_5: toImageName(imageGallery[4] || ''),
      Image_URL_1: toImageUrl(imageGallery[0] || product.image_path || ''),
      Image_URL_2: toImageUrl(imageGallery[1] || ''),
      Image_URL_3: toImageUrl(imageGallery[2] || ''),
      Image_URL_4: toImageUrl(imageGallery[3] || ''),
      Image_URL_5: toImageUrl(imageGallery[4] || ''),
      Image_Filenames: imageGallery.map((entry) => toImageName(entry)).filter(Boolean).join('|'),
      Image_URLs: imageGallery.map((entry) => toImageUrl(entry)).filter(Boolean).join('|'),
      Image_Conflict_Mode: '',
      Branch: (() => {
        // Same branchId-scoped rule as Stock_Quantity above: when the
        // export is scoped to one branch, name THAT branch, even if it
        // currently carries 0 (still tracked -- see Part 215's
        // allActiveBranchIds seeding -- so a 0 row here is real, not a
        // sign the row is missing/skippable). Falls back to the previous
        // "first branch with any stock" heuristic only for an
        // unscoped/full-catalog export, where there's no single branch to
        // prefer.
        if (branchId != null) {
          const scoped = (product.branch_stock || []).find((stock) => String(stock.branch_id) === String(branchId))
          return String(scoped?.branch_name || '')
        }
        const primary = (product.branch_stock || []).find((stock) => toNumber(stock.quantity) > 0)
        return String(primary?.branch_name || '')
      })(),
      Branch_Stock_JSON: JSON.stringify((product.branch_stock || []).map((stock) => ({
        branch_id: stock.branch_id,
        branch_name: stock.branch_name,
        quantity: toNumber(stock.quantity),
      }))),
      Parent_ID: String(product.parent_id || ''),
      Is_Group: product.is_group ? 'Yes' : 'No',
      Active: product.is_active ? 'Yes' : 'No',
    }
    if (!allowedColumns) return row
    const filtered: ProductExportRow = {}
    for (const key of Object.keys(row)) {
      if (allowedColumns.has(key)) filtered[key] = row[key]
    }
    return filtered
  })
}
