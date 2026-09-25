// U-records: the "what did this record change" block of a stock record's own
// float -- stock before -> the movement -> stock after, and, for a stock-in
// line edited after it was saved, each figure as received -> now.
//
// ONE block for every record float that shows a stock movement: a stock-in
// session line (products/StockInSessionsSection.tsx) and a Movements-tab row
// (inventory/MovementDetailFloat.tsx). The balances come from the Worker's
// one set-based helper (cloudflare/src/lib/stockLedgerQuery.ts), which the
// Stock Changes ledger agrees with, so the same movement reads the same
// before -> after on every screen.

export type StockLineChangeRow = {
  before_qty?: unknown
  after_qty?: unknown
  quantity?: unknown
  unit?: string | null
  edit_count?: unknown
  received_quantity?: unknown
  received_unit_cost_usd?: unknown
  received_total_cost_usd?: unknown
  unit_cost_usd?: unknown
  total_cost_usd?: unknown
}

type Tr = (key: string, fallback: string) => string

// A recorded cost, or "—" when none was recorded -- never a $0.00 that
// Number(null) would make of a missing one.
export function formatRecordedUsd(value: unknown): string {
  if (value == null || value === '') return '—'
  const amount = Number(value)
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '—'
}

export function formatQty(value: unknown, unit?: string | null): string {
  if (value == null || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return unit ? `${amount} ${unit}` : String(amount)
}

/**
 * `signedQuantity` is the movement with its direction (+ in, - out); null
 * when the direction is unknown, which shows the bare quantity. `pending`
 * while the balance is still being read: the tiles say so instead of "—",
 * which would claim the balance cannot be derived.
 */
export function StockLineChange({ row, signedQuantity, canViewCosts, tr, pending = false }: {
  row: StockLineChangeRow
  signedQuantity: number | null
  canViewCosts: boolean
  tr: Tr
  pending?: boolean
}) {
  const edited = Number(row.edit_count) > 0
  const changes: Array<{ label: string; received: string; now: string }> = edited ? [
    { label: tr('quantity', 'Quantity'), received: formatQty(row.received_quantity, row.unit), now: formatQty(row.quantity, row.unit) },
    ...(canViewCosts ? [
      { label: tr('unit_cost', 'Unit Cost'), received: formatRecordedUsd(row.received_unit_cost_usd), now: formatRecordedUsd(row.unit_cost_usd) },
      { label: tr('total_cost', 'Total cost'), received: formatRecordedUsd(row.received_total_cost_usd), now: formatRecordedUsd(row.total_cost_usd) },
    ] : []),
  ] : []
  const balance = (value: unknown) => pending ? '…' : formatQty(value, row.unit)
  const moved = signedQuantity == null || !Number.isFinite(signedQuantity)
    ? formatQty(row.quantity, row.unit)
    : `${signedQuantity > 0 ? '+' : signedQuantity < 0 ? '−' : ''}${formatQty(Math.abs(signedQuantity), row.unit)}`
  const movedTone = signedQuantity != null && signedQuantity < 0
    ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
    : signedQuantity != null && signedQuantity > 0
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
      : 'bg-gray-50 text-gray-700 dark:bg-gray-800/60 dark:text-gray-200'
  return <div className="space-y-2">
    {/* leading-relaxed on every label: Khmer glyphs need the vertical room. */}
    <div data-testid="stock-record-balance" aria-busy={pending || undefined} className="grid grid-cols-3 gap-2">
      <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60"><div className="text-[11px] uppercase leading-relaxed tracking-wide text-gray-400">{tr('before_qty', 'Before')}</div><div className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">{balance(row.before_qty)}</div></div>
      <div className={`rounded-xl px-3 py-2 ${movedTone}`}><div className="text-[11px] uppercase leading-relaxed tracking-wide opacity-80">{tr('quantity', 'Quantity')}</div><div className="text-sm font-semibold tabular-nums">{moved}</div></div>
      <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60"><div className="text-[11px] uppercase leading-relaxed tracking-wide text-gray-400">{tr('after_qty', 'After')}</div><div className="text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">{balance(row.after_qty)}</div></div>
    </div>
    {changes.length ? <div data-testid="stock-in-line-edit-change" className="rounded-xl border border-blue-100 bg-blue-50/55 px-3 py-2 dark:border-blue-900/60 dark:bg-blue-950/20">
      <div className="mb-1 text-[11px] font-semibold leading-relaxed text-blue-700 dark:text-blue-300">{tr('stock_in_line_changed_since', 'Edited after it was received')}</div>
      <dl className="space-y-1">{changes.map((change) => <div key={change.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
        <dt className="leading-relaxed text-gray-500">{change.label}</dt>
        <dd className="tabular-nums font-semibold text-gray-800 dark:text-gray-100" aria-label={`${change.label}: ${tr('stock_in_line_as_received', 'As received')} ${change.received}, ${tr('stock_in_line_now', 'Now')} ${change.now}`}>{change.received} → {change.now}</dd>
      </div>)}</dl>
    </div> : null}
  </div>
}
