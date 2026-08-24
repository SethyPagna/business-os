import type { FilterSection } from './FilterMenu'
import { isMultiActive, toggleMultiValue } from '../../utils/multiSelect'

// "Issues" quick-filter section for Products/Inventory -- surfaces the
// progress.md backlog item ("Searchable 'issues' filter on Products/
// Inventory", user's own example was zero stock, "and other flagged cases
// (etc)" left unspecified). Mirrors the scoped, deliberately-unambiguous
// key set built server-side in cloudflare/src/lib/searchMatch.ts's
// ISSUE_STATE_KEYS/buildIssueStateClauses -- see that file's own comment
// for the full reasoning on what's in/out of scope. Kept in sync by hand
// (a small, stable list) rather than importing across the frontend/backend
// boundary.
//
// issueFilter is stored the same comma-joined 'all'|"key,key" string shape
// as catFilter/brandFilter/supplierFilter elsewhere on these two pages (see
// utils/multiSelect.ts) -- multiple issues can be selected at once, OR'd
// together ("show me anything wrong with this product"), matching
// buildIssueStateClauses' own OR semantics server-side and
// productFilterHelpers.ts's productHasIssue client-side re-filter.

export interface BuildIssuesFilterSectionParams {
  t?: (key: string) => string | undefined
  issueFilter: string
  setIssueFilter: (value: string) => void
}

const ISSUE_KEYS = ['out_of_stock', 'no_image', 'no_barcode', 'no_category', 'no_price'] as const

export function buildIssuesFilterSection({
  t,
  issueFilter,
  setIssueFilter,
}: BuildIssuesFilterSectionParams): FilterSection {
  // t() returns the raw key itself (never undefined/empty) on a miss, so
  // `t(key) || fallback` never actually falls back -- same fix as
  // ProductDetailModal.tsx/ProductHistoryPreviewModal.tsx's T().
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const issueLabels: Record<typeof ISSUE_KEYS[number], string> = {
    out_of_stock: T('out_of_stock', 'Out of Stock'),
    no_image: T('no_image', 'No Image'),
    no_barcode: T('no_barcode', 'No Barcode'),
    no_category: T('no_category', 'No Category'),
    no_price: T('no_price', 'No Price'),
  }

  const active = issueFilter !== 'all' && !!issueFilter
  const activeKeys = ISSUE_KEYS.filter((key) => isMultiActive(issueFilter, key))

  const options = [
    { id: 'all', label: T('all', 'All'), active: !active, onClick: () => setIssueFilter('all') },
    ...ISSUE_KEYS.map((key) => ({
      id: key,
      label: issueLabels[key],
      active: isMultiActive(issueFilter, key),
      onClick: () => setIssueFilter(toggleMultiValue(issueFilter, key)),
    })),
  ]

  const summary = activeKeys.length
    ? activeKeys.map((key) => issueLabels[key]).join(' \u00b7 ')
    : T('all', 'All')

  return {
    id: 'issues',
    label: T('issues', 'Issues'),
    summary,
    active,
    activeChips: activeKeys.map((key) => ({
      id: key,
      label: issueLabels[key],
      onRemove: () => setIssueFilter(toggleMultiValue(issueFilter, key)),
    })),
    options,
  }
}
