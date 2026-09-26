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
  // the TOTAL across branches (the name every existing reader uses)
  before_qty?: unknown
  after_qty?: unknown
  total_before_qty?: unknown
  total_after_qty?: unknown
  // the movement's own branch; null when the Worker could not walk it back
  branch_before_qty?: unknown
  branch_after_qty?: unknown
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

/** One before -> after line of a stock record: its own branch, or the total across branches. */
export type StockBalanceLine = { scope: 'branch' | 'total'; label: string; before: unknown; after: unknown }

const samePair = (a: [unknown, unknown], b: [unknown, unknown]) => a.every((value, index) => value != null && b[index] != null && Number(value) === Number(b[index]))

/**
 * Owner, 26 Sep: the branch line first ("Shop 10 -> 7"), the total across
 * branches under it ("Total 18 -> 15"). When the business runs ONE active
 * branch (counted by the Worker from data, never a flag), the Total line is
 * redundant and is dropped -- but ONLY when the branch pair is known and
 * equals the total, so the one line truthfully is both. A record from a
 * branch since closed can still differ from the total, and then both lines
 * stay. With one branch and NO derivable branch pair the single line is the
 * total and says so ("Total"): an inactive branch may still hold stock, so
 * the total is not that branch's number and must never wear its name. A
 * null count (unknown) keeps both lines.
 */
export function stockBalanceLines(row: StockLineChangeRow, branchName: string | null | undefined, activeBranchCount: number | null | undefined, labels: { branch: string; total: string }): StockBalanceLine[] {
  const branchLabel = String(branchName || '').trim() || labels.branch
  const branch: [unknown, unknown] = [row.branch_before_qty, row.branch_after_qty]
  const total: [unknown, unknown] = [row.total_before_qty ?? row.before_qty, row.total_after_qty ?? row.after_qty]
  const branchKnown = branch.every((value) => value != null && value !== '')
  if (activeBranchCount != null && Number(activeBranchCount) <= 1) {
    if (branchKnown && samePair(branch, total)) return [{ scope: 'branch', label: branchLabel, before: branch[0], after: branch[1] }]
    if (!branchKnown) return [{ scope: 'total', label: labels.total, before: total[0], after: total[1] }]
  }
  return [
    { scope: 'branch', label: branchLabel, before: branch[0], after: branch[1] },
    { scope: 'total', label: labels.total, before: total[0], after: total[1] },
  ]
}

/**
 * `signedQuantity` is the movement with its direction (+ in, - out); null
 * when the direction is unknown, which shows the bare quantity. `pending`
 * while the balance is still being read: the tiles say so instead of "—",
 * which would claim the balance cannot be derived. `showQuantity` false
 * drops the Quantity tile for a float that already shows the movement's
 * signed quantity elsewhere (the Stock Changes ledger's type chip), so the
 * one number never appears twice.
 */
export function StockLineChange({ row, signedQuantity, canViewCosts, tr, pending = false, branchName, activeBranchCount, showQuantity = true }: {
  row: StockLineChangeRow
  signedQuantity: number | null
  canViewCosts: boolean
  tr: Tr
  pending?: boolean
  branchName?: string | null
  activeBranchCount?: number | null
  showQuantity?: boolean
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
  const beforeLabel = tr('before_qty', 'Before')
  const afterLabel = tr('after_qty', 'After')
  const lines = stockBalanceLines(row, branchName, activeBranchCount, { branch: tr('branch', 'Branch'), total: tr('stock_balance_total', 'Total') })
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
    <div data-testid="stock-record-balance" aria-busy={pending || undefined} className={`grid ${showQuantity ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1'} items-stretch gap-2`}>
      {showQuantity ? <div className={`rounded-xl px-3 py-2 ${movedTone}`}><div className="text-[11px] uppercase leading-relaxed tracking-wide opacity-80">{tr('quantity', 'Quantity')}</div><div className="text-sm font-semibold tabular-nums">{moved}</div></div> : null}
      {/* Branch line first, then the total across branches (owner, 26 Sep).
          The column caption sits OUTSIDE the <dl> (a <dl> holds only dt/dd
          groups) and is hidden from assistive tech; each <dd> instead
          carries its own screen-reader words, so its visible text is what
          is read -- no aria-label overriding it. */}
      <div className="min-w-0 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
        <div aria-hidden="true" className="text-right text-[11px] uppercase leading-relaxed tracking-wide text-gray-400">{beforeLabel} → {afterLabel}</div>
        <dl>
          {lines.map((line) => <div key={line.scope} data-testid="stock-balance-line" data-scope={line.scope} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
            <dt className="break-words leading-relaxed text-gray-500 dark:text-gray-400">{line.label}</dt>
            <dd className="text-sm font-semibold tabular-nums leading-relaxed text-gray-800 dark:text-gray-100"><span className="sr-only">{beforeLabel} </span>{balance(line.before)}<span aria-hidden="true"> → </span><span className="sr-only">, {afterLabel} </span>{balance(line.after)}</dd>
          </div>)}
        </dl>
      </div>
    </div>
    {changes.length ? <div data-testid="stock-in-line-edit-change" className="rounded-xl border border-blue-100 bg-blue-50/55 px-3 py-2 dark:border-blue-900/60 dark:bg-blue-950/20">
      <div className="mb-1 text-[11px] font-semibold leading-relaxed text-blue-700 dark:text-blue-300">{tr('stock_in_line_changed_since', 'Edited after it was received')}</div>
      <dl className="space-y-1">{changes.map((change) => <div key={change.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
        <dt className="leading-relaxed text-gray-500">{change.label}</dt>
        <dd className="tabular-nums font-semibold text-gray-800 dark:text-gray-100"><span className="sr-only">{tr('stock_in_line_as_received', 'As received')} </span>{change.received}<span aria-hidden="true"> → </span><span className="sr-only">, {tr('stock_in_line_now', 'Now')} </span>{change.now}</dd>
      </div>)}</dl>
    </div> : null}
  </div>
}
