import { useState } from 'react'
import Merge from 'lucide-react/dist/esm/icons/merge.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Modal from '../shared/Modal.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import { ProductImg } from './shared/primitives.tsx'
import { useApp as useAppHook } from '../../AppContext.tsx'
import type {
  SelectedConflictMergeApplyResult,
  SelectedConflictMergePreviewCase,
  SelectedConflictMergePreviewResult,
} from '../../api/productWriteTransport.ts'
import {
  selectedConflictChoicesComplete,
  type SelectedConflictLocalSkip,
  type SelectedConflictStockChoice,
} from '../../utils/selectedConflictMerge.ts'

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
