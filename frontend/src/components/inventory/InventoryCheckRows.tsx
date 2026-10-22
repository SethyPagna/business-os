import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Square from 'lucide-react/dist/esm/icons/square.js'
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import ProductImage from '../pos/ProductImage.tsx'
import ProductNameRail from '../shared/ProductNameRail.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import { useCopyFloat } from '../shared/CopyFloat.tsx'
import { knownCost } from '../../utils/costDisplay.ts'
import { todayStr } from '../../utils/dateHelpers.ts'
import { fmtDateOnly } from '../../utils/formatters.ts'
import { formatUsd4 } from '../../utils/reportMoney.ts'
import { registerDirtyWork } from '../../utils/dirtyWork.ts'
import type { InventoryCheckId, InventoryCheckObservation, InventoryCheckPatch, InventoryCheckProduct, InventoryCheckTranslator } from '../../types/inventoryChecks.ts'
import InventoryCheckCountEditor, { countMatchesStock, finiteQuantity, parseCount, signedDelta, stepCount } from './InventoryCheckCountEditor.tsx'

type FrozenAttempt = { patch: InventoryCheckPatch; revision: number }
/** Which control saved: the tick, the sheet's Count input, or the count editor. */
export type InventoryCheckCommitVia = 'tick' | 'count' | 'editor'
/** Ask the list to bring one row into view; `token` makes a repeat of the same row a new request. */
export type InventoryCheckFocusRequest = { id: InventoryCheckId; token: number | string; target: 'count' | 'action' | 'none' }

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
  /** Left unset, the Sold and Cust columns follow whether any listed product carries the figure. */
  canViewSales?: boolean
  canViewCustomers?: boolean
  /** Counts, Start and the check buttons exist only inside a session; left unset, an open session or any saved check implies it. */
  inSession?: boolean
  /** Recent issue reasons offered as chips in the count editor. */
  reasonSuggestions?: readonly string[]
  /** Scroll one row to the middle, ring it for a moment and focus its Count input or its tick. Send it with the render that shows the row. */
  focusRequest?: InventoryCheckFocusRequest
  /** After a save was confirmed (the row has not re-rendered with it yet, and the page's own editing lock may still be on). Return true when the page handled what comes next; otherwise a Count-input save moves on to the next row's Count input. */
  onCommitted?: (id: InventoryCheckId, via: InventoryCheckCommitVia) => boolean
  /** `external`: the page mounts InventoryCheckSheetHeader itself (pinned), so the list draws none. */
  sheetHeader?: 'inline' | 'external'
  fmtUSD?: (amount: number) => string
  t: InventoryCheckTranslator
  onOpenProduct: (product: InventoryCheckProduct) => void
  onSave: (productId: InventoryCheckId, patch: InventoryCheckPatch, expectedRevision: number) => void | Promise<void>
  onEditingChange?: (productId: InventoryCheckId, editing: boolean) => void
}

type Draft = { count: string; reason: string; revision: number; focus: 'count' | 'reason' | null }
type Attempt = FrozenAttempt & { via?: InventoryCheckCommitVia }

const makeTr = (t: InventoryCheckTranslator) => (key: string, fallback: string) => {
  const value = t(key)
  return value && value !== key ? value : fallback
}

// ---- The count sheet (1024px and up) ---------------------------------------------------------------------------------------
// Phone: a line of facts under the name. From `lg` the same cells line up as columns: every cell has one fixed width and one
// `order`, so rows and header agree without a shared grid. Damaged, Sold and Cust only fit beside the 220px sidebar from `xl`.

export type SheetField = 'now' | 'start' | 'damaged' | 'price' | 'cost' | 'sold' | 'customers' | 'count'
export type SheetFlags = { canCheck: boolean; inSession: boolean; canViewStock: boolean; canViewCounts: boolean; canViewPrice: boolean; canViewCost: boolean; canViewSales: boolean; canViewCustomers: boolean }
export type SheetColumns = { fields: readonly SheetField[]; actions: 'buttons' | 'state' | null }

/** The columns that exist for this viewer: a column nobody may read, or that only a session fills, is not drawn at all. */
export function sheetColumns(flags: SheetFlags): SheetColumns {
  const fields: SheetField[] = []
  if (flags.canViewStock) fields.push('now')
  if (flags.canViewStock && flags.inSession) fields.push('start')
  if (flags.canViewStock) fields.push('damaged')
  if (flags.canViewPrice) fields.push('price')
  if (flags.canViewCost) fields.push('cost')
  if (flags.canViewSales) fields.push('sold')
  if (flags.canViewCustomers) fields.push('customers')
  if (flags.canViewCounts && flags.inSession) fields.push('count')
  return { fields, actions: !flags.inSession ? null : flags.canCheck ? 'buttons' : 'state' }
}

const CELL_BOX: Record<SheetField, string> = {
  now: 'lg:order-2 lg:w-[4.5rem]', start: 'lg:order-3 lg:w-[5.5rem]', damaged: 'lg:order-4 lg:w-14', price: 'lg:order-5 lg:w-20',
  cost: 'lg:order-6 lg:w-20', sold: 'lg:order-7 lg:w-12', customers: 'lg:order-8 lg:w-14', count: 'lg:order-9 lg:w-[4.5rem]',
}
const WIDE_FIELDS: ReadonlySet<SheetField> = new Set(['damaged', 'sold', 'customers'])
const PRODUCT_BOX = 'lg:order-1 lg:min-w-0 lg:flex-1'
/** Text read beside its figure on a phone; from 1024px the column header carries it and only screen readers keep it. */
const BELOW_SHEET_ONLY = 'sr-only max-lg:not-sr-only'
const ACTIONS_BOX = { buttons: 'lg:order-10 lg:w-[5.25rem]', state: 'lg:order-10 lg:w-10' } as const
/** A placeholder keeps an empty cell's width on the sheet and does not exist on a phone. */
function cellClass(field: SheetField, placeholder = false): string {
  const show = WIDE_FIELDS.has(field) ? (placeholder ? 'hidden lg:hidden xl:block' : 'lg:hidden xl:block') : placeholder ? 'hidden lg:block' : ''
  return `lg:shrink-0 lg:text-right lg:tabular-nums ${CELL_BOX[field]} ${show}`
}

function fieldLabel(field: SheetField, tr: (key: string, fallback: string) => string): string {
  switch (field) {
    case 'now': return tr('inventory_check_now', 'Now')
    case 'start': return tr('inventory_check_start', 'Start')
    case 'damaged': return tr('inventory_check_damaged', 'Damaged')
    case 'price': return tr('inventory_check_price', 'Price')
    case 'cost': return tr('inventory_check_cost', 'Cost')
    case 'sold': return tr('inventory_check_sold', 'Sold')
    case 'customers': return tr('inventory_check_customers_short', 'Cust')
    case 'count': return tr('inventory_check_count', 'Count')
  }
}

/** The column titles of the sheet, for pages that pin one header over several lists. Draws nothing below 1024px. */
export function InventoryCheckSheetHeader({ t, className = '', ...flags }: SheetFlags & { t: InventoryCheckTranslator; className?: string }) {
  const tr = makeTr(t)
  const columns = sheetColumns(flags)
  return <div aria-hidden="true" data-inventory-check-sheet-header className={`hidden min-w-0 items-end gap-x-2 border-b border-l-2 border-b-gray-200 border-l-transparent pb-1 pl-2 text-[11px] font-semibold leading-relaxed text-gray-500 lg:flex dark:border-b-gray-700 ${className}`}>
    <span className={`${PRODUCT_BOX} text-left`}>{tr('product', 'Product')}</span>
    {columns.fields.map(field => <span key={field} className={cellClass(field)}>{fieldLabel(field, tr)}</span>)}
    {columns.actions ? <span className={`shrink-0 ${ACTIONS_BOX[columns.actions]}`} /> : null}
  </div>
}

// ---- Small helpers ---------------------------------------------------------------------------------------------------------

const rowIconButton = 'inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 lg:h-10 lg:min-h-10 lg:w-10 dark:text-gray-300 dark:hover:bg-zinc-800'

/** 'YYYY-MM-DD' expiry as the month-year it is printed with, and how close it is (30 days, the app-wide alert window). */
function expiryBadge(date: string | null | undefined): { text: string; tone: 'expired' | 'soon' | 'ok'; full: string } | null {
  const match = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const days = Math.round((Date.parse(`${match[0]}T00:00:00Z`) - Date.parse(`${todayStr()}T00:00:00Z`)) / 86400000)
  return { text: `${match[2]}/${match[1]}`, tone: days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok', full: fmtDateOnly(match[0]) }
}

function CheckRow({ product, observation, pending, error, header, adornment, frozenAttempt, copy, columns, reasonSuggestions, scanHit, onAdvance, canCheck, locked = false, canViewStock = true, canViewCounts = canCheck || canViewStock, fmtUSD = formatUsd4, t, onOpenProduct, onSave, onEditingChange, onCommitted }: {
  product: InventoryCheckProduct
  observation?: InventoryCheckObservation
  pending: boolean
  error?: string | null
  header: boolean
  adornment?: ReactNode
  frozenAttempt?: FrozenAttempt
  copy: ReturnType<typeof useCopyFloat>
  columns: SheetColumns
  reasonSuggestions: readonly string[]
  scanHit: boolean
  onAdvance: (id: InventoryCheckId) => void
} & Pick<InventoryCheckRowsProps, 'canCheck' | 'locked' | 'canViewStock' | 'canViewCounts' | 'fmtUSD' | 't' | 'onOpenProduct' | 'onSave' | 'onEditingChange' | 'onCommitted'>) {
  const [draft, setDraft] = useState<Draft | null>(null)
  // The sheet's Count input: null shows the saved count, any string is a typed, unsaved one.
  const [countText, setCountText] = useState<string | null>(null)
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
  const savedCount = canViewCounts && finiteQuantity(observation?.counted_quantity) ? String(observation.counted_quantity) : ''
  const countDirty = countText !== null && countText !== savedCount
  const editing = canCheck && (draft !== null || busy || attempt !== null || countDirty)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const failure = error || saveError
  // The row's own attempt, or the page's frozen one when this row was remounted/discarded after a failed save.
  const retryable: Attempt | null = attempt ?? frozenAttempt ?? null
  const price = knownCost(product.selling_price_usd)
  const cost = knownCost(product.cost_price_usd)
  const tr = makeTr(t)
  const state = observation?.state
  const showStateIcon = !canCheck && (state === 'done' || state === 'issue')
  const stateLabel = state === 'done' ? tr('inventory_check_done', 'Done')
    : state === 'issue' ? tr('inventory_check_issue', 'Issue') : tr('inventory_check_unstarted', 'Not started')
  const showCountInput = canCheck && canViewStock && !header && columns.fields.includes('count')

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
      discard: () => { setDraft(null); setCountText(null); setAttempt(null); setSaveError(''); setValidationError('') },
    })
  }, [dirtyKey, editing, product.name])

  useEffect(() => {
    if (!canCheck) {
      setDraft(null)
      setCountText(null)
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
      setCountText(null)
      setAttempt(null)
      setSaveError('')
    }
  }, [observation, revision, attempt])

  async function save(patch: InventoryCheckPatch, expectedRevision: number, via: InventoryCheckCommitVia) {
    if (!canCheck || header || pending || locked || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setSaveError('')
    setValidationError('')
    setAttempt({ patch, revision: expectedRevision, via })
    let confirmed = false
    try {
      await onSave(product.id, patch, expectedRevision)
      confirmed = true
    } catch (cause) {
      if (active.current) {
        // A count that matched stock when typed but not on the server: the page shows why; the number moves into the editor.
        if (via === 'count' && (cause as { code?: unknown } | null)?.code === 'inventory_check_count_requires_issue') {
          openEditor(String(patch.counted_quantity ?? ''), 'reason', expectedRevision)
        } else setSaveError(tr('inventory_check_save_failed', 'Check not saved. Try again.'))
      }
    } finally {
      inFlight.current = false
      if (active.current) setSaving(false)
    }
    if (confirmed && active.current && onCommitted?.(product.id, via) !== true && via === 'count') onAdvance(product.id)
  }

  function openEditor(count: string, focus: Draft['focus'], atRevision = revision) {
    setDraft({ count, reason: observation?.reason || '', revision: atRevision, focus })
    setValidationError('')
    setSaveError('')
    setAttempt(null)
  }

  function closeEditor() {
    setDraft(null)
    setCountText(null)
    setValidationError('')
    setSaveError('')
    setAttempt(null)
  }

  function submitDraft() {
    if (!draft) return
    const entry = parseCount(draft.count)
    if (entry.kind === 'invalid') {
      setValidationError(tr('inventory_check_invalid_count', 'Enter a valid non-negative quantity.'))
      return
    }
    const reason = draft.reason.trim()
    if (!reason && countMatchesStock(entry, product.quantity, canViewStock)) {
      void save({ state: 'done', counted_quantity: entry.kind === 'valid' ? entry.value : null, reason: null }, draft.revision, 'editor')
      return
    }
    if (!reason) {
      setValidationError(tr('inventory_check_reason_required', 'Enter an issue reason.'))
      return
    }
    void save({ state: 'issue', ...(canViewCounts ? { counted_quantity: entry.kind === 'valid' ? entry.value : null } : {}), reason }, draft.revision, 'editor')
  }

  /** Enter in the sheet's Count input: empty = Done, equal to stock = Done with the count, anything else = report it as an issue. */
  function commitCount() {
    const text = countText ?? savedCount
    const entry = parseCount(text)
    if (entry.kind === 'invalid') {
      setValidationError(tr('inventory_check_invalid_count', 'Enter a valid non-negative quantity.'))
      return
    }
    setValidationError('')
    if (entry.kind === 'empty') {
      if (state !== 'done') void save({ state: 'done', counted_quantity: null, reason: null }, revision, 'count')
    } else if (countMatchesStock(entry, product.quantity, canViewStock)) {
      if (state !== 'done' || observation?.counted_quantity !== entry.value) void save({ state: 'done', counted_quantity: entry.value, reason: null }, revision, 'count')
    } else openEditor(text.trim(), 'reason')
  }

  function onCountKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || busy || locked) return
    if (event.key === 'Enter') { event.preventDefault(); commitCount() }
    else if (event.key === 'Escape') { event.preventDefault(); setCountText(null); setValidationError('') }
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      setCountText(stepCount(countText ?? savedCount, event.key === 'ArrowUp' ? 1 : -1, product.quantity))
    }
  }

  const doneLabel = state === 'done' ? tr('inventory_check_clear', 'Clear check') : tr('inventory_check_mark_done', 'Mark done')
  const issueLabel = state === 'issue' ? tr('inventory_check_edit_issue', 'Edit issue') : tr('inventory_check_report_issue', 'Report issue')
  const retryLabel = tr('inventory_check_retry', 'Retry')
  const countLabel = tr('inventory_check_count', 'Count')
  const nowText = finiteQuantity(product.quantity) ? String(product.quantity) : ''
  const unknownStock = <span className="inline-flex items-center">—<InfoHint text={tr('inventory_check_stock_unknown_hint', 'Stock is not known for this product right now.')} label={tr('inventory_check_stock_unknown_hint', 'Stock is not known for this product right now.')} className="ml-0.5" triggerClassName="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400" /></span>
  const figure = (value: number | null | undefined) => finiteQuantity(value) ? <strong className="tabular-nums">{value}</strong> : null
  // Titles show beside a value on a phone; on the sheet the header carries them.
  const named = (field: SheetField, text = fieldLabel(field, tr)) => <span className={BELOW_SHEET_ONLY}>{text}</span>

  // Counting facts first: Now · Start (Δ⚠) · Counted · Damaged · Price · Cost · Sold · Cust. A fact with no value is not drawn on a phone and keeps its width on the sheet.
  const facts: Array<[SheetField, ReactNode]> = []
  const wants = (field: SheetField) => columns.fields.includes(field)
  if (wants('now')) {
    const unit = finiteQuantity(product.quantity) ? String(product.unit ?? '').trim() : ''
    const hint = tr('inventory_check_stock_inconsistent_hint', 'Stock records for this product disagree. Check its stock before counting.')
    facts.push(['now', <span>{named('now')} {figure(product.quantity) ?? unknownStock}{unit ? <>{' '}<span className="text-gray-500 dark:text-gray-400">{unit}</span></> : null}{product.stock_consistent === false ? <InfoHint text={hint} label={hint} className="ml-0.5" triggerClassName="inline-flex h-4 w-4 items-center justify-center rounded-full text-amber-700 dark:text-amber-300" /> : null}</span>])
  }
  if (wants('start')) {
    if (observation && Object.hasOwn(observation, 'baseline_quantity')) {
      const drifted = observation.stock_changed === true
      const delta = drifted && finiteQuantity(observation.baseline_quantity) && finiteQuantity(product.quantity) ? signedDelta(product.quantity - observation.baseline_quantity) : null
      const driftLabel = [tr('inventory_check_stock_changed', 'Stock changed'), delta].filter(Boolean).join(' ')
      facts.push(['start', <span>{named('start')} {figure(observation.baseline_quantity) ?? unknownStock}{drifted ? <> <span role="img" aria-label={driftLabel} title={driftLabel} className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300">({delta}<AlertTriangle className="h-3 w-3" aria-hidden="true" />)</span></> : null}</span>])
    } else facts.push(['start', null])
  }
  if (wants('count')) {
    const counted = !header && canViewCounts && finiteQuantity(observation?.counted_quantity) ? observation.counted_quantity : null
    // With a Count input the sheet shows that instead, so the phone-only fact steps aside there.
    facts.push(['count', counted === null ? null : <span>{named('count', tr('inventory_check_counted', 'Counted'))} {counted}</span>])
  }
  if (wants('damaged')) facts.push(['damaged', finiteQuantity(product.damaged_quantity) && product.damaged_quantity > 0 ? <span>{named('damaged')} {product.damaged_quantity}</span> : null])
  if (wants('price')) facts.push(['price', <span title={tr('inventory_check_price', 'Price')}><span className="sr-only">{tr('inventory_check_price', 'Price')} </span>{price === null ? '—' : fmtUSD(price)}</span>])
  if (wants('cost')) facts.push(['cost', <span>{named('cost')} {cost === null ? '—' : fmtUSD(cost)}{product.cost_needs_review === true ? <><span className={`ml-1 text-amber-700 dark:text-amber-300 ${BELOW_SHEET_ONLY}`}>{tr('merge_cost_needs_review', 'Cost needs review')}</span><span className="ml-0.5 hidden text-amber-700 lg:inline dark:text-amber-300" title={tr('merge_cost_needs_review', 'Cost needs review')} aria-hidden="true"><AlertTriangle className="inline h-3 w-3" /></span></> : null}</span>])
  if (wants('sold')) facts.push(['sold', finiteQuantity(product.qty_sold) ? <span>{named('sold')} {product.qty_sold}</span> : null])
  if (wants('customers')) facts.push(['customers', finiteQuantity(product.customer_count) ? <span title={tr('inventory_check_customers', 'Customers')}>{named('customers')} {product.customer_count}</span> : null])
  let shown = 0

  const barcode = product.barcode || product.sku
  const expiry = expiryBadge(product.next_expiry_date)
  const identity: Array<[string, ReactNode]> = []
  if (barcode) identity.push(['barcode', <span {...copy(barcode)} className="break-all">{barcode}</span>])
  if (product.brand) identity.push(['brand', <span {...copy(product.brand)}>{product.brand}</span>])
  if (product.category) identity.push(['category', <span>{product.category}</span>])
  const dotted = (parts: Array<[string, ReactNode]>) => parts.map(([key, node], index) => <Fragment key={key}>{index > 0 ? <span aria-hidden="true">·</span> : null}{node}</Fragment>)
  const expiryName = expiry ? expiry.tone === 'expired' ? tr('inventory_check_expired', 'Expired') : expiry.tone === 'soon' ? tr('inventory_check_expires_soon', 'Expires soon') : tr('expiry', 'Expiry') : ''
  const edge = state === 'done' ? 'border-l-emerald-500' : state === 'issue' ? 'border-l-amber-500' : 'border-l-transparent'

  return <li data-inventory-check-row={String(product.id)} data-check-state={state ?? 'unstarted'} data-scan-hit={scanHit ? '' : undefined}
    className={`min-w-0 max-w-full border-b border-l-2 border-b-gray-100 py-2 pl-2 last:border-b-0 dark:border-b-gray-800 ${edge} ${busy ? 'lg:opacity-70' : ''} ${scanHit ? 'rounded-sm ring-2 ring-primary-400 dark:ring-primary-300' : ''}`} aria-busy={busy}>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 lg:flex lg:items-center" data-inventory-check-main>
      <div className={`flex min-w-0 items-start gap-2 ${PRODUCT_BOX}`}>
        <button type="button" onClick={() => onOpenProduct(product)} className="h-11 min-h-11 w-11 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:h-10 lg:min-h-10 lg:w-10" aria-label={product.name} title={product.name}>
          <ProductImage src={product.image_path || undefined} alt="" className="h-11 w-11 rounded-lg object-cover lg:h-10 lg:w-10" />
        </button>
        <span className="min-w-0 flex-1">
          <span className="block min-w-0" {...copy(product.name)}><ProductNameRail name={product.name} className="text-xs font-semibold leading-5 text-gray-800 dark:text-gray-100" /></span>
          {identity.length || adornment || expiry ? <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-gray-500">{dotted(identity)}{adornment}
            {expiry ? <span data-expiry={expiry.tone} title={`${expiryName}: ${expiry.full}`} className={`inline-flex items-center rounded-full px-1.5 font-semibold ${expiry.tone === 'expired' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : expiry.tone === 'soon' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`}>{expiryName} {expiry.text}</span> : null}
          </span> : null}
        </span>
      </div>
      <div className="col-span-2 mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-gray-600 lg:contents lg:text-xs dark:text-gray-300" data-inventory-check-meta>
        {facts.map(([field, node]) => {
          // With a Count input the sheet's count cell is that input; the saved count then reads on a phone only.
          const phoneOnly = field === 'count' && showCountInput
          if (node === null) return phoneOnly ? null : <span key={field} aria-hidden="true" data-cell={field} className={cellClass(field, true)} />
          return <Fragment key={field}>{shown++ > 0 ? <span aria-hidden="true" className="lg:hidden">·</span> : null}<span data-cell={field} className={phoneOnly ? 'lg:hidden' : cellClass(field)}>{node}</span></Fragment>
        })}
        {showCountInput ? <span data-cell="count-input" className={`hidden lg:block lg:shrink-0 ${CELL_BOX.count}`}>
          <input data-check-count id={`inventory-check-sheet-count-${product.id}`} type="text" inputMode="numeric" autoComplete="off" value={draft ? draft.count : countText ?? savedCount}
            readOnly={busy || locked || draft !== null} placeholder={nowText} aria-label={`${countLabel}: ${product.name}`}
            className="h-9 w-full min-w-0 rounded-lg border border-gray-300 px-2 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 read-only:opacity-60 dark:border-gray-600 dark:bg-gray-900"
            onChange={event => setCountText(event.target.value)} onFocus={event => event.currentTarget.select()} onKeyDown={onCountKeyDown} />
        </span> : null}
        {busy ? <span role="status" className={BELOW_SHEET_ONLY}>{tr('inventory_check_saving', 'Saving…')}</span> : null}
      </div>
      {header ? (columns.actions ? <span aria-hidden="true" className={`hidden shrink-0 lg:block ${ACTIONS_BOX[columns.actions]}`} /> : null) : <span data-check-actions className={columns.actions ? `col-start-2 row-start-1 flex shrink-0 items-center justify-end gap-1 ${ACTIONS_BOX[columns.actions]}` : 'contents'}>
        <span data-check-status={String(product.id)} className={showStateIcon ? `inline-flex h-11 w-11 items-center justify-center lg:h-10 lg:w-10 ${state === 'done' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}` : 'sr-only'}>
          <span className="sr-only">{stateLabel}</span>
          {showStateIcon ? state === 'done' ? <Check className="h-5 w-5" aria-hidden="true" /> : <AlertCircle className="h-5 w-5" aria-hidden="true" /> : null}
        </span>
        {canCheck ? <>
          <button type="button" data-check-action="done" aria-label={`${doneLabel}: ${product.name}`} title={doneLabel} aria-pressed={state === 'done'} disabled={actionsDisabled}
            className={`${rowIconButton} ${state === 'done' ? '!text-emerald-700 dark:!text-emerald-300' : ''}`}
            // Done and Clear carry no count: the server only accepts a count on Done when it equals stock
            // (inventory_check_count_requires_issue otherwise), so a count left from an Issue must not travel along.
            onClick={() => { void save({ state: state === 'done' ? 'unstarted' : 'done', counted_quantity: null, reason: null }, revision, 'tick') }}>
            {state === 'done' ? <Check className="h-5 w-5" aria-hidden="true" /> : <Square className="h-5 w-5" aria-hidden="true" />}
          </button>
          <button type="button" data-check-action="issue" aria-label={`${issueLabel}: ${product.name}`} title={issueLabel} aria-pressed={state === 'issue'} disabled={actionsDisabled}
            className={`${rowIconButton} ${state === 'issue' ? '!text-amber-700 dark:!text-amber-300' : ''}`}
            onClick={() => openEditor(savedCount || (canViewStock ? nowText : ''), typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches ? 'count' : null)}>
            <AlertCircle className="h-5 w-5" aria-hidden="true" />
          </button>
        </> : null}
      </span>}
    </div>
    {!header && state === 'issue' && observation?.reason ? <p className="mt-1 break-words text-xs lg:pl-12 leading-relaxed text-amber-800 dark:text-amber-200">{observation.reason}</p> : null}
    {failure ? <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-red-700 dark:text-red-300">
      <p role="alert" className="min-w-0 break-words leading-relaxed">{failure}</p>
      {!draft && retryable && canCheck ? <button type="button" disabled={busy} aria-label={retryLabel} title={retryLabel} className={rowIconButton} onClick={() => { void save(retryable.patch, retryable.revision, retryable.via ?? 'tick') }}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button> : null}
    </div> : null}
    {draft && canCheck && !header ? <InventoryCheckCountEditor productName={product.name} groupLabel={`${issueLabel}: ${product.name}`} countId={`inventory-check-count-${product.id}`} reasonId={`inventory-check-reason-${product.id}`}
      count={draft.count} reason={draft.reason} stock={product.quantity} canViewStock={canViewStock} canViewCounts={canViewCounts} suggestions={reasonSuggestions} busy={busy} failed={!!failure} focus={draft.focus} t={t}
      onCount={value => setDraft({ ...draft, count: value })} onReason={value => setDraft({ ...draft, reason: value })} onSubmit={submitDraft} onCancel={closeEditor} /> : null}
    {validationError ? <p role="alert" className="mt-1 break-words text-xs leading-relaxed text-red-700 dark:text-red-300">{validationError}</p> : null}
  </li>
}

export default function InventoryCheckRows({ products, observations, pending = {}, errors = {}, adornments = {}, frozen = {}, reasonSuggestions = [], focusRequest, sheetHeader = 'inline', inSession, canViewPrice, canViewCost, canViewSales, canViewCustomers, ...props }: InventoryCheckRowsProps) {
  const observationOf = (product: InventoryCheckProduct) => String(observations[String(product.id)]?.product_id) === String(product.id) ? observations[String(product.id)] : undefined
  const parentsWithMembers = new Set(products.flatMap(product => product.parent_id == null ? [] : [String(product.parent_id)]))
  const canViewStock = props.canViewStock ?? true
  const canViewCounts = props.canViewCounts ?? (props.canCheck || canViewStock)
  const flags: SheetFlags = {
    canCheck: props.canCheck, inSession: inSession ?? (props.canCheck || products.some(product => observationOf(product) !== undefined)), canViewStock, canViewCounts,
    canViewPrice, canViewCost,
    canViewSales: canViewSales ?? products.some(product => finiteQuantity(product.qty_sold)),
    canViewCustomers: canViewCustomers ?? products.some(product => finiteQuantity(product.customer_count)),
  }
  const columns = sheetColumns(flags)
  const listRef = useRef<HTMLUListElement | null>(null)
  const label = props.t('inventory_check_products')
  // One copy controller for the whole list: names, barcodes and brands open the shared copy float.
  const translate = props.t
  const copyTranslate = useCallback((key: string, fallback: string) => { const value = translate(key); return value && value !== key ? value : fallback }, [translate])
  const copy = useCopyFloat(copyTranslate)

  // A scan brings its row forward: scroll to the middle, ring it for 1.6s, focus its Count input or tick. Nothing is saved.
  const [hitId, setHitId] = useState<string | null>(null)
  const rowElements = () => Array.from(listRef.current?.children ?? [])
  useEffect(() => {
    if (!focusRequest) return
    const id = String(focusRequest.id)
    const row = rowElements().find(element => element.getAttribute('data-inventory-check-row') === id)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    setHitId(id)
    const timer = setTimeout(() => setHitId(null), 1600)
    const field = focusRequest.target === 'count' ? row.querySelector<HTMLInputElement>('[data-check-count]') : focusRequest.target === 'action' ? row.querySelector<HTMLElement>('[data-check-action="done"]') : null
    field?.focus()
    return () => { clearTimeout(timer); setHitId(null) }
  }, [focusRequest?.token])

  // Enter in a Count input moves to the next row's Count input once the save has been confirmed and re-rendered.
  const [advance, setAdvance] = useState<{ from: string; turn: number } | null>(null)
  const onAdvance = useCallback((id: InventoryCheckId) => setAdvance(previous => ({ from: String(id), turn: (previous?.turn ?? 0) + 1 })), [])
  useEffect(() => {
    if (!advance) return
    const rows = rowElements()
    const at = rows.findIndex(element => element.getAttribute('data-inventory-check-row') === advance.from)
    for (const row of at < 0 ? [] : rows.slice(at + 1)) {
      const input = row.querySelector<HTMLInputElement>('[data-check-count]')
      if (input) { input.focus(); input.select(); break }
    }
  }, [advance])

  // A list of one has nothing to line up with, and the Issues tab draws one list per row: only a real list gets its own header.
  return <div className="min-w-0 max-w-full">
    {sheetHeader === 'inline' && products.length > 1 ? <InventoryCheckSheetHeader {...flags} t={props.t} /> : null}
    <ul ref={listRef} className="min-w-0 max-w-full" aria-label={label && label !== 'inventory_check_products' ? label : 'Inventory checks'}>
      {products.map(product => <CheckRow key={product.id} product={product} observation={observationOf(product)}
        pending={pending[String(product.id)] === true} error={errors[String(product.id)]}
        adornment={adornments[String(product.id)]} frozenAttempt={frozen[String(product.id)]} copy={copy}
        columns={columns} reasonSuggestions={reasonSuggestions} scanHit={hitId === String(product.id)} onAdvance={onAdvance}
        header={parentsWithMembers.has(String(product.id))} {...props} canViewStock={canViewStock} canViewCounts={canViewCounts} canCheck={props.canCheck && product.checkable !== false} />)}
    </ul>
  </div>
}
