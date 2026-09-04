import { fmtBusinessIsoDateTime } from './formatters.ts'

export const SALES_IMPORT_COLUMNS = [
  'receipt_number', 'sale_date', 'sale_status', 'payment_method', 'payment_currency', 'exchange_rate',
  'branch', 'customer_name', 'customer_phone', 'customer_address', 'cashier_name',
  'name', 'sku', 'barcode', 'quantity', 'unit_price_usd', 'unit_price_khr',
  'base_price_usd', 'base_price_khr',
  'product_discount_type', 'product_discount_label', 'product_discount_usd', 'product_discount_khr',
  'manual_discount_type', 'manual_discount_value', 'manual_discount_usd', 'manual_discount_khr',
  'cost_price_usd', 'cost_price_khr', 'batch_label', 'returned_quantity',
  'discount_usd', 'discount_khr', 'tax_usd', 'amount_paid_usd', 'amount_paid_khr',
  'membership_discount_usd', 'membership_discount_khr', 'membership_points_redeemed',
  'is_delivery', 'delivery_contact_name', 'delivery_contact_phone', 'delivery_contact_address',
  'delivery_fee_usd', 'delivery_fee_khr', 'delivery_fee_paid_by',
  // C4: staff-only figures -- the export is behind the sales permission and
  // receipts/portal never read this contract. Blank means "not recorded",
  // never 0 (the importer stores NULL for blank).
  'delivery_actual_cost_usd', 'delivery_actual_cost_khr', 'notes',
] as const

export const SALES_TEMPLATE_COLUMNS_TEXT = SALES_IMPORT_COLUMNS.join(', ')

type DataRow = Record<string, unknown>

function value(row: DataRow | null | undefined, key: string, fallback: unknown = ''): unknown {
  const current = row?.[key]
  return current === null || current === undefined ? fallback : current
}

function saleItems(sale: DataRow): DataRow[] {
  if (Array.isArray(sale.items)) return sale.items as DataRow[]
  if (typeof sale.items === 'string') {
    try {
      const parsed = JSON.parse(sale.items)
      return Array.isArray(parsed) ? parsed : []
    } catch { return [] }
  }
  return []
}

function headerFields(sale: DataRow): DataRow {
  return {
    receipt_number: value(sale, 'receipt_number'),
    // ISO, deliberately, even though the app displays dates day-first: this
    // cell is read BACK by parseSalesImportDateTime, whose slash branch is
    // month-first forever (every sheet the shop already has keeps its
    // present meaning). A day-first cell here would re-import as a
    // different date without failing. Same instant, same business
    // timezone, same 24-hour clock -- only the field order is ISO.
    sale_date: sale.created_at ? fmtBusinessIsoDateTime(sale.created_at as string) : '',
    sale_status: value(sale, 'sale_status', 'completed'),
    payment_method: value(sale, 'payment_method', 'Cash'),
    payment_currency: value(sale, 'payment_currency', 'USD'),
    exchange_rate: value(sale, 'exchange_rate', 4100),
    branch: value(sale, 'branch_name'),
    customer_name: value(sale, 'customer_name'),
    customer_phone: value(sale, 'customer_phone'),
    customer_address: value(sale, 'customer_address'),
    cashier_name: value(sale, 'cashier_name'),
    discount_usd: value(sale, 'discount_usd', 0),
    discount_khr: value(sale, 'discount_khr', 0),
    tax_usd: value(sale, 'tax_usd', 0),
    amount_paid_usd: value(sale, 'amount_paid_usd', 0),
    amount_paid_khr: value(sale, 'amount_paid_khr', 0),
    membership_discount_usd: value(sale, 'membership_discount_usd', 0),
    membership_discount_khr: value(sale, 'membership_discount_khr', 0),
    membership_points_redeemed: value(sale, 'membership_points_redeemed', 0),
    is_delivery: value(sale, 'is_delivery', 0),
    delivery_contact_name: value(sale, 'delivery_contact_name'),
    delivery_contact_phone: value(sale, 'delivery_contact_phone'),
    delivery_contact_address: value(sale, 'delivery_contact_address'),
    delivery_fee_usd: value(sale, 'delivery_fee_usd', 0),
    delivery_fee_khr: value(sale, 'delivery_fee_khr', 0),
    delivery_fee_paid_by: value(sale, 'delivery_fee_paid_by', 'customer'),
    // NULL (not recorded) exports as blank, deliberately not 0.
    delivery_actual_cost_usd: value(sale, 'delivery_actual_cost_usd', ''),
    delivery_actual_cost_khr: value(sale, 'delivery_actual_cost_khr', ''),
    notes: value(sale, 'notes'),
  }
}

function itemFields(item: DataRow): DataRow {
  return {
    name: value(item, 'product_name'),
    sku: value(item, 'sku'),
    barcode: value(item, 'barcode'),
    quantity: value(item, 'quantity', 1),
    unit_price_usd: value(item, 'applied_price_usd', 0),
    unit_price_khr: value(item, 'applied_price_khr', 0),
    base_price_usd: value(item, 'base_price_usd', value(item, 'applied_price_usd', 0)),
    base_price_khr: value(item, 'base_price_khr', value(item, 'applied_price_khr', 0)),
    product_discount_type: value(item, 'product_discount_type'),
    product_discount_label: value(item, 'product_discount_label'),
    product_discount_usd: value(item, 'product_discount_usd', 0),
    product_discount_khr: value(item, 'product_discount_khr', 0),
    manual_discount_type: value(item, 'manual_discount_type'),
    manual_discount_value: value(item, 'manual_discount_value', 0),
    manual_discount_usd: value(item, 'manual_discount_usd', 0),
    manual_discount_khr: value(item, 'manual_discount_khr', 0),
    cost_price_usd: value(item, 'cost_price_usd', 0),
    cost_price_khr: value(item, 'cost_price_khr', 0),
    batch_label: value(item, 'batch_label'),
    returned_quantity: value(item, 'returned_quantity'),
  }
}

// Every new sale starts with a non-blank receipt_number. Only that first
// line carries order/customer/payment data; blank header cells on following
// rows explicitly mean “same sale as above.” Item fields are never inherited.
export function buildSalesImportRows(sales: DataRow[] = []): DataRow[] {
  const rows: DataRow[] = []
  for (const sale of sales) {
    const items = saleItems(sale)
    const effectiveItems = items.length ? items : [{}]
    effectiveItems.forEach((item, index) => {
      const combined = { ...(index === 0 ? headerFields(sale) : {}), ...itemFields(item) }
      const ordered: DataRow = {}
      for (const column of SALES_IMPORT_COLUMNS) ordered[column] = combined[column] ?? ''
      rows.push(ordered)
    })
  }
  return rows
}

export const SALES_IMPORT_EXAMPLE_ROWS: DataRow[] = buildSalesImportRows([{
  receipt_number: 'RCT-1001', created_at: '2026-08-28T07:30:00.000Z', sale_status: 'completed',
  payment_method: 'Cash', payment_currency: 'USD', exchange_rate: 4100, branch_name: 'Main Branch',
  customer_name: 'Dara', customer_phone: '012345678', amount_paid_usd: 7.5, notes: 'Two-item sale',
  items: [
    { product_name: 'Iced Coffee', sku: 'BEV-001', quantity: 2, applied_price_usd: 2.5, cost_price_usd: 1.2 },
    { product_name: 'Croissant', sku: 'FOOD-002', quantity: 1, applied_price_usd: 2.5, cost_price_usd: 1.1 },
  ],
}])
