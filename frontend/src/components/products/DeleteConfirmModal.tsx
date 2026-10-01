import { lazy, Suspense, useState } from 'react'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js'
import Modal from '../shared/Modal'
import SuggestionTextInput from '../shared/SuggestionTextInput.tsx'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
// Delete's reason reads the same saved-reason catalog as the stock forms
// (type 'delete'), managed in the one stock reasons manager.
import { useSavedStockReasonCatalog } from '../../utils/useSavedStockReasons.ts'
import type { DeleteImpactSummary } from '../../utils/deleteImpactSummary'

const StockReasonsManagerModal = lazy(() => import('../shared/StockReasonsManagerModal'))

type Translate = (key: string, fallback?: string) => string | undefined

interface DeleteConfirmModalProps {
  t?: Translate
  onClose: () => void
  onConfirm: (reason: string) => void
  summary: DeleteImpactSummary
  working: boolean
}

// The "show what will be affected and require explicit confirmation" half
// of progress.md's part 202 batch item ("Products page -- delete/merge
// review flow"). Replaces the bare window.confirm() previously used by
// both Products.tsx's single-row handleDelete and bulk handleBulkDelete --
// same call site either way, driven by the impact summary computed from
// whichever rows are being deleted. Deliberately a lighter-weight review
// than MergeDuplicatesReviewModal (no per-item exclusion list) since
// delete's own soft-delete safety net (restore via undo/history, same as
// this page's existing action-history "Undo product delete" entry) already
// covers the "made a mistake" case that modal's edge-case checklist exists
// for -- this modal's job is just making the affected stock/images/batches
// visible before the click, not re-litigating whether deletion is safe.
export default function DeleteConfirmModal({
  t,
  onClose,
  onConfirm,
  summary,
  working,
}: DeleteConfirmModalProps) {
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  // Delete requires a reason: a saved one or typed text.
  const [reason, setReason] = useState('')
  const [reasonsManagerOpen, setReasonsManagerOpen] = useState(false)
  const { reasons: deleteReasons, reload: reloadDeleteReasons } = useSavedStockReasonCatalog('delete')
  const trimmedReason = reason.trim()

  const isBulk = summary.productCount > 1
  const title = isBulk
    ? T('delete_confirm_title_bulk', 'Delete {count} products?').replace('{count}', String(summary.productCount))
    : T('delete_confirm_title_single', 'Delete this product?')

  const hasImpact = summary.totalStockUnits > 0 || summary.productsWithImages > 0 || summary.productsWithBatches > 0

  return (
    <Modal title={title} onClose={onClose} size="sm" unsavedChanges="read-only">
      <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/30">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0">
            <p className="font-medium text-red-800 dark:text-red-300">
              {isBulk
                ? summary.productNames.slice(0, 5).join(', ') + (summary.productNames.length > 5 ? `, +${summary.productNames.length - 5} more` : '')
                : summary.productNames[0]}
            </p>
          </div>
        </div>

        {hasImpact && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
            <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              {T('delete_confirm_impact_heading', 'This will also remove:')}
            </p>
            <ul className="space-y-1 text-gray-700 dark:text-gray-300">
              {summary.totalStockUnits > 0 && (
                <li>
                  {T('delete_confirm_impact_stock', '{units} unit(s) of stock across {branches} branch(es)')
                    .replace('{units}', String(summary.totalStockUnits))
                    .replace('{branches}', String(summary.branchesWithStock))}
                </li>
              )}
              {summary.productsWithImages > 0 && (
                <li>
                  {isBulk
                    ? T('delete_confirm_impact_images_bulk', '{count} product(s) with uploaded images').replace('{count}', String(summary.productsWithImages))
                    : T('delete_confirm_impact_images_single', 'Uploaded product image(s)')}
                </li>
              )}
              {summary.productsWithBatches > 0 && (
                <li>
                  {isBulk
                    ? T('delete_confirm_impact_batches_bulk', '{count} product(s) with active received-date stock').replace('{count}', String(summary.productsWithBatches))
                    : T('delete_confirm_impact_batches_single', 'Active received-date stock')}
                </li>
              )}
            </ul>
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          {T('delete_confirm_soft_delete_note', 'This is a soft delete -- past sales and movement records are unaffected, and you can undo this from the page immediately after.')}
        </p>

        <div className="flex min-w-0 items-center gap-1.5">
          <SuggestionTextInput
            id="delete-confirm-reason"
            className="min-w-0 flex-1"
            inputClassName="h-9 text-sm"
            value={reason}
            options={deleteReasons.map((entry) => entry.label)}
            onChange={(next) => setReason(next)}
            disabled={working}
            ariaLabel={T('delete_confirm_reason_label', 'Reason for deleting')}
            placeholder={T('delete_confirm_reason_label', 'Reason for deleting')}
          />
          <button
            type="button"
            className={toolbarIconButtonClassName}
            onClick={() => setReasonsManagerOpen(true)}
            disabled={working}
            aria-label={T('manage_reasons', 'Manage reasons')}
            title={T('manage_reasons', 'Manage reasons')}
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => onConfirm(trimmedReason)}
            disabled={working || !trimmedReason}
            title={!trimmedReason ? T('delete_confirm_reason_required', 'A reason is required') : undefined}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
            {working ? T('delete_confirm_working', 'Deleting...') : T('delete_confirm_button', 'Delete')}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300"
          >
            {T('cancel', 'Cancel')}
          </button>
        </div>
        {reasonsManagerOpen ? (
          <Suspense fallback={null}>
            <StockReasonsManagerModal initialTab="delete" onClose={() => setReasonsManagerOpen(false)} onChanged={reloadDeleteReasons} />
          </Suspense>
        ) : null}
      </div>
    </Modal>
  )
}
