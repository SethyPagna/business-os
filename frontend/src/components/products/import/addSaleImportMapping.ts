// Pure column-mapping helpers for the General mode "Add/Sale" import
// sub-option's wizard UI (see progress.md's "CSV-import mode selector"
// item). Mirrors datedStockReconciliationMapping.ts's own shape and
// approach exactly -- same TARGET_FIELDS + normalizeHeaderForMatch +
// autoMapHeaders pattern -- plus one thing that file doesn't need:
// applyAddSaleMapping(), which actually turns raw parsed rows into the
// AddSaleImportRow shape that addSaleImportResolve.ts's functions
// consume. Nothing here writes to the DB or renders UI.

import type { AddSaleImportRow } from './addSaleImportResolve.ts'

// Target fields for the Add/Sale template, in the order shown on the
// mapping screen. Per the spec: product name, barcode, stock quantity,
// branch, and selling price are the hard-required minimum columns;
// everything else (SKU, cost price, action/sale-grouping, discount,
// fees, customer) is optional -- cost price's own hard block is a
// business rule enforced later by resolveAddSaleCostPrices(), not a
// column-mapping requirement, so it's marked optional here same as
// every other optional field.
export const TARGET_FIELDS: { key: string; label: string; required: boolean; hint: string }[] = [
  { key: 'name', label: 'Product name', required: true, hint: 'The product being sold.' },
  { key: 'barcode', label: 'Barcode', required: true, hint: 'Used to match this row to an existing product.' },
  { key: 'branch', label: 'Branch', required: true, hint: 'Which branch this sale/stock is for -- these rows are branch-specific.' },
  { key: 'quantity', label: 'Stock quantity', required: true, hint: 'How many units this row covers.' },
  { key: 'sellingPriceUsd', label: 'Selling price (USD)', required: false, hint: 'At least one of Selling price (USD) / Selling price (KHR) is required. Adjustable per sale -- never overwrites the product\'s own price.' },
  { key: 'sellingPriceKhr', label: 'Selling price (KHR)', required: false, hint: 'At least one of Selling price (USD) / Selling price (KHR) is required. Adjustable per sale -- never overwrites the product\'s own price.' },
  { key: 'sku', label: 'SKU', required: false, hint: 'Matched after barcode, before name.' },
  { key: 'costPriceUsd', label: 'Cost price (USD)', required: false, hint: 'If blank, must resolve via a matched product before import can proceed.' },
  { key: 'costPriceKhr', label: 'Cost price (KHR)', required: false, hint: 'Optional even when cost price (USD) is supplied.' },
  { key: 'action', label: 'Sale group', required: false, hint: 'Rows sharing this label (e.g. "sale1") bundle into one receipt.' },
  { key: 'customer', label: 'Customer/member', required: false, hint: 'Optional per row -- blank stays anonymous/import-flagged.' },
  { key: 'discount', label: 'Discount', required: false, hint: 'Optional, per row.' },
  { key: 'fees', label: 'Fees', required: false, hint: 'Optional, per row.' },
]

// Maps a TARGET_FIELDS key (camelCase, matches the mapping screen) to
// the snake_case field name AddSaleImportRow actually uses.
const ROW_FIELD_BY_TARGET_KEY: Record<string, string> = {
  name: 'name',
  barcode: 'barcode',
  sku: 'sku',
  branch: 'branch',
  quantity: 'quantity',
  sellingPriceUsd: 'selling_price_usd',
  sellingPriceKhr: 'selling_price_khr',
  costPriceUsd: 'cost_price_usd',
  costPriceKhr: 'cost_price_khr',
  action: 'action',
  customer: 'customer',
  discount: 'discount',
  fees: 'fees',
}

// Loose fuzzy match so a header like "Branch Name" or "branch_name"
// still auto-suggests onto the `branch` target without the person
// having to map every column by hand. Identical to
// datedStockReconciliationMapping.ts's own helper -- duplicated rather
// than imported since that file's helper isn't exported for reuse and
// this one is meant to stay a standalone, single-purpose module like
// every other *Mapping.ts in this app's import system.
export function normalizeHeaderForMatch(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function autoMapHeaders(headers: string[]): Record<string, string> {
  const normalizedHeaders = headers.map((h) => ({ raw: h, norm: normalizeHeaderForMatch(h) }))
  const map: Record<string, string> = {}
  const aliases: Record<string, string[]> = {
    name: ['name', 'productname', 'product', 'item', 'itemname'],
    barcode: ['barcode', 'upc', 'ean'],
    branch: ['branch', 'branchname', 'store', 'location'],
    quantity: ['quantity', 'qty', 'stockqty', 'stockquantity'],
    sellingPriceUsd: ['sellingpriceusd', 'priceusd', 'usdprice', 'sellingprice', 'price'],
    sellingPriceKhr: ['sellingpricekhr', 'pricekhr', 'khrprice'],
    sku: ['sku'],
    costPriceUsd: ['costpriceusd', 'costusd', 'usdcost', 'costprice', 'cost'],
    costPriceKhr: ['costpricekhr', 'costkhr', 'khrcost'],
    action: ['action', 'sale', 'salegroup', 'receipt', 'saleid'],
    customer: ['customer', 'member', 'customername', 'membername', 'customermember'],
    discount: ['discount'],
    fees: ['fees', 'fee'],
  }
  for (const field of TARGET_FIELDS) {
    const candidates = aliases[field.key] || [field.key.toLowerCase()]
    const hit = normalizedHeaders.find((h) => candidates.includes(h.norm))
    if (hit) map[field.key] = hit.raw
  }
  return map
}

// Which TARGET_FIELDS labels are still unmapped/unsatisfied, given a
// mapping -- individually-required fields plus the
// sellingPriceUsd/sellingPriceKhr "at least one" group, which can't be
// expressed as a single field's `required` flag. Empty array means the
// mapping is complete enough to proceed to row conversion.
export function getUnmetRequiredFields(mapping: Record<string, string>): string[] {
  const missing: string[] = []
  for (const field of TARGET_FIELDS) {
    if (field.required && !mapping[field.key]) missing.push(field.label)
  }
  if (!mapping.sellingPriceUsd && !mapping.sellingPriceKhr) {
    missing.push('Selling price (USD or KHR)')
  }
  return missing
}

// Converts raw parsed rows (each a plain object keyed by the file's
// own headers) into AddSaleImportRow shape, using a confirmed mapping
// from TARGET_FIELDS key -> the raw header it corresponds to. A target
// field with no mapped header, or a row with no value under that
// header, is simply left unset on the resulting row -- same
// leave-it-blank-and-let-downstream-resolution-decide behavior as
// every other optional field in this import mode; only
// getUnmetRequiredFields() above gates whether conversion should even
// be attempted.
export function applyAddSaleMapping(
  rawRows: Record<string, unknown>[],
  mapping: Record<string, string>,
): AddSaleImportRow[] {
  return rawRows.map((raw) => {
    const row: AddSaleImportRow = {}
    for (const field of TARGET_FIELDS) {
      const header = mapping[field.key]
      if (!header) continue
      const value = raw[header]
      if (value === undefined || value === null) continue
      const rowField = ROW_FIELD_BY_TARGET_KEY[field.key] ?? field.key
      ;(row as Record<string, unknown>)[rowField] = value
    }
    return row
  })
}
