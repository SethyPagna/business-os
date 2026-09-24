import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { helpPopoverGeometry } from '../../utils/helpPopoverGeometry.ts'
import AppSelect from './AppSelect.tsx'
import { useCopyFloat, type CopyFloatProps } from './CopyFloat.tsx'
import InfoHint from './InfoHint.tsx'
import ProductNameRail from './ProductNameRail.tsx'
import SuggestionTextInput from './SuggestionTextInput.tsx'
import { COPY_SELECTOR, deferCopySurfaceAction } from './textAffordances.ts'

// The one conflict resolver's grid (owner ruling, 24 Sep 2026): "just one
// button, resolve ... when press, it should show as excel style then options
// select etc... then the last column is the final what it looks like ... fit
// in all devices. if too longer can do scroll left and right, or can do fixed
// and each segments scroll left and right".
//
// One row per field, one column per record, Final pinned on the right and the
// field labels pinned on the left; only the record columns scroll sideways.
// On a phone exactly one record sits between the pinned pair and the rest
// snap in from the side ("2 / 4" plus chevrons says where you are).
//
// PURE on purpose: no fetching, no draft state. The host (ResolveModal) owns
// the draft and an adapter turns it into `columns` and `rows`, so products and
// contacts plug in without touching this file. Every row therefore arrives
// with its EFFECTIVE choice already worked out -- a default the adapter
// derived (the kept record's name) highlights exactly like an explicit pick,
// and the grid never has to know the difference.
//
// Keep separate / Merge in / Remove is a per-column disposition INSIDE the
// grid (council D4): there is no second button beside Resolve.

export type ResolveDisposition = 'include' | 'separate' | 'remove'
export type ResolveChoice = { source: string } | { option: string } | { custom: string }
/** The draft's explicit choices: row keys, and resolveCellKey() keys for per-record options. */
export type ResolveSelection = Record<string, ResolveChoice | undefined>

export type ResolveOption = {
  id: string
  label: string
  disabledReason?: string
  /** Picking this option changes a column's disposition instead of a value
   *  (council D1: "Keep this product separate" inside a required row). The
   *  adapter reports it as the row's choice once the column says so. */
  disposition?: { column: string; value: ResolveDisposition }
}

export type ResolveCell = {
  /** Plain value: compared, copied, announced. Money arrives formatted. */
  text: string
  display?: ReactNode
  invalid?: boolean
  masked?: boolean
  disabledReason?: string
  /** Record cells only: per-record choices (D3 Carry / Write off on Stock). */
  options?: ResolveOption[]
  /** Record cells only: the chosen id among `options`. */
  choice?: string
}

export type ResolveRow = {
  key: string
  label: string
  /** Explanation behind an InfoHint on the label. */
  hint?: string
  /** choice: pick a record's value; computed: the adapter works Final out;
   *  required: like choice, but Resolve waits until it has an answer. */
  kind: 'choice' | 'computed' | 'required'
  cells: Record<string, ResolveCell>
  /** Row-level answers shown in Final: "No barcode", "Average", ... */
  options?: ResolveOption[]
  /** The record cells are information only; the row is answered through `options`. */
  optionsOnly?: boolean
  /** Final can be typed. Text and suggest prefill the current Final. */
  custom?: {
    kind: 'text' | 'money' | 'suggest'
    suggestions?: string[]
    normalize?: (value: string) => string
    validate?: (value: string) => string | null
  }
  final: ResolveCell
  /** The effective choice (explicit or the adapter's default); none = unanswered. */
  choice?: ResolveChoice
  /** Every included record holds the same value: the row folds away. */
  identical: boolean
  /** Why the row cannot be changed (for example cost edit permission). */
  locked?: string
  /** Values are names, brands, suppliers or barcodes: copy float on them. */
  copyable?: boolean
}

export type ResolveColumn = {
  id: string
  title: string
  subtitle?: string
  disposition: ResolveDisposition
  dispositions: ResolveDisposition[]
  disabledReason?: string
  warning?: string
  removeReason?: string
}

export type ResolveGridProps = {
  columns: ResolveColumn[]
  rows: ResolveRow[]
  onSelect: (key: string, choice: ResolveChoice) => void
  onDisposition: (columnId: string, disposition: ResolveDisposition, reason?: string) => void
  /** resolveCellKey() keys whose value moved since the records were first read. */
  changedCells?: ReadonlySet<string>
  busy?: boolean
  t: (key: string) => string
}

export const RESOLVE_FINAL_COLUMN = '#final'
const FOLD_KEY = '#fold'
const DISPOSITION_ORDER: Record<ResolveDisposition, number> = { include: 0, separate: 1, remove: 2 }
const EMPTY_CELL: ResolveCell = { text: '' }

/** Row and column ids must not contain '|'. */
export function resolveCellKey(rowKey: string, columnId: string): string {
  return `${rowKey}|${columnId}`
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

function chosenSource(choice: ResolveChoice | undefined): string | null {
  return choice && 'source' in choice ? choice.source : null
}

function chosenOption(choice: ResolveChoice | undefined): string | null {
  return choice && 'option' in choice ? choice.option : null
}

function customValue(choice: ResolveChoice | undefined): string | null {
  return choice && 'custom' in choice ? choice.custom : null
}

// Only the copy marker: the float's own tabIndex/role/aria-label would add a
// second tab stop inside a cell that is already one, and the keyboard copy
// path must never claim Enter/Space from the cell (see textAffordances.ts).
function copyMarker(props: CopyFloatProps) {
  return { 'data-copy-value': props['data-copy-value'], 'data-copy-success': props['data-copy-success'], title: props.title }
}

type Stop = { key: string; col: number }
type EditorState = { rowKey: string; value: string; error: string | null }
type EditorBox = { left: number; top: number; width: number; above: boolean; host: Element }

export default function ResolveGrid({ columns, rows, onSelect, onDisposition, changedCells, busy = false, t }: ResolveGridProps) {
  const tr = useCallback((key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }, [t])
  const copyProps = useCopyFloat(tr)
  const gridId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const theadRef = useRef<HTMLTableSectionElement | null>(null)
  const editorRef = useRef<HTMLDivElement | null>(null)
  // False from the moment the editor starts closing: moving focus back to the
  // cell blurs the input, and that blur must not commit what Escape discarded.
  const editorOpen = useRef(false)
  const pendingAnnounce = useRef<string | null>(null)
  const [showMatching, setShowMatching] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditorState | null>(null)
  const [editorBox, setEditorBox] = useState<EditorBox | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [pager, setPager] = useState({ start: 0, perView: 1, step: 0 })

  // Keep separate and Remove columns move to the end, in their given order.
  const ordered = useMemo(() => columns
    .map((column, index) => ({ column, index }))
    .sort((a, b) => DISPOSITION_ORDER[a.column.disposition] - DISPOSITION_ORDER[b.column.disposition] || a.index - b.index)
    .map(({ column }) => column), [columns])

  // A row folds when every included record agrees -- unless it still needs an
  // answer, carries a typed value, or moved under a stale re-read.
  const foldable = useCallback((row: ResolveRow): boolean => {
    if (!row.identical || row.kind === 'required' || customValue(row.choice) !== null) return false
    if (!changedCells?.size) return true
    if (changedCells.has(resolveCellKey(row.key, RESOLVE_FINAL_COLUMN))) return false
    return !ordered.some((column) => changedCells.has(resolveCellKey(row.key, column.id)))
  }, [changedCells, ordered])

  const foldedCount = useMemo(() => rows.filter(foldable).length, [rows, foldable])
  const shown = useCallback((row: ResolveRow) => showMatching || !foldable(row), [showMatching, foldable])

  const cellOptions = useCallback((row: ResolveRow, column: ResolveColumn): ResolveOption[] => (
    column.disposition === 'include' && !column.disabledReason ? row.cells[column.id]?.options ?? [] : []
  ), [])

  // Roving tabindex: one tab stop for the whole grid, arrows move between
  // cells. Option chips are stops right after the cell that holds them.
  const navRows = useMemo(() => {
    const out: Stop[][] = []
    for (const row of rows) {
      if (!shown(row)) continue
      const stops: Stop[] = []
      ordered.forEach((column, index) => {
        const key = resolveCellKey(row.key, column.id)
        stops.push({ key, col: index })
        for (const option of cellOptions(row, column)) stops.push({ key: `${key}|${option.id}`, col: index })
      })
      const finalKey = resolveCellKey(row.key, RESOLVE_FINAL_COLUMN)
      stops.push({ key: finalKey, col: ordered.length })
      for (const option of row.options ?? []) stops.push({ key: `${finalKey}|${option.id}`, col: ordered.length })
      out.push(stops)
    }
    if (foldedCount) out.push([{ key: FOLD_KEY, col: 0 }])
    return out
  }, [rows, ordered, shown, cellOptions, foldedCount])

  const currentKey = useMemo(() => {
    if (activeKey && navRows.some((stops) => stops.some((stop) => stop.key === activeKey))) return activeKey
    return navRows[0]?.[0]?.key ?? null
  }, [activeKey, navRows])

  const focusKey = useCallback((key: string) => {
    setActiveKey(key)
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-rg-key="${CSS.escape(key)}"]`)
    if (!target) return
    // focus() alone counts a cell sitting under the pinned Final column as
    // already visible; scrollIntoView honours the scroller's scroll-padding.
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLTableElement>) => {
    const key = (event.target as HTMLElement).getAttribute('data-rg-key')
    if (!key) return // header menus, reason inputs and hints keep their own keys
    let rowIndex = -1
    let stopIndex = -1
    navRows.forEach((stops, index) => {
      const found = stops.findIndex((stop) => stop.key === key)
      if (found >= 0) { rowIndex = index; stopIndex = found }
    })
    if (rowIndex < 0) return
    const stops = navRows[rowIndex]
    let next: Stop | undefined
    if (event.key === 'ArrowRight') next = stops[stopIndex + 1]
    else if (event.key === 'ArrowLeft') next = stops[stopIndex - 1]
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const adjacent = navRows[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)]
      const col = stops[stopIndex].col
      next = adjacent?.find((stop) => stop.col === col)
        ?? adjacent?.reduce((best, stop) => (Math.abs(stop.col - col) < Math.abs(best.col - col) ? stop : best))
    } else if (event.key === 'Home') {
      next = event.ctrlKey || event.metaKey ? navRows[0][0] : stops[0]
    } else if (event.key === 'End') {
      const lastRow = navRows[navRows.length - 1]
      next = event.ctrlKey || event.metaKey ? lastRow[lastRow.length - 1] : stops[stops.length - 1]
    } else return
    event.preventDefault()
    if (next && next.key !== key) focusKey(next.key)
  }

  const handleGridFocus = (event: ReactFocusEvent<HTMLTableElement>) => {
    const key = (event.target as HTMLElement).getAttribute('data-rg-key')
    if (key) setActiveKey(key)
  }

  // "Final brand: MAC" once the adapter has worked the new Final out.
  useEffect(() => {
    const key = pendingAnnounce.current
    if (!key) return
    pendingAnnounce.current = null
    const row = rows.find((item) => item.key === key)
    if (!row) return
    const value = row.kind === 'required' && !row.choice ? tr('resolve_choose', 'Choose one') : row.final.text || tr('resolve_empty', 'Empty')
    setAnnouncement(fill(tr('resolve_final_announce', 'Final {field}: {value}'), { field: row.label, value }))
  }, [rows, tr])

  const pickSource = (row: ResolveRow, column: ResolveColumn) => {
    if (busy) return
    pendingAnnounce.current = row.key
    onSelect(row.key, { source: column.id })
  }

  const pickOption = (row: ResolveRow, option: ResolveOption, column?: ResolveColumn) => {
    if (busy || option.disabledReason || row.locked) return
    pendingAnnounce.current = row.key
    if (option.disposition) onDisposition(option.disposition.column, option.disposition.value)
    else onSelect(column ? resolveCellKey(row.key, column.id) : row.key, { option: option.id })
  }

  // A press that starts on a copyable value waits out the double-click
  // window, so a double-click copies instead of also picking the cell.
  const surfaceClick = (event: ReactMouseEvent<HTMLElement>, action: () => void) => {
    const copyTarget = (event.target as Element | null)?.closest?.(COPY_SELECTOR)
    if (copyTarget && event.currentTarget.contains(copyTarget)) deferCopySurfaceAction(copyTarget, action)
    else action()
  }

  // ---- Final editor: a popover anchored to the Final cell. It lives outside
  // the scroller so the suggestion list is never clipped by it, and opening it
  // shifts no row, so the click that closes it still lands where aimed.
  const editingRow = editing ? rows.find((row) => row.key === editing.rowKey) ?? null : null
  const editingRowKey = editing?.rowKey ?? null

  const openEditor = (row: ResolveRow) => {
    if (busy || !row.custom || row.locked) return
    const typed = customValue(row.choice)
    editorOpen.current = true
    setEditing({ rowKey: row.key, value: typed ?? (row.custom.kind === 'money' ? '' : row.final.text), error: null })
  }

  const closeEditor = (refocus: boolean) => {
    editorOpen.current = false
    setEditing(null)
    setEditorBox(null)
    if (refocus && editingRowKey) focusKey(resolveCellKey(editingRowKey, RESOLVE_FINAL_COLUMN))
  }

  const commitEditor = (override?: string, refocus = true) => {
    if (!editorOpen.current || !editing || !editingRow?.custom) return
    const spec = editingRow.custom
    const raw = override ?? editing.value
    const value = spec.normalize ? spec.normalize(raw) : raw.trim()
    // Opening Final and leaving it untouched keeps the record pick: the
    // prefilled text is not a typed value.
    const typed = customValue(editingRow.choice)
    if (!value || value === typed || (typed === null && value === editingRow.final.text)) { closeEditor(refocus); return }
    const error = spec.validate?.(value) ?? null
    if (error) { setEditing({ ...editing, value: raw, error }); return }
    pendingAnnounce.current = editingRow.key
    onSelect(editingRow.key, { custom: value })
    closeEditor(refocus)
  }

  useEffect(() => {
    if (editing && (!editingRow || busy)) { editorOpen.current = false; setEditing(null); setEditorBox(null) }
  }, [editing, editingRow, busy])

  const placeEditor = useCallback(() => {
    if (!editingRowKey) return
    const cell = rootRef.current?.querySelector<HTMLElement>(`[data-rg-key="${CSS.escape(resolveCellKey(editingRowKey, RESOLVE_FINAL_COLUMN))}"]`)
    if (!cell) return
    const viewport = window.visualViewport
    const box = helpPopoverGeometry(cell.getBoundingClientRect(), {
      left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
      width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight,
    }, 'right')
    // Inside the host dialog, so the popover stays inside its aria-modal
    // boundary and above its panel.
    const host = cell.closest('[role="dialog"]') ?? document.body
    setEditorBox({ left: box.left, top: box.top, width: box.width, above: box.placement === 'above', host })
  }, [editingRowKey])

  useLayoutEffect(() => { placeEditor() }, [placeEditor])

  useEffect(() => {
    if (!editingRowKey) return undefined
    window.addEventListener('resize', placeEditor)
    window.addEventListener('scroll', placeEditor, true)
    window.visualViewport?.addEventListener('resize', placeEditor)
    window.visualViewport?.addEventListener('scroll', placeEditor)
    return () => {
      window.removeEventListener('resize', placeEditor)
      window.removeEventListener('scroll', placeEditor, true)
      window.visualViewport?.removeEventListener('resize', placeEditor)
      window.visualViewport?.removeEventListener('scroll', placeEditor)
    }
  }, [editingRowKey, placeEditor])

  // ---- Pager and sticky header height, measured from the laid-out table.
  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    const head = theadRef.current
    if (!scroller || !head) return
    scroller.style.setProperty('--rg-head', `${head.offsetHeight}px`)
    const step = head.querySelector<HTMLElement>('th.rg-cell')?.offsetWidth ?? 0
    const label = head.querySelector<HTMLElement>('th.rg-label')?.offsetWidth ?? 0
    const final = head.querySelector<HTMLElement>('th.rg-final')?.offsetWidth ?? 0
    if (!step) return
    const perView = Math.max(1, Math.floor((scroller.clientWidth - label - final + 2) / step))
    const start = Math.min(Math.max(0, ordered.length - perView), Math.max(0, Math.round(scroller.scrollLeft / step)))
    setPager((current) => (current.start === start && current.perView === perView && current.step === step ? current : { start, perView, step }))
  }, [ordered.length])

  useLayoutEffect(() => { measure() }, [measure, rows, columns, showMatching])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return undefined
    let frame = 0
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; measure() })
    }
    scroller.addEventListener('scroll', schedule, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(scroller)
    if (theadRef.current) observer?.observe(theadRef.current)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      observer?.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [measure])

  // React 18 drops a boolean `inert` prop, so set the property directly.
  useEffect(() => {
    if (rootRef.current) rootRef.current.inert = busy
  }, [busy])

  const page = (direction: 1 | -1) => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scrollerRef.current?.scrollBy({ left: direction * pager.step, behavior: reduced ? 'auto' : 'smooth' })
  }

  const dispositionLabel = (disposition: ResolveDisposition): string => (
    disposition === 'include' ? tr('resolve_disposition_include', 'Merge in')
      : disposition === 'separate' ? tr('resolve_disposition_separate', 'Keep separate')
        : tr('remove', 'Remove')
  )

  const renderValue = (cell: ResolveCell, row: ResolveRow): ReactNode => {
    if (cell.masked) return <span className="italic text-gray-500 dark:text-gray-400">{tr('resolve_hidden', 'Hidden')}</span>
    const body = cell.display ?? (cell.text || (
      <>
        <span aria-hidden="true" className="text-gray-400">—</span>
        <span className="sr-only">{tr('resolve_empty', 'Empty')}</span>
      </>
    ))
    const content = row.copyable && cell.text ? <span {...copyMarker(copyProps(cell.text))}>{body}</span> : body
    return cell.invalid ? <s className="text-gray-500 dark:text-gray-400">{content}</s> : content
  }

  const renderChips = (row: ResolveRow, options: ResolveOption[], column?: ResolveColumn) => {
    const baseKey = resolveCellKey(row.key, column ? column.id : RESOLVE_FINAL_COLUMN)
    const selected = column ? row.cells[column.id]?.choice ?? null : chosenOption(row.choice)
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {options.map((option) => {
          const key = `${baseKey}|${option.id}`
          const pressed = selected === option.id
          const disabled = Boolean(option.disabledReason || row.locked)
          return (
            <span key={option.id} className="inline-flex max-w-full items-center gap-0.5">
              <button
                type="button"
                data-rg-key={key}
                tabIndex={key === currentKey ? 0 : -1}
                aria-pressed={pressed}
                aria-disabled={disabled || undefined}
                className={`inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-left text-xs font-medium ${pressed
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-100'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                onClick={(event) => { event.stopPropagation(); pickOption(row, option, column) }}
              >
                {pressed ? <Check aria-hidden="true" className="h-3 w-3 shrink-0" /> : null}
                <span className="min-w-0">{option.label}</span>
              </button>
              {option.disabledReason ? <InfoHint text={option.disabledReason} label={option.label} align="auto" /> : null}
            </span>
          )
        })}
      </div>
    )
  }

  const renderRecordCell = (row: ResolveRow, rowIndex: number, column: ResolveColumn, index: number) => {
    const cell = row.cells[column.id] ?? EMPTY_CELL
    const key = resolveCellKey(row.key, column.id)
    const excluded = column.disposition !== 'include'
    const choiceRow = row.kind !== 'computed' && !row.optionsOnly
    const chosen = choiceRow && !excluded && chosenSource(row.choice) === column.id
    const shownReason = cell.disabledReason || (cell.invalid ? tr('resolve_invalid', 'Invalid value') : '')
    // Excluded and disabled columns say why in their header; locked rows on
    // their label. The cell repeats it for screen readers only.
    const reason = shownReason || (!choiceRow ? '' : excluded ? dispositionLabel(column.disposition) : column.disabledReason || row.locked || '')
    const pickable = choiceRow && !reason && !cell.masked
    const changed = Boolean(changedCells?.has(key))
    const options = cellOptions(row, column)
    const reasonId = reason ? `${gridId}-reason-${rowIndex}-${index}` : undefined
    const className = ['rg-cell', pickable && 'rg-pickable', chosen && 'rg-chosen', changed && !chosen && 'rg-changed', excluded && 'rg-excluded']
      .filter(Boolean).join(' ')
    return (
      <td
        key={column.id}
        role="gridcell"
        aria-colindex={index + 2}
        data-rg-key={key}
        tabIndex={key === currentKey ? 0 : -1}
        aria-selected={choiceRow ? chosen : undefined}
        aria-disabled={choiceRow && !pickable ? true : undefined}
        aria-describedby={reasonId}
        data-clickable={pickable ? 'true' : undefined}
        className={className}
        onClick={pickable ? (event) => surfaceClick(event, () => pickSource(row, column)) : undefined}
        onKeyDown={pickable ? (event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          pickSource(row, column)
        } : undefined}
      >
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">{renderValue(cell, row)}</div>
          {chosen ? <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> : null}
          {changed ? <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" /> : null}
        </div>
        {changed ? <span className="sr-only">{tr('resolve_changed', 'Changed')}</span> : null}
        {reason ? (
          <span id={reasonId} className={shownReason ? 'mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400' : 'sr-only'}>{reason}</span>
        ) : null}
        {options.length ? renderChips(row, options, column) : null}
      </td>
    )
  }

  const renderFinalCell = (row: ResolveRow) => {
    const key = resolveCellKey(row.key, RESOLVE_FINAL_COLUMN)
    const editable = Boolean(row.custom) && !row.locked
    const typed = customValue(row.choice) !== null
    const unanswered = row.kind === 'required' && !row.choice
    const changed = Boolean(changedCells?.has(key))
    const className = ['rg-final', editable && 'rg-pickable', editingRowKey === row.key && 'rg-editing', changed && 'rg-changed']
      .filter(Boolean).join(' ')
    return (
      <td
        role="gridcell"
        aria-colindex={ordered.length + 2}
        data-rg-key={key}
        tabIndex={key === currentKey ? 0 : -1}
        aria-haspopup={editable ? 'dialog' : undefined}
        data-clickable={editable ? 'true' : undefined}
        className={className}
        onClick={editable ? (event) => surfaceClick(event, () => openEditor(row)) : undefined}
        onKeyDown={editable ? (event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'F2')) return
          event.preventDefault()
          openEditor(row)
        } : undefined}
      >
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1 font-semibold text-gray-900 dark:text-gray-100">
            {unanswered
              ? <span className="font-medium text-amber-700 dark:text-amber-300">{tr('resolve_choose', 'Choose one')}</span>
              : renderValue(row.final, row)}
          </div>
          {editable ? <Pencil aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" /> : null}
        </div>
        {typed ? (
          <span className="mt-1 inline-flex rounded-full bg-blue-50 px-1.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{tr('custom', 'Custom')}</span>
        ) : null}
        {changed ? <span className="sr-only">{tr('resolve_changed', 'Changed')}</span> : null}
        {row.options?.length ? renderChips(row, row.options) : null}
      </td>
    )
  }

  const renderColumnHeader = (column: ResolveColumn, index: number) => {
    const name = column.title
    return (
      <th key={column.id} scope="col" role="columnheader" aria-colindex={index + 2} className="rg-cell font-normal">
        <div className={column.disposition === 'include' ? undefined : 'opacity-60'}>
          {/* The record's name copies like everywhere else (double-click /
              long-press); the marker only, so the column header's accessible
              name stays the name itself. */}
          <div className="min-w-0" {...copyMarker(copyProps(name))}>
            <ProductNameRail name={name} className="font-semibold text-gray-900 dark:text-gray-100" />
          </div>
          {column.subtitle ? <span className="block text-[11px] text-gray-500 dark:text-gray-400">{column.subtitle}</span> : null}
        </div>
        {column.warning ? (
          <span className="mt-1 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0">{column.warning}</span>
          </span>
        ) : null}
        {column.disabledReason ? (
          <span className="mt-1 block text-[11px] text-gray-500 dark:text-gray-400">{column.disabledReason}</span>
        ) : column.dispositions.length > 1 ? (
          <AppSelect
            className="mt-1 w-full"
            buttonClassName="min-h-10 w-full !px-2 !py-1"
            value={column.disposition}
            // The size goes on the label, not the button: the button's own
            // text-sm is !important in main.css, while .text-xs on a span
            // also carries the Khmer line height.
            options={column.dispositions.map((disposition) => ({ value: disposition, label: <span className="text-xs">{dispositionLabel(disposition)}</span> }))}
            onChange={(value) => {
              const disposition = column.dispositions.find((item) => item === value)
              if (disposition) onDisposition(column.id, disposition, disposition === 'remove' ? column.removeReason : undefined)
            }}
            ariaLabel={fill(tr('resolve_disposition_label', 'What to do with {name}'), { name })}
            disabled={busy}
          />
        ) : null}
        {column.disposition === 'remove' && !column.disabledReason ? (
          <input
            className="input mt-1 w-full !px-2 !py-1"
            maxLength={500}
            value={column.removeReason ?? ''}
            placeholder={tr('reason', 'Reason')}
            aria-label={fill(tr('resolve_remove_reason', 'Reason to remove {name}'), { name })}
            onChange={(event) => onDisposition(column.id, 'remove', event.target.value)}
            disabled={busy}
          />
        ) : null}
      </th>
    )
  }

  const recordCount = ordered.length
  const pagerFrom = Math.min(recordCount, pager.start + 1)
  const pagerTo = Math.min(recordCount, pager.start + pager.perView)
  const editorLabel = editingRow ? `${tr('resolve_final', 'Final')} · ${editingRow.label}` : ''
  const editorErrorId = `${gridId}-editor-error`

  return (
    <div ref={rootRef} aria-busy={busy || undefined}>
      {recordCount > pager.perView ? (
        <div className="mb-1 flex items-center justify-end gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <button type="button" aria-label={tr('resolve_previous_record', 'Previous record')} disabled={pager.start <= 0} onClick={() => page(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700">
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
          <span aria-hidden="true" data-rg-pager="true" className="min-w-[3.5rem] text-center tabular-nums">
            {pagerFrom === pagerTo ? `${pagerFrom} / ${recordCount}` : `${pagerFrom}–${pagerTo} / ${recordCount}`}
          </span>
          <span className="sr-only">{fill(tr('resolve_columns_label', 'Showing records {from}–{to} of {total}'), { from: pagerFrom, to: pagerTo, total: recordCount })}</span>
          <button type="button" aria-label={tr('resolve_next_record', 'Next record')} disabled={pager.start + pager.perView >= recordCount} onClick={() => page(1)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-700">
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div ref={scrollerRef} className="resolve-grid-scroll">
        <table
          role="grid"
          aria-label={tr('resolve', 'Resolve')}
          aria-rowcount={rows.length + 1 + (foldedCount ? 1 : 0)}
          aria-colcount={recordCount + 2}
          aria-multiselectable="true"
          aria-busy={busy || undefined}
          className="resolve-grid text-gray-800 dark:text-gray-200"
          style={{ '--rg-n': recordCount } as CSSProperties}
          onKeyDown={handleGridKeyDown}
          onFocus={handleGridFocus}
        >
          <thead ref={theadRef}>
            <tr aria-rowindex={1}>
              <th scope="col" role="columnheader" aria-colindex={1} className="rg-label">
                <span className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
                  <span className="min-w-0">{tr('field', 'Field')}</span>
                  <InfoHint text={tr('resolve_how_to', 'Tap a value to use it in Final. Tap Final to type your own value. Matching fields are folded.')} label={tr('resolve_how_to_label', 'How to resolve')} align="left" />
                </span>
              </th>
              {ordered.map(renderColumnHeader)}
              <th scope="col" role="columnheader" aria-colindex={recordCount + 2} className="rg-final">
                <span className="text-xs text-emerald-700 dark:text-emerald-300">{tr('resolve_final', 'Final')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (shown(row) ? (
              <tr key={row.key} aria-rowindex={rowIndex + 2}>
                <th scope="row" role="rowheader" aria-colindex={1} className="rg-label">
                  <span className="flex items-start gap-1">
                    <span className="min-w-0">
                      {row.label}
                      {row.kind === 'required' ? <span aria-hidden="true" className="text-amber-600 dark:text-amber-400"> *</span> : null}
                    </span>
                    {row.locked ? (
                      <>
                        <Lock aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <InfoHint text={row.locked} label={`${tr('resolve_locked', 'Locked')}: ${row.label}`} align="left" />
                      </>
                    ) : null}
                    {row.hint ? <InfoHint text={row.hint} label={row.label} align="left" /> : null}
                  </span>
                </th>
                {ordered.map((column, index) => renderRecordCell(row, rowIndex, column, index))}
                {renderFinalCell(row)}
              </tr>
            ) : null))}
            {foldedCount ? (
              <tr aria-rowindex={rows.length + 2}>
                <td role="gridcell" aria-colindex={1} colSpan={recordCount + 2}>
                  <button
                    type="button"
                    data-rg-key={FOLD_KEY}
                    tabIndex={currentKey === FOLD_KEY ? 0 : -1}
                    aria-expanded={showMatching}
                    className="rg-fold inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
                    onClick={() => setShowMatching((value) => !value)}
                  >
                    {showMatching
                      ? fill(tr('resolve_hide_matching', 'Hide matching fields ({n})'), { n: foldedCount })
                      : fill(tr('resolve_show_matching', '{n} matching fields · Show all ({n})'), { n: foldedCount })}
                  </button>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="sr-only" aria-live="polite">{announcement}</div>
      {editing && editingRow?.custom && editorBox ? createPortal(
        <div
          ref={editorRef}
          role="dialog"
          aria-label={editorLabel}
          data-rg-editor="true"
          className="fixed z-[1060] rounded-xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-gray-600 dark:bg-gray-800"
          style={{ left: editorBox.left, top: editorBox.top, width: editorBox.width, transform: editorBox.above ? 'translateY(-100%)' : undefined }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              event.preventDefault()
              closeEditor(true)
            } else if (event.key === 'Enter' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
              event.preventDefault()
              commitEditor()
            }
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null
            if (!editorOpen.current || (next && editorRef.current?.contains(next))) return
            commitEditor(undefined, false)
          }}
        >
          <div className="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">{editorLabel}</div>
          <div className="flex items-start gap-2">
            {editingRow.custom.kind === 'suggest' ? (
              <SuggestionTextInput
                id={`${gridId}-editor`}
                className="min-w-0 flex-1"
                value={editing.value}
                options={editingRow.custom.suggestions ?? []}
                onChange={(value, option) => {
                  if (option) commitEditor(value)
                  else setEditing({ ...editing, value, error: null })
                }}
                ariaLabel={editorLabel}
                autoFocus
              />
            ) : (
              <input
                className="input min-h-11 w-full min-w-0 flex-1"
                value={editing.value}
                inputMode={editingRow.custom.kind === 'money' ? 'decimal' : undefined}
                placeholder={editingRow.custom.kind === 'money' ? editingRow.final.text : undefined}
                aria-label={editorLabel}
                aria-invalid={editing.error ? true : undefined}
                aria-describedby={editing.error ? editorErrorId : undefined}
                onChange={(event) => setEditing({ ...editing, value: event.target.value, error: null })}
                autoFocus
              />
            )}
            <button type="button" className="btn-primary flex h-11 w-11 shrink-0 items-center justify-center px-0" aria-label={tr('resolve_use_value', 'Use this value')} onClick={() => commitEditor()}>
              <Check aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          {editing.error ? <p id={editorErrorId} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{editing.error}</p> : null}
        </div>,
        editorBox.host,
      ) : null}
    </div>
  )
}
