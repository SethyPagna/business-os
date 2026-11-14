import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import CircleDashed from 'lucide-react/dist/esm/icons/circle-dashed.js'
import Clock from 'lucide-react/dist/esm/icons/clock.js'
import Hourglass from 'lucide-react/dist/esm/icons/hourglass.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js'
import ProductImage from '../pos/ProductImage.tsx'
import PortalMenu from '../shared/PortalMenu.tsx'
import ProductNameRail from '../shared/ProductNameRail.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import { PendingReviewMark } from '../shared/PendingReviewTag.tsx'
import { useCopyFloat } from '../shared/CopyFloat.tsx'
import { todayStr } from '../../utils/dateHelpers.ts'
import { fmtDateOnly, fmtDateTime24 } from '../../utils/formatters.ts'
import type { InventoryCheckId, InventoryCheckListStatus, InventoryCheckLotRow, InventoryCheckLotsAnswer, InventoryCheckProduct, InventoryCheckTranslator } from '../../types/inventoryChecks.ts'
import type { PromotionRule } from '../../utils/promotionRules.ts'
import { lotTotals, type LotDraft } from './inventoryCheckLots.ts'
import { isDraftKind, rowStatusKind, ROW_STATUS_WORDS, type RowStatusKind } from './inventoryCheckStatus.ts'
import InventoryCheckCountPopover from './InventoryCheckCountPopover.tsx'
import { priceFacts, type PriceMoney } from './inventoryPriceFacts.ts'
import { finiteQuantity, parseCount, signedDelta } from './InventoryCheckCountEditor.tsx'
import type { InventoryCheckFocusRequest } from './InventoryCheckRows.tsx'

/** What a person has entered on one row of the list but not yet submitted. `checked`: the count was filled from Now by the row's check button. */
export type ListDraft = { selected: boolean; count: string; checked: boolean; note: string; /** Counts typed per received date (ic_lot_counts); the row's count is their sum. */ lots?: LotDraft }
export type ListDrafts = Readonly<Record<string, ListDraft | undefined>>

const makeTr = (t: InventoryCheckTranslator) => (key: string, fallback: string) => {
  const value = t(key)
  return value && value !== key ? value : fallback
}

// ---- Columns -----------------------------------------------------------------------------------------------------------------
// Phone: the image keeps its square on the left, the count input and the status icon sit to the SIDE of the name (never on a row of their own), the facts wrap under the name. From `lg` the same cells line up as columns: every cell has one
// fixed width and one `order`, so rows and header agree without a shared grid. Last checked only fits beside the sidebar from `xl`.

export type ListField = 'now' | 'status' | 'counted' | 'count' | 'last'
export type ListFlags = { selecting: boolean; canViewStock: boolean; canViewCounts: boolean }

/** The columns that exist for this viewer: a column nobody may read is not drawn at all. */
export function listColumns(flags: ListFlags): ListField[] {
  const fields: ListField[] = []
  if (flags.canViewStock) fields.push('now')
  fields.push('status')
  if (flags.canViewCounts) fields.push('counted')
  if (flags.selecting) fields.push('count')
  fields.push('last')
  return fields
}

const CELL_BOX: Record<ListField, string> = {
  now: 'lg:order-2 lg:w-24', status: 'lg:order-3 lg:w-28', counted: 'lg:order-4 lg:w-16', count: 'lg:order-5 lg:w-20', last: 'lg:order-6 lg:w-40',
}
const WIDE_FIELDS: ReadonlySet<ListField> = new Set(['last'])
const NAME_BOX = 'lg:order-1 lg:min-w-0 lg:flex-1'
/** Text read beside its figure on a phone; from 1024px the column header carries it and only screen readers keep it. */
const BELOW_SHEET_ONLY = 'sr-only max-lg:not-sr-only'
function cellClass(field: ListField, placeholder = false): string {
  const show = WIDE_FIELDS.has(field) ? (placeholder ? 'hidden lg:hidden xl:block' : 'lg:hidden xl:block') : placeholder ? 'hidden lg:block' : ''
  return `lg:shrink-0 ${field === 'count' ? 'lg:text-center' : 'lg:text-right'} lg:tabular-nums ${CELL_BOX[field]} ${show}`
}
function fieldLabel(field: ListField, tr: (key: string, fallback: string) => string): string {
  switch (field) {
    case 'now': return tr('inventory_check_now', 'Now')
    case 'status': return tr('inventory_check_status_short', 'Status')
    case 'counted': return tr('inventory_check_counted', 'Counted')
    case 'count': return tr('inventory_check_count', 'Count')
    case 'last': return tr('inventory_check_last_checked', 'Last checked')
  }
}

/** The column titles of the list, pinned with the controls. Draws nothing below 1024px. */
export function InventoryCheckListHeader({ t, className = '', ...flags }: ListFlags & { t: InventoryCheckTranslator; className?: string }) {
  const tr = makeTr(t)
  return <div aria-hidden="true" data-inventory-check-sheet-header className={`hidden min-w-0 items-end gap-x-2 border-b border-l-2 border-b-gray-200 border-l-transparent pb-1 pl-2 pr-1 text-[11px] font-semibold leading-relaxed text-gray-500 lg:flex dark:border-b-gray-700 ${className}`}>
    <span className="w-10 shrink-0" />
    <span className={`${NAME_BOX} text-left`}>{tr('product', 'Product')}</span>
    {listColumns(flags).map(field => <span key={field} className={cellClass(field)}>{fieldLabel(field, tr)}</span>)}
  </div>
}

// ---- Small helpers -----------------------------------------------------------------------------------------------------------

const rowIconButton = 'inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 lg:h-10 lg:min-h-10 lg:w-10 dark:text-gray-300 dark:hover:bg-zinc-800'

/** 'YYYY-MM-DD' expiry as the month-year it is printed with, and how close it is (30 days, the app-wide alert window). */
function expiryBadge(date: string | null | undefined): { text: string; tone: 'expired' | 'soon' | 'ok'; full: string } | null {
  const match = String(date ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const days = Math.round((Date.parse(`${match[0]}T00:00:00Z`) - Date.parse(`${todayStr()}T00:00:00Z`)) / 86400000)
  return { text: `${match[2]}/${match[1]}`, tone: days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok', full: fmtDateOnly(match[0]) }
}

export const LIST_STATUS: Record<InventoryCheckListStatus, { key: string; fallback: string; tone: string; edge: string; Icon: typeof Check }> = {
  not_checked: { key: 'inventory_check_status_not_checked', fallback: 'Not checked', tone: 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300', edge: 'border-l-transparent', Icon: CircleDashed },
  in_check: { key: 'inventory_check_status_in_check', fallback: 'In check', tone: 'bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200', edge: 'border-l-sky-500', Icon: Clock },
  ok: { key: 'inventory_check_status_ok', fallback: 'Checked OK', tone: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200', edge: 'border-l-emerald-500', Icon: Check },
  issue: { key: 'inventory_check_issue', fallback: 'Issue', tone: 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200', edge: 'border-l-red-500', Icon: X },
}
const listStatus = (value: unknown): InventoryCheckListStatus | null => typeof value === 'string' && Object.hasOwn(LIST_STATUS, value) ? value as InventoryCheckListStatus : null

/** The sentence the server records for a differing count that came with no note; the page says it in the viewer's language. */
export const DEFAULT_COUNT_NOTE = 'Count differs from stock'

export type InventoryCheckListRowsProps = {
  products: readonly InventoryCheckProduct[]
  drafts: ListDrafts
  /** The viewer may count: rows get a status icon that opens the count popover, and a Count input. */
  selecting: boolean
  /** A submission is on its way: nothing on the list changes until it is answered. */
  locked?: boolean
  canViewStock: boolean
  canViewCounts: boolean
  /** Price details (selling, wholesale, promotion) of rows that carry prices, in the viewer's display currency. Absent: no price is drawn. */
  priceText?: (usd: unknown, khr?: unknown) => string
  promotionRules?: readonly PromotionRule[]
  exchangeRate?: number
  /** Small badges after the barcode line, by product id (the Issues tab's "Open session" chip). */
  adornments?: Readonly<Record<string, ReactNode | undefined>>
  /** Scroll one row to the middle, ring it for a moment and focus its Count input or its check button. Send it with the render that shows the row. */
  focusRequest?: InventoryCheckFocusRequest
  /** After Enter in a Count input. Return true when the page handled what comes next; otherwise focus moves to the next row's Count input. */
  onCountEntered?: (id: InventoryCheckId) => boolean
  t: InventoryCheckTranslator
  onOpenProduct: (product: InventoryCheckProduct) => void
  onCount: (product: InventoryCheckProduct, value: string) => void
  onNote: (product: InventoryCheckProduct, value: string) => void
  /** ic_lot_counts: the count is typed per received date (batch) in the row's popover, which reads that product's batches once when it opens. Absent: one total per row, exactly what it was. */
  lotCounts?: boolean
  loadLots?: (product: InventoryCheckProduct, signal: AbortSignal) => Promise<InventoryCheckLotsAnswer>
  onLotCount?: (product: InventoryCheckProduct, row: InventoryCheckLotRow, value: string) => void
  /** The popover's quick answers: matches stock (the batches given are filled with their stock, else the total), does not match, clear. */
  onMatches?: (product: InventoryCheckProduct, rows?: InventoryCheckLotRow[]) => void
  onDiffers?: (product: InventoryCheckProduct) => void
  onClear?: (product: InventoryCheckProduct) => void
  /** Full stock adjusters: a Set button beside a typed batch count that differs from stock. Resolves the batch's quantity afterwards (set, or the figure found when stock had moved), null when nothing changed. */
  onLotSet?: (product: InventoryCheckProduct, row: InventoryCheckLotRow, value: string) => Promise<number | null>
}

type RowProps = Omit<InventoryCheckListRowsProps, 'products' | 'drafts' | 'focusRequest' | 'adornments'> & {
  product: InventoryCheckProduct
  draft: ListDraft | undefined
  adornment?: ReactNode
  columns: ListField[]
  /** The row itself can be counted (not a family header, not an uncheckable product); the viewer's right to count is `selecting`. */
  countable: boolean
  copy: ReturnType<typeof useCopyFloat>
  scanHit: boolean
  onAdvance: (id: InventoryCheckId) => void
}

/** The icon of each status kind: grey dotted circle, sky clock, green check, red x, amber hourglass; a draft wears the icon of what it will be. */
function statusIconOf(kind: RowStatusKind): { Icon: typeof Check; tone: string } {
  switch (kind) {
    case 'not_checked': return { Icon: CircleDashed, tone: 'text-gray-400 dark:text-gray-500' }
    case 'in_check': return { Icon: Clock, tone: 'text-sky-600 dark:text-sky-300' }
    case 'ok': case 'draft_ok': case 'draft_counted': return { Icon: Check, tone: 'text-emerald-600 dark:text-emerald-400' }
    case 'issue': case 'draft_issue': case 'draft_empty': return { Icon: X, tone: 'text-red-600 dark:text-red-400' }
    case 'pending': return { Icon: Hourglass, tone: 'text-amber-600 dark:text-amber-400' }
  }
}

function ListRow({ product, draft, adornment, columns, countable, copy, scanHit, onAdvance, selecting, locked = false, canViewStock, canViewCounts, priceText, promotionRules, exchangeRate = 4100, t, onOpenProduct, onCount, onNote, onCountEntered, lotCounts = false, loadLots, onLotCount, onLotSet, onMatches, onDiffers, onClear }: RowProps) {
  const tr = makeTr(t)
  const id = String(product.id)
  const counting = selecting && countable
  // Nothing is ticked by default: a row has a draft only after a person typed a count, said "matches stock" or "does not match".
  const selected = counting && draft?.selected === true
  const entry = parseCount(draft?.count ?? '')
  const stockKnown = canViewStock && finiteQuantity(product.quantity)
  // Per received date (ic_lot_counts): the count is typed in the popover, per batch; the row shows their sum and opens the popover when it is touched.
  const byBatch = counting && lotCounts && canViewStock && !!loadLots
  // A count typed on received dates is measured against what those dates showed, not against the whole branch.
  const dated = lotCounts && lotTotals(draft?.lots).dates > 0
  const baseline = dated ? lotTotals(draft?.lots).seen : product.quantity
  const differs = stockKnown && entry.kind === 'valid' && entry.value !== baseline
  const status = listStatus(product.check_status)
  const wants = (field: ListField) => columns.includes(field)
  const nowText = stockKnown ? String(product.quantity) : ''
  const countLabel = `${tr('inventory_check_count', 'Count')}: ${product.name}`
  const unknownStock = <span className="inline-flex items-center">—<InfoHint text={tr('inventory_check_stock_unknown_hint', 'Stock is not known for this product right now.')} label={tr('inventory_check_stock_unknown_hint', 'Stock is not known for this product right now.')} className="ml-0.5" triggerClassName="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400" /></span>
  const figure = (value: number | null | undefined) => finiteQuantity(value) ? <strong className="tabular-nums">{value}</strong> : null
  const named = (field: ListField, text = fieldLabel(field, tr)) => <span className={BELOW_SHEET_ONLY}>{text}</span>
  const statusRef = useRef<HTMLButtonElement | null>(null)

  const facts: Array<[ListField, ReactNode]> = []
  if (wants('now')) {
    const unit = finiteQuantity(product.quantity) ? String(product.unit ?? '').trim() : ''
    facts.push(['now', <span>{named('now')} {figure(product.quantity) ?? unknownStock}{unit ? <>{' '}<span className="text-gray-500 dark:text-gray-400">{unit}</span></> : null}{finiteQuantity(product.damaged_quantity) && product.damaged_quantity > 0 ? <>{' '}<span data-damaged className="inline-flex items-center rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200" title={`${tr('inventory_check_held', 'Held')}: ${product.damaged_quantity}`}>{tr('inventory_check_held', 'Held')} {product.damaged_quantity}</span></> : null}</span>])
  }
  if (wants('counted')) {
    const recorded = canViewCounts && finiteQuantity(product.check_counted_quantity) ? product.check_counted_quantity : null
    facts.push(['counted', recorded === null ? null : <span>{named('counted')} {recorded}</span>])
  }
  if (wants('last')) {
    const who = product.check_by ? `@${product.check_by}` : ''
    const when = product.check_at ? fmtDateTime24(product.check_at) : ''
    facts.push(['last', who || when ? <span title={[who, when].filter(Boolean).join(' · ')}><span className={BELOW_SHEET_ONLY}>{tr('inventory_check_last_checked', 'Last checked')} </span>{[who, when].filter(Boolean).join(' · ')}</span> : null])
  }

  // The one status icon: what was recorded, or what the unsubmitted draft will be. With a date beside it (the day of the count session the status came from; the full date and time in the tooltip).
  // A row that can be counted always has its icon (no recorded status yet reads as not checked): it is the way into the popover. A heading or an uncheckable row has none.
  const kind = rowStatusKind({ recorded: product.check_status, pending: product.check_pending === true, draft: counting ? draft : undefined, stock: stockKnown ? product.quantity : undefined }) ?? (counting ? 'not_checked' : null)
  const statusWords = kind ? tr(ROW_STATUS_WORDS[kind].key, ROW_STATUS_WORDS[kind].fallback) : ''
  const statusGlyph = kind ? (() => { const { Icon, tone } = statusIconOf(kind); return <Icon className={`h-5 w-5 ${tone}`} aria-hidden="true" /> })() : null
  const checkedOn = kind && !isDraftKind(kind) && kind !== 'not_checked' && product.check_at ? fmtDateOnly(product.check_at) : ''
  const checkedTitle = checkedOn ? `${statusWords} · ${[product.check_by ? `@${product.check_by}` : '', fmtDateTime24(product.check_at as string)].filter(Boolean).join(' · ')}` : statusWords
  const statusButtonClass = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-transparent hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 lg:h-9 lg:w-9 dark:hover:bg-zinc-800 ${kind && isDraftKind(kind) ? 'ring-2 ring-blue-300 dark:ring-blue-700' : ''}`
  const openLabel = `${tr('inventory_check_open_count', 'Check and count: {name}').replace('{name}', product.name)} (${statusWords})`
  const statusNode = kind === null ? null : <span className="inline-flex min-w-0 flex-col items-center gap-0 lg:flex-row lg:justify-end lg:gap-1">
    {counting ? <PortalMenu align="auto" menuClassName="!rounded-xl" closeOnContentClick={false}
      trigger={<button ref={statusRef} type="button" data-check-action="status" data-check-status-kind={kind} aria-label={openLabel} title={checkedTitle} className={statusButtonClass}>{statusGlyph}</button>}
      content={({ closeMenu }) => <InventoryCheckCountPopover product={product} draft={draft} byBatch={byBatch} loadLots={loadLots} canViewStock={canViewStock} canViewCounts={canViewCounts} locked={locked} t={t} statusIcon={statusGlyph} statusText={checkedTitle}
        onClose={closeMenu} onCount={onCount} onLotCount={(item, row, value) => onLotCount?.(item, row, value)} onMatches={(item, rows) => onMatches?.(item, rows)} onDiffers={item => onDiffers?.(item)} onClear={item => onClear?.(item)} onLotSet={onLotSet} />} />
      : <span data-check-status-kind={kind} role="img" aria-label={statusWords} title={checkedTitle} className="inline-flex h-11 w-11 shrink-0 items-center justify-center lg:h-9 lg:w-9">{statusGlyph}</span>}
    {checkedOn ? <span data-check-date title={checkedTitle} className="text-[10px] leading-tight tabular-nums text-gray-500 lg:text-[11px] dark:text-gray-400">{checkedOn}</span> : null}
  </span>

  const barcode = product.barcode || product.sku
  const expiry = expiryBadge(product.next_expiry_date)
  const expiryName = expiry ? expiry.tone === 'expired' ? tr('inventory_check_expired', 'Expired') : expiry.tone === 'soon' ? tr('inventory_check_expires_soon', 'Expires soon') : tr('expiry', 'Expiry') : ''
  const identity: Array<[string, ReactNode]> = []
  if (barcode) identity.push(['barcode', <span {...copy(barcode)} className="break-all">{barcode}</span>])
  if (product.brand) identity.push(['brand', <span {...copy(product.brand)}>{product.brand}</span>])
  if (product.category) identity.push(['category', <span>{product.category}</span>])
  // Price details ride the same wrapping line as the barcode and brand (no new line, label inside), from the fields the row already carries.
  const prices = priceText ? priceFacts(product as unknown as Record<string, unknown>, promotionRules, exchangeRate) : null
  const priceFact = (key: 'selling' | 'wholesale' | 'promotion', label: string, money: PriceMoney | null) => {
    if (money && priceText) identity.push([key, <span data-price={key}><span className="text-gray-400 dark:text-gray-500">{label}</span> <strong className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">{priceText(money.usd, money.khr ?? undefined)}</strong></span>])
  }
  if (prices) {
    priceFact('selling', tr('selling_price', 'Selling price'), prices.selling)
    priceFact('wholesale', tr('wholesale_price', 'Wholesale price'), prices.wholesale)
    priceFact('promotion', tr('promotion', 'Promotion'), prices.promotion)
  }
  const dotted = (parts: Array<[string, ReactNode]>) => parts.map(([key, node], index) => <Fragment key={key}>{index > 0 ? <span aria-hidden="true">·</span> : null}{node}</Fragment>)
  const edge = status ? LIST_STATUS[status].edge : 'border-l-transparent'
  const recordedNote = status === 'issue' ? product.check_note : null
  const note = recordedNote === DEFAULT_COUNT_NOTE ? tr('inventory_check_default_note', 'Count differs from stock') : recordedNote
  let shown = 0

  function onCountKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || locked) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (byBatch) { statusRef.current?.click(); return }
      if (entry.kind === 'valid' && onCountEntered?.(product.id) !== true) onAdvance(product.id)
    } else if (event.key === 'Escape') { event.preventDefault(); if (!byBatch) onCount(product, '') }
  }

  return <li data-inventory-check-row={id} data-check-list-status={status ?? undefined} data-selected={selected ? '' : undefined} data-scan-hit={scanHit ? '' : undefined}
    className={`relative min-w-0 max-w-full border-b border-l-2 border-b-gray-100 py-2 pl-2 pr-1 last:border-b-0 dark:border-b-gray-800 ${edge} ${selected ? 'bg-sky-50/70 dark:bg-sky-950/20' : ''} ${scanHit ? 'rounded-sm ring-2 ring-primary-400 dark:ring-primary-300' : ''}`}>
    {/* A count that differs from stock and waits for an approver (ic_fix_stock): the review queue's mini tag, in the row's own start gutter. It takes no space, so the row looks the same with and without it. */}
    {product.check_pending === true ? <PendingReviewMark data-check-pending="" label={tr('inventory_check_approval_pending', 'Waiting for approval')} className="-left-px top-1" /> : null}
    {/* One compact line where the width allows: the image keeps its square, the name takes the room, the status icon and the count input sit beside it. */}
    <div className="flex min-w-0 items-center gap-2" data-inventory-check-main>
      <button type="button" onClick={() => onOpenProduct(product)} data-check-image className="relative block aspect-square h-12 w-12 shrink-0 overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:h-10 lg:w-10" aria-label={product.name} title={product.name}>
        <ProductImage src={product.image_path || undefined} alt="" className="absolute inset-0 h-full w-full rounded-lg object-cover" />
      </button>
      <div className="min-w-0 flex-1 lg:contents">
        <span className={`block min-w-0 ${NAME_BOX}`}>
          <span className="block min-w-0" {...copy(product.name)}><ProductNameRail name={product.name} className="text-xs font-semibold leading-5 text-gray-800 dark:text-gray-100" /></span>
          {identity.length || adornment || expiry ? <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-gray-500">{dotted(identity)}{adornment}
            {expiry ? <span data-expiry={expiry.tone} title={`${expiryName}: ${expiry.full}`} className={`inline-flex items-center rounded-full px-1.5 font-semibold ${expiry.tone === 'expired' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : expiry.tone === 'soon' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`}>{expiryName} {expiry.text}</span> : null}
          </span> : null}
        </span>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-relaxed text-gray-600 lg:contents lg:text-xs dark:text-gray-300" data-inventory-check-meta>
          {facts.map(([field, node]) => {
            if (node === null) return <span key={field} aria-hidden="true" data-cell={field} className={cellClass(field, true)} />
            return <Fragment key={field}>{shown++ > 0 ? <span aria-hidden="true" className="lg:hidden">·</span> : null}<span data-cell={field} className={cellClass(field)}>{node}</span></Fragment>
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 lg:contents" data-inventory-check-side>
        {wants('status') ? statusNode ? <span data-cell="status" className={`${cellClass('status')} flex justify-center lg:justify-end`}>{statusNode}</span> : <span aria-hidden="true" data-cell="status" className={cellClass('status', true)} /> : null}
        {selecting && !countable ? <span aria-hidden="true" data-cell="count-input" className={`hidden lg:block ${CELL_BOX.count} lg:shrink-0`} /> : null}
        {counting ? <span data-cell="count-input" className={`inline-flex items-center ${CELL_BOX.count} lg:shrink-0 lg:justify-end`}>
          <input data-check-count type="text" inputMode="decimal" autoComplete="off" value={draft?.count ?? ''} readOnly={locked || byBatch} placeholder={nowText} aria-label={countLabel} aria-invalid={entry.kind === 'invalid' ? true : undefined}
            className={`h-10 w-16 min-w-0 rounded-lg border px-2 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 read-only:opacity-60 dark:bg-gray-900 lg:h-9 lg:w-[4.5rem] ${byBatch ? 'cursor-pointer read-only:opacity-100' : ''} ${entry.kind === 'invalid' ? 'border-red-500' : differs ? 'border-amber-500' : 'border-gray-300 dark:border-gray-600'}`}
            onChange={event => onCount(product, event.target.value)} onClick={byBatch ? () => statusRef.current?.click() : undefined} onFocus={event => event.currentTarget.select()} onKeyDown={onCountKeyDown} />
        </span> : null}
      </div>
    </div>
    {note ? <p className="mt-1 break-words text-xs leading-relaxed text-red-800 lg:pl-12 dark:text-red-200" data-check-note>{note}</p> : null}
    {counting && selected && differs ? <label className="mt-1 flex min-w-0 items-center gap-2 text-xs text-amber-800 lg:pl-12 dark:text-amber-200" data-check-draft-note>
      <span data-check-difference className="shrink-0 font-semibold tabular-nums">{signedDelta((entry as { value: number }).value - (baseline as number))}</span>
      <input type="text" value={draft?.note ?? ''} maxLength={500} readOnly={locked} placeholder={tr('inventory_check_note_placeholder', 'Note (optional)')} aria-label={`${tr('inventory_check_note_placeholder', 'Note (optional)')}: ${product.name}`}
        className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-2 text-xs lg:h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-600 dark:bg-gray-900" onChange={event => onNote(product, event.target.value)} />
    </label> : null}
    {entry.kind === 'invalid' ? <p role="alert" className="mt-1 break-words text-xs leading-relaxed text-red-700 lg:pl-12 dark:text-red-300">{tr('inventory_check_invalid_count', 'Enter a valid non-negative quantity.')}</p> : null}
  </li>
}

export default function InventoryCheckListRows({ products, drafts, adornments = {}, focusRequest, ...props }: InventoryCheckListRowsProps) {
  const columns = listColumns({ selecting: props.selecting, canViewStock: props.canViewStock, canViewCounts: props.canViewCounts })
  const listRef = useRef<HTMLUListElement | null>(null)
  const translate = props.t
  const copyTranslate = useCallback((key: string, fallback: string) => { const value = translate(key); return value && value !== key ? value : fallback }, [translate])
  const copy = useCopyFloat(copyTranslate)
  const rowElements = () => Array.from(listRef.current?.children ?? [])

  // A scan brings its row forward: scroll to the middle, ring it for 1.6s, focus its Count input or its check button. Nothing is entered.
  const [hitId, setHitId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusRequest) return
    const id = String(focusRequest.id)
    const row = rowElements().find(element => element.getAttribute('data-inventory-check-row') === id)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    setHitId(id)
    const timer = setTimeout(() => setHitId(null), 1600)
    const field = focusRequest.target === 'count' ? row.querySelector<HTMLInputElement>('[data-check-count]') : focusRequest.target === 'action' ? row.querySelector<HTMLElement>('[data-check-action="status"]') : null
    field?.focus()
    return () => { clearTimeout(timer); setHitId(null) }
  }, [focusRequest?.token])

  // Enter in a Count input moves to the next row's Count input.
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

  const label = props.t('inventory_check_products')
  return <div className="min-w-0 max-w-full">
    <ul ref={listRef} className="min-w-0 max-w-full" aria-label={label && label !== 'inventory_check_products' ? label : 'Inventory checks'}>
      {products.map(product => <ListRow key={product.id} product={product} draft={drafts[String(product.id)]} adornment={adornments[String(product.id)]}
        columns={columns} copy={copy} scanHit={hitId === String(product.id)} onAdvance={onAdvance} {...props} countable={product.checkable !== false && !product.is_group} />)}
    </ul>
  </div>
}

// ---- The bar above the list --------------------------------------------------------------------------------------------------

export type InventoryCheckSelectionBarProps = {
  /** How many products on the list have a count (or an answer) that is not submitted yet. */
  selectedCount: number
  /** Nothing can be submitted yet: the reason, in words. */
  blocked: string
  busy: boolean
  /** A word for the main action when it is not Submit (Retry after an unconfirmed attempt). */
  submitLabel?: string
  /** One tap for the whole page ("matches stock"): offered when the viewer sees stock and the count is one total per product (not per received date, where each product's batches are answered in its own popover). */
  canMarkChecked: boolean
  onMarkChecked: () => void
  onClear: () => void
  onSubmit: () => void
  t: InventoryCheckTranslator
}

/** How many are counted, the two things to do with them as icons, and the main action, which keeps its word. There is no select-all: nothing is ticked until a person answers a row. */
export function InventoryCheckSelectionBar({ selectedCount, blocked, busy, submitLabel, canMarkChecked, onMarkChecked, onClear, onSubmit, t }: InventoryCheckSelectionBarProps) {
  const tr = makeTr(t)
  const mark = tr('inventory_check_mark_page_checked', 'Mark every product on this page as matching stock')
  const clear = tr('inventory_check_clear_selection', 'Clear selection')
  const submit = submitLabel || tr('inventory_check_submit', 'Submit')
  const countText = selectedCount > 0 ? tr('inventory_check_counted_rows', '{count} counted').replace('{count}', String(selectedCount)) : ''
  return <div data-inventory-check-selection-bar className="flex min-w-0 items-center gap-1 pl-2">
    {canMarkChecked ? <button type="button" data-selection-action="mark" className={rowIconButton} aria-label={mark} title={mark} disabled={busy} onClick={onMarkChecked}><ListChecks className="h-5 w-5" aria-hidden="true" /></button> : null}
    <span data-selected-count aria-live="polite" className="min-w-0 flex-1 truncate px-1 text-xs tabular-nums text-gray-600 dark:text-gray-300">{countText}</span>
    {selectedCount > 0 ? <button type="button" data-selection-action="clear" className={rowIconButton} aria-label={clear} title={clear} disabled={busy} onClick={onClear}><X className="h-5 w-5" aria-hidden="true" /></button> : null}
    {blocked && selectedCount > 0 ? <InfoHint text={blocked} label={blocked} /> : null}
    <button type="button" data-selection-action="submit" className="btn-primary inline-flex min-h-11 shrink-0 items-center gap-1 px-3 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-60 lg:min-h-10"
      aria-disabled={blocked || busy || selectedCount === 0 ? true : undefined} title={blocked || submit} onClick={() => { if (!blocked && !busy && selectedCount > 0) onSubmit() }}><Send className="h-4 w-4" aria-hidden="true" />{submit}</button>
  </div>
}
