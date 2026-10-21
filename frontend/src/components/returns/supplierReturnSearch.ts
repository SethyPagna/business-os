import {
  barcodeKeysMatch,
  barcodeSearchKeys,
  foldNativeDigits,
  searchTermBarcodeKeys,
  sortBySearchRelevance,
} from '../../utils/searchMatch.ts'

export interface SupplierReturnSearchProduct {
  name?: unknown
  sku?: unknown
  barcode?: unknown
  category?: unknown
  brand?: unknown
}

const isUpcPairKey = (key: string): boolean => key.startsWith('upca:') || key.startsWith('upce:')

export function supplierReturnProductMatchesSearch(
  product: SupplierReturnSearchProduct,
  rawQuery: unknown,
): boolean {
  const raw = String(rawQuery ?? '').trim()
  if (!raw) return true

  const queryBarcodeKeys = searchTermBarcodeKeys(raw)
  if (queryBarcodeKeys.length && barcodeKeysMatch(product.barcode, raw)) return true

  const term = raw.toLowerCase()
  const textHaystack = `${product.name || ''} ${product.sku || ''} ${product.category || ''} ${product.brand || ''}`.toLowerCase()
  if (textHaystack.includes(term)) return true

  // Both sides fold Khmer digits (a gun on the Khmer layout types them), but only
  // for the barcode: a Khmer numeral in a name stays as typed.
  const barcodeText = foldNativeDigits(String(product.barcode ?? '').trim().toLowerCase())
  if (!barcodeText.includes(foldNativeDigits(term))) return false

  // A valid UPC-E and its UPC-A expansion can share the same stripped text
  // with an unrelated seven-digit internal code. Once either side is in the
  // validated UPC keyspace, barcode fallback must use the namespaced pair.
  const productBarcodeKeys = barcodeSearchKeys(product.barcode)
  return !queryBarcodeKeys.some(isUpcPairKey) && !productBarcodeKeys.some(isUpcPairKey)
}

export function filterAndRankSupplierReturnProducts<T extends SupplierReturnSearchProduct>(
  products: readonly T[],
  rawQuery: unknown,
): T[] {
  const raw = String(rawQuery ?? '').trim()
  if (!raw) return products.slice()
  return sortBySearchRelevance(
    products.filter((product) => supplierReturnProductMatchesSearch(product, raw)),
    raw,
  )
}
