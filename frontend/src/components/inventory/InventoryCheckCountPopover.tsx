import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import { fmtDateOnly } from '../../utils/formatters.ts'
import type { InventoryCheckLotRow, InventoryCheckLotsAnswer, InventoryCheckProduct, InventoryCheckTranslator } from '../../types/inventoryChecks.ts'
import { lotCountOf, lotTotals, rowSetPlan, type LotDraft } from './inventoryCheckLots.ts'
import { finiteQuantity, parseCount, signedDelta } from './InventoryCheckCountEditor.tsx'

// The count popover of one row (the owner, 14 Nov: "clicking check shows the entries, and you enter there. Make it compact"). It opens from the row's status icon and renders its
// real content from the first paint: the product, the three quick answers (matches stock, does not match, clear), and the entries.
//
// The entries are per received date (batch) when ic_lot_counts is on: the product's batches at this branch are read ONCE when the popover opens (one request, one product, never the page),
// a count box on each, the row total is their sum. A product that holds no batch here (or any viewer / switch state that has none) counts one total. Counts are sellable units only.
// Nothing here shows or reads cost. Typing only changes the page's draft; nothing is written until Submit (or the direct Set of a Full stock adjuster, which confirms its own before and after).

type Lots = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; rows: InventoryCheckLotRow[]; more: boolean }

export type InventoryCheckCountPopoverProps = {
  product: InventoryCheckProduct
  draft: { count: string; lots?: LotDraft; selected: boolean } | undefined
  /** Count per received date: the batches are read when this opens. False: one total (the switch is off, or the viewer cannot see stock). */
  byBatch: boolean
  loadLots?: (product: InventoryCheckProduct, signal: AbortSignal) => Promise<InventoryCheckLotsAnswer>
  canViewStock: boolean
  /** The viewer may read counts: each batch then shows what the latest count typed on it (it survives a reload). */
  canViewCounts?: boolean
  locked: boolean
  t: InventoryCheckTranslator
  statusIcon: ReactNode
  statusText: string
  onClose: () => void
  onCount: (product: InventoryCheckProduct, value: string) => void
  onLotCount: (product: InventoryCheckProduct, row: InventoryCheckLotRow, value: string) => void
  /** Fill the stock figure the person is looking at into every entry (the batches when given, else the total). */
  onMatches: (product: InventoryCheckProduct, rows?: InventoryCheckLotRow[]) => void
  /** "Does not match": the entries are emptied, the row waits for the real count. */
  onDiffers: (product: InventoryCheckProduct) => void
  onClear: (product: InventoryCheckProduct) => void
  /** Full stock adjusters: Set one batch to its typed figure now. Resolves the quantity the batch holds afterwards (its new quantity, or the figure the writer found when the stock had moved), or null when nothing changed. */
  onLotSet?: (product: InventoryCheckProduct, row: InventoryCheckLotRow, value: string) => Promise<number | null>
}

const tool = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 lg:h-9 lg:w-9 dark:text-gray-300 dark:hover:bg-zinc-800'

export default function InventoryCheckCountPopover({ product, draft, byBatch, loadLots, canViewStock, canViewCounts = false, locked, t, statusIcon, statusText, onClose, onCount, onLotCount, onMatches, onDiffers, onClear, onLotSet }: InventoryCheckCountPopoverProps) {
  const tr = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  const [lots, setLots] = useState<Lots>(byBatch && loadLots ? { state: 'loading' } : { state: 'ready', rows: [], more: false })
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // One request when the popover opens. A late answer after it closed is dropped by the abort.
  useEffect(() => {
    if (!byBatch || !loadLots) return undefined
    const abort = new AbortController()
    loadLots(product, abort.signal).then(answer => { if (!abort.signal.aborted) setLots({ state: 'ready', rows: answer.lots ?? [], more: answer.more === true }) },
      () => { if (!abort.signal.aborted) setLots({ state: 'failed' }) })
    return () => abort.abort()
  }, [product.id, byBatch])
  const ready = lots.state === 'ready'
  const rows = lots.state === 'ready' ? lots.rows : []
  const batches = byBatch && rows.length > 0
  // Focus the first entry once the entries exist.
  useEffect(() => { if (ready) bodyRef.current?.querySelector<HTMLInputElement>('input[data-popover-count]')?.focus() }, [ready])

  const stock = finiteQuantity(product.quantity) ? product.quantity : null
  const dated = lotTotals(draft?.lots)
  const total = parseCount(draft?.count ?? '')
  const baseline = dated.dates > 0 ? dated.seen : stock
  const delta = canViewStock && total.kind === 'valid' && typeof baseline === 'number' ? total.value - baseline : null
  const unlotted = batches && !(lots.state === 'ready' && lots.more) && stock !== null ? stock - rows.reduce((sum, row) => sum + row.quantity, 0) : 0
  const idText = (row: InventoryCheckLotRow) => [row.lotCode ? String(row.lotCode) : '', row.batchNumber ? `#${row.batchNumber}` : ''].filter(Boolean).join(' ')

  function onEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.key !== 'Enter') return
    event.preventDefault()
    const inputs = Array.from(bodyRef.current?.querySelectorAll<HTMLInputElement>('input[data-popover-count]') ?? [])
    const at = inputs.indexOf(event.currentTarget)
    const next = inputs[at + 1]
    if (next) { next.focus(); next.select() } else onClose()
  }
  const input = 'h-10 w-[4.5rem] lg:h-9 min-w-0 shrink-0 rounded-lg border px-2 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 read-only:opacity-60 dark:bg-gray-900'

  return <div data-inventory-check-popover={String(product.id)} className="w-[min(21rem,calc(100vw-1rem))] max-w-full p-2 text-xs text-gray-800 dark:text-gray-100">
    <div className="flex min-w-0 items-start gap-1">
      <span data-popover-status title={statusText} aria-label={statusText} role="img" className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center">{statusIcon}</span>
      <span className="min-w-0 flex-1 break-words text-xs font-semibold leading-5">{product.name}</span>
      <button type="button" data-popover-action="close" className={tool} aria-label={tr('close', 'Close')} title={tr('close', 'Close')} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></button>
    </div>
    <div className="mt-1 flex min-w-0 items-center gap-1" data-popover-options>
      {canViewStock && stock !== null ? <button type="button" data-popover-action="matches" disabled={locked || (byBatch && !ready)} className={`${tool} text-emerald-700 dark:text-emerald-300`} aria-label={tr('inventory_check_popover_matches', 'Matches stock')} title={tr('inventory_check_popover_matches', 'Matches stock')}
        onClick={() => onMatches(product, batches ? rows : undefined)}><Check className="h-5 w-5" aria-hidden="true" /></button> : null}
      <button type="button" data-popover-action="differs" disabled={locked || (byBatch && !ready)} className={`${tool} text-red-700 dark:text-red-300`} aria-label={tr('inventory_check_popover_differs', 'Does not match: enter what you counted')} title={tr('inventory_check_popover_differs', 'Does not match: enter what you counted')}
        onClick={() => { onDiffers(product); bodyRef.current?.querySelector<HTMLInputElement>('input[data-popover-count]')?.focus() }}><X className="h-5 w-5" aria-hidden="true" /></button>
      <button type="button" data-popover-action="clear" disabled={locked || !draft} className={tool} aria-label={tr('inventory_check_popover_clear', 'Clear this count')} title={tr('inventory_check_popover_clear', 'Clear this count')} onClick={() => onClear(product)}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
      <span className="min-w-0 flex-1" />
      {canViewStock && stock !== null ? <span data-popover-now className="shrink-0 tabular-nums"><span className="text-gray-500 dark:text-gray-400">{tr('inventory_check_now', 'Now')}</span> <strong>{stock}</strong></span> : null}
    </div>

    <div ref={bodyRef} data-popover-entries className="mt-1 min-w-0">
      {lots.state === 'loading' ? <p data-popover-loading role="status" className="px-1 py-2 text-gray-500 dark:text-gray-400">{tr('inventory_check_popover_loading', 'Loading received dates…')}</p> : null}
      {lots.state === 'failed' ? <p data-popover-failed role="alert" className="px-1 py-2 text-red-700 dark:text-red-300">{tr('inventory_check_popover_failed', 'Received dates could not be loaded. Close and open again.')}</p> : null}
      {ready && batches ? <ul className="min-w-0 space-y-1" aria-label={tr('inventory_check_lot_dates', 'Received dates')}>
        {rows.map(row => {
          const text = draft?.lots?.[String(row.batchId)]?.count ?? ''
          const typed = lotCountOf(text)
          const plan = onLotSet ? rowSetPlan(row, text) : null
          const received = tr('inventory_check_lot_received', 'Received {date}').replace('{date}', row.receivedAt ? fmtDateOnly(row.receivedAt) : '—')
          const identity = idText(row)
          // What the latest count typed on this batch, kept in the session: it is still there after a reload.
          const recorded = canViewCounts ? product.check_lines?.find(line => line.scope === 'lot' && line.batch_id === row.batchId) : undefined
          const setLabel = plan ? tr('inventory_check_lot_set', 'Set to {count}').replace('{count}', String(plan.after)) : ''
          return <li key={row.batchId} data-popover-lot={row.batchId} className="flex min-w-0 items-center gap-x-1.5">
            <span className="min-w-0 flex-1 leading-relaxed">
              <span className="block truncate font-semibold" title={received}>{row.receivedAt ? fmtDateOnly(row.receivedAt) : '—'}{identity ? <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">{identity}</span> : null}</span>
              {row.expiry || recorded ? <span className="flex min-w-0 flex-wrap gap-x-2 text-[11px] text-gray-500 dark:text-gray-400">
                {row.expiry ? <span className="truncate">{tr('expiry', 'Expiry')} {fmtDateOnly(row.expiry)}</span> : null}
                {recorded ? <span data-popover-lot-recorded className="tabular-nums">{tr('inventory_check_counted', 'Counted')} <strong>{recorded.counted}</strong></span> : null}
              </span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400" title={tr('inventory_check_now', 'Now')}>{row.quantity}</span>
            <input data-popover-count data-popover-lot-count={row.batchId} type="text" inputMode="decimal" autoComplete="off" value={text} readOnly={locked} placeholder={String(row.quantity)} aria-label={`${received}: ${product.name}`} aria-invalid={typed.kind === 'invalid' ? true : undefined}
              className={`${input} ${typed.kind === 'invalid' ? 'border-red-500' : typed.kind === 'valid' && typed.value !== row.quantity ? 'border-amber-500' : 'border-gray-300 dark:border-gray-600'}`}
              onChange={event => onLotCount(product, row, event.target.value)} onFocus={event => event.currentTarget.select()} onKeyDown={onEnter} />
            {onLotSet ? <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center lg:h-9 lg:w-9">{plan ? <button type="button" data-popover-action="set-lot" disabled={locked} className={tool} aria-label={`${setLabel}: ${product.name}`} title={setLabel}
              onClick={() => { void onLotSet(product, row, text).then(quantity => { if (typeof quantity === 'number') setLots(previous => previous.state === 'ready' ? { ...previous, rows: previous.rows.map(candidate => candidate.batchId === row.batchId ? { ...candidate, quantity } : candidate) } : previous) }) }}><Save className="h-4 w-4" aria-hidden="true" /></button> : null}</span> : null}
          </li>
        })}
      </ul> : null}
      {ready && batches && unlotted > 0 ? <p data-popover-unlotted className="mt-1 px-1 tabular-nums text-gray-600 dark:text-gray-300">{tr('inventory_check_unlotted', 'No received date')}: <strong>{unlotted}</strong></p> : null}
      {ready && batches && lots.state === 'ready' && lots.more ? <p data-popover-more className="mt-1 px-1 leading-relaxed text-amber-800 dark:text-amber-200">{tr('inventory_check_popover_more', 'This product holds more received dates than one count can carry. Count the ones listed.')}</p> : null}
      {ready && !batches ? <div data-popover-single className="flex min-w-0 items-center gap-x-1.5 px-0.5">
        <span className="min-w-0 flex-1 font-semibold">{tr('inventory_check_popover_total', 'Total')}</span>
        <input data-popover-count data-popover-total type="text" inputMode="decimal" autoComplete="off" value={draft?.count ?? ''} readOnly={locked} placeholder={canViewStock && stock !== null ? String(stock) : ''} aria-label={`${tr('inventory_check_count', 'Count')}: ${product.name}`} aria-invalid={total.kind === 'invalid' ? true : undefined}
          className={`${input} ${total.kind === 'invalid' ? 'border-red-500' : delta !== null && delta !== 0 ? 'border-amber-500' : 'border-gray-300 dark:border-gray-600'}`}
          onChange={event => onCount(product, event.target.value)} onFocus={event => event.currentTarget.select()} onKeyDown={onEnter} />
      </div> : null}
    </div>

    {ready && batches ? <div data-popover-total className="mt-1 flex min-w-0 items-center justify-end gap-2 border-t border-gray-100 pt-1 tabular-nums dark:border-gray-800">
      <span className="text-gray-500 dark:text-gray-400">{tr('inventory_check_popover_total', 'Total')}</span>
      <strong data-popover-sum>{dated.dates > 0 && dated.valid ? dated.counted : '—'}</strong>
      {delta !== null && delta !== 0 ? <span data-popover-delta className="font-semibold text-amber-800 dark:text-amber-200">{signedDelta(delta)}</span> : null}
    </div> : null}
  </div>
}
