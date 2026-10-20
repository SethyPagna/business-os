import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Square from 'lucide-react/dist/esm/icons/square.js'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import ProductImage from '../pos/ProductImage.tsx'
import ProductNameRail from '../shared/ProductNameRail.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import { useCopyFloat } from '../shared/CopyFloat.tsx'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'
import { knownCost } from '../../utils/costDisplay.ts'
import { formatUsd4 } from '../../utils/reportMoney.ts'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import type { InventoryCheckId, InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct } from '../../types/inventoryChecks.ts'

type Translator = (key: string) => string | null | undefined
type FrozenAttempt = { patch: InventoryCheckPatch; revision: number }

export type InventoryCheckRowsProps = {
  products: readonly InventoryCheckProduct[]
  observations: Readonly<Record<string, InventoryCheckObservation | undefined>>
  pending?: Readonly<Record<string, boolean | undefined>>
  errors?: Readonly<Record<string, string | null | undefined>>
  /** Small badges after the barcode line, by product id (session chip, Unavailable, Renamed). */
  adornments?: Readonly<Record<string, ReactNode | undefined>>
  /** The page's frozen, not-yet-confirmed save per product: the row's Retry resends exactly that request. */
  frozen?: Readonly<Record<string, FrozenAttempt | undefined>>
  canCheck: boolean
  /** Another row (or the session) is being written: actions wait, but nothing here shows as saving. */
  locked?: boolean
  canViewStock?: boolean
  canViewCounts?: boolean
  canViewPrice: boolean
  canViewCost: boolean
  fmtUSD?: (amount: number) => string
  t: Translator
  onOpenProduct: (product: InventoryCheckProduct) => void
  onSave: (productId: InventoryCheckId, patch: InventoryCheckPatch, expectedRevision: number) => void | Promise<void>
  onEditingChange?: (productId: InventoryCheckId, editing: boolean) => void
}

type Draft = { count: string; reason: string; revision: number }
type Attempt = FrozenAttempt

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** −2, +3, 0: the size of a stock drift, with a real minus sign. */
function signed(delta: number): string {
  const rounded = Math.round(delta * 10000) / 10000
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : '0'
}

function CheckRow({ product, observation, pending, error, header, adornment, frozenAttempt, copy, canCheck, locked = false, canViewStock = true, canViewCounts = canCheck || canViewStock, canViewPrice, canViewCost, fmtUSD = formatUsd4, t, onOpenProduct, onSave, onEditingChange }: {
  product: InventoryCheckProduct
  observation?: InventoryCheckObservation
  pending: boolean
  error?: string | null
  header: boolean
  adornment?: ReactNode
  frozenAttempt?: FrozenAttempt
  copy: ReturnType<typeof useCopyFloat>
} & Pick<InventoryCheckRowsProps, 'canCheck' | 'locked' | 'canViewStock' | 'canViewCounts' | 'canViewPrice' | 'canViewCost' | 'fmtUSD' | 't' | 'onOpenProduct' | 'onSave' | 'onEditingChange'>) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [validationError, setValidationError] = useState('')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const inFlight = useRef(false)
  const active = useRef(true)
  const dirtyKey = useId()
  const revision = observation?.revision ?? 0
  const busy = pending || saving
  const actionsDisabled = busy || locked
  const editing = canCheck && (draft !== null || busy || attempt !== null)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const failure = error || saveError
  // The row's own attempt, or the page's frozen one when this row was remounted/discarded after a failed save.
  const retryable = attempt ?? frozenAttempt ?? null
  const price = knownCost(product.selling_price_usd)
  const cost = knownCost(product.cost_price_usd)
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const showStateIcon = !canCheck && (observation?.state === 'done' || observation?.state === 'issue')
  const stateLabel = observation?.state === 'done' ? tr('inventory_check_done', 'Done')
    : observation?.state === 'issue' ? tr('inventory_check_issue', 'Issue') : tr('inventory_check_unstarted', 'Not started')

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  useEffect(() => {
    onEditingChange?.(product.id, editing)
    return () => onEditingChange?.(product.id, false)
  }, [product.id, editing, onEditingChange])

  useEffect(() => {
    if (!editing) return
    return registerDirtyWork({ key: `inventory-check:${dirtyKey}`, pageId: 'inventory', label: product.name,
      isDirty: () => editingRef.current,
      discard: () => { setDraft(null); setAttempt(null); setSaveError(''); setValidationError('') },
    })
  }, [dirtyKey, editing, product.name])

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
      && (!Object.hasOwn(attempt.patch, 'counted_quantity') || observation.counted_quantity === attempt.patch.counted_quantity)
      && observation.reason === (attempt.patch.reason ?? null)) {
      setDraft(null)
      setAttempt(null)
      setSaveError('')
    }
  }, [observation, revision, attempt])

  async function save(patch: InventoryCheckPatch, expectedRevision: number) {
    if (!canCheck || header || pending || locked || inFlight.current) return
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
    void save({ state: 'issue', ...(canViewCounts ? { counted_quantity: count } : {}), reason }, draft.revision)
  }

  const doneLabel = observation?.state === 'done' ? tr('inventory_check_clear', 'Clear check') : tr('inventory_check_mark_done', 'Mark done')
  const issueLabel = observation?.state === 'issue' ? tr('inventory_check_edit_issue', 'Edit issue') : tr('inventory_check_report_issue', 'Report issue')
  const retryLabel = tr('inventory_check_retry', 'Retry')
  const countId = `inventory-check-count-${product.id}`
  const reasonId = `inventory-check-reason-${product.id}`
  const unknownStock = <span className="inline-flex items-center">—<InfoHint text={tr('inventory_check_stock_unknown_hint', 'Stock is not known for this product right now.')} label={tr('inventory_check_stock_unknown_hint', 'Stock is not known for this product right now.')} className="ml-0.5" triggerClassName="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400" /></span>
  const figure = (value: number | null | undefined) => finiteNumber(value) ? <strong className="tabular-nums">{value}</strong> : null

  // Line 3: Now 10 · Start 12 (−2 ⚠) · Damaged 1 · Sold 4 · Cust 3 · $2.50 · Cost $1.2000 · Counted 9
  const meta: Array<[string, ReactNode]> = []
  if (canViewStock) meta.push(['now', <span>{tr('inventory_check_now', 'Now')} {figure(product.quantity) ?? unknownStock}</span>])
  if (canViewStock && observation && Object.hasOwn(observation, 'baseline_quantity')) {
    const drifted = observation.stock_changed === true
    const delta = drifted && finiteNumber(observation.baseline_quantity) && finiteNumber(product.quantity) ? signed(product.quantity - observation.baseline_quantity) : null
    const driftLabel = [tr('inventory_check_stock_changed', 'Stock changed'), delta].filter(Boolean).join(' ')
    meta.push(['start', <span>{tr('inventory_check_start', 'Start')} {figure(observation.baseline_quantity) ?? unknownStock}{drifted ? <> <span role="img" aria-label={driftLabel} title={driftLabel} className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300">({delta}<AlertTriangle className="h-3 w-3" aria-hidden="true" />)</span></> : null}</span>])
  }
  if (canViewStock && finiteNumber(product.damaged_quantity) && product.damaged_quantity > 0) meta.push(['damaged', <span>{tr('inventory_check_damaged', 'Damaged')} {product.damaged_quantity}</span>])
  if (finiteNumber(product.qty_sold)) meta.push(['sold', <span>{tr('inventory_check_sold', 'Sold')} {product.qty_sold}</span>])
  if (finiteNumber(product.customer_count)) meta.push(['customers', <span title={tr('inventory_check_customers', 'Customers')}>{tr('inventory_check_customers_short', 'Cust')} {product.customer_count}</span>])
  if (canViewPrice) meta.push(['price', <span title={tr('inventory_check_price', 'Price')}><span className="sr-only">{tr('inventory_check_price', 'Price')} </span>{price === null ? '—' : fmtUSD(price)}</span>])
  if (canViewCost) meta.push(['cost', <span>{tr('inventory_check_cost', 'Cost')} {cost === null ? '—' : fmtUSD(cost)}{product.cost_needs_review === true ? <span className="ml-1 text-amber-700 dark:text-amber-300">{tr('merge_cost_needs_review', 'Cost needs review')}</span> : null}</span>])
  if (!header && canViewCounts && finiteNumber(observation?.counted_quantity)) meta.push(['counted', <span>{tr('inventory_check_counted', 'Counted')} {observation.counted_quantity}</span>])
  const barcode = product.barcode || product.sku
  const identity: Array<[string, ReactNode]> = []
  if (barcode) identity.push(['barcode', <span {...copy(barcode)} className="break-all">{barcode}</span>])
  if (product.brand) identity.push(['brand', <span {...copy(product.brand)}>{product.brand}</span>])
  if (product.category) identity.push(['category', <span>{product.category}</span>])
  const dotted = (parts: Array<[string, ReactNode]>) => parts.map(([key, node], index) => <Fragment key={key}>{index > 0 ? <span aria-hidden="true">·</span> : null}{node}</Fragment>)

  return <li data-inventory-check-row={String(product.id)} className="min-w-0 max-w-full border-b border-gray-100 py-2 last:border-0 dark:border-gray-800" aria-busy={busy}>
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <button type="button" onClick={() => onOpenProduct(product)} className="min-h-10 w-10 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={product.name} title={product.name}>
          <ProductImage src={product.image_path || undefined} alt="" className="h-10 w-10 rounded-lg object-cover" />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block min-w-0" {...copy(product.name)}><ProductNameRail name={product.name} className="text-xs font-semibold leading-5 text-gray-800 dark:text-gray-100" /></span>
          {identity.length || adornment ? <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-gray-500">{dotted(identity)}{adornment}</span> : null}
        </span>
      </div>
      {!header ? <span className="flex shrink-0 items-center gap-0.5">
        {canCheck ? <>
          <button type="button" data-check-action="done" aria-label={`${doneLabel}: ${product.name}`} title={doneLabel} aria-pressed={observation?.state === 'done'} disabled={actionsDisabled}
            className={`${toolbarIconButtonClassName} ${observation?.state === 'done' ? '!text-emerald-700 dark:!text-emerald-300' : ''} disabled:opacity-50`}
            // Done and Clear carry no count: the server only accepts a count on Done when it equals stock
            // (inventory_check_count_requires_issue otherwise), so a count left from an Issue must not travel along.
            onClick={() => { void save({ state: observation?.state === 'done' ? 'unstarted' : 'done', counted_quantity: null, reason: null }, revision) }}>
            {observation?.state === 'done' ? <Check className="h-5 w-5" aria-hidden="true" /> : <Square className="h-5 w-5" aria-hidden="true" />}
          </button>
          <button type="button" data-check-action="issue" aria-label={`${issueLabel}: ${product.name}`} title={issueLabel} aria-pressed={observation?.state === 'issue'} disabled={actionsDisabled}
            className={`${toolbarIconButtonClassName} ${observation?.state === 'issue' ? '!text-amber-700 dark:!text-amber-300' : ''} disabled:opacity-50`}
            onClick={() => { setDraft({ count: observation?.counted_quantity == null ? '' : String(observation.counted_quantity), reason: observation?.reason || '', revision }); setValidationError(''); setSaveError(''); setAttempt(null) }}>
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </button>
        </> : null}
      </span> : null}
    </div>
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300" data-inventory-check-meta>
      {dotted(meta)}
      {!header ? <span data-check-status={String(product.id)} className={showStateIcon ? `inline-flex items-center ${observation?.state === 'done' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}` : 'sr-only'}>
        <span className="sr-only">{stateLabel}</span>
        {showStateIcon ? observation?.state === 'done' ? <Check className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" /> : null}
      </span> : null}
      {busy ? <span role="status">{tr('inventory_check_saving', 'Saving…')}</span> : null}
    </div>
    {!header && observation?.state === 'issue' && observation.reason ? <p className="mt-1 break-words text-xs leading-relaxed text-amber-800 dark:text-amber-200">{observation.reason}</p> : null}
    {failure ? <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-red-700 dark:text-red-300">
      <p role="alert" className="min-w-0 break-words leading-relaxed">{failure}</p>
      {!draft && retryable && canCheck ? <button type="button" disabled={busy} aria-label={retryLabel} title={retryLabel} className={`${toolbarIconButtonClassName} disabled:opacity-50`} onClick={() => { void save(retryable.patch, retryable.revision) }}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button> : null}
    </div> : null}
    {draft && canCheck && !header ? <div className="mt-2 min-w-0 space-y-2 rounded-lg bg-gray-50 p-2 dark:bg-gray-800/50" role="group" aria-label={`${issueLabel}: ${product.name}`}>
      <div className={`grid min-w-0 gap-2 ${canViewCounts ? 'grid-cols-[minmax(0,1fr)_minmax(0,2fr)]' : 'grid-cols-1'}`}>
        {canViewCounts ? <label className="min-w-0 text-xs leading-relaxed" htmlFor={countId}>{tr('inventory_check_count_optional', 'Counted quantity (optional)')}
          <input id={countId} type="text" inputMode="decimal" autoComplete="off" value={draft.count} disabled={busy} className="mt-1 min-h-10 w-full min-w-0 rounded-lg border border-gray-300 px-2 dark:border-gray-600 dark:bg-gray-900"
            onChange={event => setDraft({ ...draft, count: event.target.value })} />
        </label> : null}
        <label className="min-w-0 text-xs leading-relaxed" htmlFor={reasonId}>{tr('inventory_check_reason', 'Issue reason')}
          <textarea id={reasonId} rows={2} value={draft.reason} disabled={busy} className="mt-1 min-h-10 w-full min-w-0 resize-y rounded-lg border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-900"
            onChange={event => setDraft({ ...draft, reason: event.target.value })} />
        </label>
      </div>
      {validationError ? <p role="alert" className="break-words text-xs leading-relaxed text-red-700 dark:text-red-300">{validationError}</p> : null}
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <button type="button" disabled={busy} aria-label={tr('inventory_check_cancel', 'Cancel')} title={tr('inventory_check_cancel', 'Cancel')} className={`${toolbarIconButtonClassName} disabled:opacity-50`} onClick={() => { setDraft(null); setValidationError(''); setSaveError(''); setAttempt(null) }}><X className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" disabled={busy} aria-label={failure ? retryLabel : tr('inventory_check_save_issue', 'Save issue')} title={failure ? retryLabel : tr('inventory_check_save_issue', 'Save issue')} className="btn-primary inline-flex min-h-10 items-center gap-1 px-3 text-xs" onClick={saveIssue}>
          {failure ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}{failure ? retryLabel : tr('save', 'Save')}
        </button>
      </div>
    </div> : null}
  </li>
}

export default function InventoryCheckRows({ products, observations, pending = {}, errors = {}, adornments = {}, frozen = {}, ...props }: InventoryCheckRowsProps) {
  const parentsWithMembers = new Set(products.flatMap(product => product.parent_id == null ? [] : [String(product.parent_id)]))
  const label = props.t('inventory_check_products')
  // One copy controller for the whole list: names, barcodes and brands open the shared copy float.
  const translate = props.t
  const copyTranslate = useCallback((key: string, fallback: string) => { const value = translate(key); return value && value !== key ? value : fallback }, [translate])
  const copy = useCopyFloat(copyTranslate)
  return <ul className="min-w-0 max-w-full" aria-label={label && label !== 'inventory_check_products' ? label : 'Inventory checks'}>
    {products.map(product => <CheckRow key={product.id} product={product}
      observation={String(observations[String(product.id)]?.product_id) === String(product.id) ? observations[String(product.id)] : undefined}
      pending={pending[String(product.id)] === true} error={errors[String(product.id)]}
      adornment={adornments[String(product.id)]} frozenAttempt={frozen[String(product.id)]} copy={copy}
      header={parentsWithMembers.has(String(product.id))} {...props} canCheck={props.canCheck && product.checkable !== false} />)}
  </ul>
}
