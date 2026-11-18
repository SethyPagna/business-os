import type { InventoryCheckApproval, InventoryCheckApprovalDecision, InventoryCheckLineAnswer, InventoryCheckSessionItem } from '../../api/inventoryChecksTransport.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import type { ConfirmRequest } from '../shared/useConfirmDialog.tsx'
import { approvalRequestBound, runApprovalFlow } from './inventoryCheckApprovalFlow.ts'
import { fmtDateOnly } from '../../utils/formatters.ts'
import { approvalResult, decisionOf, effectiveLotCounted, figureRefusal, lineShapeOf, openLinesOf } from './inventoryCheckApprovalLines.ts'
import { lineDecisionVerdict, lineRequestBody, type LineInput } from './inventoryCheckLineInput.ts'

// The decisions on a submitted count, with no React in them: Approve all, accept some lines, reject / close the whole count, and one decision on one line. The page's hook
// (useInventoryCheckApproval.ts) hands in its state and the transport; tests hand in doubles. A request id is made once per decision and reused by every retry of the SAME
// decision, which is what makes a lost answer safe to repeat; a definite refusal drops it so the corrected decision is a fresh one.

export type ApprovalAction = 'approve' | 'reject' | 'close'
type Cell<T> = { current: T }
/** `stale`: an answer of this decision showed a line another tab applied; it stays set across the repeats of a lost answer, so the session is still read once at the end. */
export type ApprovalAttempt = { key: string; requestId: string; stale?: boolean }
export type LineChange = { productId: number; action: 'reject' | 'modify' | 'reopen'; counted?: number; lots?: Array<{ batchId: number; counted: number }>; note?: string }

export type ApprovalDeps = {
  sessionId: string
  approval: InventoryCheckApproval | null
  items: readonly InventoryCheckSessionItem[]
  capabilities?: { lotLinesPerSubmission?: number; productsPerSubmission?: number } | null
  current: () => boolean
  /** One write at a time on the page. */
  inFlight: Cell<boolean>
  setBusy: (busy: boolean) => void
  setApproval: (approval: InventoryCheckApproval) => void
  /** Lines this decision applied, by product id, with the ordinary stock each now holds: the page puts it on the session's rows so they do not show the stock from before. */
  setApplied?: (stock: Record<string, number>) => void
  setWriteError: (text: string) => void
  setRefused: (refused: Record<string, string>) => void
  setLineError: (productId: string, text: string | null) => void
  askToConfirm: (request: ConfirmRequest) => Promise<boolean>
  tr: (key: string, fallback: string) => string
  notify: (message: string, kind: 'success' | 'warning' | 'error') => void
  knownRefusal: (cause: unknown) => Promise<{ key: string; fallback: string } | undefined>
  unknownSaveKey: (cause: unknown) => string
  /** Reads the session again: used only when a refusal or a stalled approval means the screen may not show the real state. */
  reload: () => void
  approvalAttempt: Cell<ApprovalAttempt | null>
  lineAttempt: Cell<ApprovalAttempt | null>
  send: {
    approval: (input: { decision: ApprovalAction; requestId: string; productIds?: number[] }) => Promise<InventoryCheckApprovalDecision>
    line: (input: Record<string, unknown>) => Promise<InventoryCheckLineAnswer>
  }
  newRequestId?: (prefix: string) => string
}

const refusedMap = (list: unknown): Record<string, string> => Object.fromEntries((Array.isArray(list) ? list as Array<{ productId?: unknown; code?: unknown }> : []).filter(entry => entry && typeof entry.code === 'string').map(entry => [String(entry.productId), String(entry.code)]))
const isUnknown = (cause: unknown) => (cause as { outcome?: string })?.outcome === 'unknown' || (cause as { code?: string })?.code === 'inventory_check_outcome_unknown'
const nameOf = (item: InventoryCheckSessionItem | undefined, id: number | string) => item?.product_snapshot?.name ?? item?.current_product_name ?? String(id)
const REVIEW_LINES = 8
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export function createApprovalActions(deps: ApprovalDeps) {
  const { tr } = deps
  const newId = deps.newRequestId ?? createClientRequestId
  const unknownText = (cause: unknown) => tr(deps.unknownSaveKey(cause), 'Save not confirmed. Retry the same operation or reload.')
  const failedText = tr('inventory_check_save_failed', 'Check not saved. Try again.')
  // A refusal for a count that cannot be rejected any more (stock may have moved) points at Close.
  const withCloseHint = (text: string) => deps.approval && (deps.approval.applying || deps.approval.applied > 0) ? `${text} ${tr('inventory_check_close_hint', 'Part of it was already applied, so close the remaining lines instead.')}` : text

  /** Approve all (no ids), accept the named lines (productIds), reject or close the whole count. Approving repeats the same request until the server says done. */
  async function decideApproval(decision: ApprovalAction, productIds?: number[]): Promise<void> {
    const approval = deps.approval
    if (!deps.current() || !deps.sessionId || !approval || approval.status !== 'pending' || deps.inFlight.current) return
    const key = `${deps.sessionId}:${decision}:${productIds ? [...productIds].sort((a, b) => a - b).join(',') : ''}`
    if (!deps.approvalAttempt.current || deps.approvalAttempt.current.key !== key) {
      // Approving moves stock and a close or reject ends the count: every one shows what it will do first. A repeat of the same decision (a lost answer) is not asked again.
      const open = openLinesOf(deps.items, approval)
      const accepted = productIds ? deps.items.filter(item => productIds.includes(Number(item.product_id))) : []
      const review = productIds ? acceptReview(accepted) : decision === 'approve' ? approveAllReview(open) : wholeReview(decision, open.length)
      const confirmed = await deps.askToConfirm(review)
      if (!confirmed || !deps.current() || deps.inFlight.current) return
      // An approval that already started under a request id (this approver's own earlier attempt) continues under it: that id is what the stock writers replay.
      deps.approvalAttempt.current = { key, requestId: decision === 'approve' && !productIds && approval.applying_request_id ? approval.applying_request_id : newId('inventory_check_approval') }
    }
    const attempt = deps.approvalAttempt.current
    deps.inFlight.current = true; deps.setBusy(true); deps.setWriteError(''); deps.setRefused({})
    for (const id of productIds ?? []) deps.setLineError(String(id), null)
    let seen = deps.approval?.applied_lines ?? {}
    try {
      const flow = await runApprovalFlow({
        send: () => deps.send.approval({ decision, requestId: attempt.requestId, ...(productIds ? { productIds } : {}) }),
        onProgress: result => {
          if (!deps.current()) return
          // The stock of a line this request applied is now the figure it wrote: the screen shows it without a second read. A line this page had not seen that this request did not apply (another tab applied it,
          // and sales may have moved its stock since) carries an older figure than the rows hold: the answer is not put on any row then, and the session is read once at the end.
          const fresh = Object.entries(result.approval.applied_lines ?? {}).filter(([id, line]) => !seen[id] && finite(line.after))
          seen = result.approval.applied_lines ?? {}
          // `applied` counts stock writes, one per received date, and a product is listed once all its dates have landed: more new products than writes, a product the request was not asked to accept, or any new
          // line from a takeover (it carries the old approver's write) was applied elsewhere or earlier, and sales may have moved it since.
          if (fresh.length > result.applied || (result.takeover && fresh.length > 0) || (productIds && fresh.some(([id]) => !productIds.includes(Number(id))))) attempt.stale = true
          if (fresh.length && !attempt.stale) deps.setApplied?.(Object.fromEntries(fresh.map(([id, line]) => [id, line.after])))
          deps.setApproval(result.approval); deps.setRefused(refusedMap(result.refused))
        },
        isCurrent: deps.current,
        maxRequests: approvalRequestBound(deps.capabilities),
      })
      if (!deps.current()) return
      let reload = !productIds || !!attempt.stale
      if (flow.outcome === 'done') {
        deps.approvalAttempt.current = null
        const ended = flow.last?.approval.status !== 'pending'
        if (!productIds || ended) deps.notify(decision === 'approve' ? tr('inventory_check_approved_done', 'Counts approved. Stock updated.') : decision === 'close' ? tr('inventory_check_closed_done', 'Count closed. Closing did not change stock.') : tr('inventory_check_rejected_done', 'Counts rejected. Stock unchanged.'), 'success')
      } else if (flow.outcome === 'refused') {
        // Some lines were applied; the rest cannot be: said once, with each line's reason on its row. The same Approve repeats once the cause is fixed.
        deps.setWriteError(withCloseHint(tr('inventory_check_lines_refused', 'Some lines cannot be applied. Fix the cause and approve again, or close the remaining lines.')))
      } else if (flow.outcome === 'stalled') {
        deps.setWriteError(tr('inventory_check_error_write_refused', 'Stock could not be updated for some products. Try again.')); reload = true
      } else deps.approvalAttempt.current = null // declined: the next Approve is a fresh decision with its own review
      if (reload) deps.reload()
    } catch (cause) {
      const unknown = isUnknown(cause)
      const refusal = unknown ? undefined : await deps.knownRefusal(cause)
      if (!unknown) deps.approvalAttempt.current = null
      if (!deps.current()) return
      deps.setRefused(refusedMap((cause as { refused?: unknown }).refused))
      const text = refusal ? withCloseHint(tr(refusal.key, refusal.fallback)) : unknown ? unknownText(cause) : failedText
      if (productIds && productIds.length === 1) deps.setLineError(String(productIds[0]), text); else deps.setWriteError(text)
      // Approving the whole count reads the session again whatever happened (as it always did); one accepted line reads it again only for a definite refusal, to show the line as it is.
      if (!unknown || !productIds || attempt.stale) deps.reload()
    } finally { deps.inFlight.current = false; if (deps.current()) deps.setBusy(false) }
  }

  const dateLabel = (line: NonNullable<InventoryCheckSessionItem['lot_lines']>[number]) => line.scope === 'branch' ? tr('inventory_check_branch_total', 'Branch total') : tr('inventory_check_lot_received', 'Received {date}').replace('{date}', line.received_at ? fmtDateOnly(line.received_at) : '—')

  /** What approving leaves per product, as the dialog shows it: a line counted as one figure reads `Now X → Set to Y` (the approver's modified figure when there is one); a line counted by received date is
   * shown date by date (what the counter saw → the figure applied), as the panel shows it, because each date is applied from what it held at approval, which this page does not read. */
  function lineRows(item: InventoryCheckSessionItem, approval: InventoryCheckApproval): Array<{ label: string; value: string }> {
    const name = nameOf(item, item.product_id)
    if (item.lot_lines?.length) {
      return item.lot_lines.map(line => ({
        label: `${name} · ${dateLabel(line)}`,
        value: `${finite(line.seen) ? line.seen : '—'} → ${effectiveLotCounted(item, approval, line)}`,
      }))
    }
    return [{ label: name, value: `${tr('inventory_check_approval_now', 'Now')} ${item.current_quantity ?? '—'} → ${tr('inventory_check_approval_set_to', 'Set to')} ${approvalResult(item, approval) ?? '—'}` }]
  }
  function approveAllReview(open: InventoryCheckSessionItem[]): ConfirmRequest {
    const approval = deps.approval as InventoryCheckApproval
    const rows = open.flatMap(item => lineRows(item, approval)), shown = rows.slice(0, REVIEW_LINES)
    return {
      title: tr('inventory_check_approve_title', 'Approve these counts?'),
      message: tr('inventory_check_approve_all_confirm', 'Every open line is applied. A modified line uses your figure; rejected lines are left out.'),
      note: tr('inventory_check_approve_message', 'Stock changes by what each count found. Sales since the count are kept.'),
      items: [
        { label: tr('inventory_check_line_open_lines', 'Open lines'), value: `${open.length} → 0` },
        ...shown,
        ...(rows.length > shown.length ? [{ label: '…', value: `+${rows.length - shown.length}` }] : []),
      ],
      confirmLabel: tr('inventory_check_approve', 'Approve'),
    }
  }
  /** Accepting one line moves stock, so it is reviewed like the whole count: the line's name, the stock now and what it will be set to. */
  function acceptReview(lines: InventoryCheckSessionItem[]): ConfirmRequest {
    const approval = deps.approval as InventoryCheckApproval
    return {
      title: tr('inventory_check_line_accept_title', 'Approve this line?'),
      message: tr('inventory_check_line_accept_confirm', 'The line is applied. A modified line uses your figure.'),
      note: tr('inventory_check_approve_message', 'Stock changes by what each count found. Sales since the count are kept.'),
      items: lines.flatMap(item => lineRows(item, approval)),
      confirmLabel: tr('inventory_check_approve', 'Approve'),
    }
  }
  function wholeReview(decision: 'reject' | 'close', open: number): ConfirmRequest {
    return {
      title: decision === 'close' ? tr('inventory_check_close_title', 'Close the remaining lines?') : tr('inventory_check_reject_title', 'Reject these counts?'),
      message: decision === 'close' ? tr('inventory_check_close_message', 'Stock does not change. Lines already applied stay applied; the rest are recorded as not applied.') : tr('inventory_check_reject_message', 'Stock stays as it is.'),
      // Lines the approver already rejected are decided; only the lines this decision ends are counted.
      items: [{ label: tr('inventory_check_differences', 'Differences'), value: open }],
      confirmLabel: decision === 'close' ? tr('inventory_check_close', 'Close') : tr('inventory_check_reject', 'Reject'),
      danger: true,
    }
  }

  /** What rejecting one line changes, from the line's own state: an open line is "Open", a modified line is "Modified to {figure}" (each date, for a line counted by received date). */
  function rejectFrom(item: InventoryCheckSessionItem | undefined, id: string, approval: InventoryCheckApproval): Array<{ label: string; value: string }> {
    const name = nameOf(item, id), rejected = tr('inventory_check_line_decided_reject', 'Rejected')
    const modifiedTo = (value: number) => `${tr('inventory_check_line_modified_to', 'Modified to {value}').replace('{value}', String(value))} → ${rejected}`
    const decision = decisionOf(approval, id), modified = decision?.decision === 'modify'
    // Rejecting removes the whole line, so a line counted by received date lists every date, as the accept dialog does: a modified line shows each date's modified figure, an open one reads Open.
    if (item?.lot_lines?.length) return item.lot_lines.map(line => ({ label: `${name} · ${dateLabel(line)}`, value: modified ? modifiedTo(effectiveLotCounted(item, approval, line)) : `${tr('inventory_check_line_open', 'Open')} → ${rejected}` }))
    if (modified && finite(decision?.counted)) return [{ label: name, value: modifiedTo(decision.counted) }]
    return [{ label: name, value: `${tr('inventory_check_line_open', 'Open')} → ${rejected}` }]
  }

  /** Reject, modify or reopen one line: one request, the answer's approval replaces the panel's state, nothing is read again. Resolves true when the line was saved. */
  async function decideLine(change: LineChange): Promise<boolean> {
    const approval = deps.approval
    if (!deps.current() || !deps.sessionId || !approval || approval.status !== 'pending' || deps.inFlight.current) return false
    const id = String(change.productId)
    const item = deps.items.find(candidate => Number(candidate.product_id) === change.productId)
    const body = { productId: change.productId, action: change.action, ...(change.counted !== undefined ? { counted: change.counted } : {}), ...(change.lots ? { lots: change.lots } : {}), ...(change.note !== undefined ? { note: change.note } : {}) }
    const key = JSON.stringify([deps.sessionId, body.productId, body.action, body.counted ?? null, body.lots ? [...body.lots].sort((a, b) => a.batchId - b.batchId) : null, body.note ?? null])
    const requestId = deps.lineAttempt.current?.key === key ? deps.lineAttempt.current.requestId : newId('inventory_check_line')
    // The same judgement the server gives, before anything is sent: a refused figure never leaves the page.
    const verdict = lineDecisionVerdict({ ...body, requestId }, item ? lineShapeOf(item) : { dated: false, batchIds: [] })
    if (!verdict.ok) {
      const refusal = await deps.knownRefusal({ code: change.action === 'modify' ? figureRefusal(verdict.code) : verdict.code })
      if (deps.current()) deps.setLineError(id, refusal ? tr(refusal.key, refusal.fallback) : failedText)
      return false
    }
    if (change.action === 'reject' && deps.lineAttempt.current?.key !== key) {
      const now = item?.current_quantity
      const confirmed = await deps.askToConfirm({
        title: tr('inventory_check_line_reject_title', 'Reject this line?'),
        message: tr('inventory_check_line_reject_confirm', 'The line is not applied and stock stays as it is. You can reopen it while the count is waiting.'),
        items: [
          ...rejectFrom(item, id, approval),
          ...(now !== undefined && now !== null ? [{ label: tr('inventory_check_approval_now', 'Now'), value: `${now} → ${now}` }] : []),
        ],
        confirmLabel: tr('inventory_check_reject', 'Reject'), danger: true,
      })
      if (!confirmed || !deps.current() || deps.inFlight.current) return false
    }
    deps.lineAttempt.current = { key, requestId }
    deps.inFlight.current = true; deps.setBusy(true); deps.setLineError(id, null); deps.setWriteError('')
    try {
      const answer = await deps.send.line(lineRequestBody(verdict.input as LineInput))
      deps.lineAttempt.current = null
      if (!deps.current()) return false
      deps.setApproval(answer.approval)
      deps.setRefused({})
      if (answer.done) deps.notify(answer.approval.status === 'approved' ? tr('inventory_check_approved_done', 'Counts approved. Stock updated.') : tr('inventory_check_rejected_done', 'Counts rejected. Stock unchanged.'), 'success')
      return true
    } catch (cause) {
      const unknown = isUnknown(cause)
      const refusal = unknown ? undefined : await deps.knownRefusal(cause)
      if (!unknown) deps.lineAttempt.current = null
      if (!deps.current()) return false
      deps.setLineError(id, refusal ? tr(refusal.key, refusal.fallback) : unknown ? unknownText(cause) : failedText)
      // A conflict means the approval is not what the screen shows: read it again so the line shows its real state.
      if (!unknown && (cause as { status?: unknown })?.status === 409) deps.reload()
      return false
    } finally { deps.inFlight.current = false; if (deps.current()) deps.setBusy(false) }
  }

  return { decideApproval, decideLine }
}
