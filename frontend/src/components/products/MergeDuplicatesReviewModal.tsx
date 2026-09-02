import { useEffect, useRef, useState } from 'react'
import GitMerge from 'lucide-react/dist/esm/icons/git-merge.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Modal from '../shared/Modal'

type Translate = (key: string, fallback?: string) => string | undefined

export type MergeDuplicatesPreviewGroup = {
  canonicalId: number
  canonicalName: string | null
  canonicalBarcode: string | null
  duplicates: Array<{
    id: number
    name: string | null
    barcode: string | null
    quantity: number
    batchCount: number
  }>
  totalQuantityToMove: number
  branchBreakdown: Array<{ branchId: number; branchName: string | null; quantity: number }>
}

type PreviewResult = {
  groupCount: number
  duplicateProductCount: number
  groups: MergeDuplicatesPreviewGroup[]
}

interface MergeDuplicatesReviewModalProps {
  t?: Translate
  onClose: () => void
  onConfirm: () => void
  onLoadPreview: () => Promise<PreviewResult>
  working: boolean
}

// Explains exactly what "Merge duplicate products" does, and (since part
// 96) actually shows which products would merge before the person commits
// -- backed by the read-only GET /api/products/merge-duplicates/preview
// (routes/products.ts), which reuses findDuplicateProductGroups without
// acting on it. There is still no atomic preview-then-commit in one
// transaction (see progress.md part 96's "did not touch" note) -- a
// catalog change between opening this modal and clicking confirm can make
// the real merge act on a slightly different group set than what was
// shown, which the staleness note below says plainly rather than implying
// a guarantee that doesn't exist.
export default function MergeDuplicatesReviewModal({ t, onClose, onConfirm, onLoadPreview, working }: MergeDuplicatesReviewModalProps) {
  // t() returns the raw key itself (never undefined/empty) on a miss, so
  // `t(key) || fallback` never actually falls back -- same fix as
  // ProductDetailModal.tsx/ProductHistoryPreviewModal.tsx's T().
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  const [acknowledged, setAcknowledged] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const mountedRef = useRef(true)
  const firstLoadRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const runPreview = () => {
    setPreviewLoading(true)
    setPreviewError(null)
    onLoadPreview()
      .then((result) => {
        if (!mountedRef.current) return
        setPreview(result)
        setAcknowledged(false)
      })
      .catch((error) => { if (mountedRef.current) setPreviewError(error?.message || 'Failed to load preview') })
      .finally(() => { if (mountedRef.current) setPreviewLoading(false) })
  }

  useEffect(() => {
    if (!firstLoadRef.current) return
    firstLoadRef.current = false
    runPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups = preview?.groups || []
  const duplicateProductCount = preview?.duplicateProductCount || 0
  const canMerge = !previewLoading && !previewError && groups.length > 0

  return (
    <Modal title={T('merge_duplicate_products', 'Merge duplicate products')} onClose={onClose} size="lg">
      <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
          <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-blue-800 dark:text-blue-300">
            {T(
              'merge_duplicates_summary',
              'Scans every active product and folds branch-only duplicates -- rows that are identical in every identity field but landed in the catalog separately, usually from two import runs (e.g. one file per branch) that never saw each other -- into a single row.',
            )}
          </p>
        </div>

        <section>
          <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
            {T('merge_duplicates_what_counts_title', 'What counts as a duplicate')}
          </h3>
          <p>
            {T(
              'merge_duplicates_what_counts_body',
              'Two products are only merged if their normalized name, cost price, and barcode all match. Selling and special prices do not create a child row; when they differ, the highest price is kept. A different cost or barcode stays as a separate child row. Matching is exact, never fuzzy or approximate.',
            )}
          </p>
        </section>

        <section>
          <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
            {T('merge_duplicates_quantity_title', 'What happens to quantity')}
          </h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              {T(
                'merge_duplicates_quantity_kept',
                'The oldest row in each duplicate group (lowest id) is kept as the "canonical" product; every other row in the group is merged into it.',
              )}
            </li>
            <li>
              {T(
                'merge_duplicates_quantity_summed',
                'Per branch, quantities are ADDED together, never overwritten or picked. If both the kept row and a duplicate already had stock at the same branch, the result is the sum of both (e.g. 5 + 3 = 8) -- not one replacing the other.',
              )}
            </li>
            <li>
              {T(
                'merge_duplicates_quantity_zero_skip',
                'A branch where the duplicate had zero quantity is skipped entirely -- no empty stock row or empty movement record is created for it.',
              )}
            </li>
          </ul>
        </section>

        <section>
          <h3 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
            {T('merge_duplicates_trail_title', 'Traceability -- nothing disappears silently')}
          </h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              {T(
                'merge_duplicates_trail_movement',
                'Every branch that actually receives quantity gets a real inventory movement record, naming the absorbed product by name and id -- visible in that branch\u2019s normal stock history.',
              )}
            </li>
            <li>
              {T(
                'merge_duplicates_trail_audit',
                'Every merged product gets an audit log entry recording which product it was folded into.',
              )}
            </li>
            <li>
              {T(
                'merge_duplicates_trail_soft_delete',
                'The absorbed duplicate is deactivated (soft delete), the same as a normal product delete -- it stops showing in the catalog, but old sales and movement records that reference it are unaffected and keep showing its original name.',
              )}
            </li>
            <li>
              {T(
                'merge_duplicates_trail_batches',
                'Batch and lot records (lot codes, expiry dates) move to the kept product too, the same way quantity does -- they stay visible under "Manage Batches" after merging, not just the stock number. If both products already had a batch with the same lot code, those two batches are combined into one rather than kept as duplicates.',
              )}
            </li>
          </ul>
        </section>

        <section>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {T('merge_duplicates_preview_title', 'What will actually happen')}
            </h3>
            <button
              type="button"
              onClick={runPreview}
              disabled={previewLoading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${previewLoading ? 'animate-spin' : ''}`} />
              {T('merge_duplicates_preview_refresh', 'Re-scan')}
            </button>
          </div>

          {previewLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{T('merge_duplicates_preview_loading', 'Scanning the catalog for duplicates...')}</span>
            </div>
          )}

          {!previewLoading && previewError && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>{T('merge_duplicates_preview_error', 'Could not load a preview.')}</p>
                <p className="mt-0.5 text-xs opacity-80">{previewError}</p>
              </div>
            </div>
          )}

          {!previewLoading && !previewError && groups.length === 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-gray-600 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400">
              {T('merge_duplicates_preview_none', 'No duplicate products found. Nothing to merge right now.')}
            </div>
          )}

          {!previewLoading && !previewError && groups.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {T('merge_duplicates_preview_count', 'Found {groups} group(s), {products} duplicate product(s) that will be folded away.')
                  .replace('{groups}', String(groups.length))
                  .replace('{products}', String(duplicateProductCount))}
              </p>
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {groups.map((group) => (
                  <div
                    key={group.canonicalId}
                    className="rounded-lg border border-gray-200 p-2.5 text-sm dark:border-gray-700"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {group.canonicalName || `#${group.canonicalId}`}
                      </span>
                      <span className="text-xs text-gray-400">
                        {T('merge_duplicates_preview_kept', '(kept, #{id})').replace('{id}', String(group.canonicalId))}
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-1 pl-3">
                      {group.duplicates.map((dup) => (
                        <li key={dup.id} className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                          <span>{dup.name || `#${dup.id}`}</span>
                          <span className="text-gray-400">#{dup.id}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] dark:bg-gray-800">
                            +{dup.quantity}
                          </span>
                          {dup.batchCount > 0 && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] dark:bg-gray-800">
                              {dup.batchCount} {T('merge_duplicates_preview_batches', 'batch(es)')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {group.branchBreakdown.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {group.branchBreakdown.map((b) => (
                          <span
                            key={b.branchId}
                            className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950/30 dark:text-blue-300"
                          >
                            {b.branchName || `#${b.branchId}`}: +{b.quantity}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/40">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
          <p className="text-gray-600 dark:text-gray-400">
            {T(
              'merge_duplicates_preview_staleness',
              'This preview reflects the catalog right now -- if another change lands between opening this dialog and confirming, the merge below still acts on whatever the catalog looks like at that moment, so the exact result may shift slightly.',
            )}
          </p>
        </div>

        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-300 p-3 text-sm dark:border-gray-600">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            disabled={!canMerge}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            {T(
              'merge_duplicates_acknowledge',
              'I understand quantities and batch/lot records will be combined per branch, and duplicates will be deactivated (not permanently erased).',
            )}
          </span>
        </label>

        {/* Sticky footer, same pattern as ProductForm.tsx/FeeForm.tsx's own
            fix. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
          <button
            onClick={onConfirm}
            disabled={!acknowledged || !canMerge || working}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {working
              ? T('merge_duplicates_working', 'Merging...')
              : T('merge_duplicates_confirm_count', 'Merge {products} product(s) now').replace('{products}', String(duplicateProductCount))}
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
