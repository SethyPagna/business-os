import { useEffect, useRef, useState } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import ProductImage from '../pos/ProductImage.tsx'
import ProductNameRail from '../shared/ProductNameRail.tsx'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { knownCost } from '../../utils/costDisplay.ts'
import { formatUsd4 } from '../../utils/reportMoney.ts'
import type { InventoryCheckId, InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../../types/inventoryChecks.ts'

type Translator = (key: string) => string | null | undefined

export type InventoryCheckRowsProps = {
  products: readonly InventoryCheckProduct[]
  observations: Readonly<Record<string, InventoryCheckObservation | undefined>>
  pending?: Readonly<Record<string, boolean | undefined>>
  errors?: Readonly<Record<string, string | null | undefined>>
  canCheck: boolean
  canViewStock?: boolean
  canViewPrice: boolean
  canViewCost: boolean
  fmtUSD?: (amount: number) => string
  t: Translator
  onOpenProduct: (product: InventoryCheckProduct) => void
  onSave: (productId: InventoryCheckId, patch: InventoryCheckPatch, expectedRevision: number) => void | Promise<void>
}

type Draft = { count: string; reason: string; revision: number }
type Attempt = { patch: InventoryCheckPatch; revision: number }

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function CheckRow({ product, observation, pending, error, header, canCheck, canViewStock = true, canViewPrice, canViewCost, fmtUSD = formatUsd4, t, onOpenProduct, onSave }: {
  product: InventoryCheckProduct
  observation?: InventoryCheckObservation
  pending: boolean
  error?: string | null
  header: boolean
} & Pick<InventoryCheckRowsProps, 'canCheck' | 'canViewStock' | 'canViewPrice' | 'canViewCost' | 'fmtUSD' | 't' | 'onOpenProduct' | 'onSave'>) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [validationError, setValidationError] = useState('')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const inFlight = useRef(false)
  const active = useRef(true)
  const revision = observation?.revision ?? 0
  const busy = pending || saving
  const failure = error || saveError
  const price = knownCost(product.selling_price_usd)
  const cost = knownCost(product.cost_price_usd)
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const stateLabel = observation?.state === 'done' ? tr('inventory_check_done', 'Done')
    : observation?.state === 'issue' ? tr('inventory_check_issue', 'Issue') : tr('inventory_check_unstarted', 'Not started')

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  useEffect(() => {
    if (!canCheck) {
      setDraft(null)
      setSaveError('')
      setValidationError('')
      setAttempt(null)
    }
  }, [canCheck])

  useEffect(() => {
    if (attempt && observation && revision > attempt.revision
      && observation.state === attempt.patch.state
      && observation.counted_quantity === (attempt.patch.counted_quantity ?? null)
      && observation.reason === (attempt.patch.reason ?? null)) {
      setDraft(null)
      setAttempt(null)
      setSaveError('')
    }
  }, [observation, revision, attempt])

  async function save(patch: InventoryCheckPatch, expectedRevision: number) {
    if (!canCheck || header || pending || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setSaveError('')
    setValidationError('')
    setAttempt({ patch, revision: expectedRevision })
    try {
      await onSave(product.id, patch, expectedRevision)
    } catch {
      if (active.current) setSaveError(tr('inventory_check_save_failed', 'Check not saved. Try again.'))
    } finally {
      inFlight.current = false
      if (active.current) setSaving(false)
    }
  }

  function saveIssue() {
    if (!draft) return
    const countText = draft.count.trim()
    const count = countText === '' ? null : Number(countText)
    if (count !== null && (!/^\d*(?:\.\d*)?$/.test(countText) || !Number.isFinite(count) || count < 0)) {
      setValidationError(tr('inventory_check_invalid_count', 'Enter a valid non-negative quantity.'))
      return
    }
    const reason = draft.reason.trim()
    if (!reason) {
      setValidationError(tr('inventory_check_reason_required', 'Enter an issue reason.'))
      return
    }
    void save({ state: 'issue', counted_quantity: count, reason }, draft.revision)
  }

  const doneLabel = observation?.state === 'done' ? tr('inventory_check_clear', 'Clear check') : tr('inventory_check_mark_done', 'Mark done')
  const issueLabel = observation?.state === 'issue' ? tr('inventory_check_edit_issue', 'Edit issue') : tr('inventory_check_report_issue', 'Report issue')
  const countId = `inventory-check-count-${product.id}`
  const reasonId = `inventory-check-reason-${product.id}`

  return <li data-inventory-check-row={String(product.id)} className="min-w-0 max-w-full border-b border-gray-100 py-2 last:border-0 dark:border-gray-800" aria-busy={busy}>
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <button type="button" onClick={() => onOpenProduct(product)} className="min-h-10 w-10 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={product.name}>
          <ProductImage src={product.image_path || undefined} alt="" className="h-10 w-10 rounded-lg object-cover" />
        </button>
        <span className="min-w-0 flex-1">
          <ProductNameRail name={product.name} className="text-xs font-semibold leading-5 text-gray-800 dark:text-gray-100" />
          <span className="block break-all text-[11px] text-gray-500">{[product.barcode || product.sku, product.brand, product.category].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      {!header ? <span className="flex shrink-0 items-center gap-0.5">
        {canCheck ? <>
          <button type="button" data-check-action="done" aria-label={`${doneLabel}: ${product.name}`} title={doneLabel} aria-pressed={observation?.state === 'done'} disabled={busy}
            className={`${toolbarIconButtonClassName} ${observation?.state === 'done' ? 'text-emerald-700 dark:text-emerald-300' : ''} disabled:opacity-50`}
            onClick={() => { void save({ state: observation?.state === 'done' ? 'unstarted' : 'done', counted_quantity: observation?.state === 'done' ? null : observation?.counted_quantity ?? null, reason: null }, revision) }}>
            <Check className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" data-check-action="issue" aria-label={`${issueLabel}: ${product.name}`} title={issueLabel} aria-pressed={observation?.state === 'issue'} disabled={busy}
            className={`${toolbarIconButtonClassName} ${observation?.state === 'issue' ? 'text-amber-700 dark:text-amber-300' : ''} disabled:opacity-50`}
            onClick={() => { setDraft({ count: observation?.counted_quantity == null ? '' : String(observation.counted_quantity), reason: observation?.reason || '', revision }); setValidationError(''); setSaveError(''); setAttempt(null) }}>
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </button>
        </> : null}
      </span> : null}
    </div>
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600 dark:text-gray-300">
      {canViewStock ? <span>{tr('inventory_check_stock', 'Stock')}: <strong className="tabular-nums">{finiteNumber(product.quantity) ? product.quantity : '—'}</strong></span> : null}
      {canViewStock && finiteNumber(product.damaged_quantity) && product.damaged_quantity > 0 ? <span>{tr('inventory_check_damaged', 'Damaged')}: {product.damaged_quantity}</span> : null}
      {finiteNumber(product.qty_sold) ? <span>{tr('inventory_check_sold', 'Sold')}: {product.qty_sold}</span> : null}
      {finiteNumber(product.customer_count) ? <span>{tr('inventory_check_customers', 'Customers')}: {product.customer_count}</span> : null}
      {canViewPrice ? <span>{tr('inventory_check_price', 'Price')}: {price === null ? '—' : fmtUSD(price)}</span> : null}
      {canViewCost ? <span>{tr('inventory_check_cost', 'Cost')}: {cost === null ? '—' : fmtUSD(cost)}</span> : null}
      {!header ? <span data-check-status={String(product.id)} className="font-semibold">{stateLabel}</span> : null}
      {!header && finiteNumber(observation?.counted_quantity) ? <span>{tr('inventory_check_counted', 'Counted')}: {observation.counted_quantity}</span> : null}
      {busy ? <span role="status">{tr('inventory_check_saving', 'Saving…')}</span> : null}
    </div>
    {!header && observation?.state === 'issue' && observation.reason ? <p className="mt-1 break-words text-xs text-amber-800 dark:text-amber-200">{observation.reason}</p> : null}
    {failure ? <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-red-700 dark:text-red-300">
      <p role="alert" className="min-w-0 break-words">{failure}</p>
      {!draft && attempt && canCheck ? <button type="button" disabled={busy} className="btn-secondary inline-flex min-h-10 shrink-0 items-center gap-1 px-2 text-xs" onClick={() => { void save(attempt.patch, attempt.revision) }}><RotateCcw className="h-4 w-4" aria-hidden="true" />{tr('inventory_check_retry', 'Retry')}</button> : null}
    </div> : null}
    {draft && canCheck && !header ? <div className="mt-2 min-w-0 space-y-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800/50" role="group" aria-label={`${issueLabel}: ${product.name}`}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
        <label className="min-w-0 text-xs" htmlFor={countId}>{tr('inventory_check_count_optional', 'Counted quantity (optional)')}
          <input id={countId} type="text" inputMode="decimal" autoComplete="off" value={draft.count} disabled={busy} className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-gray-300 px-2 dark:border-gray-600 dark:bg-gray-900"
            onChange={event => setDraft({ ...draft, count: event.target.value })} />
        </label>
        <label className="min-w-0 text-xs" htmlFor={reasonId}>{tr('inventory_check_reason', 'Issue reason')}
          <textarea id={reasonId} rows={2} value={draft.reason} disabled={busy} className="mt-1 min-h-10 w-full min-w-0 resize-y rounded-lg border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900"
            onChange={event => setDraft({ ...draft, reason: event.target.value })} />
        </label>
      </div>
      {validationError ? <p role="alert" className="break-words text-xs text-red-700 dark:text-red-300">{validationError}</p> : null}
      <div className="flex min-w-0 flex-wrap justify-end gap-2">
        <button type="button" disabled={busy} className="btn-secondary min-h-10 px-3 text-xs" onClick={() => { setDraft(null); setValidationError(''); setSaveError(''); setAttempt(null) }}>{tr('inventory_check_cancel', 'Cancel')}</button>
        <button type="button" disabled={busy} className="btn-primary min-h-10 px-3 text-xs" onClick={saveIssue}>{failure ? tr('inventory_check_retry', 'Retry') : tr('inventory_check_save_issue', 'Save issue')}</button>
      </div>
    </div> : null}
  </li>
}

export default function InventoryCheckRows({ products, observations, pending = {}, errors = {}, ...props }: InventoryCheckRowsProps) {
  const parentsWithMembers = new Set(products.flatMap(product => product.parent_id == null ? [] : [String(product.parent_id)]))
  const label = props.t('inventory_check_products')
  return <ul className="min-w-0 max-w-full" aria-label={label && label !== 'inventory_check_products' ? label : 'Inventory checks'}>
    {products.map(product => <CheckRow key={product.id} product={product}
      observation={String(observations[String(product.id)]?.product_id) === String(product.id) ? observations[String(product.id)] : undefined}
      pending={pending[String(product.id)] === true} error={errors[String(product.id)]}
      header={parentsWithMembers.has(String(product.id))} {...props} />)}
  </ul>
}
