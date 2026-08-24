import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import PageSizeSelect from '../shared/PageSizeSelect'

const CATALOG_PAGE_SIZE_OPTIONS = [20, 50, 100]
// The preset list's display order is ascending (20/50/100) and unrelated to
// which one is the actual default -- CATALOG_PAGE_SIZE_OPTIONS[0] used to be
// read as "the default" by every fallback below, which quietly pinned the
// default to 20 (the smallest preset) rather than the org-wide "default page
// size is 50" decision (Part 151). Split the two concerns: options stay
// ascending for display, CATALOG_DEFAULT_PAGE_SIZE is the actual default.
export const CATALOG_DEFAULT_PAGE_SIZE = 50

type NumericInput = number | string | null | undefined
type Translate = (key: string) => string | undefined

type CatalogPaginationControlsProps = {
  page?: NumericInput
  pageSize?: NumericInput
  totalItems?: NumericInput
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  label?: string
  t?: Translate
  className?: string
}

function clampCatalogPage(page: NumericInput, totalItems: NumericInput, pageSize: NumericInput): number {
  const safePageSize = Math.max(1, Number(pageSize || CATALOG_DEFAULT_PAGE_SIZE))
  const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalItems || 0)) / safePageSize))
  return Math.max(1, Math.min(totalPages, Number(page || 1)))
}

export function paginateCatalogItems<T>(items: readonly T[] = [], page: NumericInput = 1, pageSize: NumericInput = CATALOG_DEFAULT_PAGE_SIZE): T[] {
  const list = Array.isArray(items) ? items : []
  const safePageSize = Math.max(1, Number(pageSize || CATALOG_DEFAULT_PAGE_SIZE))
  const safePage = clampCatalogPage(page, list.length, safePageSize)
  const start = (safePage - 1) * safePageSize
  return list.slice(start, start + safePageSize)
}

export default function CatalogPaginationControls({
  page = 1,
  pageSize = CATALOG_DEFAULT_PAGE_SIZE,
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  label = 'products',
  t,
  className = '',
}: CatalogPaginationControlsProps) {
  const safePageSize = Math.max(1, Number(pageSize || CATALOG_DEFAULT_PAGE_SIZE))
  const total = Math.max(0, Number(totalItems || 0))
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = clampCatalogPage(page, total, safePageSize)
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
    const next = clampCatalogPage(parsed, total, safePageSize)
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

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white/88 px-2 py-2 text-xs text-neutral-600 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/76 dark:text-neutral-300 sm:px-3 ${className}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(6.5rem,8rem)] items-center gap-1.5 sm:grid-cols-[minmax(7rem,1fr)_4rem_minmax(7.5rem,10rem)] sm:gap-2">
        <span className="inline-flex min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 sm:text-xs">
          <span className="sm:hidden">{start.toLocaleString()}-{end.toLocaleString()} / {total.toLocaleString()}</span>
          <span className="hidden sm:inline">{showingLabel} {start.toLocaleString()}-{end.toLocaleString()} {ofLabel} {total.toLocaleString()} {label}</span>
        </span>
        {/*
          Merged preset+custom control (see PageSizeSelect): one click
          target instead of a preset dropdown sitting next to a separate,
          easy-to-miss custom textbox. Colors use the neutral- family
          rather than slate/gray: public-portal.css force-overrides the
          text-slate and text-gray utility classes with !important to keep
          the theme legible against arbitrary admin-picked backgrounds, which was
          quietly beating this control's own dark: variants and dimming it
          -- the same root cause as the top/bottom scroll-arrow contrast
          issue. neutral-* isn't in that override list, so it renders as
          authored.
        */}
        <PageSizeSelect
          value={safePageSize}
          options={CATALOG_PAGE_SIZE_OPTIONS}
          onChange={(nextValue) => onPageSizeChange?.(nextValue)}
          // Matches portal.ts's /catalog/products/search route:
          // Math.min(100, ...) on pageSize -- a custom value above 100
          // was silently clamped server-side with no feedback here.
          maxValue={100}
          ariaLabel={perPageLabel}
          buttonClassName="h-8 w-full rounded-full border-slate-200 bg-white px-3 pr-2 text-xs font-semibold text-neutral-700 shadow-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:hover:bg-neutral-800"
          menuClassName="min-w-[9.5rem] dark:border-neutral-700 dark:bg-neutral-950"
          optionClassName="dark:text-neutral-100 dark:hover:bg-neutral-800"
        />
        <div className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-950">
          <button
            type="button"
            className="inline-flex h-8 w-7 shrink-0 items-center justify-center text-neutral-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
            disabled={safePage <= 1}
            onClick={() => onPageChange?.(safePage - 1)}
            aria-label="Previous page"
          >
            &lt;
          </button>
          <div className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 px-1 text-[11px] font-semibold text-neutral-700 dark:text-neutral-100">
            <input
              type="text"
              inputMode="numeric"
              aria-label={pageLabel}
              className="h-8 w-7 border-0 bg-transparent px-0 text-center text-[11px] font-semibold text-neutral-700 outline-none dark:text-neutral-100"
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
              onBlur={(event) => commitPageDraft(event.currentTarget.value)}
              onKeyDown={handlePageInputKeyDown}
            />
            <span className="shrink-0 text-[11px] font-semibold text-neutral-500 dark:text-neutral-300">/ {totalPages}</span>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-7 shrink-0 items-center justify-center text-neutral-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-300 dark:hover:bg-neutral-800"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange?.(safePage + 1)}
            aria-label="Next page"
          >
            &gt;
          </button>
        </div>
      </div>
    </div>
  )
}
