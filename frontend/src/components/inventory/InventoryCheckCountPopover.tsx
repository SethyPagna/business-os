import { Component, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { InventoryCheckLotRow, InventoryCheckLotsAnswer, InventoryCheckProduct, InventoryCheckTranslator } from '../../types/inventoryChecks.ts'
import { lotTotals, type LotDraft } from './inventoryCheckLots.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import { loadLotEntries } from './inventoryCheckLotChunk.ts'
// The per-received-date entries are code only a viewer with ic_lot_counts on needs: they load as their own chunk, started when the list draws (preloadLotEntries), so they are there before any tap.
// lazyRetry: a failed or slow chunk is retried quietly and recovered by the project's own rules (never a reload while counts are unsubmitted: the page registers them as dirty work). Anything it still throws
// is caught by LotEntriesBoundary below, so a chunk that will not load can never take the page down or lose the counts typed (they live in the page's drafts, not in this popover).
const newLotEntries = () => lazyRetry(loadLotEntries, 'inventory-check-lot-entries')
let InventoryCheckLotEntries = newLotEntries()
// A warm-up only: its failure is swallowed (the popover's own load retries and reports).
export const preloadLotEntries = (): void => { loadLotEntries().catch(() => {}) }
class LotEntriesBoundary extends Component<{ failed: (retry: () => void) => ReactNode; onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.failed(() => { this.props.onRetry(); this.setState({ failed: false }) }) : this.props.children }
}
import { finiteQuantity, parseCount } from './InventoryCheckCountEditor.tsx'

// The count popover of one row (the owner, 14 Nov: "clicking check shows the entries, and you enter there. Make it compact"). It opens from the row's status icon and renders its
// real content from the first paint: the product, the three quick answers (matches stock, does not match, clear), and the entries.
//
// The entries are per received date (batch) when ic_lot_counts is on: the product's batches at this branch are read ONCE when the popover opens (one request, one product, never the page),
// a count box on each, the row total is their sum. A product that holds no batch here (or any viewer / switch state that has none) counts one total. Counts are sellable units only.
// Nothing here shows or reads cost. Typing only changes the page's draft; nothing is written until Submit (or the direct Set of a Full stock adjuster, which confirms its own before and after).

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
  /** The status in words (what the icon means), printed in the header: a tooltip never shows on touch. */
  statusWord?: string
  /** A count waits for approval: the status recorded before it (issue, OK), which the pending icon hides. */
  recordedWord?: string
  onClose: () => void
  /** Where keyboard focus goes when the popover closes by any path (the row's status icon), unless the person has deliberately moved into another field. */
  returnFocus?: () => void
  /** Enter in the last entry: the popover closes and the list moves on to the next row. */
  onAdvance?: () => void
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

export default function InventoryCheckCountPopover({ product, draft, byBatch, loadLots, canViewStock, canViewCounts = false, locked, t, statusIcon, statusText, statusWord, recordedWord, onClose, returnFocus, onAdvance, onCount, onLotCount, onMatches, onDiffers, onClear, onLotSet }: InventoryCheckCountPopoverProps) {
  const tr = (key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
  // The row already carries its stocked batches (the list read them): the entries are drawn from them at the first paint, with no request. Only a row that says lots_more, or a list that did not carry
  // batches, reads them (one request, this product). A row that was changed on another device after the list was read (lots_stale) reads them too: a stock-in there adds a date this row does not carry.
  const carried = Array.isArray(product.lot_rows) && product.lots_more !== true && product.lots_stale !== true
  // Counting per date at all (switch on, a way to read the dates): everything that is only for that (reading the dates, the loading and failed lines, the Set, the unlotted units) lives in the entries chunk.
  // The first paint without it (switch OFF, or a viewer who cannot see stock) is the one Total box below, in this chunk.
  const perBatch = byBatch && !!loadLots
  // The counted dates the header needs (the Matches stock tick, the Total box): the row's own at the first paint, null while the entries have not reported them, [] when there is no per-date counting.
  const [dates, setDates] = useState<InventoryCheckLotRow[] | null>(!perBatch ? [] : carried ? product.lot_rows! : null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // A retry builds a new lazy component (a rejected one stays rejected); the key makes the entries mount again.
  const [entriesTry, setEntriesTry] = useState(0)
  // Every way out (X, Enter in the last entry, a tap outside, Escape) unmounts this popover, and the unmount returns focus to the status icon: the focused entry has just left the page, so focus would
  // otherwise fall to the body. When it is on any field that is still on the page the person went there on purpose (a tap into another input), and it stays.
  const giveFocusBack = useRef(returnFocus)
  giveFocusBack.current = returnFocus
  // A tap outside closes on mousedown and the browser then blurs the page on that same press, after this runs: so it is checked again on the next frame.
  useEffect(() => () => {
    const back = giveFocusBack.current
    const check = () => {
      const active = document.activeElement
      if (!active || active === document.body || active === document.documentElement || !document.body.contains(active)) back?.()
    }
    check()
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(check)
  }, [])
  const ready = dates !== null
  const rows = dates ?? []
  const batches = byBatch && rows.length > 0
  // Focus the first entry once the entries exist.
  useEffect(() => { if (ready) bodyRef.current?.querySelector<HTMLInputElement>('input[data-popover-count]')?.focus() }, [ready])

  const stock = finiteQuantity(product.quantity) ? product.quantity : null
  const dated = lotTotals(draft?.lots)
  const total = parseCount(draft?.count ?? '')
  const baseline = dated.dates > 0 ? dated.seen : stock
  const delta = canViewStock && total.kind === 'valid' && typeof baseline === 'number' ? total.value - baseline : null

  function onEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.key !== 'Enter') return
    event.preventDefault()
    const inputs = Array.from(bodyRef.current?.querySelectorAll<HTMLInputElement>('input[data-popover-count]') ?? [])
    const at = inputs.indexOf(event.currentTarget)
    const next = inputs[at + 1]
    if (next) { next.focus(); next.select() } else { onClose(); onAdvance?.() }
  }
  const input = 'h-10 w-[4.5rem] lg:h-9 min-w-0 shrink-0 rounded-lg border px-2 text-right text-xs tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 read-only:opacity-60 dark:bg-gray-900'

  return <div data-inventory-check-popover={String(product.id)} role="dialog" aria-label={tr('inventory_check_open_count', 'Check and count: {name}').replace('{name}', product.name)} className="w-[min(21rem,calc(100vw-1rem))] max-w-full p-2 text-xs text-gray-800 dark:text-gray-100">
    <div className="flex min-w-0 items-start gap-1">
      <span data-popover-status title={statusText} aria-label={statusText} role="img" className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center">{statusIcon}</span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-xs font-semibold leading-5">{product.name}</span>
        {statusWord ? <span data-popover-status-word className="block break-words text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{statusWord}{recordedWord ? <span data-popover-recorded-word> · {recordedWord}</span> : null}</span> : null}
      </span>
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
      {perBatch ? <LotEntriesBoundary key={entriesTry} onRetry={() => { InventoryCheckLotEntries = newLotEntries(); setEntriesTry(value => value + 1) }}
        failed={retry => <p data-popover-chunk-failed role="alert" className="flex items-center gap-1 px-1 py-2 text-red-700 dark:text-red-300"><span className="min-w-0 flex-1 break-words">{tr('inventory_check_popover_chunk_failed', 'The received dates could not load. Your counts are kept.')}</span>
          <button type="button" data-popover-action="retry-entries" className={tool} aria-label={tr('retry', 'Retry')} title={tr('retry', 'Retry')} onClick={retry}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button></p>}>
        <Suspense fallback={<p data-popover-loading role="status" className="px-1 py-2 text-gray-500 dark:text-gray-400">{tr('inventory_check_popover_loading', 'Loading received dates…')}</p>}><InventoryCheckLotEntries product={product} loadLots={loadLots!} carried={carried} onDates={setDates} draftLots={draft?.lots} canViewCounts={canViewCounts} locked={locked} tr={tr} inputClass={input} toolClass={tool}
        sumText={dated.dates > 0 && dated.valid ? String(dated.counted) : '—'} delta={delta} onLotCount={(row, value) => onLotCount(product, row, value)} onEnter={onEnter} onSet={onLotSet} /></Suspense></LotEntriesBoundary> : null}
      {ready && !batches ? <div data-popover-single className="flex min-w-0 items-center gap-x-1.5 px-0.5">
        <span className="min-w-0 flex-1 font-semibold">{tr('inventory_check_popover_total', 'Total')}</span>
        <input data-popover-count data-popover-total type="text" inputMode="decimal" autoComplete="off" value={draft?.count ?? ''} readOnly={locked} placeholder={canViewStock && stock !== null ? String(stock) : ''} aria-label={`${tr('inventory_check_count', 'Count')}: ${product.name}`} aria-invalid={total.kind === 'invalid' ? true : undefined}
          className={`${input} ${total.kind === 'invalid' ? 'border-red-500' : delta !== null && delta !== 0 ? 'border-amber-500' : 'border-gray-300 dark:border-gray-600'}`}
          onChange={event => onCount(product, event.target.value)} onFocus={event => event.currentTarget.select()} onKeyDown={onEnter} />
      </div> : null}
    </div>

  </div>
}
