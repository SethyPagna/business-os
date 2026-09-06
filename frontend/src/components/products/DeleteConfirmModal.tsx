import { useCallback, useEffect, useMemo, useState } from 'react'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Modal from '../shared/Modal'
import { getInventoryReasons, saveInventoryReasons } from '../../api/methods.ts'
// Same saved-reason catalog + "Manage reasons" component Inventory's own
// Adjust-stock modal already uses -- per the
// user's own framing, delete's reason field is "basically same as
// inventory page products adjust stock... just different page but same
// purpose and function", so this reuses the catalog (type: 'delete'
// alongside its existing 'adjust'/'transfer'/'move' entries) rather than
// inventing a separate one.
import InventoryReasonManagerModal from '../inventory/InventoryReasonManagerModal.tsx'
import type { DeleteImpactSummary } from '../../utils/deleteImpactSummary'

type Translate = (key: string, fallback?: string) => string | undefined

interface DeleteConfirmModalProps {
  t?: Translate
  onClose: () => void
  onConfirm: (reason: string) => void
  summary: DeleteImpactSummary
  working: boolean
}

type InventoryReasonType = 'adjust' | 'transfer' | 'move' | 'delete'

type InventoryReason = {
  id: string
  type?: InventoryReasonType
  label: string
}

type ReasonManagerState = {
  open: boolean
  type: InventoryReasonType
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

  // Delete now requires a reason, drawn from the same saved-reason catalog
  // Inventory's Adjust-stock modal uses (inventory_saved_reasons), just
  // filtered to type: 'delete' -- same chip-picker + free-text + "Manage
  // reasons" pattern that modal uses, not a separate one-off UI.
  const [reason, setReason] = useState('')
  const [inventoryReasons, setInventoryReasons] = useState<InventoryReason[]>([])
  const [reasonManager, setReasonManager] = useState<ReasonManagerState>({ open: false, type: 'delete' })
  const [reasonDraft, setReasonDraft] = useState('')
  const [savingReasons, setSavingReasons] = useState(false)
  const trimmedReason = reason.trim()

  useEffect(() => {
    let cancelled = false
    getInventoryReasons()
      .then((result) => {
        if (cancelled) return
        const items = Array.isArray((result as { items?: unknown })?.items) ? (result as { items: InventoryReason[] }).items : []
        setInventoryReasons(items)
      })
      .catch(() => { if (!cancelled) setInventoryReasons([]) })
    return () => { cancelled = true }
  }, [])

  const deleteReasons = useMemo(() => inventoryReasons.filter((item) => item?.type === 'delete'), [inventoryReasons])
  // Only the 'delete' slice is rendered as picker chips here, but the full
  // catalog (all types) is what gets saved back -- otherwise saving from
  // this modal would silently wipe out every Inventory-side adjust/
  // transfer/move reason, same shared-array trap Inventory.tsx's own
  // save already guards against.
  const reasonsByType = useMemo(() => ({ delete: deleteReasons }), [deleteReasons])

  const saveReasonCatalog = useCallback(async (nextItems: InventoryReason[]) => {
    setSavingReasons(true)
    try {
      const result = await saveInventoryReasons(nextItems) as { pending?: boolean; items?: InventoryReason[] } | undefined
      if (result?.pending) return inventoryReasons
      const items = Array.isArray(result?.items) ? result.items : []
      setInventoryReasons(items)
      return items
    } finally {
      setSavingReasons(false)
    }
  }, [inventoryReasons])
  const addSavedReason = useCallback(async () => {
    const label = reasonDraft.trim()
    if (!label) return
    const next = [...inventoryReasons, { id: `delete:${Date.now()}`, type: 'delete' as InventoryReasonType, label }]
    await saveReasonCatalog(next)
    setReasonDraft('')
  }, [inventoryReasons, reasonDraft, saveReasonCatalog])
  const renameSavedReason = useCallback(async (entry: InventoryReason) => {
    const nextLabel = window.prompt(T('rename_reason_prompt', 'Rename saved reason'), entry?.label || '')
    if (!nextLabel) return
    const next = inventoryReasons.map((item) => (item.id === entry.id ? { ...item, label: nextLabel.trim() } : item))
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog])
  const deleteSavedReason = useCallback(async (entry: InventoryReason) => {
    if (!window.confirm(T('delete_saved_reason_confirm', 'Delete this saved reason?'))) return
    const next = inventoryReasons.filter((item) => item.id !== entry.id)
    await saveReasonCatalog(next)
  }, [inventoryReasons, saveReasonCatalog])

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
                    ? T('delete_confirm_impact_batches_bulk', '{count} product(s) with active batch/lot stock').replace('{count}', String(summary.productsWithBatches))
                    : T('delete_confirm_impact_batches_single', 'Active batch/lot stock')}
                </li>
              )}
            </ul>
          </div>
        )}

        <p className="text-xs text-gray-500 dark:text-gray-400">
          {T('delete_confirm_soft_delete_note', 'This is a soft delete -- past sales and movement records are unaffected, and you can undo this from the page immediately after.')}
        </p>

        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="delete-confirm-reason" className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              {T('delete_confirm_reason_label', 'Reason for deleting')}
            </label>
            <button type="button" className="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-300" onClick={() => setReasonManager({ open: true, type: 'delete' })}>
              {T('manage_reasons', 'Manage reasons')}
            </button>
          </div>
          {deleteReasons.length ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {deleteReasons.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reason === entry.label ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}
                  onClick={() => setReason(entry.label)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          ) : null}
          <input
            id="delete-confirm-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={working}
            placeholder={T('delete_confirm_reason_placeholder', 'Choose a saved reason or type your own')}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
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
        <InventoryReasonManagerModal
          addSavedReason={addSavedReason}
          deleteSavedReason={deleteSavedReason}
          reasonDraft={reasonDraft}
          reasonManager={reasonManager}
          reasonsByType={reasonsByType}
          renameSavedReason={renameSavedReason}
          savingReasons={savingReasons}
          setReasonDraft={setReasonDraft}
          setReasonManager={setReasonManager}
          t={t || (() => undefined)}
          tr={(key, fallbackEn) => T(key, fallbackEn ?? key)}
        />
      </div>
    </Modal>
  )
}
