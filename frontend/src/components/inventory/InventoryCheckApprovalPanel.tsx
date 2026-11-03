import Check from 'lucide-react/dist/esm/icons/check.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { InventoryCheckApproval, InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { ApprovalChip } from './InventoryCheckSessionsList.tsx'

type Translator = (key: string) => string | null | undefined
const label = (t: Translator, key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const EPSILON = 1e-9

/** The lines an approval is about: counts that differ from the stock the counter's baseline recorded. The server judges the same way. */
export function approvalLines(items: readonly InventoryCheckSessionItem[]): InventoryCheckSessionItem[] {
  return items.filter(item => finite(item.baseline_quantity) && finite(item.counted_quantity) && Math.abs(item.baseline_quantity - item.counted_quantity) > EPSILON)
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

export type InventoryCheckApprovalPanelProps = {
  approval: InventoryCheckApproval
  items: readonly InventoryCheckSessionItem[]
  /** The viewer holds the extra, can adjust stock and the page can save. */
  canDecide: boolean
  busy: boolean
  onApprove: () => void
  onReject: () => void
  t: Translator
}

/**
 * The decision on a submitted count, shown above the session's rows: where it stands, what approving will leave per product
 * (the stock of now moved by what the count found) and, for someone who may decide, Approve and Reject. Once stock may have moved for it
 * there is no Reject, and only the approver who started it can finish it.
 */
export default function InventoryCheckApprovalPanel({ approval, items, canDecide, busy, onApprove, onReject, t }: InventoryCheckApprovalPanelProps) {
  const lines = approvalLines(items)
  const pending = approval.status === 'pending'
  const who = approval.decided_by_name ? `@${approval.decided_by_name}` : ''
  const when = approval.decided_at ? fmtDateTime24(approval.decided_at) : ''
  const approve = label(t, 'inventory_check_approve', 'Approve'), reject = label(t, 'inventory_check_reject', 'Reject')
  const claimedByAnother = pending && approval.applying === true && !approval.applying_request_id
  return <section data-inventory-check-approval={approval.status} aria-label={label(t, 'inventory_check_approval', 'Count approval')}
    className="min-w-0 rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <ApprovalChip status={approval.status} t={t} />
      <span className="tabular-nums">{label(t, 'inventory_check_differences', 'Differences')} {approval.lines}</span>
      {pending && approval.applied > 0 ? <span data-approval-progress className="tabular-nums text-gray-600 dark:text-gray-300">{approval.applied}/{approval.lines}</span> : null}
      {who || when ? <span data-approval-decided className="text-gray-600 dark:text-gray-300">{[who, when].filter(Boolean).join(' · ')}</span> : null}
      <span className="min-w-0 flex-1" />
      {claimedByAnother ? <span data-approval-in-progress className="text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_approval_in_progress', 'Being applied by another approver')}</span> : null}
      {canDecide && pending && !claimedByAnother ? <>
        <button type="button" data-approval-action="approve" className="btn-primary inline-flex min-h-10 shrink-0 items-center gap-1 px-3 text-xs disabled:opacity-60" disabled={busy} onClick={onApprove}>
          <Check className="h-4 w-4" aria-hidden="true" />{approve}
        </button>
        {approval.applying ? null : <button type="button" data-approval-action="reject" className={`${toolbarIconButtonClassName} disabled:opacity-50`} aria-label={reject} title={reject} disabled={busy} onClick={onReject}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>}
      </> : null}
    </div>
    {lines.length ? <ul className="mt-1 min-w-0 divide-y divide-gray-100 dark:divide-zinc-800" data-approval-lines>
      {lines.map(item => {
        const id = String(item.product_id)
        const done = approval.applied_lines?.[id]
        const target = done ? done.after : approvalResult(item, approval)
        const short = approvalShortfall(item, approval)
        return <li key={id} data-approval-line={id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
          <span className="min-w-0 flex-1 basis-40 break-words font-medium">{item.product_snapshot?.name ?? item.current_product_name ?? id}</span>
          <span className="tabular-nums">{label(t, 'inventory_check_approval_counted', 'Counted')} {item.counted_quantity}</span>
          <span data-approval-baseline={id} className="tabular-nums text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_system', 'System')} {baselineOf(item, approval)}</span>
          {pending && finite(item.current_quantity) ? <span className="tabular-nums text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_now', 'Now')} {item.current_quantity}</span> : null}
          {short === null ? null : <span data-approval-clamped={id} className="tabular-nums text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_approval_clamped', 'Stock ran out, short by')} {short}</span>}
          {target === null ? null : <span data-approval-target={id} className={`tabular-nums font-semibold ${done ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{label(t, 'inventory_check_approval_set_to', 'Set to')} {target}</span>}
        </li>
      })}
    </ul> : null}
  </section>
}
