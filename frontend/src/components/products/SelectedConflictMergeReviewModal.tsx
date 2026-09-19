import { useState } from 'react'
import { supplierDisplay } from '../../utils/supplierDisplay.ts'
import Modal from '../shared/Modal.tsx'
import ConfirmDialog from '../shared/ConfirmDialog.tsx'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import PaginationControls from '../shared/PaginationControls.tsx'
import { ModalCloseContext } from '../shared/modalCloseContext.ts'
import { ProductImg } from './shared/primitives.tsx'
import { batchDisplayLabel } from '../../utils/batchLabel.ts'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { canViewAcquisitionCosts } from '../../utils/acquisitionCostAccess.ts'
import type { PermissionUser } from '../../utils/permissions.ts'
import type {
  SelectedConflictGroupReviewGroup,
  SelectedConflictGroupReviewResult,
  SelectedConflictGroupFinalizeResult,
  SelectedConflictGroupApplyResult,
} from '../../api/productWriteTransport.ts'
import {
  selectedConflictGroupLoadedProgress,
  selectedConflictGroupChoicesComplete,
  selectedConflictGroupSourceValue,
  type SelectedConflictGroupResolutionChoice,
} from '../../utils/selectedConflictActionReview.ts'

type Translate = (key: string) => string | undefined
const useApp = useAppHook as unknown as () => {
  user: PermissionUser
  fmtUSD: (value: unknown) => string
  fmtKHR: (value: unknown) => string
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
  const { fmtUSD, fmtKHR, user } = useApp()
  const canViewCosts = canViewAcquisitionCosts(user)
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const merged = group.economics.merged
  return (
    <div className="space-y-1 text-xs">
      {canViewCosts ? <div className="flex justify-between gap-2"><span>{tr('cost_price', 'Cost')}</span><span>{optionalMoney(merged.cost_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(merged.cost_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</span></div> : null}
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
  const inputId = `selected-conflict-${group.group_key}-${field}`
  const tr = (key: string, fallback: string) => {
    const translated = t(key)
    return translated && translated !== key ? translated : fallback
  }
  const options: AppSelectOption[] = [
    { value: '', label: tr('selected_conflict_choose_source', 'Choose source product') },
    ...ids.map((id) => {
      const member = group.members.find((item) => item.id === id)
      const sourceValue = selectedConflictGroupSourceValue(group.members, id, sourceField)
      return {
        value: id,
        label: `#${id} · ${sourceValue == null || sourceValue === '' ? tr('selected_conflict_blank', 'Blank') : sourceValue} · ${member?.name || tr('unknown', 'Unknown')}`,
      }
    }),
  ]
  return (
    <div className="block text-xs">
      <label htmlFor={inputId} className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{label}</label>
      <AppSelect
        id={inputId}
        className="w-full"
        buttonClassName="w-full text-xs"
        value={selected == null ? '' : String(selected)}
        options={options}
        disabled={disabled}
        onChange={(nextValue) => onChoice({ [field]: nextValue ? Number(nextValue) : undefined })}
        ariaLabel={label}
      />
    </div>
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
  const label = tr('barcode', 'Barcode')
  const inputId = `selected-conflict-${group.group_key}-barcode`
  const options: AppSelectOption[] = [
    { value: '', label: tr('selected_conflict_choose_barcode', 'Choose barcode result') },
    ...(group.eligibility_basis === 'barcode'
      ? [{ value: 'canonical', label: tr('selected_conflict_canonical_barcode', 'Use canonical shared barcode') }]
      : []),
    ...group.options.barcode_source_ids.map((id) => {
      const member = group.members.find((item) => item.id === id)
      const barcode = selectedConflictGroupSourceValue(group.members, id, 'barcode')
      return {
        value: `member:${id}`,
        label: `#${id} · ${barcode || tr('selected_conflict_blank', 'Blank')} · ${member?.name || tr('unknown', 'Unknown')}`,
      }
    }),
    { value: 'clear', label: tr('selected_conflict_clear_barcode', 'Clear barcode') },
  ]
  return (
    <div className="block text-xs">
      <label htmlFor={inputId} className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{label}</label>
      <AppSelect
        id={inputId}
        className="w-full"
        buttonClassName="w-full text-xs"
        value={value}
        options={options}
        disabled={disabled}
        onChange={(nextValue) => {
          if (nextValue === 'canonical') onChoice({ barcode: { mode: 'canonical' } })
          else if (nextValue === 'clear') onChoice({ barcode: { mode: 'clear' } })
          else if (nextValue.startsWith('member:')) onChoice({ barcode: { mode: 'member', source_product_id: Number(nextValue.slice(7)) } })
          else onChoice({ barcode: undefined })
        }}
        ariaLabel={label}
      />
    </div>
  )
}

function GroupReviewCard({ group, choice, choicesFrozen, onChoice, t }: {
  group: SelectedConflictGroupReviewGroup
  choice: SelectedConflictGroupResolutionChoice | undefined
  choicesFrozen: boolean
  onChoice: (patch: Partial<SelectedConflictGroupResolutionChoice>) => void
  t: Translate
}) {
  const { fmtUSD, fmtKHR, user } = useApp()
  const canViewCosts = canViewAcquisitionCosts(user)
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
                    {canViewCosts ? <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr('cost_price', 'Cost')}: {optionalMoney(member.cost_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(member.cost_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</p> : null}
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr('selling_price', 'Selling price')}: {optionalMoney(member.selling_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(member.selling_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr('wholesale_price', 'Wholesale price')}: {optionalMoney(member.wholesale_price_usd, fmtUSD, tr('unknown', 'Unknown'))} · {optionalMoney(member.wholesale_price_khr, fmtKHR, tr('unknown', 'Unknown'))}</p>
                  </div>
                </div>
                <div className="mt-2 space-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                  {stockRows.length ? stockRows.map((row) => <div key={`${row.branch_id}-${row.product_id}`}>{row.branch_name || `#${row.branch_id}`}: {row.quantity}</div>) : <div>{tr('selected_conflict_no_stock_rows', 'No branch stock')}</div>}
                  {lotRows.map((lot) => (
                    <div key={`${lot.batch_id}-${lot.branch_id}`} className="rounded bg-gray-100 p-1.5 dark:bg-zinc-800">
                      {tr('batch', 'Received date')} {batchDisplayLabel({ id: lot.batch_id, lot_code: lot.lot_code || lot.batch_key || null, received_at: lot.received_at || null }, tr('batch', 'Received date'))} · {lot.branch_id == null ? tr('unknown', 'Unknown') : (stockRows.find((row) => row.branch_id === lot.branch_id)?.branch_name || `#${lot.branch_id}`)} · {lot.quantity ?? tr('unknown', 'Unknown')}
                      <br />{tr('supplier', 'Supplier')}: {supplierDisplay(lot.supplier_name, tr)} · {tr('received_date', 'Received date')}: {lot.received_at || tr('unknown', 'Unknown')} · {tr('expiry_date', 'Expiry date')}: {lot.expiry_date || tr('unknown', 'Unknown')}
                      <br />{tr('selected_conflict_received_quantity', 'Received quantity')}: {lot.received_quantity ?? tr('unknown', 'Unknown')}{canViewCosts ? <> · {tr('selected_conflict_received_cost', 'Received cost')}: {optionalMoney(lot.received_cost_usd ?? lot.unit_cost_usd, fmtUSD, tr('unknown', 'Unknown'))}</> : null}
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
          <div className="block text-xs">
            <label htmlFor={`selected-conflict-${group.group_key}-keeper`} className="mb-1 block font-medium text-gray-600 dark:text-gray-300">{tr('selected_conflict_keeper', 'Kept product')}</label>
            <AppSelect
              id={`selected-conflict-${group.group_key}-keeper`}
              className="w-full"
              buttonClassName="w-full text-xs"
              value={choice?.keeper_id == null ? '' : String(choice.keeper_id)}
              options={[
                { value: '', label: tr('selected_conflict_choose_keeper', 'Choose kept product') },
                ...group.members.map((member) => ({ value: member.id, label: `#${member.id} · ${member.name || tr('unknown', 'Unknown')}` })),
              ]}
              disabled={disabled}
              onChange={(nextValue) => onChoice({ keeper_id: nextValue ? Number(nextValue) : undefined })}
              ariaLabel={tr('selected_conflict_keeper', 'Kept product')}
            />
          </div>
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
            <div>{group.lots.count} {tr('selected_conflict_lots', 'received dates')} · {tr('selected_conflict_projected_quantity', 'projected quantity')} {group.lots.projected_quantity}</div>
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
          <p className="font-semibold">{tr('selected_conflict_lots', 'Received dates')}</p>
          {removal.batches.length ? removal.batches.map((batch, index) => (
            <p key={index}>{String(batch.lot_code || batch.batch_key || `#${batch.id || '?'}`)} · {supplierDisplay(batch.supplier_name, tr)} · {String(batch.received_at || tr('unknown', 'Unknown'))} · {String(batch.expiry_date || tr('unknown', 'Unknown'))}</p>
          )) : <p>{tr('selected_conflict_no_lots', 'No received dates')}</p>}
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
  const statusLabel = (status: string) => {
    if (status === 'running') return tr('processing', 'Processing…')
    if (status === 'approval_pending') return tr('selected_conflict_pending_approval', 'Pending approval')
    if (status === 'completed') return tr('completed', 'Completed')
    if (status === 'interrupted') return tr('selected_conflict_apply_interrupted', 'Apply stopped')
    if (status === 'partial') return tr('partial', 'Partial')
    if (status === 'refused') return tr('selected_conflict_refused', 'Refused')
    if (status === 'reversed') return tr('selected_conflict_review_reversed', 'Review reversed')
    if (status === 'history_pending') return tr('selected_conflict_undo_pending', 'Undo history pending')
    if (status === 'undo_ready') return tr('selected_conflict_undo_ready', 'Undo ready')
    return status.replaceAll('_', ' ')
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
              <strong>{statusLabel(applyResult.status)}</strong> · {processed}/{totalWork} {tr('selected_conflict_processed', 'processed')}
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
              {appliedGroups.map((row) => <p key={row.group_key}>{tr('selected_conflict_action_merge', 'Merge')} · {row.group_key} · {statusLabel(row.status)} · {row.processed_folds} {tr('selected_conflict_folds', 'folds')}</p>)}
              {appliedRemovals.map((row) => <p key={row.action_ordinal}>{tr('selected_conflict_remove_independently', 'Remove')} · #{row.product_id} · {row.status === 'approval_pending' ? tr('selected_conflict_pending_approval', 'Pending approval') : tr('selected_conflict_undo_ready', 'Undo ready')}</p>)}
            </div>
          ) : null}

          <div className="sticky bottom-0 -mx-3 -mb-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-gray-800 sm:-mx-4 sm:-mb-4 sm:px-4">
            <PaginationControls
              page={pageIndex + 1}
              pageSize={review.page.limit}
              totalItems={progress.total ?? progress.loaded}
              onPageChange={(nextPage) => {
                if (working || nextPage === pageIndex + 1) return
                if (nextPage < pageIndex + 1) onPreviousPage()
                else if (canGoNext) onNextPage()
              }}
              label={tr('actions', 'Actions')}
              t={t}
              layout="centered"
              editablePageInput={false}
              className={working ? 'pointer-events-none opacity-50' : ''}
            />
            <div className="flex flex-wrap gap-2">
              <ModalCloseContext.Consumer>
                {(requestClose) => <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={requestClose || onClose}>{tr('close', 'Close')}</button>}
              </ModalCloseContext.Consumer>
              {canResume ? <button type="button" className="btn-secondary px-3 py-2 text-sm" onClick={onResume}>{tr('selected_conflict_resume_same_review', 'Resume same review')}</button> : null}
              {!applyResult || applyResult.continuation_required ? (
                <button type="button" className="btn-primary px-3 py-2 text-sm disabled:opacity-40" disabled={working || (!finalized && !canFinalize)} onClick={() => { void prepareConfirmation() }}>
                  {working ? tr('saving', 'Saving...') : finalized ? tr('selected_conflict_group_apply_button', 'Apply reviewed actions') : tr('selected_conflict_continue_confirmation', 'Continue to confirmation')}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </Modal>

      {confirmOpen ? (
        <ConfirmDialog
          layer="nested"
          title={tr('selected_conflict_group_confirm_title', 'Confirm reviewed product actions')}
          message={tr('selected_conflict_group_confirm_message', 'This applies the complete frozen review. It may continue in bounded steps without asking again.')}
          items={[
            { label: tr('selected_conflict_merge_groups', 'Merge groups'), value: finalized?.counts.ready_groups ?? 0 },
            { label: tr('selected_conflict_requested_removals', 'Removals'), value: finalized?.counts.ready_removals ?? 0 },
            { label: tr('selected_conflict_folds', 'Merge folds'), value: finalized?.counts.merge_folds ?? 0 },
          ]}
          note={tr('selected_conflict_group_confirm_note', 'Every committed merge or removal has a stable receipt and an Undo path; approval-pending removals remain unchanged.')}
          confirmLabel={tr('selected_conflict_group_apply_button', 'Apply reviewed actions')}
          onConfirm={() => { setConfirmOpen(false); onApply() }}
          onClose={() => setConfirmOpen(false)}
          t={t}
        />
      ) : null}
    </>
  )
}
