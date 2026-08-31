import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtDate } from '../../utils/formatters.ts'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import Modal from '../shared/Modal'

type Translate = (key: string, fallback?: string) => string | undefined

export type ZeroQuantityCandidate = {
  id: number
  name: string | null
  barcode: string | null
  sku: string | null
  neverStocked: boolean
  zeroSince: string | null
  ageDays: number | null
}

type PreviewResult = {
  thresholdDays: number
  checkedCount: number
  totalCandidates: number
  candidates: ZeroQuantityCandidate[]
}

type DeleteResult = {
  success?: boolean
  error?: string
  deletedCount?: number
  deletedIds?: number[]
  skipped?: Array<{ id: number; reason: string }>
}

interface ZeroQuantityCleanupModalProps {
  t?: Translate
  formatDate?: (value: string) => string
  onClose: () => void
  onLoadPreview: (thresholdDays?: number) => Promise<PreviewResult>
  onConfirmDelete: (ids: number[]) => Promise<DeleteResult | undefined>
  working: boolean
}

// The confirm-before-delete review UI for the "delete products that have
// sat at 0 stock across every branch for a while" cleanup feature. Per
// explicit user instruction (progress.md part 91), this ALWAYS requires a
// person to look at the specific candidate list and pick which ones to
// actually remove -- there is no "just delete everything past the
// threshold" button here, and no scheduled/automatic variant exists
// anywhere in this codebase. Every candidate shown already passed the
// backend's "cache and live branch_stock sum both agree it's 0" check
// (GET /api/products/zero-quantity-candidates) before it ever reaches this
// list -- this modal's only job is age-threshold framing and letting the
// person exclude individual items, not re-deriving the 0-quantity check
// itself.
export default function ZeroQuantityCleanupModal({
  t,
  formatDate,
  onClose,
  onLoadPreview,
  onConfirmDelete,
  working,
}: ZeroQuantityCleanupModalProps) {
  // t() returns the raw key itself (never undefined/empty) on a miss, so
  // `t(key) || fallback` never actually falls back -- same fix as
  // ProductDetailModal.tsx/ProductHistoryPreviewModal.tsx's T().
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  const [thresholdDays, setThresholdDays] = useState(30)
  const [thresholdInput, setThresholdInput] = useState('30')
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())
  const [acknowledged, setAcknowledged] = useState(false)
  const mountedRef = useRef(true)
  const firstLoadRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const runPreview = (days?: number) => {
    setPreviewLoading(true)
    setPreviewError(null)
    onLoadPreview(days)
      .then((result) => {
        if (!mountedRef.current) return
        setPreview(result)
        setThresholdDays(result.thresholdDays)
        setThresholdInput(String(result.thresholdDays))
        setExcludedIds(new Set())
        setAcknowledged(false)
      })
      .catch((error) => { if (mountedRef.current) setPreviewError(error?.message || 'Failed to load candidates') })
      .finally(() => { if (mountedRef.current) setPreviewLoading(false) })
  }

  useEffect(() => {
    if (!firstLoadRef.current) return
    firstLoadRef.current = false
    runPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyThreshold = () => {
    const parsed = Number.parseInt(thresholdInput, 10)
    const days = Number.isFinite(parsed) && parsed >= 0 ? parsed : thresholdDays
    runPreview(days)
  }

  const candidates = preview?.candidates || []
  const selectedIds = useMemo(
    () => candidates.map((c) => c.id).filter((id) => !excludedIds.has(id)),
    [candidates, excludedIds],
  )
  const canDelete = !previewLoading && !previewError && selectedIds.length > 0

  const toggleExcluded = (id: number) => {
    setExcludedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const [deleteResult, setDeleteResult] = useState<DeleteResult | null>(null)

  const handleConfirm = async () => {
    setDeleteResult(null)
    const result = await onConfirmDelete(selectedIds)
    if (!mountedRef.current) return
    setDeleteResult(result || null)
    // Re-scan after a real delete so the list reflects reality instead of
    // showing rows that no longer exist -- same instinct as the merge-
    // duplicates preview's own "re-scan" button, just automatic here since
    // a successful delete always changes the candidate set.
    if (result?.success !== false && (result?.deletedCount || 0) > 0) {
      runPreview(thresholdDays)
    }
  }

  const formatZeroSince = (value: string | null): string => {
    if (!value) return T('unknown', 'Unknown')
    if (formatDate) return formatDate(value)
    // Shared mm/dd/yyyy formatter -- bare toLocaleDateString() follows the
    // viewer's locale (dd/mm on non-US devices).
    try { const d = new Date(value); return Number.isNaN(d.getTime()) ? value : fmtDate(d) } catch (_) { return value }
  }

  return (
    <Modal title={T('zero_quantity_cleanup_title', 'Remove 0-quantity products')} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
          <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-blue-800 dark:text-blue-300">
            {T(
              'zero_quantity_cleanup_summary',
              'Finds products with 0 stock at every branch, confirmed from both the stock cache and a live sum, that have stayed at 0 for at least the threshold below. Nothing is ever deleted automatically -- review the list and confirm which ones to remove.',
            )}
          </p>
        </div>

        <section className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              {T('zero_quantity_cleanup_threshold_label', 'Days at 0 stock before eligible')}
            </span>
            <input
              type="number"
              min={0}
              value={thresholdInput}
              onChange={(event) => setThresholdInput(event.target.value)}
              className="w-28 rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
          </label>
          <button
            type="button"
            onClick={applyThreshold}
            disabled={previewLoading}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {T('zero_quantity_cleanup_apply', 'Apply')}
          </button>
        </section>

        <section>
          {previewLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{T('zero_quantity_cleanup_loading', 'Scanning the catalog...')}</span>
            </div>
          )}

          {!previewLoading && previewError && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>{T('zero_quantity_cleanup_error', 'Could not load candidates.')}</p>
                <p className="mt-0.5 text-xs opacity-80">{previewError}</p>
              </div>
            </div>
          )}

          {!previewLoading && !previewError && candidates.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
              {T('zero_quantity_cleanup_none', 'No products have been at 0 stock for that long. Nothing to review.')}
            </div>
          )}

          {!previewLoading && !previewError && candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {T('zero_quantity_cleanup_count', '{count} product(s) past the {days}-day threshold. Uncheck any you want to keep.')
                  .replace('{count}', String(candidates.length))
                  .replace('{days}', String(thresholdDays))}
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {candidates.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200 p-2.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/40"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={!excludedIds.has(candidate.id)}
                      onChange={() => toggleExcluded(candidate.id)}
                    />
                    <span className="flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {candidate.name || `#${candidate.id}`}
                        </span>
                        <span className="text-xs text-gray-400">#{candidate.id}</span>
                        {candidate.neverStocked ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            {T('zero_quantity_cleanup_never_stocked', 'Never had stock')}
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            {T('zero_quantity_cleanup_sold_out_since', 'Sold out since {date}').replace('{date}', formatZeroSince(candidate.zeroSince))}
                          </span>
                        )}
                        <span className="text-[11px] text-gray-400">
                          {T('zero_quantity_cleanup_age_days', '{days}d at 0').replace('{days}', String(candidate.ageDays ?? '?'))}
                        </span>
                      </span>
                      {(candidate.barcode || candidate.sku) && (
                        <span className="mt-0.5 block text-xs text-gray-400">
                          {[candidate.sku, candidate.barcode].filter(Boolean).join(' \u00b7 ')}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {deleteResult && deleteResult.skipped && deleteResult.skipped.length > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {T('zero_quantity_cleanup_skipped', '{count} product(s) were skipped because they no longer had 0 stock at confirm time.').replace('{count}', String(deleteResult.skipped.length))}
            </p>
          </div>
        )}

        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
          <p className="text-gray-600 dark:text-gray-400">
            {T(
              'zero_quantity_cleanup_soft_delete_note',
              'Removed products are deactivated (soft delete), not permanently erased -- old sales and movement records that reference them are unaffected, and every removal is written to the audit log.',
            )}
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-600">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            disabled={!canDelete}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            {T(
              'zero_quantity_cleanup_acknowledge',
              'I have reviewed this list and want to deactivate the checked products.',
            )}
          </span>
        </label>

        {/* Sticky footer, same pattern as ProductForm.tsx/FeeForm.tsx's own
            fix. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
          <button
            onClick={handleConfirm}
            disabled={!acknowledged || !canDelete || working}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-40"
          >
            {working
              ? T('zero_quantity_cleanup_working', 'Removing...')
              : T('zero_quantity_cleanup_confirm_count', 'Remove {count} product(s)').replace('{count}', String(selectedIds.length))}
          </button>
          <button
            onClick={onClose}
            disabled={working}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300"
          >
            {T('cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
