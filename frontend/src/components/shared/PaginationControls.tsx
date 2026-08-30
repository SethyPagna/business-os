import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import PageSizeSelect from './PageSizeSelect'

export const PAGE_SIZE_OPTIONS: number[] = [20, 50, 100]

// The default row count for every list in the admin app.
//
// Was written as PAGE_SIZE_OPTIONS[1] -- an index into the options array,
// which made "the default" and "the middle option" the same fact by
// accident: reordering or inserting an option would silently move the
// default. It is now its own named constant, so the two can change
// independently.
//
// 20 rather than 50 by request: 50 rows is a long scroll on a phone and a
// heavier query for a catalogue this size. Anyone who wants more can still
// pick 50 or 100 from the selector, and that choice is echoed back by the
// server and kept.
export const DEFAULT_PAGE_SIZE = 20

// POS is the one deliberate exception. A cashier is scanning through a grid
// of product cards looking for the next item rather than reading rows, so
// paging every 20 interrupts the actual task. 30 keeps that flow while
// staying well under the old 50.
export const POS_DEFAULT_PAGE_SIZE = 30

type Translate = (key: string) => string | undefined

type NumericInput = number | string | null | undefined

export interface PaginationControlsProps {
  page?: NumericInput
  pageSize?: NumericInput
  totalItems?: NumericInput
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  label?: string
  t?: Translate
  className?: string
  compact?: boolean
  compactPageInput?: boolean
  editablePageInput?: boolean
  editablePageSizeInput?: boolean
  // Opt-in single-line compact form the user asked for: "‹ page (1-20) / total ›".
  // The item range doubles as the per-page trigger -- tapping "1-20" opens the
  // 20/50/100 options -- so the separate per-page column disappears and the
  // whole control fits inline next to a Select-all checkbox. Only applies with
  // `compact`; leaving it off keeps the existing three-column compact layout,
  // so callers that don't set it are unaffected.
  rangeAsPageSize?: boolean
}

export function clampPage(page: NumericInput, totalItems: NumericInput, pageSize: NumericInput): number {
  const safePageSize = Math.max(1, Number(pageSize || DEFAULT_PAGE_SIZE))
  const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalItems || 0)) / safePageSize))
  return Math.max(1, Math.min(totalPages, Number(page || 1)))
}

export function paginateItems<T>(items: readonly T[] = [], page: NumericInput = 1, pageSize: NumericInput = DEFAULT_PAGE_SIZE): T[] {
  const list = Array.isArray(items) ? items : []
  const safePageSize = Math.max(1, Number(pageSize || DEFAULT_PAGE_SIZE))
  const safePage = clampPage(page, list.length, safePageSize)
  const start = (safePage - 1) * safePageSize
  return list.slice(start, start + safePageSize)
}

export default function PaginationControls({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  label = 'records',
  t,
  className = '',
  compact = false,
  compactPageInput = false,
  editablePageInput = true,
  editablePageSizeInput = true,
  rangeAsPageSize = false,
}: PaginationControlsProps) {
  const safePageSize = Math.max(1, Number(pageSize || DEFAULT_PAGE_SIZE))
  const total = Math.max(0, Number(totalItems || 0))
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = clampPage(page, total, safePageSize)
  const start = total ? ((safePage - 1) * safePageSize) + 1 : 0
  const end = Math.min(total, safePage * safePageSize)
  const pageLabel = typeof t === 'function' ? (t('page') || 'Page') : 'Page'
  const ofLabel = typeof t === 'function' ? (t('of') || 'of') : 'of'
  const perPageLabel = typeof t === 'function' ? (t('per_page') || 'per page') : 'per page'
  const showingLabel = typeof t === 'function' ? (t('showing') || 'Showing') : 'Showing'
  const [pageDraft, setPageDraft] = useState(String(safePage))

  useEffect(() => {
    setPageDraft(String(safePage))
  }, [safePage])

  const commitPageDraft = (value: string = pageDraft) => {
    const parsed = Number.parseInt(String(value || '').trim(), 10)
    if (!Number.isFinite(parsed)) {
      setPageDraft(String(safePage))
      return
    }
    const next = clampPage(parsed, total, safePageSize)
    onPageChange?.(next)
    setPageDraft(String(next))
  }

  const handlePageInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitPageDraft(event.currentTarget.value)
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      setPageDraft(String(safePage))
      event.currentTarget.blur()
    }
  }

  if (total <= 0) return null

  if (compact && rangeAsPageSize) {
    // The user's "‹ page (1-20) / total ›" form. Everything lives on one line
    // inside a single pill so it can sit in the Select-all row: prev, the
    // editable current page, the item-range chip (which is itself the per-page
    // dropdown trigger), the total page count, and next.
    // Consistent one-line pill: prev / editable page / the "1-20" range chip
    // (which IS the per-page dropdown -- no caret, tap to open) / total pages
    // / next. Everything is text-xs and font-semibold on the same slate ramp
    // so the numbers read as one set; the prev/next arrows are the strongest
    // element (darker, bolder stroke, solid hover) so the primary action --
    // paging -- stands out and the disabled edge is unmistakable.
    const arrowButtonClass = 'inline-flex h-7 w-8 shrink-0 items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white dark:disabled:text-slate-600'
    return (
      <div className={`inline-flex max-w-full items-center overflow-hidden rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 ${className}`}>
        <button
          type="button"
          className={arrowButtonClass}
          disabled={safePage <= 1}
          onClick={() => onPageChange?.(safePage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
        </button>
        <div className="inline-flex min-w-0 items-center gap-1.5 px-1.5">
          {/* Order per request: the item-range chip (per-page trigger) FIRST,
              then the editable page number, then the total page count. */}
          <PageSizeSelect
            value={safePageSize}
            options={pageSizeOptions}
            onChange={(nextValue) => onPageSizeChange?.(nextValue)}
            ariaLabel={perPageLabel}
            allowCustom={editablePageSizeInput}
            hideCaret
            buttonContent={`${start.toLocaleString()}-${end.toLocaleString()}`}
            className="min-w-0"
            buttonClassName="h-6 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0 text-xs font-semibold text-slate-800 shadow-none hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            menuClassName="min-w-[9rem]"
            optionClassName="text-xs"
          />
          {editablePageInput ? (
            <>
              <span className="sr-only">{pageLabel}</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={pageLabel}
                className="h-7 w-6 border-0 bg-transparent px-0 text-center text-xs font-semibold text-slate-800 outline-none dark:text-slate-100"
                value={pageDraft}
                onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
                onBlur={(event) => commitPageDraft(event.currentTarget.value)}
                onKeyDown={handlePageInputKeyDown}
              />
            </>
          ) : (
            <span className="px-0.5 text-xs font-semibold text-slate-800 dark:text-slate-100">{safePage}</span>
          )}
          <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-500 dark:text-slate-400">/ {totalPages}</span>
        </div>
        <button
          type="button"
          className={arrowButtonClass}
          disabled={safePage >= totalPages}
          onClick={() => onPageChange?.(safePage + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    )
  }

  if (compact) {
    return (
      <div className={`max-w-full rounded-xl border border-slate-200 bg-white/80 px-2 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 ${className}`}>
        {/* Per-page selector narrowed to fit a 3-digit value (its own values
            top out at 999 via PageSizeSelect's custom-input maxValue where
            callers don't override it) instead of a fixed wide column -- the
            width that frees up goes to the prev/next buttons below, not to
            growing the row: same h-7 everywhere, just wider touch targets. */}
        <div className="grid max-w-full grid-cols-[minmax(5.25rem,1fr)_minmax(3.75rem,4.5rem)_minmax(7.5rem,10rem)] items-center gap-1">
          <span className="inline-flex min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-50 px-1.5 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
            {start.toLocaleString()}-{end.toLocaleString()} / {total.toLocaleString()}
          </span>
          <div className="flex min-w-0 items-center gap-1">
            <PageSizeSelect
              value={safePageSize}
              options={pageSizeOptions}
              onChange={(nextValue) => onPageSizeChange?.(nextValue)}
              ariaLabel={perPageLabel}
              allowCustom={editablePageSizeInput}
              className="h-7 w-full min-w-0"
              buttonClassName="h-7 w-full rounded-full px-1 py-0 pl-1.5 pr-0.5 text-xs font-semibold shadow-none"
              menuClassName="min-w-[9rem]"
              optionClassName="text-xs"
            />
          </div>
          <div className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
            <button
              type="button"
              className="inline-flex h-7 w-9 shrink-0 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={safePage <= 1}
              onClick={() => onPageChange?.(safePage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {compactPageInput ? (
              <div className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 px-1 text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={pageLabel}
                  className="h-7 w-6 border-0 bg-transparent px-0 text-center text-[11px] font-semibold text-slate-700 outline-none dark:text-slate-100"
                  value={pageDraft}
                  onChange={(event) => {
                    setPageDraft(event.target.value.replace(/[^\d]/g, '') || '')
                  }}
                  onBlur={(event) => commitPageDraft(event.currentTarget.value)}
                  onKeyDown={handlePageInputKeyDown}
                />
                <span className="shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-300">/ {totalPages}</span>
              </div>
            ) : (
              <span className="min-w-0 flex-1 truncate px-1 text-center text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                {pageLabel} {safePage} {ofLabel} {totalPages}
              </span>
            )}
            <button
              type="button"
              className="inline-flex h-7 w-9 shrink-0 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange?.(safePage + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="font-medium">
        {showingLabel} {start.toLocaleString()}-{end.toLocaleString()} {ofLabel} {total.toLocaleString()} {label}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2">
          <span>{perPageLabel}</span>
          <PageSizeSelect
            value={safePageSize}
            options={pageSizeOptions}
            onChange={(nextValue) => onPageSizeChange?.(nextValue)}
            ariaLabel={perPageLabel}
            allowCustom={editablePageSizeInput}
            buttonClassName="h-8 min-w-[4.25rem] rounded-lg px-2 py-1 text-xs font-semibold shadow-none"
            menuClassName="min-w-[10rem]"
            optionClassName="text-xs"
          />
        </label>
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
            disabled={safePage <= 1}
            onClick={() => onPageChange?.(safePage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {editablePageInput ? (
            <div className="inline-flex min-w-24 items-center justify-center gap-1 bg-slate-50 px-3 py-1.5 font-semibold dark:bg-slate-800">
              <span className="sr-only">{pageLabel}</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={pageLabel}
                className="h-5 w-8 border-0 bg-transparent p-0 text-center text-xs font-semibold text-slate-700 outline-none dark:text-slate-100"
                value={pageDraft}
                onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
                onBlur={(event) => commitPageDraft(event.currentTarget.value)}
                onKeyDown={handlePageInputKeyDown}
              />
              <span className="text-slate-500 dark:text-slate-300">/ {totalPages}</span>
            </div>
          ) : (
            <span className="min-w-24 bg-slate-50 px-3 py-2 text-center font-semibold dark:bg-slate-800">
              {pageLabel} {safePage} {ofLabel} {totalPages}
            </span>
          )}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange?.(safePage + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
