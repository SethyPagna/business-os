import { useState } from 'react'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Modal from '../shared/Modal.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { ModalCloseContext } from '../shared/modalCloseContext.ts'
import { ProductImg } from './shared/primitives.tsx'
import { useApp as useAppHook } from '../../AppContext.tsx'
import type {
  SelectedConflictGroupReviewGroup,
  SelectedConflictGroupReviewResult,
  SelectedConflictGroupFinalizeResult,
  SelectedConflictGroupApplyResult,
  SelectedConflictMergeApplyResult,
  SelectedConflictMergePreviewCase,
  SelectedConflictMergePreviewResult,
} from '../../api/productWriteTransport.ts'
import {
  selectedConflictChoicesComplete,
  type SelectedConflictLocalSkip,
  type SelectedConflictStockChoice,
} from '../../utils/selectedConflictMerge.ts'
import {
  selectedConflictGroupLoadedProgress,
  selectedConflictGroupChoicesComplete,
  selectedConflictGroupSourceValue,
  type SelectedConflictGroupResolutionChoice,
} from '../../utils/selectedConflictActionReview.ts'

type Translate = (key: string) => string | undefined
const useApp = useAppHook as unknown as () => {
  fmtUSD: (value: unknown) => string
  fmtKHR: (value: unknown) => string
}

type Props = {
  preview: SelectedConflictMergePreviewResult
  localSkipped: SelectedConflictLocalSkip[]
  choices: Readonly<Record<string, SelectedConflictStockChoice | undefined>>
  working: boolean
  result: SelectedConflictMergeApplyResult | null
  committedCases: SelectedConflictMergeApplyResult['committedCases']
  changedCases: Readonly<Record<string, SelectedConflictMergePreviewCase | undefined>>
  choicesFrozen: boolean
  unknownOutcome: boolean
  needsRefresh: boolean
  canResume: boolean
  canRepreview: boolean
  onChoice: (caseKey: string, choice: SelectedConflictStockChoice) => void
  onConfirm: () => void
  onResume: () => void
  onRefresh: () => void
  onClose: () => void
  t: Translate
}

function ImageSummary({ primary, gallery, label, t }: {
  primary: string | null
  gallery: string[]
  label: string
  t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const visible = expanded ? gallery : gallery.slice(0, 4)
  return (
    <div className="mt-2 rounded border border-black/5 p-1.5 text-[11px] dark:border-white/10">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{label}</span>
        <span>{tr('primary', 'Primary')}:</span>
        {primary ? <ProductImg src={primary} alt="" className="h-9 w-9 rounded object-cover" /> : <span>{tr('no_image', 'No image')}</span>}
        <span>· {tr('images', 'Images')}: {gallery.length}</span>
      </div>
      {visible.length ? <div className="mt-1 flex flex-wrap gap-1">{visible.map((src, index) => <ProductImg key={`${src}-${index}`} src={src} alt="" className="h-9 w-9 rounded object-cover" />)}</div> : null}
      {gallery.length > 4 ? (
        <button type="button" className="mt-1 text-blue-600 dark:text-blue-300" onClick={() => setExpanded((open) => !open)}>
          {expanded ? tr('show_less', 'Show less') : `${tr('selected_conflict_show_all_images', 'Show all images')} (+${gallery.length - 4})`}
        </button>
      ) : null}
    </div>
  )
}

function asNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function codeKey(code: string): string {
  return `selected_conflict_${String(code || 'unknown').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`
}

function SummaryPair({ label, usdValue, khrValue }: { label: string; usdValue: unknown; khrValue: unknown }) {
  const { fmtUSD, fmtKHR } = useApp()
  return (
    <div className="flex items-start justify-between gap-3 text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right font-medium text-gray-900 dark:text-gray-100">{fmtUSD(asNumber(usdValue))} · {fmtKHR(asNumber(khrValue))}</span>
    </div>
  )
}

function BeforeAfterCase({ item, previousReview, choice, choiceDisabled, onChoice, t }: {
  item: SelectedConflictMergePreviewCase
  previousReview?: SelectedConflictMergePreviewCase
  choice?: SelectedConflictStockChoice
  choiceDisabled: boolean
  onChoice: (choice: SelectedConflictStockChoice) => void
  t: Translate
}) {
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const resolvedChoice = choice || (!item.needs_stock_choice ? 'merge' : null)
  const after = resolvedChoice ? item.after_by_stock_choice[resolvedChoice] : null
  const previousChoice = previousReview && (choice || (!previousReview.needs_stock_choice ? 'merge' : null))
  const previousAfter = previousReview && previousChoice ? previousReview.after_by_stock_choice[previousChoice] : null
  return (
    <section className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700" data-case-key={item.case_key}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {item.before.keeper.name || `#${item.keep_id}`} ← {item.before.discarded.name || `#${item.merge_id}`}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {tr('keep', 'Keep')} #{item.keep_id} · {item.before.keeper.barcode || tr('unknown', 'Unknown')} · {item.before.keeper.is_active ? tr('active', 'Active') : tr('inactive', 'Inactive')}{item.before.keeper.is_group ? ` · ${tr('selected_conflict_group_label', 'Group')}` : ''}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {tr('remove', 'Remove')} #{item.merge_id} · {item.before.discarded.barcode || tr('unknown', 'Unknown')} · {item.before.discarded.is_active ? tr('active', 'Active') : tr('inactive', 'Inactive')}{item.before.discarded.is_group ? ` · ${tr('selected_conflict_group_label', 'Group')}` : ''}
          </p>
        </div>
        {item.blocked ? (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            {tr(codeKey(item.blocked.code), item.blocked.message || item.blocked.code)}
          </span>
        ) : null}
        {previousReview ? (
          <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            {tr('selected_conflict_changed_since_review', 'Changed since review')}
          </span>
        ) : null}
      </div>

      {previousReview ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/20">
          <p className="font-semibold text-amber-900 dark:text-amber-100">{tr('selected_conflict_previous_review_values', 'Previous review values')}</p>
          <SummaryPair label={`${tr('keep', 'Keep')} · ${tr('cost_price', 'Cost')}`} usdValue={previousReview.before.costs.keeper.cost_price_usd} khrValue={previousReview.before.costs.keeper.cost_price_khr} />
          <SummaryPair label={`${tr('remove', 'Remove')} · ${tr('cost_price', 'Cost')}`} usdValue={previousReview.before.costs.discarded.cost_price_usd} khrValue={previousReview.before.costs.discarded.cost_price_khr} />
          <SummaryPair label={`${tr('keep', 'Keep')} · ${tr('selling_price', 'Selling price')}`} usdValue={previousReview.before.prices.keeper.selling_price_usd} khrValue={previousReview.before.prices.keeper.selling_price_khr} />
          <SummaryPair label={`${tr('remove', 'Remove')} · ${tr('selling_price', 'Selling price')}`} usdValue={previousReview.before.prices.discarded.selling_price_usd} khrValue={previousReview.before.prices.discarded.selling_price_khr} />
          <SummaryPair label={`${tr('keep', 'Keep')} · ${tr('wholesale_price', 'Wholesale price')}`} usdValue={previousReview.before.prices.keeper.wholesale_price_usd} khrValue={previousReview.before.prices.keeper.wholesale_price_khr} />
          <SummaryPair label={`${tr('remove', 'Remove')} · ${tr('wholesale_price', 'Wholesale price')}`} usdValue={previousReview.before.prices.discarded.wholesale_price_usd} khrValue={previousReview.before.prices.discarded.wholesale_price_khr} />
          <div className="mt-1 space-y-0.5 text-[11px] text-amber-900 dark:text-amber-100">
            {previousReview.before.stock.map((line) => <div key={line.branch_id}>{line.branch_name || `#${line.branch_id}`}: {line.keeper_quantity} + {line.discarded_quantity} · {line.keeper_lot_count} + {line.discarded_lot_count} {tr('selected_conflict_lots', 'lots')}</div>)}
          </div>
          <ImageSummary primary={previousReview.before.images.keeper.primary} gallery={previousReview.before.images.keeper.gallery || []} label={`${tr('previous', 'Previous')} · ${tr('keep', 'Keep')}`} t={t} />
          <ImageSummary primary={previousReview.before.images.discarded.primary} gallery={previousReview.before.images.discarded.gallery || []} label={`${tr('previous', 'Previous')} · ${tr('remove', 'Remove')}`} t={t} />
          {previousAfter ? (
            <div className="mt-2 border-t border-amber-200 pt-1 dark:border-amber-900/50">
              <SummaryPair label={`${tr('previous', 'Previous')} · ${tr('after', 'After')} · ${tr('cost_price', 'Cost')}`} usdValue={previousAfter.costs.cost_price_usd} khrValue={previousAfter.costs.cost_price_khr} />
              <SummaryPair label={`${tr('previous', 'Previous')} · ${tr('after', 'After')} · ${tr('selling_price', 'Selling price')}`} usdValue={previousAfter.prices.selling_price_usd} khrValue={previousAfter.prices.selling_price_khr} />
              <SummaryPair label={`${tr('previous', 'Previous')} · ${tr('after', 'After')} · ${tr('wholesale_price', 'Wholesale price')}`} usdValue={previousAfter.prices.wholesale_price_usd} khrValue={previousAfter.prices.wholesale_price_khr} />
              <div className="mt-1 space-y-0.5 text-[11px] text-amber-900 dark:text-amber-100">
                {previousAfter.stock.map((line) => <div key={line.branch_id}>{line.branch_name || `#${line.branch_id}`}: {line.quantity} · {line.lot_count} {tr('selected_conflict_lots', 'lots')}</div>)}
              </div>
              <ImageSummary primary={previousAfter.images.primary} gallery={previousAfter.images.gallery || []} label={`${tr('previous', 'Previous')} · ${tr('after', 'After')}`} t={t} />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-gray-50 p-2.5 dark:bg-zinc-900/60">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{tr('before', 'Before')}</h4>
          <SummaryPair label={`${tr('keep', 'Keep')} · ${tr('cost_price', 'Cost')}`} usdValue={item.before.costs.keeper.cost_price_usd} khrValue={item.before.costs.keeper.cost_price_khr} />
          <SummaryPair label={`${tr('remove', 'Remove')} · ${tr('cost_price', 'Cost')}`} usdValue={item.before.costs.discarded.cost_price_usd} khrValue={item.before.costs.discarded.cost_price_khr} />
          <SummaryPair label={`${tr('keep', 'Keep')} · ${tr('selling_price', 'Selling price')}`} usdValue={item.before.prices.keeper.selling_price_usd} khrValue={item.before.prices.keeper.selling_price_khr} />
          <SummaryPair label={`${tr('remove', 'Remove')} · ${tr('selling_price', 'Selling price')}`} usdValue={item.before.prices.discarded.selling_price_usd} khrValue={item.before.prices.discarded.selling_price_khr} />
          <SummaryPair label={`${tr('keep', 'Keep')} · ${tr('wholesale_price', 'Wholesale price')}`} usdValue={item.before.prices.keeper.wholesale_price_usd} khrValue={item.before.prices.keeper.wholesale_price_khr} />
          <SummaryPair label={`${tr('remove', 'Remove')} · ${tr('wholesale_price', 'Wholesale price')}`} usdValue={item.before.prices.discarded.wholesale_price_usd} khrValue={item.before.prices.discarded.wholesale_price_khr} />
          <div className="mt-2 space-y-1 text-[11px] text-gray-600 dark:text-gray-300">
            {item.before.stock.map((line) => (
              <div key={line.branch_id} className="flex justify-between gap-2">
                <span>{line.branch_name || `#${line.branch_id}`}</span>
                <span>{line.keeper_quantity} + {line.discarded_quantity} · {line.keeper_lot_count} + {line.discarded_lot_count} {tr('selected_conflict_lots', 'lots')}</span>
              </div>
            ))}
          </div>
          <ImageSummary primary={item.before.images.keeper.primary} gallery={item.before.images.keeper.gallery || []} label={tr('keep', 'Keep')} t={t} />
          <ImageSummary primary={item.before.images.discarded.primary} gallery={item.before.images.discarded.gallery || []} label={tr('remove', 'Remove')} t={t} />
        </div>
        <div className="rounded-lg bg-blue-50 p-2.5 dark:bg-blue-950/20">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{tr('after', 'After')}</h4>
          {after ? (
            <>
              <SummaryPair label={tr('cost_price', 'Cost')} usdValue={after.costs.cost_price_usd} khrValue={after.costs.cost_price_khr} />
              <SummaryPair label={tr('selling_price', 'Selling price')} usdValue={after.prices.selling_price_usd} khrValue={after.prices.selling_price_khr} />
              <SummaryPair label={tr('wholesale_price', 'Wholesale price')} usdValue={after.prices.wholesale_price_usd} khrValue={after.prices.wholesale_price_khr} />
              <div className="mt-2 space-y-1 text-[11px] text-gray-600 dark:text-gray-300">
                {after.stock.map((line) => (
                  <div key={line.branch_id} className="flex justify-between gap-2">
                    <span>{line.branch_name || `#${line.branch_id}`}</span>
                    <span>{line.quantity} · {line.lot_count} {tr('selected_conflict_lots', 'lots')}</span>
                  </div>
                ))}
              </div>
              <ImageSummary primary={after.images.primary} gallery={after.images.gallery || []} label={tr('after', 'After')} t={t} />
            </>
          ) : <p className="text-xs text-blue-800 dark:text-blue-200">{tr('selected_conflict_choose_stock_to_preview', 'Choose what happens to the discarded stock to see the projected result.')}</p>}
        </div>
      </div>

      {!item.blocked && item.needs_stock_choice ? (
        <fieldset className="mt-3">
          <legend className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-200">{tr('selected_conflict_stock_decision', 'Discarded stock')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['merge', 'write_off'] as const).map((value) => (
              <label key={value} className={`cursor-pointer rounded-lg border px-3 py-2 text-xs ${choice === value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-zinc-700'}`}>
                <input type="radio" className="mr-2" name={`stock-${item.case_key}`} value={value} checked={choice === value} disabled={choiceDisabled} onChange={() => onChoice(value)} />
                {value === 'merge'
                  ? tr('selected_conflict_move_stock', 'Move stock and lots to the kept product')
                  : tr('selected_conflict_write_off_stock', 'Write off the discarded stock')}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </section>
  )
}

export default function SelectedConflictMergeReviewModal({ preview, localSkipped, choices, working, result, committedCases, changedCases, choicesFrozen, unknownOutcome, needsRefresh, canResume, canRepreview, onChoice, onConfirm, onResume, onRefresh, onClose, t }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const actionable = preview.cases.filter((item) => !item.blocked)
  const canConfirm = selectedConflictChoicesComplete(preview.cases, choices) && !working && !result && !unknownOutcome && !needsRefresh
  const skipped = [
    ...localSkipped.map((item) => ({ caseKey: item.caseKey, code: item.code, message: tr(codeKey(item.code), item.code) })),
    ...preview.skipped.map((item) => ({ caseKey: item.case_key, code: item.code, message: tr(codeKey(item.code), item.message || item.code) })),
  ]

  return (
    <>
      <Modal title={tr('selected_conflict_review_title', 'Review selected product merges')} onClose={onClose} size="xl" draggable unsavedChanges={{ dirty: working || Object.keys(choices).length > 0 }}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {tr('selected_conflict_review_intro', 'Check each kept and discarded product, then choose what happens to stock before confirming the batch.')}
          </p>

          {unknownOutcome ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{tr('selected_conflict_unknown_outcome', 'The connection ended after the merge started. Product data was refreshed; resume the same request to reconcile its saved receipt.')}</span>
              {canResume ? <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={working} onClick={onResume}>{tr('selected_conflict_resume_request', 'Resume same request')}</button> : null}
            </div>
          ) : null}

          {needsRefresh ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
              <span>{tr('selected_conflict_review_changed', 'One or more products changed. Refresh the review before confirming again.')}</span>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={working} onClick={onRefresh}>{tr('selected_conflict_refresh_review', 'Refresh review')}</button>
            </div>
          ) : null}

          {result ? (
            <div className="rounded-xl border border-gray-200 p-3 text-sm dark:border-zinc-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">{tr('selected_conflict_result_title', 'Merge result')}</h3>
              <p className="mt-1 text-gray-600 dark:text-gray-300">
                {committedCases.length} {tr('selected_conflict_committed', 'committed')} · {result.refusals.length} {tr('selected_conflict_refused', 'refused')} · {result.remainingCaseCount == null ? tr('unknown', 'Unknown') : result.remainingCaseCount} {tr('selected_conflict_remaining', 'remaining')}
              </p>
              <div className="mt-2 space-y-1 text-xs">
                {committedCases.map((item) => (
                  <div key={item.caseKey} className="rounded bg-emerald-50 px-2 py-1.5 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                    #{item.mergedId} → #{item.keptId} · {item.undoReady
                      ? `${tr('selected_conflict_undo_available', 'Undo available')} #${item.actionHistoryId}`
                      : item.undoAvailability === 'pending'
                        ? `${tr('selected_conflict_undo_pending', 'Undo history pending')} · ${item.operationId}`
                        : `${tr('selected_conflict_undo_unavailable', 'Undo unavailable')} · ${item.operationId}`}
                  </div>
                ))}
                {result.refusals.map((item) => <div key={item.caseKey} className="rounded bg-amber-50 px-2 py-1.5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{item.caseKey}: {tr(codeKey(item.code), item.error || item.code)}</div>)}
                {result.pendingCaseKeys.map((caseKey) => <div key={caseKey} className="rounded bg-gray-100 px-2 py-1.5 text-gray-700 dark:bg-zinc-800 dark:text-gray-200">{caseKey}: {tr('pending', 'Pending')}</div>)}
              </div>
              {result.interrupted ? <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">{tr(codeKey(result.interruptionCode || 'unknown'), result.interruptionCode || 'Unknown interruption')}</p> : null}
              {canResume ? <button type="button" className="btn-secondary mt-2 px-3 py-1.5 text-xs" disabled={working} onClick={onResume}>{tr('selected_conflict_resume_request', 'Resume same request')}</button> : null}
              {canRepreview ? <button type="button" className="btn-secondary mt-2 px-3 py-1.5 text-xs" disabled={working} onClick={onRefresh}>{tr('selected_conflict_repreview_remaining', 'Review remaining pairs again')}</button> : null}
            </div>
          ) : null}

          {!result && committedCases.length ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100">
              {committedCases.length} {tr('selected_conflict_committed', 'committed')} · {tr('selected_conflict_retained_commits', 'kept from the previous attempt')}
            </div>
          ) : null}

          {preview.cases.map((item) => <BeforeAfterCase key={item.case_key} item={item} previousReview={changedCases[item.case_key]} choice={choices[item.case_key]} choiceDisabled={choicesFrozen} onChoice={(choice) => onChoice(item.case_key, choice)} t={t} />)}

          {skipped.length || preview.cases.some((item) => item.blocked) ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">{tr('selected_conflict_skipped_title', 'Skipped or ineligible')}</h3>
              <ul className="mt-1 space-y-1 text-xs text-amber-900 dark:text-amber-100">
                {preview.cases.filter((item) => item.blocked).map((item) => <li key={item.case_key}>{item.case_key}: {tr(codeKey(item.blocked?.code || ''), item.blocked?.message || '')}</li>)}
                {skipped.map((item) => <li key={`${item.caseKey}-${item.code}`}>{item.caseKey}: {item.message}</li>)}
              </ul>
            </div>
          ) : null}

          <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-gray-800 sm:-mx-4 sm:-mb-4 sm:px-4">
            <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={onClose}>{working ? tr('selected_conflict_cancel_and_refresh', 'Cancel and refresh') : tr('close', 'Close')}</button>
            {!result && !unknownOutcome ? (
              <button type="button" className="btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm disabled:opacity-40" disabled={!canConfirm} onClick={() => setConfirmOpen(true)}>
                <Merge className="h-4 w-4" />
                {working ? tr('saving', 'Saving...') : tr('selected_conflict_confirm_button', 'Review and confirm')}
              </button>
            ) : null}
          </div>
        </div>
      </Modal>

      {confirmOpen ? (
        <ConfirmDialog
          layer="nested"
          title={tr('selected_conflict_confirm_title', 'Confirm selected product merges')}
          message={tr('selected_conflict_confirm_message', 'Only the reviewed pairs below will be merged.')}
          items={[
            { label: tr('selected_conflict_pairs', 'Pairs'), value: actionable.length },
            { label: tr('selected_conflict_stock_choices', 'Stock choices'), value: actionable.filter((item) => item.needs_stock_choice).length },
          ]}
          note={tr('selected_conflict_confirm_note', 'Each committed pair has its own audit and Undo record.')}
          confirmLabel={tr('selected_conflict_apply_button', 'Merge reviewed pairs')}
          onConfirm={() => { setConfirmOpen(false); onConfirm() }}
          onClose={() => setConfirmOpen(false)}
          t={t}
        />
      ) : null}
    </>
  )
}

type GroupReviewProps = {
  pages: SelectedConflictGroupReviewResult[]
  pageIndex: number
  choices: Readonly<Record<string, SelectedConflictGroupResolutionChoice | undefined>>
  working: boolean
  finalized: SelectedConflictGroupFinalizeResult | null
  applyResult: SelectedConflictGroupApplyResult | null
  appliedGroups: SelectedConflictGroupApplyResult['groups']
  appliedRemovals: SelectedConflictGroupApplyResult['removals']
  applyError: { code: string; message: string } | null
  unknownOutcome: boolean
  onChoice: (groupKey: string, patch: Partial<SelectedConflictGroupResolutionChoice>) => void
  onPreviousPage: () => void
  onNextPage: () => void
  onFinalize: () => Promise<boolean>
  onApply: () => void
  onResume: () => void
  onClose: () => void
  t: Translate
}

function optionalMoney(value: unknown, format: (value: unknown) => string, unknown: string): string {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return unknown
  return format(Number(value))
}

function GroupMoneyRows({ group, t }: { group: SelectedConflictGroupReviewGroup; t: Translate }) {
  const { fmtUSD, fmtKHR } = useApp()
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const merged = group.economics.merged
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between gap-2"><span>{tr('cost_price', 'Cost')}</span><span>{optionalMoney(merged.cost_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(merged.cost_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</span></div>
      <div className="flex justify-between gap-2"><span>{tr('selling_price', 'Selling price')}</span><span>{optionalMoney(merged.selling_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(merged.selling_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</span></div>
      <div className="flex justify-between gap-2"><span>{tr('wholesale_price', 'Wholesale price')}</span><span>{optionalMoney(merged.wholesale_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(merged.wholesale_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</span></div>
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        {tr('selected_conflict_group_cost_rule', 'Cost uses the mean of distinct non-zero values from the original group; prices use the original group maximum.')}
      </p>
    </div>
  )
}

function GroupSourceSelect({ label, field, ids, group, choice, disabled, onChoice, t }: {
  label: string
  field: 'category_source_id' | 'brand_source_id' | 'unit_source_id'
  ids: number[]
  group: SelectedConflictGroupReviewGroup
  choice: SelectedConflictGroupResolutionChoice | undefined
  disabled: boolean
  onChoice: (patch: Partial<SelectedConflictGroupResolutionChoice>) => void
  t: Translate
}) {
  const sourceField = field.replace('_source_id', '') as 'category' | 'brand' | 'unit'
  const selected = choice?.[field]
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{label}</span>
      <select className="input w-full text-xs" value={selected == null ? '' : String(selected)} disabled={disabled} onChange={(event) => onChoice({ [field]: event.target.value ? Number(event.target.value) : undefined })}>
        <option value="">{tr('selected_conflict_choose_source', 'Choose source product')}</option>
        {ids.map((id) => {
          const member = group.members.find((item) => item.id === id)
          const value = selectedConflictGroupSourceValue(group.members, id, sourceField)
          return <option key={id} value={id}>#{id} · {value == null || value === '' ? tr('selected_conflict_blank', 'Blank') : value} · {member?.name || tr('unknown', 'Unknown')}</option>
        })}
      </select>
    </label>
  )
}

function GroupBarcodeSelect({ group, choice, disabled, onChoice, t }: {
  group: SelectedConflictGroupReviewGroup
  choice: SelectedConflictGroupResolutionChoice | undefined
  disabled: boolean
  onChoice: (patch: Partial<SelectedConflictGroupResolutionChoice>) => void
  t: Translate
}) {
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const value = choice?.barcode?.mode === 'member'
    ? `member:${choice.barcode.source_product_id}`
    : choice?.barcode?.mode || ''
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{tr('barcode', 'Barcode')}</span>
      <select
        className="input w-full text-xs"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === 'canonical') onChoice({ barcode: { mode: 'canonical' } })
          else if (event.target.value === 'clear') onChoice({ barcode: { mode: 'clear' } })
          else if (event.target.value.startsWith('member:')) onChoice({ barcode: { mode: 'member', source_product_id: Number(event.target.value.slice(7)) } })
          else onChoice({ barcode: undefined })
        }}
      >
        <option value="">{tr('selected_conflict_choose_barcode', 'Choose barcode result')}</option>
        {group.eligibility_basis === 'barcode' ? <option value="canonical">{tr('selected_conflict_canonical_barcode', 'Use canonical shared barcode')}</option> : null}
        {group.options.barcode_source_ids.map((id) => {
          const member = group.members.find((item) => item.id === id)
          const barcode = selectedConflictGroupSourceValue(group.members, id, 'barcode')
          return <option key={id} value={`member:${id}`}>#{id} · {barcode || tr('selected_conflict_blank', 'Blank')} · {member?.name || tr('unknown', 'Unknown')}</option>
        })}
        <option value="clear">{tr('selected_conflict_clear_barcode', 'Clear barcode')}</option>
      </select>
    </label>
  )
}

function GroupReviewCard({ group, choice, choicesFrozen, onChoice, t }: {
  group: SelectedConflictGroupReviewGroup
  choice: SelectedConflictGroupResolutionChoice | undefined
  choicesFrozen: boolean
  onChoice: (patch: Partial<SelectedConflictGroupResolutionChoice>) => void
  t: Translate
}) {
  const { fmtUSD, fmtKHR } = useApp()
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const disabled = Boolean(group.blocked) || choicesFrozen
  return (
    <section className="rounded-xl border border-gray-200 p-3 dark:border-zinc-700" data-group-key={group.group_key}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{group.eligibility_value || group.group_key}</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{group.member_ids.length} {tr('selected_conflict_members', 'products')} · {group.eligibility_basis ? tr(`selected_conflict_basis_${group.eligibility_basis}`, group.eligibility_basis) : tr('unknown', 'Unknown')}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${group.blocked ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200'}`}>
          {group.blocked ? tr(`selected_conflict_${group.blocked.code}`, group.blocked.message || tr('selected_conflict_blocked', 'Blocked')) : tr('selected_conflict_action_merge', 'Merge')}
        </span>
      </div>

      {group.blocked ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{group.blocked.message}</p> : null}

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="space-y-2 rounded-lg bg-gray-50 p-2.5 dark:bg-zinc-900/60">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{tr('before', 'Before')}</h4>
          {group.members.map((member) => {
            const stockRows = group.stock.rows.filter((row) => row.product_id === member.id)
            const lotRows = group.lots.rows.filter((row) => row.product_id === member.id)
            return (
              <article key={member.id} className="rounded-lg border border-gray-200 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900">
                <div className="flex items-start gap-2">
                  {member.image_path ? <ProductImg src={member.image_path} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 dark:text-white">#{member.id} · {member.name || tr('unknown', 'Unknown')}</p>
                    <p className="break-all text-[11px] text-gray-500 dark:text-gray-400">{tr('barcode', 'Barcode')}: {member.barcode == null || member.barcode === '' ? tr('selected_conflict_blank', 'Blank') : member.barcode}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{member.category || tr('selected_conflict_blank', 'Blank')} · {member.brand || tr('selected_conflict_blank', 'Blank')} · {member.unit || tr('selected_conflict_blank', 'Blank')}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr('cost_price', 'Cost')}: {optionalMoney(member.cost_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(member.cost_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr('selling_price', 'Selling price')}: {optionalMoney(member.selling_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(member.selling_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr('wholesale_price', 'Wholesale price')}: {optionalMoney(member.wholesale_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(member.wholesale_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</p>
                  </div>
                </div>
                <div className="mt-2 space-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                  {stockRows.length ? stockRows.map((row) => <div key={`${row.branch_id}-${row.product_id}`}>{row.branch_name || `#${row.branch_id}`}: {row.quantity}</div>) : <div>{tr('selected_conflict_no_stock_rows', 'No branch stock')}</div>}
                  {lotRows.map((lot) => (
                    <div key={`${lot.batch_id}-${lot.branch_id}`} className="rounded bg-gray-100 p-1.5 dark:bg-zinc-800">
                      {tr('batch', 'Batch')} {lot.lot_code || lot.batch_key} · {lot.branch_id == null ? tr('unknown', 'Unknown') : (stockRows.find((row) => row.branch_id === lot.branch_id)?.branch_name || `#${lot.branch_id}`)} · {lot.quantity ?? tr('unknown', 'Unknown')}
                      <br />{tr('supplier', 'Supplier')}: {lot.supplier_name || tr('unknown', 'Unknown')} · {tr('received_date', 'Received date')}: {lot.received_at || tr('unknown', 'Unknown')} · {tr('expiry_date', 'Expiry date')}: {lot.expiry_date || tr('unknown', 'Unknown')}
                      <br />{tr('selected_conflict_received_quantity', 'Received quantity')}: {lot.received_quantity ?? tr('unknown', 'Unknown')} · {tr('selected_conflict_received_cost', 'Received cost')}: {optionalMoney(lot.received_cost_usd ?? lot.unit_cost_usd, fmtUSD, tr('unknown', 'Unknown'))}
                      <br />{tr('selected_conflict_payment_status', 'Payment status')}: {lot.payment_status || tr('unknown', 'Unknown')} · {tr('due_date', 'Due date')}: {lot.credit_due_date || tr('unknown', 'Unknown')} · {lot.is_active ? tr('active', 'Active') : tr('inactive', 'Inactive')}
                    </div>
                  ))}
                </div>
              </article>
            )
          })}
        </div>

        <div className="space-y-3 rounded-lg bg-blue-50 p-2.5 dark:bg-blue-950/20">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">{tr('after', 'Resolved after')}</h4>
          <label className="block text-xs">
            <span className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{tr('selected_conflict_keeper', 'Kept product')}</span>
            <select className="input w-full text-xs" value={choice?.keeper_id == null ? '' : String(choice.keeper_id)} disabled={disabled} onChange={(event) => onChoice({ keeper_id: event.target.value ? Number(event.target.value) : undefined })}>
              <option value="">{tr('selected_conflict_choose_keeper', 'Choose kept product')}</option>
              {group.members.map((member) => <option key={member.id} value={member.id}>#{member.id} · {member.name || tr('unknown', 'Unknown')}</option>)}
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <GroupBarcodeSelect group={group} choice={choice} disabled={disabled} onChoice={onChoice} t={t} />
            <GroupSourceSelect label={tr('category', 'Category')} field="category_source_id" ids={group.options.category_source_ids} group={group} choice={choice} disabled={disabled} onChoice={onChoice} t={t} />
            <GroupSourceSelect label={tr('brand', 'Brand')} field="brand_source_id" ids={group.options.brand_source_ids} group={group} choice={choice} disabled={disabled} onChoice={onChoice} t={t} />
            <GroupSourceSelect label={tr('unit', 'Unit')} field="unit_source_id" ids={group.options.unit_source_ids} group={group} choice={choice} disabled={disabled} onChoice={onChoice} t={t} />
          </div>
          <p className="text-[11px] text-blue-800 dark:text-blue-200">{tr('selected_conflict_source_only_note', 'Choose an existing product as the source for each field. Manual barcode editing is not part of this review.')}</p>
          <GroupMoneyRows group={group} t={t} />
          <div className="space-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
            {group.stock.projected_by_branch.map((row) => <div key={row.branch_id}>{row.branch_name || `#${row.branch_id}`}: {row.quantity}</div>)}
            <div>{group.lots.count} {tr('selected_conflict_lots', 'lots')} · {tr('selected_conflict_projected_quantity', 'projected quantity')} {group.lots.projected_quantity}</div>
          </div>
        </div>
      </div>
    </section>
  )
}

function RemovalReviewCard({ removal, t }: {
  removal: SelectedConflictGroupReviewResult['page']['removals'][number]
  t: Translate
}) {
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const product = removal.product || {}
  const productName = String(product.name || `#${removal.product_id}`)
  const barcode = String(product.barcode || '')
  return (
    <section className="rounded-xl border border-rose-200 p-3 dark:border-rose-900/60" data-removal-product-id={removal.product_id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">#{removal.product_id} · {productName}</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr('barcode', 'Barcode')}: {barcode || tr('selected_conflict_blank', 'Blank')}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${removal.blocker ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-200'}`}>
          {removal.blocker ? tr('selected_conflict_blocked', 'Blocked') : tr('selected_conflict_remove_independently', 'Remove independently')}
        </span>
      </div>
      <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-700 dark:bg-zinc-900 dark:text-gray-200"><strong>{tr('reason', 'Reason')}:</strong> {removal.reason}</p>
      {removal.blocker ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{removal.blocker.message}</p> : null}
      <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
        <div className="rounded-lg bg-gray-50 p-2 dark:bg-zinc-900">
          <p className="font-semibold">{tr('stock', 'Stock')}</p>
          {removal.branch_stock.length ? removal.branch_stock.map((row, index) => (
            <p key={index}>{String(row.branch_name || `#${row.branch_id || '?'}`)}: {String(row.quantity ?? 0)}</p>
          )) : <p>{tr('selected_conflict_no_stock_rows', 'No branch stock')}</p>}
        </div>
        <div className="rounded-lg bg-gray-50 p-2 dark:bg-zinc-900">
          <p className="font-semibold">{tr('selected_conflict_lots', 'Lots')}</p>
          {removal.batches.length ? removal.batches.map((batch, index) => (
            <p key={index}>{String(batch.lot_code || batch.batch_key || `#${batch.id || '?'}`)} · {String(batch.supplier_name || tr('unknown', 'Unknown'))} · {String(batch.received_at || tr('unknown', 'Unknown'))} · {String(batch.expiry_date || tr('unknown', 'Unknown'))}</p>
          )) : <p>{tr('selected_conflict_no_lots', 'No lots')}</p>}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">{tr('selected_conflict_remove_effect', 'This clears current stock and deactivates the product while preserving transaction and history records. Undo restores the same product identity.')}</p>
    </section>
  )
}

export function SelectedConflictGroupReviewModal({
  pages, pageIndex, choices, working, finalized, applyResult, appliedGroups, appliedRemovals,
  applyError, unknownOutcome, onChoice, onPreviousPage, onNextPage, onFinalize, onApply, onResume, onClose, t,
}: GroupReviewProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const review = pages[pageIndex]
  if (!review) return null
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const progress = selectedConflictGroupLoadedProgress(
    pages.map((item) => item.page),
    review.counts.actionable_groups + review.counts.blocked_groups + review.counts.requested_removals,
  )
  const allGroups = pages.flatMap((item) => item.page.groups)
  const allChoicesComplete = selectedConflictGroupChoicesComplete(allGroups, choices)
  const canGoNext = pageIndex < pages.length - 1 || review.page.next_cursor != null
  const canFinalize = progress.complete && allChoicesComplete && !working && !finalized
  const canResume = Boolean(finalized) && !working && applyError?.code !== 'review_reversed'
    && (unknownOutcome || (!applyError && Boolean(applyResult?.continuation_required)))
  const processed = applyResult
    ? applyResult.counts.committed_folds + applyResult.counts.completed_removals + applyResult.counts.approval_pending_removals
    : 0
  const totalWork = finalized ? finalized.counts.merge_folds + Number(finalized.counts.ready_removals || 0) : 0
  const prepareConfirmation = async () => {
    const ready = finalized ? true : await onFinalize()
    if (ready) setConfirmOpen(true)
  }
  return (
    <>
      <Modal
        title={tr('selected_conflict_group_review_title', 'Review selected product actions')}
        onClose={onClose}
        size="xl"
        draggable
        unsavedChanges={{
          dirty: finalized
            ? (!applyResult || applyResult.continuation_required || applyResult.status === 'interrupted' || unknownOutcome || Boolean(applyError))
            : Object.keys(choices).length > 0,
        }}
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
            <p>{tr('selected_conflict_group_review_intro', 'This is one server-saved review for every selected merge and independent removal. Inspect every page before applying.')}</p>
            <p className="mt-1 text-xs font-medium">{tr('selected_conflict_one_confirmation_notice', 'After every page and choice is complete, one confirmation applies the frozen review through bounded resumable steps.')}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <div className="rounded bg-gray-100 p-2 dark:bg-zinc-800">{tr('selected_conflict_requested_actions', 'Actions')}<strong className="block text-base">{review.counts.requested_actions}</strong></div>
            <div className="rounded bg-gray-100 p-2 dark:bg-zinc-800">{tr('selected_conflict_requested_groups', 'Merge groups')}<strong className="block text-base">{review.counts.requested_groups}</strong></div>
            <div className="rounded bg-rose-50 p-2 dark:bg-rose-950/30">{tr('selected_conflict_requested_removals', 'Removals')}<strong className="block text-base">{review.counts.requested_removals}</strong></div>
            <div className="rounded bg-amber-50 p-2 dark:bg-amber-950/30">{tr('selected_conflict_blocked_groups', 'Blocked groups')}<strong className="block text-base">{review.counts.blocked_groups}</strong></div>
            <div className="rounded bg-gray-100 p-2 dark:bg-zinc-800">{tr('selected_conflict_members', 'Products')}<strong className="block text-base">{review.counts.total_members}</strong></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{tr('selected_conflict_review_id', 'Review')} {review.review_id} · {tr('selected_conflict_loaded_progress', 'loaded')} {progress.loaded}/{progress.total ?? tr('unknown', 'Unknown')}</span>
            <span>{tr('selected_conflict_page', 'Page')} {pageIndex + 1}/{pages.length}{progress.complete ? ` · ${tr('selected_conflict_review_complete', 'Complete')}` : ''}</span>
          </div>

          {finalized ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
              <strong>{tr('selected_conflict_review_frozen', 'Review frozen')}</strong> · {finalized.counts.ready_groups} {tr('selected_conflict_merge_groups', 'merge groups')} · {Number(finalized.counts.ready_removals || 0)} {tr('selected_conflict_requested_removals', 'removals')} · {totalWork} {tr('selected_conflict_work_steps', 'protected steps')}
            </div>
          ) : null}
          {applyResult ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-100">
              <strong>{tr(`selected_conflict_status_${applyResult.status}`, applyResult.status)}</strong> · {processed}/{totalWork} {tr('selected_conflict_processed', 'processed')}
              {applyResult.approval_required ? <p className="mt-1 font-medium">{tr('selected_conflict_group_approval_pending', 'Removal requests are pending approval; they are not reported as completed.')}</p> : null}
            </div>
          ) : null}
          {applyError ? (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              <strong>{applyError.code === 'review_reversed' ? tr('selected_conflict_review_reversed', 'Review reversed') : tr('selected_conflict_apply_interrupted', 'Apply stopped')}</strong>
              <p>{applyError.message}</p>
              {applyError.code === 'review_reversed' ? <p className="mt-1">{tr('selected_conflict_review_reversed_help', 'Redo the visible group action from History or close this review and start a new one.')}</p> : null}
              {unknownOutcome ? <p className="mt-1">{tr('selected_conflict_unknown_outcome', 'The last request may have committed. Resume uses the same review receipt and request ID.')}</p> : null}
            </div>
          ) : null}

          {review.page.groups.map((group) => <GroupReviewCard key={`${review.review_id}-${group.ordinal}`} group={group} choice={choices[group.group_key]} choicesFrozen={Boolean(finalized)} onChoice={(patch) => onChoice(group.group_key, patch)} t={t} />)}
          {review.page.removals.map((removal) => <RemovalReviewCard key={`${review.review_id}-remove-${removal.action_ordinal}`} removal={removal} t={t} />)}
          {!review.page.groups.length && !review.page.removals.length ? <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-zinc-900 dark:text-gray-400">{tr('selected_conflict_empty_page', 'No actions are on this page.')}</p> : null}

          {appliedGroups.length || appliedRemovals.length ? (
            <div className="rounded-xl border border-gray-200 p-3 text-xs dark:border-zinc-700">
              <h3 className="font-semibold">{tr('selected_conflict_current_receipts', 'Receipts from this apply')}</h3>
              {appliedGroups.map((row) => <p key={row.group_key}>{tr('selected_conflict_action_merge', 'Merge')} · {row.group_key} · {row.status} · {row.processed_folds} {tr('selected_conflict_folds', 'folds')}</p>)}
              {appliedRemovals.map((row) => <p key={row.action_ordinal}>{tr('selected_conflict_remove_independently', 'Remove')} · #{row.product_id} · {row.status === 'approval_pending' ? tr('selected_conflict_pending_approval', 'Pending approval') : tr('selected_conflict_undo_ready', 'Undo ready')}</p>)}
            </div>
          ) : null}

          <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-gray-800 sm:-mx-4 sm:-mb-4 sm:px-4">
            <div className="flex gap-2">
              <button type="button" className="btn-secondary px-3 py-2 text-sm" disabled={working || pageIndex === 0} onClick={onPreviousPage}>{tr('previous', 'Previous')}</button>
              <button type="button" className="btn-secondary px-3 py-2 text-sm" disabled={working || !canGoNext} onClick={onNextPage}>{working ? tr('loading', 'Loading...') : tr('next', 'Next')}</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <ModalCloseContext.Consumer>
                {(requestClose) => <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={requestClose || onClose}>{tr('close', 'Close')}</button>}
              </ModalCloseContext.Consumer>
              {canResume ? <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={onResume}>{tr('selected_conflict_resume_same_review', 'Resume same review')}</button> : null}
              {!applyResult || applyResult.continuation_required ? (
                <button type="button" className="btn-primary px-3 py-2 text-sm disabled:opacity-40" disabled={working || (!finalized && !canFinalize)} onClick={() => { void prepareConfirmation() }}>
                  {working ? tr('saving', 'Saving...') : finalized ? tr('selected_conflict_apply_button', 'Apply reviewed actions') : tr('selected_conflict_continue_confirmation', 'Continue to confirmation')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </Modal>

      {confirmOpen ? (
        <ConfirmDialog
          layer="nested"
          title={tr('selected_conflict_confirm_title', 'Confirm reviewed product actions')}
          message={tr('selected_conflict_confirm_message', 'This applies the complete frozen review. It may continue in bounded steps without asking again.')}
          items={[
            { label: tr('selected_conflict_merge_groups', 'Merge groups'), value: finalized?.counts.ready_groups ?? 0 },
            { label: tr('selected_conflict_requested_removals', 'Removals'), value: finalized?.counts.ready_removals ?? 0 },
            { label: tr('selected_conflict_folds', 'Merge folds'), value: finalized?.counts.merge_folds ?? 0 },
          ]}
          note={tr('selected_conflict_confirm_note', 'Every committed merge or removal has a stable receipt and an Undo path; approval-pending removals remain unchanged.')}
          confirmLabel={tr('selected_conflict_apply_button', 'Apply reviewed actions')}
          onConfirm={() => { setConfirmOpen(false); onApply() }}
          onClose={() => setConfirmOpen(false)}
          t={t}
        />
      ) : null}
    </>
  )
}
