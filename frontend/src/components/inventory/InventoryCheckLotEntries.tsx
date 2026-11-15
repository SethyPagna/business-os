import { useEffect, useState, type KeyboardEvent } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import { fmtDateOnly } from '../../utils/formatters.ts'
import type { InventoryCheckLotRow, InventoryCheckLotsAnswer, InventoryCheckProduct } from '../../types/inventoryChecks.ts'
import { lotCountOf, rowSetPlan, type LotDraft } from './inventoryCheckLots.ts'
import { finiteQuantity, signedDelta } from './InventoryCheckCountEditor.tsx'

// The per-received-date entries of the count popover (ic_lot_counts): one count box per batch that holds stock, and, collapsed at the end, the batches that hold 0 ("Show empty received dates (n)").
// An empty date is offered because units are sometimes found on a batch the system says is empty; it is never part of "matches stock" and never read from the server here (the row carries it).
//
// This chunk also owns everything that exists only when counting per date: the dates themselves (the row's own at the first paint, or one request for this product when the row does not carry them), the loading and
// failed lines, the direct Set of one date and the units no date holds. The popover's header needs only the counted dates, which the entries report (onDates).

type Lots = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; rows: InventoryCheckLotRow[]; more: boolean }

export type InventoryCheckLotEntriesProps = {
  product: InventoryCheckProduct
  /** The row carries its stocked dates in full and they are current: drawn at the first paint, nothing is read. Otherwise they are read once (one request, this product) when this mounts. */
  carried: boolean
  loadLots: (product: InventoryCheckProduct, signal: AbortSignal) => Promise<InventoryCheckLotsAnswer>
  /** The counted dates, whenever they become known or change (a Set): the popover's Matches stock and Total box work from them. */
  onDates: (rows: InventoryCheckLotRow[]) => void
  draftLots: LotDraft | undefined
  canViewCounts: boolean
  locked: boolean
  tr: (key: string, fallback: string) => string
  onLotCount: (row: InventoryCheckLotRow, value: string) => void
  /** Full stock adjusters: Set one date to its typed figure now. Resolves the quantity it holds afterwards, or null when nothing changed. */
  onSet?: (product: InventoryCheckProduct, row: InventoryCheckLotRow, value: string) => Promise<number | null>
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void
  /** The sum of what is typed and its difference from what the dates showed (computed from the draft by the popover). */
  sumText: string
  delta: number | null
  inputClass: string
  toolClass: string
}

type LotListProps = {
  product: InventoryCheckProduct
  /** The batches that hold stock at the branch. */
  rows: InventoryCheckLotRow[]
  /** The batches that hold 0 (carried on the row). Collapsed until asked for, or until something is typed on one. */
  emptyRows: InventoryCheckLotRow[]
  draftLots: LotDraft | undefined
  canViewCounts: boolean
  locked: boolean
  tr: (key: string, fallback: string) => string
  onLotCount: (row: InventoryCheckLotRow, value: string) => void
  onLotSet?: (row: InventoryCheckLotRow, value: string) => void
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void
  /** Units no received date holds (read-only note), whether more dates exist than one count carries, the sum of what is typed and its difference from what the dates showed. */
  unlotted: number
  more: boolean
  sumText: string
  delta: number | null
  inputClass: string
  toolClass: string
}

const idText = (row: InventoryCheckLotRow) => [row.lotCode ? String(row.lotCode) : '', row.batchNumber ? `#${row.batchNumber}` : ''].filter(Boolean).join(' ')

export default function InventoryCheckLotEntries({ product, carried, loadLots, onDates, draftLots, canViewCounts, locked, tr, onLotCount, onSet, onEnter, sumText, delta, inputClass, toolClass }: InventoryCheckLotEntriesProps) {
  const [lots, setLots] = useState<Lots>(carried ? { state: 'ready', rows: product.lot_rows!, more: false } : { state: 'loading' })
  // The dates this branch holds at 0, carried by the row: behind "Show empty received dates", never read here, never part of "matches stock".
  const [emptied, setEmptied] = useState<InventoryCheckLotRow[]>(() => product.empty_lot_rows ?? [])
  // One request when this opens, for a row that does not carry its dates in full. A late answer after it closed is dropped by the abort.
  useEffect(() => {
    if (carried) return undefined
    const abort = new AbortController()
    loadLots(product, abort.signal).then(answer => { if (!abort.signal.aborted) setLots({ state: 'ready', rows: answer.lots ?? [], more: answer.more === true }) },
      () => { if (!abort.signal.aborted) setLots({ state: 'failed' }) })
    return () => abort.abort()
  }, [product.id])
  useEffect(() => { if (lots.state === 'ready') onDates(lots.rows) }, [lots])
  // A direct Set changed what one date holds. A date that holds stock is a counted date; one Set to 0 holds none, so it leaves the counted dates ("Matches stock" must never write a 0 against 0 line for it)
  // and waits behind the empty dates, and a date Set up from empty joins the counted ones.
  function setLotQuantity(row: InventoryCheckLotRow, quantity: number) {
    const moved: InventoryCheckLotRow = { ...row, quantity }
    const same = (candidate: InventoryCheckLotRow) => candidate.batchId === row.batchId
    setLots(previous => previous.state !== 'ready' ? previous : { ...previous, rows: quantity <= 0 ? previous.rows.filter(candidate => !same(candidate)) : previous.rows.some(same) ? previous.rows.map(candidate => same(candidate) ? moved : candidate) : [...previous.rows, moved] })
    setEmptied(previous => quantity > 0 ? previous.filter(candidate => !same(candidate)) : previous.some(same) ? previous.map(candidate => same(candidate) ? moved : candidate) : [...previous, moved])
  }
  if (lots.state === 'loading') return <p data-popover-loading role="status" className="px-1 py-2 text-gray-500 dark:text-gray-400">{tr('inventory_check_popover_loading', 'Loading received dates…')}</p>
  if (lots.state === 'failed') return <p data-popover-failed role="alert" className="px-1 py-2 text-red-700 dark:text-red-300">{tr('inventory_check_popover_failed', 'Received dates could not be loaded. Close and open again.')}</p>
  // No stocked date: the popover counts one total instead (its own box).
  if (lots.rows.length === 0) return null
  const stock = finiteQuantity(product.quantity) ? product.quantity : null
  const unlotted = !lots.more && stock !== null ? stock - lots.rows.reduce((sum, row) => sum + row.quantity, 0) : 0
  return <LotList product={product} rows={lots.rows} emptyRows={carried ? emptied : []} draftLots={draftLots} canViewCounts={canViewCounts} locked={locked} tr={tr} inputClass={inputClass} toolClass={toolClass}
    unlotted={unlotted} more={lots.more} sumText={sumText} delta={delta} onLotCount={onLotCount} onEnter={onEnter}
    onLotSet={onSet ? (row, value) => { void onSet(product, row, value).then(quantity => { if (typeof quantity === 'number') setLotQuantity(row, quantity) }) } : undefined} />
}

function LotList({ product, rows, emptyRows, draftLots, canViewCounts, locked, tr, onLotCount, onLotSet, onEnter, unlotted, more, sumText, delta, inputClass, toolClass }: LotListProps) {
  // Something already typed on an empty date keeps it in view.
  const [shown, setShown] = useState(() => emptyRows.some(row => draftLots?.[String(row.batchId)] !== undefined))
  const open = shown || emptyRows.some(row => draftLots?.[String(row.batchId)] !== undefined)
  const toggleText = tr('inventory_check_popover_show_empty', 'Show empty received dates ({count})').replace('{count}', String(emptyRows.length))
  const hideText = tr('inventory_check_popover_hide_empty', 'Hide empty received dates ({count})').replace('{count}', String(emptyRows.length))

  const line = (row: InventoryCheckLotRow) => {
    const text = draftLots?.[String(row.batchId)]?.count ?? ''
    const typed = lotCountOf(text)
    const plan = onLotSet ? rowSetPlan(row, text) : null
    const received = tr('inventory_check_lot_received', 'Received {date}').replace('{date}', row.receivedAt ? fmtDateOnly(row.receivedAt) : '—')
    const identity = idText(row)
    // What the latest count typed on this batch, kept in the session: it is still there after a reload.
    const recorded = canViewCounts ? product.check_lines?.find(entry => entry.scope === 'lot' && entry.batch_id === row.batchId) : undefined
    const setLabel = plan ? tr('inventory_check_lot_set', 'Set to {count}').replace('{count}', String(plan.after)) : ''
    return <li key={row.batchId} data-popover-lot={row.batchId} data-popover-lot-empty={row.quantity > 0 ? undefined : ''} className="flex min-w-0 items-center gap-x-1.5">
      <span className="min-w-0 flex-1 leading-relaxed">
        <span className="block truncate font-semibold" title={received}>{row.receivedAt ? fmtDateOnly(row.receivedAt) : '—'}{identity ? <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">{identity}</span> : null}</span>
        {row.expiry || recorded ? <span className="flex min-w-0 flex-wrap gap-x-2 text-[11px] text-gray-500 dark:text-gray-400">
          {row.expiry ? <span className="truncate">{tr('expiry', 'Expiry')} {fmtDateOnly(row.expiry)}</span> : null}
          {recorded ? <span data-popover-lot-recorded className="tabular-nums">{tr('inventory_check_counted', 'Counted')} <strong>{recorded.counted}</strong></span> : null}
        </span> : null}
      </span>
      <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400" title={tr('inventory_check_now', 'Now')}>{row.quantity}</span>
      <input data-popover-count data-popover-lot-count={row.batchId} type="text" inputMode="decimal" autoComplete="off" value={text} readOnly={locked} placeholder={String(row.quantity)} aria-label={`${received}: ${product.name}`} aria-invalid={typed.kind === 'invalid' ? true : undefined}
        className={`${inputClass} ${typed.kind === 'invalid' ? 'border-red-500' : typed.kind === 'valid' && typed.value !== row.quantity ? 'border-amber-500' : 'border-gray-300 dark:border-gray-600'}`}
        onChange={event => onLotCount(row, event.target.value)} onFocus={event => event.currentTarget.select()} onKeyDown={onEnter} />
      {onLotSet ? <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center lg:h-9 lg:w-9">{plan ? <button type="button" data-popover-action="set-lot" disabled={locked} className={toolClass} aria-label={`${setLabel}: ${product.name}`} title={setLabel}
        onClick={() => onLotSet(row, text)}><Save className="h-4 w-4" aria-hidden="true" /></button> : null}</span> : null}
    </li>
  }

  return <>
  <ul className="min-w-0 space-y-1" aria-label={tr('inventory_check_lot_dates', 'Received dates')}>
    {rows.map(line)}
    {emptyRows.length > 0 ? <li data-popover-empty-toggle className="flex min-w-0 items-center">
      <button type="button" data-popover-action="toggle-empty" aria-expanded={open} aria-label={open ? hideText : toggleText} title={open ? hideText : toggleText} onClick={() => setShown(!open)}
        className="inline-flex h-9 min-w-0 items-center gap-1 rounded-lg border-0 bg-transparent px-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-400 dark:hover:bg-zinc-800">
        {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}<span className="tabular-nums">({emptyRows.length})</span>
      </button>
    </li> : null}
    {open ? emptyRows.map(line) : null}
  </ul>
  {unlotted > 0 ? <p data-popover-unlotted className="mt-1 px-1 tabular-nums text-gray-600 dark:text-gray-300">{tr('inventory_check_unlotted', 'No received date')}: <strong>{unlotted}</strong></p> : null}
  {more ? <p data-popover-more className="mt-1 px-1 leading-relaxed text-amber-800 dark:text-amber-200">{tr('inventory_check_popover_more', 'This product holds more received dates than one count can carry. Count the ones listed.')}</p> : null}
  <div data-popover-total className="mt-1 flex min-w-0 items-center justify-end gap-2 border-t border-gray-100 pt-1 tabular-nums dark:border-gray-800">
    <span className="text-gray-500 dark:text-gray-400">{tr('inventory_check_popover_total', 'Total')}</span>
    <strong data-popover-sum>{sumText}</strong>
    {delta !== null && delta !== 0 ? <span data-popover-delta className="font-semibold text-amber-800 dark:text-amber-200">{signedDelta(delta)}</span> : null}
  </div>
  </>
}
