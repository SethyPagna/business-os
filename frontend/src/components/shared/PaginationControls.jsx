import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const PAGE_SIZE_OPTIONS = [20, 50, 100]

export function clampPage(page, totalItems, pageSize) {
  const safePageSize = Math.max(1, Number(pageSize || PAGE_SIZE_OPTIONS[1]))
  const totalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalItems || 0)) / safePageSize))
  return Math.max(1, Math.min(totalPages, Number(page || 1)))
}

export function paginateItems(items = [], page = 1, pageSize = PAGE_SIZE_OPTIONS[1]) {
  const list = Array.isArray(items) ? items : []
  const safePageSize = Math.max(1, Number(pageSize || PAGE_SIZE_OPTIONS[1]))
  const safePage = clampPage(page, list.length, safePageSize)
  const start = (safePage - 1) * safePageSize
  return list.slice(start, start + safePageSize)
}

export default function PaginationControls({
  page = 1,
  pageSize = PAGE_SIZE_OPTIONS[1],
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
}) {
  const safePageSize = Math.max(1, Number(pageSize || PAGE_SIZE_OPTIONS[1]))
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

  const commitPageDraft = (value = pageDraft) => {
    const parsed = Number.parseInt(String(value || '').trim(), 10)
    if (!Number.isFinite(parsed)) {
      setPageDraft(String(safePage))
      return
    }
    const next = clampPage(parsed, total, safePageSize)
    onPageChange?.(next)
    setPageDraft(String(next))
  }

  const handlePageInputKeyDown = (event) => {
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

  if (compact) {
    return (
      <div className={`rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 ${className}`}>
        <div className="grid grid-cols-[minmax(5.5rem,auto)_3.35rem_minmax(6.8rem,9.5rem)] items-center gap-1.5">
          <span className="inline-flex min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-slate-50 px-2 py-1 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-100">
            {start.toLocaleString()}-{end.toLocaleString()} / {total.toLocaleString()}
          </span>
          <label className="relative inline-flex h-7 w-full min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
            <span className="sr-only">{perPageLabel}</span>
            <select
              className="h-full w-full appearance-none bg-transparent pl-2 pr-5 text-xs font-semibold text-slate-700 outline-none dark:text-slate-100"
              value={safePageSize}
              onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <ChevronRight className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 rotate-90 text-slate-500 dark:text-slate-300" />
          </label>
          <div className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950">
            <button
              type="button"
              className="inline-flex h-7 w-6 shrink-0 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={safePage <= 1}
              onClick={() => onPageChange?.(safePage - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
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
              className="inline-flex h-7 w-6 shrink-0 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange?.(safePage + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
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
          <select
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            value={safePageSize}
            onChange={(event) => onPageSizeChange?.(Number(event.target.value))}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
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
