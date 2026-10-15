import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../AppContext'
import { canViewAcquisitionCosts, canEditAcquisitionCosts } from '../../utils/acquisitionCostAccess.ts'
import { effectivePermissions, type PermissionUser } from '../../utils/permissions.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import { captureActorReadScope, assertActorReadScope } from '../../api/actorReadScope.ts'
import Modal from './Modal'
import { getProductCostBreakdown } from '../../api/productReadTransport.ts'
import { fmtDate } from '../../utils/formatters.ts'
import {
  formatBreakdownFormula,
  formatCostShare,
  formatCostWeight,
  costExclusionLabelKey,
  costRowPrimaryText,
  costRowMeta,
  normalizeCostBreakdown,
  type CostBreakdown,
} from '../../utils/costBreakdownFormat.ts'

type TranslateFn = (key: string, fallback: string) => string

export type CostCalculationFloatProps = {
  productId: number | string
  productName?: string
  onClose: () => void
  fmtUSD: (value: number) => string
  fmtKHR: (value: number) => string
  t: TranslateFn
}

// P10-6 (owner ruling, 2026-09-16, verbatim): "when clicked on cost price it
// opens a page that tells us the calculated cost price (n_i + n_{i+1} +
// ... + n_{i+k}) / i". One shared float, opened from every clickable cost
// price display in the app -- see the display sites listed in the lane task.
// Renders its real content from first paint (per the standing no-stub-float
// rule): it fetches on mount and shows a loading state, never a shell that
// waits on some prior action.
export default function CostCalculationFloat({ productId, productName, onClose, fmtUSD, fmtKHR, t }: CostCalculationFloatProps) {
  const { user } = useApp() as { user: PermissionUser }
  const canViewCosts = canViewAcquisitionCosts(user)
  const tr = (key: string, fallback: string): string => t(key, fallback) || fallback
  const unknownLabel = tr('cost_unknown', 'Unknown cost')
  const [loaded, setLoaded] = useState<{ breakdown: CostBreakdown; productId: number | string; user: PermissionUser } | null>(null)
  const breakdown = loaded?.productId === productId && loaded.user === user ? loaded.breakdown : null
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const confirmationRef = useRef<{ body: { client_request_id: string; reviewed_digest: string; value: number }; scope: ReturnType<typeof captureActorReadScope> } | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    if (!canViewCosts) return
    let cancelled = false
    aliveRef.current = true
    setLoading(true)
    setLoaded(null)
    setConfirmed(false)
    setConfirming(false)
    confirmationRef.current = null
    const scope = captureActorReadScope()
    setError('')
    getProductCostBreakdown(productId)
      .then((result) => {
        if (cancelled || !aliveRef.current) return
        assertActorReadScope(scope)
        const normalized = normalizeCostBreakdown(result)
        if (!normalized) throw new Error('empty')
        setLoaded({ breakdown: normalized, productId, user })
        if (normalized.costConfirmation) confirmationRef.current = { scope, body: { client_request_id: createClientRequestId('cost_confirm'), reviewed_digest: normalized.costConfirmation.reviewed_digest, value: normalized.costConfirmation.usd } }
      })
      .catch(() => {
        if (!cancelled && aliveRef.current) setError(tr('cost_breakdown_failed', 'Could not load the cost calculation'))
      })
      .finally(() => {
        if (!cancelled && aliveRef.current) setLoading(false)
      })
    return () => { cancelled = true; aliveRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, canViewCosts, user])

  const formula = breakdown ? formatBreakdownFormula(breakdown) : ''
  const permissions = effectivePermissions(user)
  const canConfirm = canViewCosts && canEditAcquisitionCosts(user) && permissions.getPermissionTier('products') === 'full' && permissions.can('products', 'edit')
  const confirm = async () => {
    const submission = confirmationRef.current
    if (!submission || !canConfirm || confirming || confirmed) return
    setConfirming(true)
    setError('')
    try {
      assertActorReadScope(submission.scope)
      const { confirmProductCostReview } = await import('../../api/productWriteTransport.ts')
      if (!aliveRef.current || confirmationRef.current !== submission) return
      assertActorReadScope(submission.scope)
      const result = await confirmProductCostReview(productId, submission.body) as { success?: unknown; cost_needs_review?: unknown }
      if (!aliveRef.current || confirmationRef.current !== submission) return
      assertActorReadScope(submission.scope)
      if (result.success !== true || result.cost_needs_review !== false) throw new Error(tr('cost_review_changed', 'The product needs a new cost review. Close and reopen its calculation.'))
      if (aliveRef.current) setConfirmed(true)
    } catch (failure) {
      if (aliveRef.current && confirmationRef.current === submission) setError(failure instanceof Error ? failure.message : tr('cost_review_confirm_failed', 'Could not confirm the cost. Retry the original confirmation.'))
    } finally { if (aliveRef.current && confirmationRef.current === submission) setConfirming(false) }
  }
  if (!canViewCosts) return null

  return (
    <Modal title={tr('cost_breakdown_title', 'Calculated cost price')} onClose={onClose} size="sm" unsavedChanges="read-only" closeDisabled={confirming}>
      <div className="space-y-3 text-sm">
        {productName ? <div className="min-w-0 detail-scroll-text text-xs font-medium text-gray-500 dark:text-gray-400">{productName}</div> : null}

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        ) : error && !breakdown ? (
          <p role="alert" className="text-red-600">{error}</p>
        ) : breakdown ? (
          <>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
              {breakdown.inputs.length ? breakdown.inputs.map((input, index) => {
                const excludedKey = costExclusionLabelKey(input.excluded, input.cost_usd)
                const excludedLabel = excludedKey ? tr(excludedKey, excludedKey) : ''
                const isManual = input.source === 'manual'
                const formattedDate = isManual
                  ? (input.recorded_at ? fmtDate(input.recorded_at) : null)
                  : (input.received_at ? fmtDate(input.received_at) : null)
                const primaryText = isManual ? tr('cost_breakdown_manual_tag', 'Override') : costRowPrimaryText(input, formattedDate)
                const meta = costRowMeta(input, formattedDate)
                const currentCostText = input.cost_usd == null ? unknownLabel : fmtUSD(input.cost_usd)
                const costText = isManual
                  ? `${input.previous_cost_usd == null ? '—' : fmtUSD(input.previous_cost_usd)} → ${currentCostText}`
                  : currentCostText
                // U-cost (owner, 2026-09-25): the average is weighted by what is
                // on hand, so every counted row says how much it weighs and its
                // share; the sold-out fallback says why it stands in.
                const weight = formatCostWeight(input)
                const share = formatCostShare(input.share)
                const weightText = weight
                  ? `${weight} ${tr('cost_breakdown_on_hand', 'on hand')}${share ? ` · ${share}` : ''}`
                  : input.fallback ? tr('cost_breakdown_fallback_note', 'Nothing on hand - newest received cost') : ''
                return (
                  // ONE compact row per entry (P10-11 ruling): the lot
                  // code/date or the "Manual" tag on the left with its
                  // muted meta strip on the same line, the cost on the
                  // right -- never a two-line "list number · shop" card.
                  <li
                    key={`${input.source}-${input.lot_code || input.recorded_at || input.label}-${index}`}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${input.excluded ? 'opacity-50' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      {/* This line is per-record data, not a caption: the meta
                          strip carries the BRANCH name on a lot row and the
                          USER name on a manual one (costBreakdownFormat.ts,
                          `costRowMeta`). Names are not cut on this project --
                          they scroll sideways inside their own box -- so the
                          row uses the same `.detail-scroll-text` the cost
                          column beside it already uses, and no longer hands
                          the text to the truncating component. */}
                      <span className={`detail-scroll-text text-sm ${isManual ? 'font-medium text-indigo-600 dark:text-indigo-400' : 'text-gray-800 dark:text-gray-200'}`}>{`${primaryText}${meta ? ` · ${meta}` : ''}`}</span>
                    </span>
                    <span className={`${isManual ? 'min-w-0 max-w-[65%]' : 'shrink-0'} text-right tabular-nums`}>
                      <span className={`block font-medium ${isManual ? 'detail-scroll-text' : ''}`} title={isManual ? costText : undefined}>{costText}</span>
                      {weightText ? <span className={`block text-[11px] text-gray-500 dark:text-gray-400 ${isManual ? 'detail-scroll-text' : ''}`}>{weightText}</span> : null}
                      {excludedLabel ? <span className={`block text-[11px] text-gray-400 ${isManual ? 'detail-scroll-text' : ''}`}>{excludedLabel}</span> : null}
                    </span>
                  </li>
                )
              }) : (
                <li className="px-2.5 py-2 text-xs text-gray-400">{tr('cost_breakdown_no_lots', 'No lot costs recorded yet -- showing the catalog cost.')}</li>
              )}
            </ul>

            {formula ? (
              <div className="rounded-lg bg-gray-50 p-2.5 font-mono text-xs tabular-nums text-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
                {formula}
              </div>
            ) : null}

            <div className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{tr('cost_breakdown_result_label', 'Catalog cost price')}</div>
              <div className="text-base font-semibold tabular-nums text-gray-900 dark:text-white">{breakdown.result_usd == null ? unknownLabel : fmtUSD(breakdown.result_usd)}</div>
              {breakdown.result_khr != null ? (
                <div className="text-xs text-gray-400">
                  {fmtKHR(breakdown.result_khr)}
                  <span className="ml-1">({tr('cost_breakdown_khr_note', 'recorded KHR cost, not averaged from lots')})</span>
                </div>
              ) : null}
            </div>
            {breakdown.cost_needs_review && !confirmed ? <div className="space-y-2" role="status"><p>{tr('merge_cost_needs_review', 'Cost needs review')}</p>{canConfirm && breakdown.costConfirmation ? <button type="button" className="btn-primary w-full" disabled={confirming || !confirmationRef.current} onClick={() => void confirm()}>{confirming ? tr('saving', 'Saving…') : tr('cost_review_confirm_usd', 'Confirm this known USD cost')}</button> : null}</div> : null}
            {confirmed ? <p role="status">{tr('cost_review_confirmed', 'Cost confirmed')}</p> : null}
            {error ? <p role="alert" className="text-red-600">{error}</p> : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}
