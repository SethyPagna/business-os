import { useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import AppSelect from '../shared/AppSelect'

const CATALOG_PAGE_SIZE_OPTIONS = [20, 50, 100]

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
  const safePageSize = Math.max(1, Number(pageSize || CATALOG_PAGE_SIZE_OPTIONS[0]))
  const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalItems || 0)) / safePageSize))
  return Math.max(1, Math.min(totalPages, Number(page || 1)))
}

export function paginateCatalogItems<T>(items: readonly T[] = [], page: NumericInput = 1, pageSize: NumericInput = CATALOG_PAGE_SIZE_OPTIONS[0]): T[] {
  const list = Array.isArray(items) ? items : []
  const safePageSize = Math.max(1, Number(pageSize || CATALOG_PAGE_SIZE_OPTIONS[0]))
  const safePage = clampCatalogPage(page, list.length, safePageSize)
  const start = (safePage - 1) * safePageSize
  return list.slice(start, start + safePageSize)
}

export default function CatalogPaginationControls({
  page = 1,
  pageSize = CATALOG_PAGE_SIZE_OPTIONS[0],
  totalItems = 0,
  onPageChange,
  onPageSizeChange,
  label = 'products',
  t,
  className = '',
}: CatalogPaginationControlsProps) {
  const safePageSize = Math.max(1, Number(pageSize || CATALOG_PAGE_SIZE_OPTIONS[0]))
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
  const pageSizeSelectOptions = CATALOG_PAGE_SIZE_OPTIONS.map((option) => ({ value: option, label: option }))

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
    <div className={`rounded-2xl border border-slate-200 bg-white/88 px-2 py-2 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/76 dark:text-slate-300 sm:px-3 ${className}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(6.5rem,8rem)] items-center gap-1.5 sm:grid-cols-[minmax(7rem,1fr)_4rem_minmax(7.5rem,10rem)] sm:gap-2">
        <span className="inline-flex min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-100 sm:text-xs">
          <span className="sm:hidden">{start.toLocaleString()}-{end.toLocaleString()} / {total.toLocaleString()}</span>
          <span className="hidden sm:inline">{showingLabel} {start.toLocaleString()}-{end.toLocaleString()} {ofLabel} {total.toLocaleString()} {label}</span>
        </span>
        <AppSelect
          value={safePageSize}
          options={pageSizeSelectOptions}
          onChange={(nextValue) => onPageSizeChange?.(Number(nextValue))}
          ariaLabel={perPageLabel}
          className="h-8 w-full min-w-0"
          buttonClassName="h-8 w-full rounded-full px-3 py-0 pr-2 text-xs font-semibold shadow-none"
          menuClassName="min-w-[4rem]"
          optionClassName="text-xs"
        />
        <div className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
          <button
            type="button"
            className="inline-flex h-8 w-7 shrink-0 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
            disabled={safePage <= 1}
            onClick={() => onPageChange?.(safePage - 1)}
            aria-label="Previous page"
          >
            &lt;
          </button>
          <div className="inline-flex min-w-0 flex-1 items-center justify-center gap-1 px-1 text-[11px] font-semibold text-slate-700 dark:text-slate-100">
            <input
              type="text"
              inputMode="numeric"
              aria-label={pageLabel}
              className="h-8 w-7 border-0 bg-transparent px-0 text-center text-[11px] font-semibold text-slate-700 outline-none dark:text-slate-100"
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, '') || '')}
              onBlur={(event) => commitPageDraft(event.currentTarget.value)}
              onKeyDown={handlePageInputKeyDown}
            />
            <span className="shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-300">/ {totalPages}</span>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-7 shrink-0 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
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
