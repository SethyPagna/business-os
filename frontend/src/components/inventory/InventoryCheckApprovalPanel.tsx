import Ban from 'lucide-react/dist/esm/icons/ban.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { InventoryCheckApproval, InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { ApprovalChip, approvalChipStatus } from './InventoryCheckSessionsList.tsx'

type Translator = (key: string) => string | null | undefined
const label = (t: Translator, key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const EPSILON = 1e-9

/** The lines an approval is about: counts that differ from the stock the counter's baseline recorded. The server judges the same way. */
export function approvalLines(items: readonly InventoryCheckSessionItem[]): InventoryCheckSessionItem[] {
  // A product counted per received date differs when ANY of its dates does (two wrong dates whose sums agree still need a decision), and is applied date by date.
  return items.filter(item => item.lot_lines?.length ? item.lot_lines.some(line => finite(line.seen) && Math.abs(line.seen - line.counted) > EPSILON)
    : finite(item.baseline_quantity) && finite(item.counted_quantity) && Math.abs(item.baseline_quantity - item.counted_quantity) > EPSILON)
}

/**
 * The ordinary stock approving leaves for one line: the stock of now moved by what the count found against what the counter saw, never below zero.
 * The server applies the same rule; null when a figure it needs is missing (nothing is invented).
 */
export function approvalResult(item: InventoryCheckSessionItem, approval: InventoryCheckApproval): number | null {
  const counted = item.counted_quantity
  const seen = baselineOf(item, approval)
  const damaged = finite(item.current_stock?.recorded_damaged_quantity) ? item.current_stock.recorded_damaged_quantity : 0
  const now = finite(item.current_stock?.recorded_ordinary_quantity) ? item.current_stock.recorded_ordinary_quantity : finite(item.current_quantity) ? item.current_quantity - damaged : null
  return finite(counted) && finite(seen) && now !== null ? Math.max(0, approvalWanted(now, counted, seen)) : null
}

/** The figure the count asks for before the floor at zero; below zero means the stock cannot take the whole shortage the count found. */
export const approvalWanted = (now: number, counted: number, seen: number): number => now + counted - seen

/** How far a line falls short because the stock ran out: recorded on a decided line, worked out for a pending one; null when the stock takes the whole count. */
export function approvalShortfall(item: InventoryCheckSessionItem, approval: InventoryCheckApproval): number | null {
  const done = approval.applied_lines?.[String(item.product_id)]
  if (done) return done.clamped && finite(done.wanted) ? -done.wanted : null
  const damaged = finite(item.current_stock?.recorded_damaged_quantity) ? item.current_stock.recorded_damaged_quantity : 0
  const now = finite(item.current_stock?.recorded_ordinary_quantity) ? item.current_stock.recorded_ordinary_quantity : finite(item.current_quantity) ? item.current_quantity - damaged : null
  const seen = baselineOf(item, approval)
  if (!finite(item.counted_quantity) || !finite(seen) || now === null) return null
  const wanted = approvalWanted(now, item.counted_quantity, seen)
  return wanted < -EPSILON ? -wanted : null
}

/** The figure the count is measured against: the stock recorded at submit, as the approval holds it (the line's own baseline when the approval has none). */
export function baselineOf(item: InventoryCheckSessionItem, approval: InventoryCheckApproval): number | null | undefined {
  const recorded = approval.baselines?.[String(item.product_id)]
  return finite(recorded) ? recorded : item.baseline_quantity
}

const REASONS: Record<string, { key: string; fallback: string }> = {
  inventory_check_product_retired: { key: 'inventory_check_reason_product_retired', fallback: 'Product merged or removed' },
  inventory_check_stock_inconsistent: { key: 'inventory_check_reason_stock_inconsistent', fallback: 'Stock records do not add up' },
  inventory_check_baseline_missing: { key: 'inventory_check_reason_baseline_missing', fallback: 'No starting stock recorded' },
  inventory_check_count_below_damaged: { key: 'inventory_check_reason_count_below_damaged', fallback: 'Count below damaged units' },
  inventory_check_target_not_whole: { key: 'inventory_check_reason_target_not_whole', fallback: 'Not a whole number' },
  inventory_check_count_superseded: { key: 'inventory_check_reason_count_superseded', fallback: 'Another count covered it' },
  inventory_check_stock_adjusted: { key: 'inventory_check_reason_stock_adjusted', fallback: 'Stock changed by hand after the count' },
  inventory_check_no_lot: { key: 'inventory_check_reason_no_lot', fallback: 'No received date to add to' },
}
/** Why a line is not applied, in a few words: its refusal code, or the plain fact that nobody applied it. */
export function reasonLabel(t: Translator, code: string): string {
  const reason = Object.hasOwn(REASONS, code) ? REASONS[code] : undefined
  return reason ? label(t, reason.key, reason.fallback) : label(t, 'inventory_check_approval_not_applied', 'Not applied')
}

export type InventoryCheckApprovalPanelProps = {
  approval: InventoryCheckApproval
  items: readonly InventoryCheckSessionItem[]
  /** The viewer holds the extra, can adjust stock and the page can save. */
  canDecide: boolean
  /** The viewer holds the extra and the page can save: closing moves no stock, so adjusting stock is not needed. */
  canClose?: boolean
  busy: boolean
  /** Lines the last request could not apply, by product id, each with its refusal code. */
  refused?: Readonly<Record<string, string>>
  onApprove: () => void
  onReject: () => void
  onClose?: () => void
  t: Translator
}

/**
 * The decision on a submitted count, shown above the session's rows: where it stands, what approving will leave per product
 * (the stock of now moved by what the count found) and, for someone who may decide, Approve and Reject. Once stock may have moved for it
 * there is no Reject: it is finished by approving again (another approver takes it over when the one who started it is gone) or ended by Close,
 * which moves no stock, keeps the lines already applied and records the rest as not applied with the reason.
 */
export default function InventoryCheckApprovalPanel({ approval, items, canDecide, canClose = false, busy, refused, onApprove, onReject, onClose, t }: InventoryCheckApprovalPanelProps) {
  const lines = approvalLines(items)
  const pending = approval.status === 'pending'
  const who = approval.decided_by_name ? `@${approval.decided_by_name}` : ''
  const when = approval.decided_at ? fmtDateTime24(approval.decided_at) : ''
  const approve = label(t, 'inventory_check_approve', 'Approve'), reject = label(t, 'inventory_check_reject', 'Reject'), close = label(t, 'inventory_check_close', 'Close')
  const claimedByAnother = pending && approval.applying === true && !approval.applying_request_id
  const closable = pending && (approval.applying === true || approval.applied > 0)
  // A line a newer count of the same product replaced is never applied: it is not part of what is left to decide.
  const replaced = approval.superseded ?? {}, toApply = approval.lines - Object.keys(replaced).length
  return <section data-inventory-check-approval={approval.status} aria-label={label(t, 'inventory_check_approval', 'Count approval')}
    className="min-w-0 rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <ApprovalChip status={approvalChipStatus(approval)} t={t} />
      <span className="tabular-nums">{label(t, 'inventory_check_differences', 'Differences')} {approval.lines}</span>
      {pending && approval.applied > 0 ? <span data-approval-progress className="tabular-nums text-gray-600 dark:text-gray-300">{approval.applied}/{toApply}</span> : null}
      {approval.replaced ? <span data-approval-replaced-note className="text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_superseded', 'Replaced by a newer count')}</span> : null}
      {who || when ? <span data-approval-decided className="text-gray-600 dark:text-gray-300">{[who, when].filter(Boolean).join(' · ')}</span> : null}
      <span className="min-w-0 flex-1" />
      {claimedByAnother ? <span data-approval-in-progress className="text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_approval_in_progress', 'Being applied by another approver')}</span> : null}
      {canDecide && pending ? <>
        <button type="button" data-approval-action="approve" className="btn-primary inline-flex min-h-10 shrink-0 items-center gap-1 px-3 text-xs disabled:opacity-60" disabled={busy} onClick={onApprove}>
          <Check className="h-4 w-4" aria-hidden="true" />{approve}
        </button>
        {approval.applying ? null : <button type="button" data-approval-action="reject" className={`${toolbarIconButtonClassName} disabled:opacity-50`} aria-label={reject} title={reject} disabled={busy} onClick={onReject}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>}
      </> : null}
      {closable && (canClose || canDecide) && onClose ? <button type="button" data-approval-action="close" className={`${toolbarIconButtonClassName} disabled:opacity-50`} aria-label={close} title={close} disabled={busy} onClick={onClose}>
        <Ban className="h-5 w-5" aria-hidden="true" />
      </button> : null}
    </div>
    {lines.length ? <ul className="mt-1 min-w-0 divide-y divide-gray-100 dark:divide-zinc-800" data-approval-lines>
      {lines.map(item => {
        const id = String(item.product_id)
        const done = approval.applied_lines?.[id]
        // Dated counts are applied per received date from what each date held at approval, which this page does not read: no product-level result or shortfall is invented for them.
        const dated = !!item.lot_lines?.length
        const target = dated ? null : done ? done.after : approvalResult(item, approval)
        const short = dated ? null : approvalShortfall(item, approval)
        const notApplied = approval.closed?.lines[id], cannot = pending ? refused?.[id] : undefined, replacedBy = replaced[id]
        return <li key={id} data-approval-line={id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
          <span className="min-w-0 flex-1 basis-40 break-words font-medium">{item.product_snapshot?.name ?? item.current_product_name ?? id}</span>
          <span className="tabular-nums">{label(t, 'inventory_check_approval_counted', 'Counted')} {item.counted_quantity}</span>
          <span data-approval-baseline={id} className="tabular-nums text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_system', 'System')} {baselineOf(item, approval)}</span>
          {pending && finite(item.current_quantity) ? <span className="tabular-nums text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_now', 'Now')} {item.current_quantity}</span> : null}
          {replacedBy || short === null ? null : <span data-approval-clamped={id} className="tabular-nums text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_approval_clamped', 'Stock ran out, short by')} {short}</span>}
          {replacedBy ? <span data-approval-superseded={id} className="text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_superseded', 'Replaced by a newer count')}</span> : null}
          {notApplied ? <span data-approval-not-applied={id} className="text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_approval_not_applied', 'Not applied')}: {reasonLabel(t, notApplied)}</span> : null}
          {cannot ? <span data-approval-refused={id} className="text-red-700 dark:text-red-300">{label(t, 'inventory_check_approval_cannot_apply', 'Cannot apply')}: {reasonLabel(t, cannot)}</span> : null}
          {dated ? <ul data-approval-lot-lines={id} className="flex basis-full flex-wrap gap-x-3 tabular-nums text-gray-600 dark:text-gray-300">
            {item.lot_lines!.map(line => <li key={line.batch_id}>{line.scope === 'branch' ? label(t, 'inventory_check_branch_total', 'Branch total') : label(t, 'inventory_check_lot_received', 'Received {date}').replace('{date}', line.received_at ? fmtDateOnly(line.received_at) : '—')}: {finite(line.seen) ? `${line.seen} → ` : ''}<strong>{line.counted}</strong></li>)}
          </ul> : null}
          {replacedBy || target === null ? null : <span data-approval-target={id} className={`tabular-nums font-semibold ${done ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{label(t, 'inventory_check_approval_set_to', 'Set to')} {target}</span>}
        </li>
      })}
    </ul> : null}
  </section>
}
