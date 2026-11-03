import Check from 'lucide-react/dist/esm/icons/check.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { InventoryCheckApproval, InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { fixStockTarget } from './inventoryCheckFixStock.ts'
import { ApprovalChip } from './InventoryCheckSessionsList.tsx'

type Translator = (key: string) => string | null | undefined
const label = (t: Translator, key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const EPSILON = 1e-9

/** The lines an approval is about: counts that differ from the stock the counter's baseline recorded. The server judges the same way. */
export function approvalLines(items: readonly InventoryCheckSessionItem[]): InventoryCheckSessionItem[] {
  return items.filter(item => finite(item.baseline_quantity) && finite(item.counted_quantity) && Math.abs(item.baseline_quantity - item.counted_quantity) > EPSILON)
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
 * The decision on a submitted count, shown above the session's rows: where it stands, what approving will write per product
 * (counted minus damaged units, the figure Set takes) and, for someone who may decide, Approve and Reject.
 */
export default function InventoryCheckApprovalPanel({ approval, items, canDecide, busy, onApprove, onReject, t }: InventoryCheckApprovalPanelProps) {
  const lines = approvalLines(items)
  const pending = approval.status === 'pending'
  const who = approval.decided_by_name ? `@${approval.decided_by_name}` : ''
  const when = approval.decided_at ? fmtDateTime24(approval.decided_at) : ''
  const approve = label(t, 'inventory_check_approve', 'Approve'), reject = label(t, 'inventory_check_reject', 'Reject')
  return <section data-inventory-check-approval={approval.status} aria-label={label(t, 'inventory_check_approval', 'Count approval')}
    className="min-w-0 rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <ApprovalChip status={approval.status} t={t} />
      <span className="tabular-nums">{label(t, 'inventory_check_differences', 'Differences')} {approval.lines}</span>
      {pending && approval.applied > 0 ? <span data-approval-progress className="tabular-nums text-gray-600 dark:text-gray-300">{approval.applied}/{approval.lines}</span> : null}
      {who || when ? <span data-approval-decided className="text-gray-600 dark:text-gray-300">{[who, when].filter(Boolean).join(' · ')}</span> : null}
      <span className="min-w-0 flex-1" />
      {canDecide && pending ? <>
        <button type="button" data-approval-action="approve" className="btn-primary inline-flex min-h-10 shrink-0 items-center gap-1 px-3 text-xs disabled:opacity-60" disabled={busy} onClick={onApprove}>
          <Check className="h-4 w-4" aria-hidden="true" />{approve}
        </button>
        <button type="button" data-approval-action="reject" className={`${toolbarIconButtonClassName} disabled:opacity-50`} aria-label={reject} title={reject} disabled={busy} onClick={onReject}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </> : null}
    </div>
    {lines.length ? <ul className="mt-1 min-w-0 divide-y divide-gray-100 dark:divide-zinc-800" data-approval-lines>
      {lines.map(item => {
        const id = String(item.product_id)
        const done = approval.applied_lines?.[id]
        const target = done ? done.after : fixStockTarget(item.counted_quantity as number, item.current_stock?.recorded_damaged_quantity)
        return <li key={id} data-approval-line={id} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
          <span className="min-w-0 flex-1 basis-40 break-words font-medium">{item.product_snapshot?.name ?? item.current_product_name ?? id}</span>
          <span className="tabular-nums">{label(t, 'inventory_check_approval_counted', 'Counted')} {item.counted_quantity}</span>
          <span className="tabular-nums text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_system', 'System')} {item.baseline_quantity}</span>
          {pending && finite(item.current_quantity) ? <span className="tabular-nums text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_now', 'Now')} {item.current_quantity}</span> : null}
          <span data-approval-target={id} className={`tabular-nums font-semibold ${done ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{label(t, 'inventory_check_approval_set_to', 'Set to')} {target}</span>
        </li>
      })}
    </ul> : null}
  </section>
}
