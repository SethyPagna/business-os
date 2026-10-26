import ConfirmDialog from '../shared/ConfirmDialog'
import { entityFieldLabel } from '../../utils/entityRecords.ts'
import type { ReviewMergePreview } from '../../api/branchRuleErrors.ts'

// The compact confirm an approver sees before a queued rename is merged into an existing product (REVQ-A). It shows, from first
// paint, what the Worker will do: the kept product, the stock that moves onto it, the price it ends with, the stock-in sessions
// whose Undo closes and -- before confirming, not in a toast afterwards -- the queued changes the merge will NOT apply.
type Props = {
  preview: ReviewMergePreview
  tr: (key: string, fallback: string) => string
  t?: (key: string) => string | undefined
  fmtUSD?: (value: unknown) => string
  working: boolean
  onConfirm: () => void
  onClose: () => void
}

export default function ReviewMergeDialog({ preview, tr, t, fmtUSD, working, onConfirm, onClose }: Props) {
  const items = [
    { label: tr('review_merge_confirm_survivor', 'Kept product'), value: preview.survivorName || '#' + preview.survivorId },
    { label: tr('review_merge_confirm_stock_moved', 'Stock moved onto the kept product'), value: String(preview.stockMoved) },
    { label: tr('review_merge_confirm_price_after', 'Price after the merge'), value: fmtUSD ? fmtUSD(preview.priceAfter) : String(preview.priceAfter) },
    ...(preview.restUnapplied.length
      ? [{ label: tr('review_merge_confirm_rest_unapplied', 'Changes not applied'), value: preview.restUnapplied.map((field) => entityFieldLabel(field, tr)).join(', ') }]
      : []),
  ]
  return (
    <ConfirmDialog
      t={t}
      title={tr('review_merge_confirm_title', 'Approve and merge')}
      message={preview.changed
        ? tr('review_merge_target_changed', 'The merge changed since you reviewed it. Nothing was applied. Review it as it is now and confirm again.')
        : tr('review_merge_confirm_required', 'Approving this request merges two products. Review the merge and confirm to continue.')}
      items={items}
      note={preview.sessionsClosing > 0
        ? tr('review_merge_confirm_sessions_closing', 'Approving closes Undo for {n} stock-in session(s) that include these products.').replace('{n}', String(preview.sessionsClosing))
        : undefined}
      confirmLabel={tr('confirm', 'Confirm')}
      cancelLabel={tr('back', 'Back')}
      working={working}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
