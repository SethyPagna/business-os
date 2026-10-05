import { useCallback, useEffect, useState } from 'react'

// PUBLIC-FILTER-MENU (owner, 5 Oct): "Public site browse: put view + sort in the
// filter menu; default by brand, user can switch (select/deselect)."
//
// VIEW is how the grid is grouped (section headers); SORT is the order inside
// each group. Both ride the storefront search request as `view` and `sort`, so
// the server orders and pages by them -- the grid is server-paginated, so a
// client-side sort could only ever reorder the 20/50/100 cards on screen.
//
// These two lists are the SAME allowlists the Worker enforces (PORTAL_BROWSE_*
// in cloudflare/src/routes/portal.ts); tests/portalBrowse.test.ts fails when
// the two copies drift. Anything outside them -- a stale bookmark, a hand-edited
// URL -- is not an error here either: it falls back to the default.
export const PORTAL_BROWSE_VIEWS = ['brand', 'category', 'all'] as const
export const PORTAL_BROWSE_SORTS = ['featured', 'name_asc', 'name_desc', 'price_asc', 'price_desc'] as const
export type PortalBrowseView = typeof PORTAL_BROWSE_VIEWS[number]
export type PortalBrowseSort = typeof PORTAL_BROWSE_SORTS[number]

export const DEFAULT_PORTAL_BROWSE_VIEW: PortalBrowseView = 'brand'
export const DEFAULT_PORTAL_BROWSE_SORT: PortalBrowseSort = 'featured'

// The URL keys. Shareable: a copied link opens on the same view and sort.
const VIEW_PARAM = 'view'
const SORT_PARAM = 'sort'

export interface PortalBrowse {
  view: PortalBrowseView
  sort: PortalBrowseSort
}

export const DEFAULT_PORTAL_BROWSE: PortalBrowse = { view: DEFAULT_PORTAL_BROWSE_VIEW, sort: DEFAULT_PORTAL_BROWSE_SORT }

export function isPortalPriceSort(sort: unknown): boolean {
  return sort === 'price_asc' || sort === 'price_desc'
}

export function normalizePortalBrowseView(value: unknown): PortalBrowseView {
  const key = String(value ?? '').trim().toLowerCase()
  return (PORTAL_BROWSE_VIEWS as readonly string[]).includes(key) ? key as PortalBrowseView : DEFAULT_PORTAL_BROWSE_VIEW
}

// `allowPrice` is false while the store hides its prices: ordering the grid by
// a number the shopper cannot see would leak it, and the Worker refuses it too.
export function normalizePortalBrowseSort(value: unknown, allowPrice = true): PortalBrowseSort {
  const key = String(value ?? '').trim().toLowerCase()
  const known = (PORTAL_BROWSE_SORTS as readonly string[]).includes(key) ? key as PortalBrowseSort : DEFAULT_PORTAL_BROWSE_SORT
  return !allowPrice && isPortalPriceSort(known) ? DEFAULT_PORTAL_BROWSE_SORT : known
}

export function isDefaultPortalBrowse(view: PortalBrowseView, sort: PortalBrowseSort): boolean {
  return view === DEFAULT_PORTAL_BROWSE_VIEW && sort === DEFAULT_PORTAL_BROWSE_SORT
}

/**
 * The request params for a view/sort pair. The default is sent as nothing at
 * all, so a visitor who never touched the menu asks for exactly the URL (and
 * hits exactly the cache entry) the storefront always used.
 */
export function portalBrowseParams(view: PortalBrowseView, sort: PortalBrowseSort): { view: string; sort: string } {
  return {
    view: view === DEFAULT_PORTAL_BROWSE_VIEW ? '' : view,
    sort: sort === DEFAULT_PORTAL_BROWSE_SORT ? '' : sort,
  }
}

/** Reads `?view=&sort=` (any junk becomes the default). */
export function readPortalBrowseFromSearch(search: string): PortalBrowse {
  try {
    const params = new URLSearchParams(search)
    return {
      view: normalizePortalBrowseView(params.get(VIEW_PARAM)),
      sort: normalizePortalBrowseSort(params.get(SORT_PARAM)),
    }
  } catch {
    return DEFAULT_PORTAL_BROWSE
  }
}

/**
 * The search string for a view/sort pair, leaving every other query parameter
 * alone. Defaults are omitted, so the plain storefront URL stays plain.
 */
export function portalBrowseSearch(currentSearch: string, view: PortalBrowseView, sort: PortalBrowseSort): string {
  const params = new URLSearchParams(currentSearch)
  const wanted = portalBrowseParams(view, sort)
  if (wanted.view) params.set(VIEW_PARAM, wanted.view)
  else params.delete(VIEW_PARAM)
  if (wanted.sort) params.set(SORT_PARAM, wanted.sort)
  else params.delete(SORT_PARAM)
  const text = params.toString()
  return text ? `?${text}` : ''
}

function writePortalBrowseToUrl(view: PortalBrowseView, sort: PortalBrowseSort): void {
  if (typeof window === 'undefined') return
  try {
    const { pathname, search, hash } = window.location
    const nextSearch = portalBrowseSearch(search, view, sort)
    if (nextSearch === search) return
    // replaceState, not pushState: a view/sort change is not a page the
    // shopper navigated to, and must not add a Back step for each tap.
    window.history.replaceState(window.history.state, '', `${pathname}${nextSearch}${hash}`)
  } catch {
    // A sandboxed frame can refuse history writes; the choice still applies.
  }
}

/**
 * The shopper's view + sort. `syncUrl` is the live storefront: it starts from
 * the URL and writes every change back. The admin editor's preview passes
 * false -- it must not rewrite the admin app's own address bar.
 */
export function usePortalBrowse(syncUrl: boolean) {
  const [browse, setBrowse] = useState<PortalBrowse>(() => (
    syncUrl && typeof window !== 'undefined' ? readPortalBrowseFromSearch(window.location.search) : DEFAULT_PORTAL_BROWSE
  ))
  useEffect(() => {
    if (syncUrl) writePortalBrowseToUrl(browse.view, browse.sort)
  }, [syncUrl, browse.view, browse.sort])
  const setView = useCallback((view: PortalBrowseView) => setBrowse((prev) => ({ ...prev, view: normalizePortalBrowseView(view) })), [])
  const setSort = useCallback((sort: PortalBrowseSort) => setBrowse((prev) => ({ ...prev, sort: normalizePortalBrowseSort(sort) })), [])
  return { view: browse.view, sort: browse.sort, setView, setSort }
}

export interface PortalGroupHeaderInput {
  view: PortalBrowseView
  /** How many cards at the top are the server's promoted block (0 when the sort is not Featured). */
  promotedRun: number
  promotionsLabel: string
  noBrandLabel: string
  noCategoryLabel: string
}

/**
 * Section-header text keyed by the index of the card that opens each section.
 * The server already ordered the page by the view's group key (blank last), so
 * a header is simply "the group changed since the previous card" -- nothing is
 * re-sorted here. `all` has no groups and so no headers, apart from the
 * promoted block that leads the Featured sort.
 */
export function buildPortalGroupHeaders(
  products: ReadonlyArray<Record<string, unknown>>,
  { view, promotedRun, promotionsLabel, noBrandLabel, noCategoryLabel }: PortalGroupHeaderInput,
): Map<number, string> {
  const headers = new Map<number, string>()
  const run = Math.max(0, Math.min(promotedRun, products.length))
  if (run > 0) headers.set(0, promotionsLabel)
  if (view === 'all') return headers
  let lastKey: string | null = null
  products.forEach((product, index) => {
    if (index < run) return
    const raw = String((view === 'category' ? product.category : product.brand) ?? '').trim()
    const key = raw.toLowerCase()
    if (key === lastKey) return
    lastKey = key
    headers.set(index, raw || (view === 'category' ? noCategoryLabel : noBrandLabel))
  })
  return headers
}
