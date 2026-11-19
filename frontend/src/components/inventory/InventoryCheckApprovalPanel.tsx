import { useState, type ReactNode } from 'react'
import Ban from 'lucide-react/dist/esm/icons/ban.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { InventoryCheckApproval, InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { ApprovalChip, approvalChipStatus } from './InventoryCheckSessionsList.tsx'
import { approvalLines, approvalResult, approvalShortfall, baselineOf, decisionOf, effectiveLotCounted, figureOf, lineShapeOf, lineStateOf, modifyProblem, type ModifyFigures } from './inventoryCheckApprovalLines.ts'
import { REFUSAL_MESSAGES } from './inventoryCheckRefusals.ts'

type Translator = (key: string) => string | null | undefined
const label = (t: Translator, key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const REASONS: Record<string, { key: string; fallback: string }> = {
  inventory_check_product_retired: { key: 'inventory_check_reason_product_retired', fallback: 'Product merged or removed' },
  inventory_check_stock_inconsistent: { key: 'inventory_check_reason_stock_inconsistent', fallback: 'Stock records do not add up' },
  inventory_check_baseline_missing: { key: 'inventory_check_reason_baseline_missing', fallback: 'No starting stock recorded' },
  inventory_check_count_below_damaged: { key: 'inventory_check_reason_count_below_damaged', fallback: 'Count below damaged units' },
  inventory_check_target_not_whole: { key: 'inventory_check_reason_target_not_whole', fallback: 'Not a whole number' },
  inventory_check_count_superseded: { key: 'inventory_check_reason_count_superseded', fallback: 'Another count covered it' },
  inventory_check_stock_adjusted: { key: 'inventory_check_reason_stock_adjusted', fallback: 'Stock changed by hand after the count' },
  inventory_check_no_lot: { key: 'inventory_check_reason_no_lot', fallback: 'No received date' },
}
/** Why a line is not applied, in a few words: its refusal code, or the plain fact that nobody applied it. */
export function reasonLabel(t: Translator, code: string): string {
  const reason = Object.hasOwn(REASONS, code) ? REASONS[code] : undefined
  return reason ? label(t, reason.key, reason.fallback) : label(t, 'inventory_check_approval_not_applied', 'Not applied')
}

export type InventoryCheckApprovalPanelProps = {
  approval: InventoryCheckApproval
  items: readonly InventoryCheckSessionItem[]
  /** The viewer holds the extra, can adjust stock and the page can save: Approve all, accept and modify. */
  canDecide: boolean
  /** The viewer holds the extra and the page can save: closing, rejecting and reopening move no stock, so adjusting stock is not needed. */
  canClose?: boolean
  busy: boolean
  /** Lines the last request could not apply, by product id, each with its refusal code. */
  refused?: Readonly<Record<string, string>>
  /** What the last decision on a line was refused for, by product id, already in words. */
  lineErrors?: Readonly<Record<string, string>>
  onApprove: () => void
  onReject: () => void
  onClose?: () => void
  onAccept?: (productId: number) => void
  /** Resolves true when the figures were saved (the editor then closes). */
  onModify?: (productId: number, figures: ModifyFigures) => Promise<boolean>
  onRejectLine?: (productId: number) => void
  onReopen?: (productId: number) => void
  t: Translator
}

// 44 px on a phone and 40 px on a desktop, as the buttons of the Inventory rows beside it.
const lineButton = 'inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 lg:h-10 lg:min-h-10 lg:w-10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-gray-200 dark:hover:bg-zinc-800'

function LineButton({ name, text, disabled, onClick, children }: { name: string; text: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" data-approval-line-action={name} className={lineButton} aria-label={text} title={text} disabled={disabled} onClick={onClick}>{children}</button>
}

/** The figure boxes of one line being modified: one total, or one per received date the count holds. */
type Editor = { id: string; values: Record<string, string> }

/**
 * The decision on a submitted count, shown above the session's rows: where it stands, what approving will leave per product (the stock of now moved by what the count found) and, for someone
 * who may decide, Approve all and Reject for the whole count, and per line: accept, modify (an inline figure whose "Set to" updates as it is typed), reject, and reopen for a rejected or
 * modified line while the count is pending. Once stock may have moved for it there is no Reject and no per-line decision: it is finished by approving again (another approver takes it over
 * when the one who started it is gone) or ended by Close, which moves no stock, keeps the lines already applied and records the rest as not applied with the reason.
 */
export default function InventoryCheckApprovalPanel({ approval, items, canDecide, canClose = false, busy, refused, lineErrors, onApprove, onReject, onClose, onAccept, onModify, onRejectLine, onReopen, t }: InventoryCheckApprovalPanelProps) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const lines = approvalLines(items, approval)
  const pending = approval.status === 'pending'
  const who = approval.decided_by_name ? `@${approval.decided_by_name}` : ''
  const when = approval.decided_at ? fmtDateTime24(approval.decided_at) : ''
  const approve = label(t, 'inventory_check_approve', 'Approve'), approveAll = label(t, 'inventory_check_approve_all', 'Approve all'), reject = label(t, 'inventory_check_reject', 'Reject'), close = label(t, 'inventory_check_close', 'Close')
  const claimedByAnother = pending && approval.applying === true && !approval.applying_request_id
  const closable = pending && (approval.applying === true || approval.applied > 0)
  // A line a newer count of the same product replaced is never applied: it is not part of what is left to decide.
  const replaced = approval.superseded ?? {}, toApply = approval.lines - Object.keys(replaced).length
  const withBy = (text: string, by: string | undefined, at: string) => [text, by ? label(t, 'inventory_check_line_decided_by', 'by {name}').replace('{name}', `@${by}`) : '', fmtDateTime24(at)].filter(Boolean).join(' · ')

  function startEdit(item: InventoryCheckSessionItem) {
    const id = String(item.product_id), shape = lineShapeOf(item)
    if (!shape.dated) return setEditor({ id, values: { '': String(finite(approval.line_decisions?.[id]?.counted) ? approval.line_decisions?.[id]?.counted : item.counted_quantity ?? '') } })
    setEditor({ id, values: Object.fromEntries((item.lot_lines ?? []).filter(line => line.scope === 'lot').map(line => [String(line.batch_id), String(effectiveLotCounted(item, approval, line))])) })
  }
  /** What the editor holds as figures for the validator; null while a box is empty. */
  function figuresOf(item: InventoryCheckSessionItem, values: Record<string, string>): ModifyFigures | null {
    if (!lineShapeOf(item).dated) { const counted = figureOf(values['']); return counted === null ? null : { counted } }
    const lots = Object.entries(values).map(([batchId, text]) => ({ batchId: Number(batchId), counted: figureOf(text) }))
    return lots.some(lot => lot.counted === null) ? null : { lots: lots as Array<{ batchId: number; counted: number }> }
  }
  async function saveEdit(item: InventoryCheckSessionItem, figures: ModifyFigures) {
    if (!onModify) return
    if (await onModify(Number(item.product_id), figures)) setEditor(null)
  }
  const problemText = (code: string | null) => { if (!code) return ''; const entry = Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : undefined; return entry ? label(t, entry.key, entry.fallback) : '' }

  return <section data-inventory-check-approval={approval.status} aria-label={label(t, 'inventory_check_approval', 'Count approval')}
    className="min-w-0 rounded-lg border border-gray-200 bg-white p-2 text-xs leading-relaxed dark:border-zinc-700 dark:bg-zinc-900">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
      {/* The facts wrap inside their own group; the icons stay together on one row, to the right, at any width. */}
      <div className="flex min-w-0 flex-1 basis-24 flex-wrap items-center gap-x-2 gap-y-1">
        <ApprovalChip status={approvalChipStatus(approval)} t={t} />
        <span className="tabular-nums">{label(t, 'inventory_check_differences', 'Differences')} {approval.lines}</span>
        {pending && approval.applied > 0 ? <span data-approval-progress className="tabular-nums text-gray-600 dark:text-gray-300">{approval.applied}/{toApply}</span> : null}
        {approval.replaced ? <span data-approval-replaced-note className="text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_superseded', 'Replaced by a newer count')}</span> : null}
        {who || when ? <span data-approval-decided className="text-gray-600 dark:text-gray-300">{[who, when].filter(Boolean).join(' · ')}</span> : null}
        {claimedByAnother ? <span data-approval-in-progress className="text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_approval_in_progress', 'Being applied by another approver')}</span> : null}
      </div>
      <span data-approval-header-actions className="inline-flex shrink-0 items-center gap-1">
        {canDecide && pending ? <button type="button" data-approval-action="approve" className="btn-primary inline-flex min-h-10 shrink-0 items-center gap-1 px-3 text-xs disabled:opacity-60" aria-label={approveAll} title={approveAll} disabled={busy} onClick={onApprove}>
          <Check className="h-4 w-4" aria-hidden="true" />{approve}
        </button> : null}
        {/* Rejecting moves no stock and the Worker asks only for the right to approve, as for a line. */}
        {(canClose || canDecide) && pending && !approval.applying ? <button type="button" data-approval-action="reject" className={`${toolbarIconButtonClassName} disabled:opacity-50`} aria-label={reject} title={reject} disabled={busy} onClick={onReject}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button> : null}
        {closable && (canClose || canDecide) && onClose ? <button type="button" data-approval-action="close" className={`${toolbarIconButtonClassName} disabled:opacity-50`} aria-label={close} title={close} disabled={busy} onClick={onClose}>
          <Ban className="h-5 w-5" aria-hidden="true" />
        </button> : null}
      </span>
    </div>
    {lines.length ? <ul className="mt-1 min-w-0 divide-y divide-gray-100 dark:divide-zinc-800" data-approval-lines>
      {lines.map(item => {
        const id = String(item.product_id), productId = Number(item.product_id)
        const done = approval.applied_lines?.[id]
        const state = lineStateOf(item, approval)
        const decision = decisionOf(approval, id)
        const rejected = decision?.decision === 'reject', modified = decision?.decision === 'modify'
        // Dated counts are applied per received date from what each date held at approval, which this page does not read: no product-level result or shortfall is invented for them.
        const dated = !!item.lot_lines?.length
        const target = dated || rejected ? null : done ? done.after : approvalResult(item, approval)
        const short = dated || rejected ? null : approvalShortfall(item, approval)
        const notApplied = approval.closed?.lines[id], cannot = pending ? refused?.[id] : undefined, replacedBy = replaced[id]
        const error = lineErrors?.[id]
        const decidable = state === 'open' || state === 'modified'
        const editing = editor?.id === id && decidable ? editor : null
        const figures = editing ? figuresOf(item, editing.values) : null
        const problem = editing && figures ? modifyProblem(item, approval, figures) : null
        const shape = lineShapeOf(item)
        // The live "Set to" for a line counted as one figure: the stock of now moved by the typed figure against what the counter saw.
        const preview = editing && figures && 'counted' in figures && !problem ? approvalResult(item, approval, figures.counted) : null
        const modifiedTotal = modified ? (shape.dated ? (item.lot_lines ?? []).reduce((sum, line) => sum + effectiveLotCounted(item, approval, line), 0) : decision.counted) : null
        const decidedChip = decision ? <span data-approval-decision={id} data-decision={decision.decision} className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1 rounded-full px-2 text-[11px] font-semibold leading-relaxed ${rejected ? 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200' : 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'}`}>
          {withBy(rejected ? label(t, 'inventory_check_line_decided_reject', 'Rejected') : label(t, 'inventory_check_line_modified_to', 'Modified to {value}').replace('{value}', String(modifiedTotal ?? '')), decision.by_name, decision.at)}
        </span> : null
        // The actions the Worker accepts on this line: accept (a modified line is applied from the approver's figure), modify again, reject, and reopen for a decided line. A line the viewer's own claim has planned or
        // part-written can only be finished (accept again: the Worker continues it); a rejected line only reopens; another approver's claim, an applied or a replaced line offer nothing.
        const resumable = state === 'applying'
        const rights = pending && !editing
        const actions: ReactNode[] = rights ? [
          (decidable || resumable) && canDecide && onAccept ? <LineButton key="accept" name="accept" text={label(t, 'inventory_check_line_accept', 'Accept line')} disabled={busy} onClick={() => onAccept(productId)}><Check className="h-4 w-4" aria-hidden="true" /></LineButton> : null,
          decidable && canDecide && onModify ? <LineButton key="modify" name="modify" text={label(t, 'inventory_check_line_modify', 'Modify')} disabled={busy} onClick={() => startEdit(item)}><Pencil className="h-4 w-4" aria-hidden="true" /></LineButton> : null,
          decidable && canClose && onRejectLine ? <LineButton key="reject" name="reject" text={label(t, 'inventory_check_line_reject', 'Reject line')} disabled={busy} onClick={() => onRejectLine(productId)}><X className="h-4 w-4" aria-hidden="true" /></LineButton> : null,
          (state === 'rejected' || state === 'modified') && canClose && onReopen ? <LineButton key="reopen" name="reopen" text={label(t, 'inventory_check_line_reopen', 'Reopen line')} disabled={busy} onClick={() => onReopen(productId)}><Undo2 className="h-4 w-4" aria-hidden="true" /></LineButton> : null,
        ].filter(Boolean) : []
        return <li key={id} data-approval-line={id} data-approval-line-state={state} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1">
          <span className="min-w-0 flex-1 basis-40 break-words font-medium">{item.product_snapshot?.name ?? item.current_product_name ?? id}</span>
          <span className="tabular-nums">{label(t, 'inventory_check_approval_counted', 'Counted')} {item.counted_quantity}</span>
          <span data-approval-baseline={id} className="tabular-nums text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_system', 'System')} {baselineOf(item, approval)}</span>
          {pending && finite(item.current_quantity) ? <span className="tabular-nums text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_now', 'Now')} {item.current_quantity}</span> : null}
          {replacedBy || short === null ? null : <span data-approval-clamped={id} className="tabular-nums text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_approval_clamped', 'Stock ran out, short by')} {short}</span>}
          {replacedBy ? <span data-approval-superseded={id} className="text-gray-600 dark:text-gray-300">{label(t, 'inventory_check_approval_superseded', 'Replaced by a newer count')}</span> : null}
          {notApplied ? <span data-approval-not-applied={id} className="text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_approval_not_applied', 'Not applied')}: {reasonLabel(t, notApplied)}</span> : null}
          {cannot ? <span data-approval-refused={id} className="text-red-700 dark:text-red-300">{label(t, 'inventory_check_approval_cannot_apply', 'Cannot apply')}: {reasonLabel(t, cannot)}</span> : null}
          {dated ? <ul data-approval-lot-lines={id} className="flex basis-full flex-wrap gap-x-3 tabular-nums text-gray-600 dark:text-gray-300">
            {item.lot_lines!.map(line => {
              const own = effectiveLotCounted(item, approval, line)
              return <li key={line.batch_id}>{line.scope === 'branch' ? label(t, 'inventory_check_branch_total', 'Branch total') : label(t, 'inventory_check_lot_received', 'Received {date}').replace('{date}', line.received_at ? fmtDateOnly(line.received_at) : '—')}: {finite(line.seen) ? `${line.seen} → ` : ''}<strong>{own}</strong>{own !== line.counted ? <span data-approval-lot-was className="opacity-70"> ({line.counted})</span> : null}</li>
            })}
          </ul> : null}
          {replacedBy || target === null ? null : <span data-approval-target={id} className={`tabular-nums font-semibold ${done ? 'text-emerald-700 dark:text-emerald-300' : ''}`}>{label(t, 'inventory_check_approval_set_to', 'Set to')} {target}</span>}
          {decidedChip}
          {state === 'applied' ? <span data-approval-line-note="applied" className="text-emerald-700 dark:text-emerald-300">{label(t, 'inventory_check_line_state_applied', 'Applied')}</span> : null}
          {state === 'applying' ? <span data-approval-line-note="applying" className="text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_line_state_applying', 'Being applied')}</span> : null}
          {state === 'waiting' ? <span data-approval-line-note="waiting" className="text-amber-700 dark:text-amber-300">{label(t, 'inventory_check_line_state_waiting', 'Waiting for the approver applying this count')}</span> : null}
          {editing ? <div data-approval-editor={id} className="flex basis-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {shape.dated
              ? (item.lot_lines ?? []).filter(line => line.scope === 'lot').map(line => <label key={line.batch_id} className="inline-flex items-center gap-1 tabular-nums">
                <span>{label(t, 'inventory_check_lot_received', 'Received {date}').replace('{date}', line.received_at ? fmtDateOnly(line.received_at) : '—')}{finite(line.seen) ? ` (${line.seen} →)` : ''}</span>
                <input data-approval-figure={`${id}:${line.batch_id}`} inputMode="numeric" autoComplete="off" value={editing.values[String(line.batch_id)] ?? ''} disabled={busy} aria-invalid={!!problem}
                  className="input h-9 w-20 px-2 text-xs tabular-nums lg:h-8" onChange={event => setEditor({ id, values: { ...editing.values, [String(line.batch_id)]: event.target.value } })}
                  onKeyDown={event => { if (event.key === 'Escape') setEditor(null); else if (event.key === 'Enter' && figures && !problem) { event.preventDefault(); void saveEdit(item, figures) } }} />
              </label>)
              : <input data-approval-figure={id} inputMode="numeric" autoComplete="off" autoFocus value={editing.values[''] ?? ''} disabled={busy} aria-invalid={!!problem} aria-label={label(t, 'inventory_check_line_modify', 'Modify')}
                className="input h-9 w-24 px-2 text-xs tabular-nums lg:h-8" onChange={event => setEditor({ id, values: { '': event.target.value } })}
                onKeyDown={event => { if (event.key === 'Escape') setEditor(null); else if (event.key === 'Enter' && figures && !problem) { event.preventDefault(); void saveEdit(item, figures) } }} />}
            {preview !== null ? <span data-approval-preview={id} className="tabular-nums font-semibold">{label(t, 'inventory_check_approval_set_to', 'Set to')} {preview}</span> : null}
            {problem ? <span data-approval-problem={id} role="alert" className="text-red-700 dark:text-red-300">{problemText(problem)}</span> : null}
            <LineButton name="confirm" text={label(t, 'inventory_check_line_modify_save', 'Save figure')} disabled={busy || !figures || !!problem} onClick={() => { if (figures) void saveEdit(item, figures) }}><Check className="h-4 w-4" aria-hidden="true" /></LineButton>
            <LineButton name="cancel" text={label(t, 'cancel', 'Cancel')} disabled={busy} onClick={() => setEditor(null)}><X className="h-4 w-4" aria-hidden="true" /></LineButton>
          </div> : null}
          {error ? <span data-approval-line-error={id} role="alert" className="basis-full text-red-700 dark:text-red-300">{error}</span> : null}
          {actions.length ? <span data-approval-line-actions={id} className="ml-auto inline-flex shrink-0 items-center gap-2">{actions}</span> : null}
        </li>
      })}
    </ul> : null}
  </section>
}
