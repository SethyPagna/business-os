import { useEffect, useMemo, useRef, useState } from 'react'
import RotateCw from 'lucide-react/dist/esm/icons/rotate-cw.js'
import { useApp, useSync } from '../../AppContext'
import { ConflictIcon, CONFLICT_ICON_CLASS } from '../shared/ConflictIcon.ts'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import PaginationControls from '../shared/PaginationControls.tsx'
import { canEditAcquisitionCosts, canViewAcquisitionCosts } from '../../utils/acquisitionCostAccess.ts'
import type { PermissionUser } from '../../utils/permissions.ts'
import { createDataGapsPager, dataGapRefusalText, dataGapsPagerTotal, type DataGapsState } from '../../utils/productDataGapsPager.ts'
import { ProductDataGapRowCard } from './ProductDataGapRowCard.tsx'
import {
  PRODUCT_DATA_GAP_PAGE_SIZE,
  getProductDataGapCounts,
  getProductDataGaps,
  setProductConflictMark,
  type ProductConflictMark,
  type ProductDataGapKind,
  type ProductDataGapRow,
} from '../../api/productWriteTransport.ts'

// Products -> Conflicts, second block: the gaps no merge can settle, only an edit or a decision (owner, 14-15 Oct 2026).
//   Unknown cost  every unknown-cost item: a catalog cost never recorded, received dates with units and no cost, held damaged lots
//                 with no cost, and an old $0 nobody has proven (a $0 on a newer product is a recorded $0 and is not listed).
//                 "Confirm $0" proves a real $0 and rewrites nothing.
//   No barcode / Barcode 0   blank barcodes and the old all-zero placeholders, two lists; "This product has no barcode" takes a
//                 product off both, reversibly.
// The flag is per product row (a name group's child row): the row carries its own cost and barcode and is what gets edited. A tap opens
// the same product preview a Products row opens, which has Edit; both decisions are audited, undoable from History, and touch no
// cost, stock or sale.

type TranslateFn = (key: string) => string | undefined

const KINDS: ReadonlyArray<{ kind: ProductDataGapKind; labelKey: string; labelFallback: string; emptyKey: string; emptyFallback: string }> = [
  { kind: 'unknown_cost', labelKey: 'conflict_type_unknown_cost', labelFallback: 'Unknown cost', emptyKey: 'product_data_gaps_none_unknown_cost', emptyFallback: 'No products with an unknown cost.' },
  { kind: 'empty_barcode', labelKey: 'conflict_type_empty_barcode', labelFallback: 'No barcode', emptyKey: 'product_data_gaps_none_empty_barcode', emptyFallback: 'No products without a barcode.' },
  { kind: 'placeholder_barcode', labelKey: 'conflict_type_placeholder_barcode', labelFallback: 'Barcode 0', emptyKey: 'product_data_gaps_none_placeholder_barcode', emptyFallback: 'No products with a placeholder barcode.' },
]

type Pending = { mark: ProductConflictMark; row: ProductDataGapRow }

export default function ProductDataGapsSection({ t, notify, onPreviewProduct, refreshToken = 0 }: {
  t: TranslateFn
  notify: (message: string, tone?: string) => void
  onPreviewProduct?: (productId: number) => void
  /** The tab's own Refresh bumps this; the section re-reads instead of carrying a second Refresh button. */
  refreshToken?: number
}) {
  const { user, can, getPermissionTier } = useApp() as { user: PermissionUser; can?: (permissionKey: string, actionKey: string) => boolean; getPermissionTier?: (key: string) => string }
  const { syncChannel } = useSync() as { syncChannel?: { channel?: string; reason?: string; ts?: number } }
  const canSeeCost = canViewAcquisitionCosts(user)
  const canEditProduct = can ? can('products', 'edit') : false
  const canConfirmZero = canEditProduct && canEditAcquisitionCosts(user)
  // A Review-tier account may ask for either decision; an admin approves it from the review queue (owner, 27 Oct 2026).
  const queuesForReview = getPermissionTier?.('products') === 'review'
  const kinds = useMemo(() => KINDS.filter((item) => item.kind !== 'unknown_cost' || canSeeCost), [canSeeCost])
  // One pager per mount (created in the effect, so a StrictMode re-run gets a fresh, undisposed one).
  const pagerRef = useRef<ReturnType<typeof createDataGapsPager> | null>(null)
  const [state, setState] = useState<DataGapsState>({ kind: kinds[0].kind, page: 1, rows: [], hasMore: false, status: 'loading', counts: null })
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const pager = createDataGapsPager({ fetchPage: getProductDataGaps, fetchCounts: getProductDataGapCounts }, kinds[0].kind)
    pagerRef.current = pager
    setState(pager.getState())
    pager.subscribe(() => setState(pager.getState()))
    void pager.start()
    return () => { pager.dispose(); pagerRef.current = null }
  }, [kinds])

  // The tab's Refresh, and any products change (an edit saved from the preview, a decision, another device): re-read this page.
  const firstRefresh = useRef(refreshToken)
  useEffect(() => {
    if (firstRefresh.current === refreshToken) return
    firstRefresh.current = refreshToken
    void pagerRef.current?.start()
  }, [refreshToken])
  const syncTs = Number(syncChannel?.ts || 0)
  const handledSync = useRef(syncTs)
  useEffect(() => {
    if (syncTs === handledSync.current) return
    handledSync.current = syncTs
    if (syncChannel?.channel === 'products' && syncChannel?.reason !== 'cache-refresh') void pagerRef.current?.reload()
  }, [syncTs, syncChannel?.channel, syncChannel?.reason])

  const active = kinds.find((item) => item.kind === state.kind) || kinds[0]
  const total = dataGapsPagerTotal(state, PRODUCT_DATA_GAP_PAGE_SIZE)

  const confirmPending = async () => {
    if (!pending) return
    setSaving(true)
    try {
      const result = await setProductConflictMark(pending.row.id, pending.mark, true)
      setPending(null)
      // Queued: nothing changed yet, so the row stays listed (with its waiting tag) until an admin approves.
      notify(result?.pending
        ? t('reason_submitted_for_review') || 'Submitted for review -- changes will appear once approved.'
        : t('conflict_issue_saved') || 'Saved — removed from Conflicts')
      void pagerRef.current?.reload()
    } catch (error) {
      notify(dataGapRefusalText(error, t, 'Could not save this decision'), 'error')
      void pagerRef.current?.reload()
    } finally {
      setSaving(false)
    }
  }

  const zeroDialog = pending?.mark === 'zero_cost_confirmed'
  return (
    <section data-product-data-gaps className="space-y-2 border-t border-gray-100 pt-3 dark:border-zinc-800">
      <div className="flex min-w-0 items-center gap-1.5">
        <ConflictIcon aria-hidden="true" className={`h-4 w-4 shrink-0 ${CONFLICT_ICON_CLASS}`} />
        <div role="group" aria-label={t('type') || 'Type'} className="flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto [scrollbar-width:none]">
          {kinds.map((item) => {
            const count = state.counts ? state.counts[item.kind] : undefined
            return (
              <button
                key={item.kind}
                type="button"
                data-product-data-gap-kind={item.kind}
                aria-pressed={state.kind === item.kind}
                onClick={() => void pagerRef.current?.setKind(item.kind)}
                className={`inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold leading-relaxed transition-colors ${state.kind === item.kind ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' : 'text-gray-600 hover:bg-black/5 dark:text-gray-300 dark:hover:bg-white/10'}`}
              >
                {t(item.labelKey) || item.labelFallback}{typeof count === 'number' && count > 0 ? ` · ${count}` : ''}
              </button>
            )
          })}
        </div>
      </div>

      {state.status === 'error' ? (
        <div role="alert" data-product-data-gap-error className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-rose-200 px-4 py-6 text-sm text-rose-700 dark:border-rose-900/50 dark:text-rose-300">
          <span>{t('product_data_gaps_load_failed') || 'Could not load these products'}</span>
          <button type="button" onClick={() => void pagerRef.current?.retry()} title={t('retry') || 'Retry'} aria-label={t('retry') || 'Retry'}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
            <RotateCw aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : state.status === 'loading' && !state.rows.length ? (
        <div className="py-6 text-center text-sm text-gray-400">{t('loading') || 'Loading...'}</div>
      ) : state.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-zinc-700">
          {t(active.emptyKey) || active.emptyFallback}
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 ${state.status === 'loading' ? 'opacity-60' : ''}`}>
            {state.rows.map((row) => (
              <ProductDataGapRowCard
                key={row.id}
                row={row}
                kind={state.kind}
                t={t}
                onOpen={onPreviewProduct}
                onConfirmZero={canConfirmZero ? (target) => setPending({ mark: 'zero_cost_confirmed', row: target }) : undefined}
                onMarkNoBarcode={canEditProduct ? (target) => setPending({ mark: 'no_barcode', row: target }) : undefined}
              />
            ))}
          </div>
          <div className="flex justify-center">
            <PaginationControls
              compact
              editablePageInput={false}
              page={state.page}
              pageSize={PRODUCT_DATA_GAP_PAGE_SIZE}
              totalItems={total}
              label={t(active.labelKey) || active.labelFallback}
              t={t}
              onPageChange={(page) => void pagerRef.current?.goTo(page)}
            />
          </div>
        </>
      )}

      {pending ? (
        <ConfirmDialog
          title={zeroDialog ? t('conflict_confirm_zero') || 'Confirm $0 (free)' : t('conflict_mark_no_barcode') || 'This product has no barcode'}
          message={`${pending.row.name || `#${pending.row.id}`} — ${zeroDialog
            ? t('conflict_confirm_zero_message') || 'Keep the cost at $0. Nothing is rewritten, and History can undo it.'
            : t('conflict_mark_no_barcode_message') || 'It leaves the barcode lists. History can undo it.'}`}
          items={zeroDialog
            ? [
              { label: t('before') || 'Before', value: t('cost_zero_unconfirmed') || '$0 not confirmed' },
              { label: t('after') || 'After', value: queuesForReview ? t('conflict_sent_for_review_state') || 'Pending approval' : t('conflict_zero_confirmed_state') || '$0 confirmed' },
            ]
            : [
              { label: t('before') || 'Before', value: state.kind === 'placeholder_barcode' ? t('conflict_type_placeholder_barcode') || 'Barcode 0' : t('conflict_type_empty_barcode') || 'No barcode' },
              { label: t('after') || 'After', value: queuesForReview ? t('conflict_sent_for_review_state') || 'Pending approval' : t('conflict_no_barcode_marked_state') || 'Marked: no barcode' },
            ]}
          confirmLabel={t('confirm') || 'Confirm'}
          working={saving}
          onConfirm={() => void confirmPending()}
          onClose={() => { if (!saving) setPending(null) }}
          t={t}
        />
      ) : null}
    </section>
  )
}
