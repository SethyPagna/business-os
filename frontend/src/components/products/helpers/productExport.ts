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
  purchase_price_khr?: unknown
  purchase_price_usd?: unknown
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

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function getImageGallery(product: ProductRecord): unknown[] {
  return Array.isArray(product?.image_gallery) ? product.image_gallery : []
}

export function buildProductExportRows(products: ProductRecord[] = []): ProductExportRow[] {
  const toImageName = (value: unknown) => String(value || '').split(/[\\/]/).pop() || ''
  const toImageUrl = (value: unknown) => String(value || '').trim()
  const priceCsv = (value: unknown) => formatPriceNumber(value || 0)
  return products.map((product) => {
    const imageGallery = getImageGallery(product)
    return {
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
      Purchase_Price_USD: priceCsv(product.purchase_price_usd || product.cost_price_usd || 0),
      Purchase_Price_KHR: priceCsv(product.purchase_price_khr || product.cost_price_khr || 0),
      Cost_Price_USD: priceCsv(product.cost_price_usd || product.purchase_price_usd || 0),
      Cost_Price_KHR: priceCsv(product.cost_price_khr || product.purchase_price_khr || 0),
      Stock_Quantity: toNumber(product.stock_quantity),
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
  })
}
