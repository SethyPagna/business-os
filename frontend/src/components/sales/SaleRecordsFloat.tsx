// The sale's RECORDS vocabulary: what each kind of sale change is called, and
// how each before/after value is rendered.
//
// The owner, Sep 6 2026: "one line called Records with total records when press
// it pops up a float with who made changes in this sales record (by default
// should show change status / add sale / edit product quantity / change
// delivery fee / or + for matching conditions, and click on specific
// information/record row can see more details before and after."
//
// The float ITSELF -- the read-only Modal, the kind filter, press-to-open, the
// Field | Before | After table -- is components/shared/RecordsFloat.tsx, which
// four surfaces now share (a sale, a return, a product, a contact). What stays
// here is only what is true of a SALE and of nothing else:
//
//   * its kinds are a CLOSED set the Worker emits, so every one of them has a
//     translated label and none can print a raw snake_case identifier;
//   * its fields carry a FORMAT -- `amount_usd` is money, `quantity` a count,
//     `sale_status` a status localized elsewhere -- because rendering money as
//     a bare number ("2" for $2.00) in a list whose whole job is explaining a
//     corrected total is worse than showing nothing.
//
// Every decision the float made stayed made; it just lives one file over now.
// Nothing here fetches and nothing here formats a date.
import RecordsFloat, { RecordChangeTable } from '../shared/RecordsFloat.tsx'
import { getSaleRecords } from '../../api/salesTransport.ts'
import { getStatusLabel } from './StatusBadge.tsx'
import { formatSaleRecordValueLinesLocalized } from './saleRecordValue.ts'
import type { RecordItem, RecordRenderContext, RecordsAdapter } from '../../utils/entityRecords.ts'
import {
  SALE_RECORD_KIND_KEYS,
  saleRecordFieldRows,
  saleRecordKind,
  type SaleRecord,
  type SaleRecordFieldRow,
  type SaleRecordValue,
} from '../../utils/saleRecords.ts'

type TranslateFn = (key: string) => string

interface SaleRecordsFloatProps {
  sale: { id: number | string; receipt_number?: string | null }
  onClose: () => void
  t: TranslateFn
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

const KIND_FALLBACKS: Record<string, string> = {
  record_kind_sale_created: 'Sale recorded',
  record_kind_driver_changed: 'Driver changed',
  record_kind_status_changed: 'Status changed',
  record_kind_item_added: 'Product added',
  record_kind_item_removed: 'Product removed',
  record_kind_item_quantity_changed: 'Quantity changed',
  record_kind_item_price_changed: 'Selling price changed',
  record_kind_items_replaced: 'Products replaced',
  record_kind_delivery_fee_changed: 'Delivery fee changed',
  record_kind_delivery_cost_changed: 'Actual delivery cost changed',
  record_kind_delivery_added: 'Delivery added',
  record_kind_customer_changed: 'Customer changed',
  record_kind_membership_changed: 'Membership changed',
  record_kind_payment_changed: 'Payment changed',
  record_kind_payment_settled: 'Payment settled',
  record_kind_cancelled: 'Sale cancelled',
  record_kind_sale_items_recovered: 'Recovered missing sale products',
  record_kind_sale_stock_corrected: 'Corrected stock for Not Paid sale',
  record_kind_legacy_sale_change: 'Earlier sale change',
}

const FIELD_FALLBACKS: Record<string, string> = {
  amount: 'Amount',
  amount_paid: 'Amount paid',
  amount_paid_khr: 'Amount paid (KHR)',
  change: 'Change',
  change_khr: 'Change (KHR)',
  total: 'Sale total',
  money_calculated_total: 'Calculated total',
  money_rounding_adjustment: 'Rounding adjustment',
  quantity: 'Quantity',
  selling_price: 'Selling price',
  price: 'Price',
  product_discount: 'Product discount',
  discount_type: 'Discount type',
  discount: 'Discount',
  discount_amount_usd: 'Discount amount',
  line_total: 'Line total',
  status: 'Status',
  refund: 'Refund',
  receipt_number: 'Receipt',
  customer: 'Customer',
  membership_number: 'Membership',
  reason: 'Reason',
  note: 'Note',
  payment_method: 'Payment method',
  payment_details: 'Payment details',
  payment: 'Payment',
  items: 'Products',
  item: 'Product',
  removed_items: 'Removed products',
  added_items: 'Added products',
  product_lines: 'Product lines',
  held_units: 'Stock units',
  recovery_stock_action: 'Stock action',
  membership: 'Membership',
  delivery: 'Delivery',
  id: 'ID',
  driver: 'Driver',
  driver_phone: 'Driver phone',
  address: 'Address',
  delivery_fee: 'Delivery fee',
  paid_by: 'Paid by',
  delivery_actual_cost: 'Actual delivery cost',
  exchange_rate: 'Exchange rate',
}

export interface SaleRecordChangeTableProps {
  record: SaleRecord
  t: TranslateFn
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

/** One sale before/after value, rendered by the format its field declares. */
function renderSaleValue(row: SaleRecordFieldRow, snapshot: SaleRecordValue, ctx: RecordRenderContext) {
  const { label, t, fmtUSD, fmtKHR } = ctx
  if (snapshot.state === 'unknown') return label('historical_details_unavailable', 'Historical details unavailable')
  if (snapshot.state === 'known_none') {
    // An absent value is not "None" everywhere: a sale with no customer is a
    // GENERAL sale, and reading "None" where the receipt says General is how a
    // reader concludes the customer record was deleted.
    if (row.field === 'customer') return label('general', 'General')
    if (row.field === 'membership') return label('no_membership', 'No membership')
    if (row.field === 'driver') return label('no_driver', 'No driver')
    if (row.field === 'actual_delivery_cost_usd') return label('no_actual_delivery_cost', 'No actual delivery cost')
    return label('none', 'None')
  }
  const value = snapshot.value
  if (row.format === 'money') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? fmtUSD(parsed) : label('value_changed', 'Value changed')
  }
  if (row.format === 'money_4dp') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return label('value_changed', 'Value changed')
    return parsed < 0 ? `-$${Math.abs(parsed).toFixed(4)}` : `$${parsed.toFixed(4)}`
  }
  if (row.format === 'money_khr') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? fmtKHR(parsed) : label('value_changed', 'Value changed')
  }
  if (row.format === 'status') return getStatusLabel(value, t)
  if (row.format === 'boolean') return value ? label('yes', 'Yes') : label('no', 'No')
  if (row.format === 'quantity') return Number.isFinite(Number(value)) ? String(value) : label('value_changed', 'Value changed')
  const lines = formatSaleRecordValueLinesLocalized(row.field, value, fmtUSD, fmtKHR, label)
  return (
    <span className="inline-flex max-w-full flex-col items-end gap-0.5">
      {lines.map((line, index) => <span key={`${index}:${line}`} className="max-w-full break-words">{line}</span>)}
    </span>
  )
}

/**
 * The sale adapter: three functions and no component. This is the whole of what
 * a sale's records know that the shared float does not.
 */
export const SALE_RECORDS_ADAPTER: RecordsAdapter = {
  normalizeKind: (raw) => saleRecordKind(raw),
  kindLabel: (kind, ctx) => {
    const key = SALE_RECORD_KIND_KEYS[saleRecordKind(kind)]
    return ctx.label(key, KIND_FALLBACKS[key] || key)
  },
  // saleRecordFieldRows drops the fields whose before and after are equal: a
  // sale total carried alongside a courier-cost correction that never touched
  // it is context, not a change.
  fieldRows: (record, ctx) => saleRecordFieldRows(record as unknown as SaleRecord).map((row) => ({
    key: row.field,
    label: ctx.label(row.labelKey || 'value_changed', FIELD_FALLBACKS[row.labelKey || ''] || 'Value changed'),
    before: renderSaleValue(row, row.before, ctx),
    after: renderSaleValue(row, row.after, ctx),
  })),
}

/** The expanded Records table for one sale. Exported so its contract is testable. */
export function SaleRecordChangeTable({ record, t, fmtUSD, fmtKHR }: SaleRecordChangeTableProps) {
  return <RecordChangeTable record={record as unknown as RecordItem} adapter={SALE_RECORDS_ADAPTER} t={t} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
}

export default function SaleRecordsFloat({ sale, onClose, t, fmtUSD, fmtKHR }: SaleRecordsFloatProps) {
  const label = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const title = sale.receipt_number
    ? `${label('sale_records', 'Records')} \u00b7 ${sale.receipt_number}`
    : label('sale_records', 'Records')
  return (
    <RecordsFloat
      title={title}
      recordKey={`sale:${sale.id}`}
      load={() => getSaleRecords(sale.id)}
      adapter={SALE_RECORDS_ADAPTER}
      onClose={onClose}
      t={t}
      fmtUSD={fmtUSD}
      fmtKHR={fmtKHR}
    />
  )
}
