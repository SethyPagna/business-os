import type { MergeCostQuotation, MergeCostReview } from '../../api/productWriteTransport.ts'
import { useEffect, useState } from 'react'
import ConfirmDialog from '../shared/ConfirmDialog'
import InfoHint from '../shared/InfoHint'
import { formatMergeCost } from '../../utils/mergeCostPreview.ts'
import { useApp } from '../../AppContext'
import { canViewAcquisitionCosts } from '../../utils/acquisitionCostAccess.ts'
import type { PermissionUser } from '../../utils/permissions.ts'

// "What happens when I save one and the other row also has stock?"
//
// Keeping one of a name-twin pair used to fold the other row's stock onto the
// keeper silently -- including rows the reviewer had explicitly marked Remove.
// Merging the stock in and writing it off are BOTH defensible and they give
// OPPOSITE inventory answers, so this dialog makes the operator say which, with
// the actual numbers in front of them:
//
//   MERGE     -- every lot moves onto the kept product keeping its lot code,
//                batch number, branch, cost and dates. A lot the kept product
//                already has under the same batch key at the same branch has
//                the quantities added into that one row (said so explicitly
//                below, because "merge" alone does not tell you that).
//   REMOVE    -- the stock is written off with a stock movement (reason, user,
//                time) so the ledger still adds up, and nothing lands on the
//                kept product's shelf.
//
// There is no third, silent path: the server refuses a stocked row that arrives
// with no answer (400 stock_choice_required), so this dialog is the ONLY way a
// stocked twin gets resolved, on every surface that resolves twins.
//
// It also surfaces the OTHER thing a merge changes quietly: the fold adopts the
// higher of the two rows' selling/special prices, so a resolved pair can raise
// what the shop rings up. Any price that would move is shown before -> after.

export type MergeStockBranch = {
  branchId: number
  branchName: string | null
  quantity: number
  lotCount: number
}

export type MergeStockImpact = {
  productId: number
  totalQuantity: number
  lotCount: number
  branches: MergeStockBranch[]
}

export type MergePricingChange = {
  before: Record<string, number>
  after: Record<string, number>
  changes: Array<{ field: string; from: number; to: number }>
}

export type MergeIdentityDiff = {
  same: boolean
  differs: Array<{ field: string; keeper: string; discarded: string }>
  costVerdict?: 'same' | 'missing' | 'differs'
  costFill?: Array<{ field: string; value: number }>
  /** The kept row's cost as it stands, per currency field. */
  costBefore?: Record<string, number | null>
  costAfter?: Record<string, number | null>
  costOutliers?: Array<{ field: string; min: number; max: number }>
}

export type MergeStockChoice = 'merge' | 'write_off'

type TranslateFn = (key: string) => string | undefined

// The discounted tier is the WHOLESALE price. It was labelled special_price_*
// here until 2026-09-06 -- columns migration 0111 zeroed on every row -- so
// these two entries could never match a change the server sent, while the one
// price a merge does move had no label at all and fell back to the raw column
// name.
const PRICE_FIELD_LABEL: Record<string, [string, string]> = {
  selling_price_usd: ['selling_price', 'Selling price'],
  selling_price_khr: ['selling_price_khr', 'Selling price (KHR)'],
  wholesale_price_usd: ['wholesale_price', 'Wholesale price'],
  wholesale_price_khr: ['wholesale_price_khr', 'Wholesale price (KHR)'],
}

const IDENTITY_FIELD_LABEL: Record<string, [string, string]> = {
  name: ['name', 'Name'],
  barcode: ['barcode', 'Barcode'],
  cost_price_usd: ['cost', 'Cost'],
  cost_price_khr: ['cost_price_khr', 'Cost (KHR)'],
}

function formatPrice(field: string, value: number): string {
  const amount = Number(value) || 0
  if (field.startsWith('cost_price_')) {
    const cost = amount.toLocaleString('en-US', { maximumFractionDigits: 4 })
    return field.endsWith('_khr') ? `${cost}៛` : `$${cost}`
  }
  return field.endsWith('_khr')
    ? `${Math.round(amount).toLocaleString('en-US')}៛`
    : `$${amount % 1 === 0 ? amount : amount.toFixed(2)}`
}

export default function MergeStockChoiceDialog({
  t, keeperName, discardedName, impact, pricing, identity, needsChoice, working, onConfirm, onClose, loadCost,
}: {
  t: TranslateFn
  keeperName: string
  discardedName: string
  impact: MergeStockImpact
  /** Omitted when the caller could not read a preview; the section is then hidden. */
  pricing?: MergePricingChange | null
  /** Omitted when unknown; the section is then hidden rather than guessed at. */
  identity?: MergeIdentityDiff | null
  /**
   * False when the discarded row holds NO stock: there is nothing to decide, so
   * the two options are not shown and this is an ordinary confirm (opened only
   * because the merge would still move a price).
   */
  needsChoice: boolean
  working: boolean
  onConfirm: (choice: MergeStockChoice, costReview?: MergeCostReview) => void
  onClose: () => void
  loadCost?: (choice: MergeStockChoice, signal: AbortSignal) => Promise<MergeCostQuotation>
}) {
  // Starts unanswered on purpose. Pre-selecting either option would make the
  // dangerous case (a distracted Enter) pick a disposition nobody chose, which
  // is the exact failure this dialog exists to remove.
  const [choice, setChoice] = useState<MergeStockChoice | null>(null)
  const user = (useApp() as { user: PermissionUser }).user
  const canViewCosts = canViewAcquisitionCosts(user)
  const T = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  const [costState, setCostState] = useState<{ value: MergeCostQuotation; choice: MergeStockChoice; user: PermissionUser; loadCost: typeof loadCost } | null>(null)
  const [pageActive, setPageActive] = useState(typeof document === 'undefined' || !document.hidden)
  const quotation = pageActive && costState?.choice === (choice ?? 'merge') && costState.user === user && costState.loadCost === loadCost ? costState.value : null
  const authority=quotation?.costAuthority ?? null
  useEffect(() => {
    const update = () => setPageActive(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  const [costLoading, setCostLoading] = useState(false)
  useEffect(() => {
    setCostState(null)
    if (!pageActive || !canViewCosts || (needsChoice && !choice) || !loadCost) { setCostLoading(false); return }
    const controller = new AbortController()
    setCostLoading(true)
    loadCost(choice ?? 'merge', controller.signal).then(value => { if (!controller.signal.aborted) setCostState({value, choice: choice ?? 'merge', user, loadCost}) }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setCostLoading(false) })
    return () => controller.abort()
  }, [choice, needsChoice, loadCost, canViewCosts, user, pageActive])
  const pcs = T('pcs', 'pcs')
  const lotWord = T('batches', 'received dates')
  const priceChanges = (pricing?.changes ?? []).filter(change => canViewCosts || !/cost|purchase/i.test(change.field))
  const identityDiffers = Boolean(identity && !identity.same && identity.differs.length)
  const options: Array<{ value: MergeStockChoice; label: string; hint: string; tone: string }> = [
    {
      value: 'merge',
      label: T('merge_stock_choice_merge', 'Merge the stock'),
      hint: [
        T(
          'merge_stock_choice_merge_hint',
          'Every received-date record moves onto the kept product with its received-date code, branch, cost and dates unchanged. If the kept product already has the same received date at the same branch, the quantities are added together and one row is kept.',
        ),
        // Spelled out on the option itself, not only in the banner above: the
        // operator picking "merge the stock" is the one who needs to know the
        // shelf it lands on belongs to a different-identity row.
        identityDiffers ? T(
          'merge_stock_choice_merge_cross_identity',
          'These rows are NOT the same product — the stock would move onto a product with a different barcode or cost.',
        ) : '',
      ].filter(Boolean).join(' '),
      tone: 'peer-checked:border-emerald-500 peer-checked:bg-emerald-50 dark:peer-checked:bg-emerald-950/30',
    },
    {
      value: 'write_off',
      label: T('merge_stock_choice_write_off', 'Remove the stock'),
      hint: T(
        'merge_stock_choice_write_off_hint',
        'The received-date records are emptied and a stock movement is recorded for each branch — reason, who did it and when — so the ledger still adds up. Nothing is added to the kept product.',
      ),
      tone: 'peer-checked:border-rose-500 peer-checked:bg-rose-50 dark:peer-checked:bg-rose-950/30',
    },
  ]

  return (
    <ConfirmDialog
      t={(key, fallback) => t(key) || fallback}
      title={identityDiffers
        ? T('merge_identity_differs_title', 'These are not the same product')
        : needsChoice
          ? T('merge_stock_choice_title', 'This record still has stock')
          : T('merge_duplicate_confirm_title', 'Merge these records')}
      message={(
        <span>
          {T('keep', 'Keep')} <strong>{keeperName}</strong> — <strong>{discardedName}</strong>{' '}
          {needsChoice
            ? T('merge_stock_choice_lead', 'still holds stock. Choose what happens to it.')
            : T('merge_stock_choice_lead_empty', 'holds no stock and will be merged into it.')}
        </span>
      )}
      items={needsChoice ? [
        ...impact.branches.map((branch) => ({
          label: branch.branchName || `#${branch.branchId}`,
          value: `${branch.quantity} ${pcs}${branch.lotCount ? ` · ${branch.lotCount} ${lotWord}` : ''}`,
        })),
        { label: T('total', 'Total'), value: `${impact.totalQuantity} ${pcs} · ${impact.lotCount} ${lotWord}` },
      ] : undefined}
      note={T('merge_stock_choice_note', 'You can undo this merge immediately afterwards.')}
      confirmLabel={choice === 'write_off' ? T('remove', 'Remove') : T('merge', 'Merge')}
      danger={choice === 'write_off' || identityDiffers}
      working={working}
      confirmDisabled={!pageActive || (needsChoice && !choice) || (canViewCosts && !authority)}
      onConfirm={() => { if(pageActive && (!canViewCosts || quotation)) onConfirm(needsChoice ? (choice as MergeStockChoice) : 'merge', canViewCosts ? quotation?.costReview : undefined) }}
      onClose={onClose}
    >
      {identityDiffers ? (
        <div className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-2 dark:border-orange-900/50 dark:bg-orange-950/30">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-orange-800 dark:text-orange-300">
            <span>{T('merge_identity_differs_title', 'These are not the same product')}</span>
            <InfoHint
              label={T('merge_identity_differs_title', 'These are not the same product')}
              text={T(
                'merge_identity_differs_hint',
                'Name, barcode and cost together decide whether two rows are one product. These rows differ, so this is not a duplicate clean-up -- the stock and history would move onto a DIFFERENT product. Merge only if you are sure they really are one item.',
              )}
            />
          </div>
          <dl className="space-y-0.5 text-xs">
            {(identity?.differs ?? []).filter(diff => canViewCosts || !/cost|purchase/i.test(diff.field)).map((diff) => {
              const [labelKey, labelFallback] = IDENTITY_FIELD_LABEL[diff.field] || [diff.field, diff.field]
              return (
                <div key={diff.field} className="flex items-start justify-between gap-3">
                  <dt className="text-orange-700 dark:text-orange-400">{T(labelKey, labelFallback)}</dt>
                  <dd className="min-w-0 break-words text-right font-medium text-orange-900 dark:text-orange-200">
                    <span>{diff.keeper || '—'}</span>
                    {' ≠ '}
                    <span>{diff.discarded || '—'}</span>
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
      ) : null}

      {canViewCosts ? <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
        <span>{T('cost', 'Cost')}</span>
        {authority ? <><strong>{authority.cost_price_usd === null ? '—' : formatMergeCost(authority.cost_price_usd, 'usd')}</strong>{authority.cost_price_khr !== null ? <span>{formatMergeCost(authority.cost_price_khr, 'khr')}</span> : null}{authority.needsReview ? <span>{T('merge_cost_needs_review', 'Cost needs review')}</span> : null}</> : <span>{costLoading ? T('merge_cost_preview_calculating', 'Calculating cost…') : T('merge_cost_preview_unavailable', 'Cost preview unavailable')}</span>}
      </div> : null}

      <div className={needsChoice ? 'space-y-1.5' : 'hidden'}>
        {options.map((option) => (
          <label key={option.value} className="block cursor-pointer">
            <input
              type="radio"
              name="merge-stock-choice"
              className="peer sr-only"
              checked={choice === option.value}
              onChange={() => setChoice(option.value)}
              disabled={working}
            />
            <span className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-800 transition peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300 dark:border-gray-700 dark:text-gray-100 ${option.tone}`}>
              <span className="min-w-0 flex-1">{option.label}</span>
              <InfoHint label={option.label} text={option.hint} />
            </span>
          </label>
        ))}
      </div>

      {priceChanges.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/30">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <span>{T('merge_price_change_title', 'This merge also changes the price')}</span>
            <InfoHint
              label={T('merge_price_change_title', 'This merge also changes the price')}
              text={T('merge_price_change_hint', 'A merge keeps the higher of the two records\' prices, so the kept product is repriced. Undo restores the old price exactly.')}
            />
          </div>
          <dl className="space-y-0.5 text-xs">
            {priceChanges.map((change) => {
              const [labelKey, labelFallback] = PRICE_FIELD_LABEL[change.field] || [change.field, change.field]
              return (
                <div key={change.field} className="flex items-center justify-between gap-3">
                  <dt className="text-amber-700 dark:text-amber-400">{T(labelKey, labelFallback)}</dt>
                  <dd className="font-medium text-amber-900 dark:text-amber-200">
                    <span className="line-through opacity-60">{formatPrice(change.field, change.from)}</span>
                    {' → '}
                    <span>{formatPrice(change.field, change.to)}</span>
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
      ) : null}
    </ConfirmDialog>
  )
}
