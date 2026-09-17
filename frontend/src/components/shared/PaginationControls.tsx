import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import { clampPageNumber, pagerState } from '../../utils/pagerState.ts'

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
  /** Tight visual form for a centered pager between two fixed action slots. */
  compactCentered?: boolean
  // Opt-in CENTRED single-line form for the public storefront. The default
  // three-part admin row -- a "Showing 1-50 of 3,555 products" summary on the
  // left, then a labelled per-page column and the pager pushed to the right
  // edge -- is what a shopper was being shown above and below the product
  // grid. This variant drops the summary, keeps an editable page number
  // between visible Back/Next controls, and centres the whole thing.
  // 2026-09-15 (owner): Back first, then the size selector, then page/total,
  // then Next. 2026-09-17, P10-20 (owner: "no need to show rows per page
  // options"): the size selector is gone from every layout, so the row is
  // simply Back, page/total, Next. 'default' stays the default,
  // so every admin consumer of this control renders exactly as before.
  layout?: 'default' | 'centered'
  /** `centered` layout only: printed on the SAME row as the pill, e.g.
   * "3,585 result(s)". Omit to leave the row exactly as wide as the pill
   * (the merge-review modal's own `centered` pager never passes this). */
  resultsCount?: string
}

export function clampPage(page: NumericInput, totalItems: NumericInput, pageSize: NumericInput): number {
  return clampPageNumber(page, totalItems, pageSize, DEFAULT_PAGE_SIZE)
}

export function paginateItems<T>(items: readonly T[] = [], page: NumericInput = 1, pageSize: NumericInput = DEFAULT_PAGE_SIZE): T[] {
  const list = Array.isArray(items) ? items : []
  const parsedPageSize = Number(pageSize || DEFAULT_PAGE_SIZE)
  const safePageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : DEFAULT_PAGE_SIZE
  const safePage = clampPage(page, list.length, safePageSize)
  const start = (safePage - 1) * safePageSize
  return list.slice(start, start + safePageSize)
}

export default function PaginationControls({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  totalItems = 0,
  onPageChange,
  // onPageSizeChange, pageSizeOptions and editablePageSizeInput stay in
  // PaginationControlsProps (many callers still pass them) but P10-20
  // removed the last rows-per-page selector that read them, so they are no
  // longer destructured here -- doing so is a dead local, not behaviour.
  label = 'records',
  t,
  className = '',
  compact = false,
  compactPageInput = false,
  editablePageInput = true,
  rangeAsPageSize = false,
  compactCentered = false,
  layout = 'default',
  resultsCount,
}: PaginationControlsProps) {
  // One shared kernel (utils/pagerState.ts) answers all of it: the clamped
  // page, the page count, the item range, whether each arrow is dead, and
  // whether the control renders at all.
  const state = pagerState(page, totalItems, pageSize, DEFAULT_PAGE_SIZE)
  const { total, totalPages, start, end, backDisabled, nextDisabled } = state
  const safePageSize = state.pageSize
  const safePage = state.page
  const pageLabel = typeof t === 'function' ? (t('page') || 'Page') : 'Page'
  const ofLabel = typeof t === 'function' ? (t('of') || 'of') : 'of'
  const showingLabel = typeof t === 'function' ? (t('showing') || 'Showing') : 'Showing'
  const backLabel = typeof t === 'function' ? (t('back') || 'Back') : 'Back'
  const nextLabel = typeof t === 'function' ? (t('next') || 'Next') : 'Next'
  const [pageDraft, setPageDraft] = useState(String(safePage))

  useEffect(() => {
    setPageDraft(String(safePage))
  }, [safePage])

  // A filtered or deleted last page can leave the parent holding a page that
  // no longer exists.  Rendering the clamped number alone makes the controls
  // look correct but sends the next request with the stale offset, so Back /
  // Next appears unresponsive. Keep the controlled page in sync for every
  // list that uses this shared control.
  useEffect(() => {
    const requestedPage = Math.max(1, Number(page || 1))
    if (Number.isFinite(requestedPage) && requestedPage !== safePage) {
      onPageChange?.(safePage)
    }
  }, [page, safePage, onPageChange])

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

  if (!state.visible) return null

  if (layout === 'centered') {
    // Storefront pager: ONE centred pill, "< Back  20  1 / 72  Next >", mounted
    // identically above and below the grid.
    //
    // Order is the owner's (2026-09-15, supersedes 2026-09-14's page-size-
    // first order): Back, then the page-size selector, then the editable
    // page field and total page count, then Next. All controls keep a 40px
    // hit area and an inset keyboard focus ring so the rounded pill does not
    // clip the indicator.
    const focusRingClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500'
    const arrowButtonClass = `inline-flex h-10 shrink-0 items-center gap-0.5 px-3 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white dark:disabled:text-slate-600 ${focusRingClass}`
    const countClass = 'h-10 shrink-0 whitespace-nowrap px-2 text-xs font-semibold leading-10 text-slate-500 dark:text-slate-400'
    // The page box takes its width from what it prints. `ch` is the width of
    // "0" in the current font, which is the right unit for a numeric field.
    //
    // With a FLOOR, though. Removing the fixed `w-9` closed the gap the owner
    // circled, and then overshot: at text-xs a `ch` is about 6-7px, so a
    // one-digit page gave `calc(1ch + 0.5rem)` ~= 15px of tap target -- 21px
    // narrower than the 36px box it replaced, on the storefront's only
    // page-jump control, and half the 40px floor the arrows beside it keep.
    // `max()` keeps both facts: 40px minimum, and it still grows with the
    // digits so "108" is snug and nothing reserves room for digits that are
    // not there. `min-w-10` rather than `min-w-0` for the same reason -- a
    // flex child told it may collapse below its content is the one thing that
    // could undo the floor.
    const pageDigits = Math.max(1, String(editablePageInput ? pageDraft : safePage).length)
    // P10-20: the per-page chooser this pill used to carry is gone (owner:
    // "no need to show rows per page options"), so the single-page early
    // return that existed only to keep that chooser reachable is gone with
    // it -- this layout now falls back to the same `state.visible` gate
    // (checked above) every other layout already uses.
    // A LANDMARK, not a bare div. This row is the storefront's whole
    // navigation between pages of the catalogue, and as a `<div>` it appeared
    // in no landmark list, so the one control a screen-reader user most needs
    // to jump to was the one they had to hunt for.
    //
    // The name is composed from `page`, which every one of the 17 portal
    // language packs already translates (portalLanguagePacks.ts), rather than
    // from a `pagination` key added for this row alone: the storefront's
    // `copy()` resolves through those packs, so a new key would be English in
    // 15 languages and would duplicate a string that already exists.
    //
    // And it SAYS where it went. Pressing Next swapped the grid silently: the
    // focus stays on Next, whose accessible name does not change, so nothing
    // was announced at all. The polite live region carries the page and the
    // total. Both mounts (above and below the grid) carry one, because either
    // one can be the pager being operated; a reader on a page with both will
    // hear the move once per region.
    return (
      <nav className={`flex w-full flex-wrap items-center justify-center gap-2 ${className}`} aria-label={pageLabel}>
        <div className="inline-flex max-w-full items-center rounded-full border border-slate-300 bg-white text-xs font-semibold text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
          <button
            type="button"
            className={`${arrowButtonClass} rounded-l-full`}
            disabled={backDisabled}
            onClick={() => onPageChange?.(safePage - 1)}
            aria-label={backLabel}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
            <span className="whitespace-nowrap">{backLabel}</span>
          </button>
          <div className="inline-flex min-w-0 shrink items-center">
            {editablePageInput ? (
              <>
                <span className="sr-only">{pageLabel}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={pageLabel}
                  style={{ width: `max(2.5rem, calc(${pageDigits}ch + 0.5rem))` }}
                  className={`h-10 min-w-10 border-0 bg-transparent px-0 text-center text-xs font-semibold text-slate-800 outline-none dark:text-slate-100 ${focusRingClass}`}
                  value={pageDraft}
                  onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
                  onBlur={(event) => commitPageDraft(event.currentTarget.value)}
                  onKeyDown={handlePageInputKeyDown}
                />
              </>
            ) : (
              <span className="px-1 text-xs font-semibold text-slate-800 dark:text-slate-100">{safePage}</span>
            )}
            <span className={countClass}>/ {totalPages}</span>
          </div>
          <button
            type="button"
            className={`${arrowButtonClass} rounded-r-full`}
            disabled={nextDisabled}
            onClick={() => onPageChange?.(safePage + 1)}
            aria-label={nextLabel}
          >
            <span className="whitespace-nowrap">{nextLabel}</span>
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>
        {/* Same row as the pill, not a separate line above/below it -- the
            owner's 2026-09-15 ask. Wraps onto its own line only if the pill
            itself doesn't fit (320px width with a long translated count). */}
        {resultsCount ? (
          <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-slate-500 dark:text-slate-400">{resultsCount}</span>
        ) : null}
        <span className="sr-only" aria-live="polite">{pageLabel} {safePage} {ofLabel} {totalPages}</span>
      </nav>
    )
  }

  if (compact && rangeAsPageSize) {
    // The user's "‹ page (1-20) / total ›" form. Everything lives on one line
    // inside a single pill so it can sit in the Select-all row: prev, the
    // editable current page, the item-range chip, the total page count, and
    // next.
    // P10-20: the range chip used to double as the per-page dropdown
    // trigger; the owner no longer wants a rows-per-page control anywhere,
    // so it is now always the plain item-range span -- onPageSizeChange is
    // still accepted (some callers still pass it) but nothing renders it.
    const arrowButtonClass = `inline-flex h-10 shrink-0 items-center gap-0.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white dark:disabled:text-slate-600 ${compactCentered ? 'px-0.5 text-[10px]' : 'px-1'}`
    const arrowIconClass = compactCentered ? 'h-3 w-3' : 'h-4 w-4'
    const compactPageDigits = Math.max(1, String(editablePageInput ? pageDraft : safePage).length)
    return (
      <div className={`mx-auto flex w-fit max-w-full items-center rounded-full border border-slate-300 bg-white font-semibold text-slate-800 shadow-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 ${compactCentered ? 'text-[10px]' : 'text-xs'} ${className}`}>
        <button
          type="button"
          className={arrowButtonClass}
          disabled={backDisabled}
          onClick={() => onPageChange?.(safePage - 1)}
          aria-label={backLabel}
        >
          <ChevronLeft className={arrowIconClass} strokeWidth={2.5} />
          <span className="whitespace-nowrap">{backLabel}</span>
        </button>
        <div className={`inline-flex min-w-0 items-center ${compactCentered ? 'gap-0 px-0' : 'gap-0.5 px-0.5'}`}>
          {/* Order per request: the item-range chip FIRST, then the editable
              page number, then the total page count. */}
          <span className="h-6 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">{start.toLocaleString()}-{end.toLocaleString()}</span>
          {editablePageInput ? (
            <>
              <span className="sr-only">{pageLabel}</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={pageLabel}
                style={compactCentered ? { width: `max(1.75rem, calc(${compactPageDigits}ch + 0.75rem))` } : undefined}
                className={`h-10 border-0 bg-transparent px-0 text-center font-semibold text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:text-slate-100 ${compactCentered ? 'min-w-7 shrink-0 text-[10px]' : 'w-8 text-xs'}`}
                value={pageDraft}
                onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
                onBlur={(event) => commitPageDraft(event.currentTarget.value)}
                onKeyDown={handlePageInputKeyDown}
              />
            </>
          ) : (
              <span className={`${compactCentered ? 'px-0 text-[10px]' : 'px-0.5 text-xs'} font-semibold text-slate-800 dark:text-slate-100`}>{safePage}</span>
          )}
          <span className={`shrink-0 whitespace-nowrap font-semibold text-slate-500 dark:text-slate-400 ${compactCentered ? 'text-[10px]' : 'text-xs'}`}>/ {totalPages}</span>
        </div>
        <button
          type="button"
          className={arrowButtonClass}
          disabled={nextDisabled}
          onClick={() => onPageChange?.(safePage + 1)}
          aria-label={nextLabel}
        >
          <span className="whitespace-nowrap">{nextLabel}</span>
          <ChevronRight className={arrowIconClass} strokeWidth={2.5} />
        </button>
      </div>
    )
  }

  if (compact) {
    return (
      <div className={`max-w-full rounded-xl border border-slate-200 bg-white/80 px-2 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 ${className}`}>
        {/* P10-20: the middle grid column used to hold the per-page selector
            (owner: "no need to show rows per page options"). Two columns now
            -- the item-range chip and the back/next pill -- so removing the
            selector widens the count chip instead of leaving a hole. */}
        <div className="grid max-w-full grid-cols-[minmax(5rem,1fr)_minmax(12rem,14rem)] items-center gap-1">
          <span className="inline-flex min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-50 px-1.5 py-1 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
            {start.toLocaleString()}-{end.toLocaleString()} / {total.toLocaleString()}
          </span>
          <div className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
            <button
              type="button"
              className="inline-flex h-7 shrink-0 items-center gap-0.5 px-2 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={backDisabled}
              onClick={() => onPageChange?.(safePage - 1)}
              aria-label={backLabel}
            >
              <ChevronLeft className="h-4 w-4" />
              <span>{backLabel}</span>
            </button>
            {compactPageInput ? (
              <div className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 px-1 text-[11px] font-semibold text-slate-700 dark:text-slate-100">
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={pageLabel}
                  className="h-7 w-9 border-0 bg-transparent px-0 text-center text-[11px] font-semibold text-slate-700 outline-none dark:text-slate-100"
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
              className="inline-flex h-7 shrink-0 items-center gap-0.5 px-2 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={nextDisabled}
              onClick={() => onPageChange?.(safePage + 1)}
              aria-label={nextLabel}
            >
              <span>{nextLabel}</span>
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
      {/* P10-20: the "per page" label + selector that lived here is gone
          (owner: "no need to show rows per page options"); only the
          back/next pill remains next to the count above. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-0.5 bg-white px-3 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
            disabled={backDisabled}
            onClick={() => onPageChange?.(safePage - 1)}
            aria-label={backLabel}
          >
            <ChevronLeft className="h-4 w-4" />
            <span>{backLabel}</span>
          </button>
          {editablePageInput ? (
            <div className="inline-flex min-w-28 items-center justify-center gap-1 bg-slate-50 px-3 py-1.5 font-semibold dark:bg-slate-800">
              <span className="sr-only">{pageLabel}</span>
              <input
                type="text"
                inputMode="numeric"
                aria-label={pageLabel}
                className="h-5 w-12 border-0 bg-transparent p-0 text-center text-xs font-semibold text-slate-700 outline-none dark:text-slate-100"
                value={pageDraft}
                onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
                onBlur={(event) => commitPageDraft(event.currentTarget.value)}
                onKeyDown={handlePageInputKeyDown}
              />
              <span className="text-slate-500 dark:text-slate-300">/ {totalPages}</span>
            </div>
          ) : (
            <span className="min-w-28 bg-slate-50 px-3 py-2 text-center font-semibold dark:bg-slate-800">
              {pageLabel} {safePage} {ofLabel} {totalPages}
            </span>
          )}
          <button
            type="button"
            className="inline-flex h-9 items-center gap-0.5 bg-white px-3 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800"
            disabled={nextDisabled}
            onClick={() => onPageChange?.(safePage + 1)}
            aria-label={nextLabel}
          >
            <span>{nextLabel}</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
