import { useEffect, useRef, type KeyboardEvent } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Minus from 'lucide-react/dist/esm/icons/minus.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { InventoryCheckTranslator } from '../../types/inventoryChecks.ts'
import { SCAN_GUARD_PROPS } from '../../utils/scannerWedge.ts'

export type CountEntry = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'valid'; value: number }

export function finiteQuantity(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Typed count text: blank is "no count", anything that is not a non-negative decimal is invalid (never zero). */
export function parseCount(text: string): CountEntry {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'empty' }
  const value = Number(trimmed)
  return /^\d*(?:\.\d*)?$/.test(trimmed) && Number.isFinite(value) && value >= 0 ? { kind: 'valid', value } : { kind: 'invalid' }
}

/** A count equals stock only for someone who can see stock; the server re-checks it against live stock. */
export function countMatchesStock(entry: CountEntry, stock: number | null | undefined, canViewStock: boolean): boolean {
  return canViewStock && entry.kind === 'valid' && finiteQuantity(stock) && entry.value === stock
}

/** One stepper press: from the typed count, else from stock, else from zero. Never below zero. */
export function stepCount(text: string, delta: number, stock: number | null | undefined): string {
  const entry = parseCount(text)
  const base = entry.kind === 'valid' ? entry.value : finiteQuantity(stock) ? stock : 0
  return String(Math.max(0, Math.round((base + delta) * 10000) / 10000))
}

/** −2, +3, 0: the size of a difference, with a real minus sign. */
export function signedDelta(delta: number): string {
  const rounded = Math.round(delta * 10000) / 10000
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `−${Math.abs(rounded)}` : '0'
}

/** Up to eight distinct suggestions, case-insensitively, in the order given. */
export function reasonChips(suggestions: readonly string[], limit = 8): string[] {
  const seen = new Set<string>()
  const chips: string[] = []
  for (const suggestion of suggestions) {
    const text = String(suggestion ?? '').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    chips.push(text)
    if (chips.length === limit) break
  }
  return chips
}

type Props = {
  productName: string
  groupLabel: string
  countId: string
  reasonId: string
  count: string
  reason: string
  stock?: number | null
  canViewStock: boolean
  canViewCounts: boolean
  suggestions: readonly string[]
  busy: boolean
  /** A save was refused or lost: the primary button resends the draft as Retry. */
  failed: boolean
  /** Field that takes focus when the editor opens; null leaves focus alone (no keyboard pop-up on a phone). */
  focus: 'count' | 'reason' | null
  t: InventoryCheckTranslator
  onCount: (value: string) => void
  onReason: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}

const boxButton = 'inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 lg:h-10 lg:min-h-10 lg:w-10 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-zinc-800'
const fieldClass = 'h-11 min-h-11 min-w-0 rounded-lg border border-gray-300 px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 read-only:opacity-60 lg:h-10 lg:min-h-10 dark:border-gray-600 dark:bg-gray-900'

/**
 * The issue editor of one count row: a stepper with the difference from stock, a reason with recent-reason chips,
 * and one primary button that is Done when the count equals stock and no reason is given, Save (as an issue) otherwise.
 * Labels live inside the inputs; the draft itself belongs to the row, so a failed save keeps every value.
 */
export default function InventoryCheckCountEditor({ productName, groupLabel, countId, reasonId, count, reason, stock, canViewStock, canViewCounts, suggestions, busy, failed, focus, t, onCount, onReason, onSubmit, onCancel }: Props) {
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const countRef = useRef<HTMLInputElement | null>(null)
  const reasonRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const field = focus === 'count' ? countRef.current : focus === 'reason' ? reasonRef.current : null
    field?.focus()
    field?.select()
  }, [])

  const entry = parseCount(count)
  const done = countMatchesStock(entry, stock, canViewStock) && reason.trim() === ''
  const difference = entry.kind === 'valid' && canViewStock && finiteQuantity(stock) ? entry.value - stock : null
  const chips = reasonChips(suggestions)
  const retryLabel = tr('inventory_check_retry', 'Retry')
  const doneLabel = tr('done', 'Done')
  const saveLabel = tr('inventory_check_save_issue', 'Save issue')
  const submitName = failed ? retryLabel : done ? doneLabel : saveLabel
  const countLabel = tr('inventory_check_count', 'Count')
  const reasonLabel = tr('inventory_check_reason', 'Reason')
  const differenceLabel = tr('inventory_check_difference', 'Difference')
  const decrease = tr('decreaseQty', 'Decrease quantity')
  const increase = tr('increaseQty', 'Increase quantity')
  const cancel = tr('inventory_check_cancel', 'Cancel')

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, field: 'count' | 'reason') {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); return }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (field === 'count' && !done) reasonRef.current?.focus()
    else onSubmit()
  }

  return <div role="group" aria-label={groupLabel} data-inventory-check-editor className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg bg-gray-50 p-2 dark:bg-gray-800/50">
    {canViewCounts ? <div className="flex shrink-0 items-center gap-1">
      <button type="button" disabled={busy} aria-label={decrease} title={decrease} className={boxButton} onClick={() => onCount(stepCount(count, -1, stock))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
      <input ref={countRef} id={countId} type="text" inputMode="decimal" autoComplete="off" value={count} readOnly={busy} placeholder={countLabel} aria-label={`${countLabel}: ${productName}`}
        className={`${fieldClass} w-20 text-center tabular-nums`} onChange={event => onCount(event.target.value)} onFocus={event => event.currentTarget.select()} onKeyDown={event => onKeyDown(event, 'count')} />
      <button type="button" disabled={busy} aria-label={increase} title={increase} className={boxButton} onClick={() => onCount(stepCount(count, 1, stock))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
      {difference === null ? null : <span role="img" aria-label={`${differenceLabel}: ${signedDelta(difference)}`} title={`${differenceLabel}: ${signedDelta(difference)}`}
        className={`inline-flex min-w-8 items-center justify-center text-xs font-semibold tabular-nums ${difference === 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
        {difference === 0 ? <Check className="h-4 w-4" aria-hidden="true" /> : signedDelta(difference)}
      </span>}
    </div> : null}
    <div className="flex min-w-0 flex-1 basis-64 items-center gap-1">
      <input ref={reasonRef} id={reasonId} type="text" autoComplete="off" value={reason} readOnly={busy} placeholder={reasonLabel} aria-label={`${reasonLabel}: ${productName}`}
        className={`${fieldClass} flex-1`} onChange={event => onReason(event.target.value)} onKeyDown={event => onKeyDown(event, 'reason')} {...SCAN_GUARD_PROPS} />
      <button type="button" disabled={busy} aria-label={cancel} title={cancel} className={boxButton} onClick={onCancel}><X className="h-4 w-4" aria-hidden="true" /></button>
      <button type="button" data-check-submit={failed ? 'retry' : done ? 'done' : 'issue'} disabled={busy} aria-label={submitName} title={submitName}
        className="btn-primary inline-flex h-11 min-h-11 shrink-0 items-center gap-1 px-3 text-xs lg:h-10 lg:min-h-10" onClick={onSubmit}>
        {failed ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : done ? <Check className="h-4 w-4" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
        {failed ? retryLabel : done ? doneLabel : tr('save', 'Save')}
      </button>
    </div>
    {chips.length ? <div className="scroll-x-clean basis-full" role="group" aria-label={tr('inventory_check_reason_suggestions', 'Recent reasons')}>
      <span className="inline-flex gap-1.5 pr-1">
        {chips.map(chip => <button key={chip} type="button" disabled={busy} aria-pressed={reason.trim().toLowerCase() === chip.toLowerCase()}
          className="inline-flex h-8 shrink-0 items-center rounded-full border border-gray-300 px-3 text-xs leading-relaxed text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 aria-pressed:border-amber-500 aria-pressed:bg-amber-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-zinc-800 dark:aria-pressed:bg-amber-950/40"
          onClick={() => { onReason(chip); reasonRef.current?.focus() }}>{chip}</button>)}
      </span>
    </div> : null}
  </div>
}
