import { todayStr } from '../../utils/dateHelpers.ts'
import type { FilterSection } from '../shared/FilterMenu'

// "Created" filter section for the Products page -- a real date range sent
// to the server as batchDateFrom/batchDateTo (see routes/products.ts's
// buildSearchFilters), scoping results to products with at least one active
// batch received in that range (product_batches.received_at). Replaces the
// previous client-only year/month picker, which only re-filtered the
// already-fetched page against product.created_at -- never sent to the
// server, never affected the total count or pagination, and didn't reflect
// when a product's stock actually arrived (created_at is just the row's
// own creation time). See progress.md's "Created section reworked to filter
// by batch date" item for the full history.
//
// Built as its own JSX file (not productMenuHelpers.ts, which stays
// JSX-free so its tests can run under plain node -- see that file's header
// comment) and passed into buildProductFilterSections the same way
// AvailabilityFilterOptions.tsx's merged section is.

export interface BuildCreatedDateFilterSectionParams {
  t?: (key: string) => string | undefined
  createdDateFrom: string
  setCreatedDateFrom: (value: string) => void
  createdDateTo: string
  setCreatedDateTo: (value: string) => void
}


export function buildCreatedDateFilterSection({
  t,
  createdDateFrom,
  setCreatedDateFrom,
  createdDateTo,
  setCreatedDateTo,
}: BuildCreatedDateFilterSectionParams): FilterSection {
  // t() returns the raw key itself (never undefined/empty) on a miss, so
  // `t(key) || fallback` never actually falls back -- same fix as
  // ProductDetailModal.tsx/ProductHistoryPreviewModal.tsx's T().
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }
  const active = !!createdDateFrom || !!createdDateTo
  const summary = active
    ? `${createdDateFrom || '\u2026'} \u2013 ${createdDateTo || '\u2026'}`
    : T('all_time', 'All time')

  return {
    id: 'created',
    label: T('created', 'Created'),
    summary,
    active,
    render: () => (
      <div className="space-y-2 p-2">
        <div>
          <label htmlFor="products-created-from-date" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            {T('start_date', 'Start Date')}
          </label>
          <input
            id="products-created-from-date"
            type="date"
            className="input"
            value={createdDateFrom}
            max={createdDateTo || undefined}
            onChange={(event) => setCreatedDateFrom(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="products-created-to-date" className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
            {T('end_date', 'End Date')}
          </label>
          <input
            id="products-created-to-date"
            type="date"
            className="input"
            value={createdDateTo}
            min={createdDateFrom || undefined}
            max={todayStr()}
            onChange={(event) => setCreatedDateTo(event.target.value)}
          />
        </div>
      </div>
    ),
  }
}
