// Where a notification row takes you (NOTIF-V2, owner 6 Oct 2026: "links directly to where we can
// find like dashboard lowstock/out of stock ... so to actual locations").
//
// One pure resolver, so the rule is written once and tested without a browser: a row names WHAT it is
// about (its `kind` and, where it has one, a sale id, an import job id, or a search text) and this
// turns that into an existing AppContext destination -- a page id plus the hub anchor the destination
// already understands. It invents no router: the caller hands the result to navigateTo(), after
// queueing the optional `focus` through the same sessionStorage hand-offs the app already uses
// (components/shared/entityLinkFocus.ts, Dashboard's inventory focus).
//
// Before this, most rows pointed at page ids that no longer exist ('inventory', 'loyalty_points',
// 'backup', 'users' -- E1/E2/E4 retired them into hubs), and AppContext.canAccessPage refuses an unknown
// page, so a click closed the panel and did nothing. RETIRED_PAGE_TARGETS keeps such an id (from a
// stale cached summary) landing on the hub section that absorbed it.

export type NotificationLinkItem = {
  kind?: string
  pageId?: string
  anchor?: string
  saleId?: number | string | null
  importJobId?: string | null
  search?: string | null
}

export type NotificationFocus =
  | { type: 'sale'; saleId: number }
  | { type: 'search'; page: 'products' | 'contacts'; search: string; anchor?: string }
  | { type: 'inventory-products'; stockFilter: 'low' | 'out' }
  | { type: 'users-devices' }

export type NotificationTarget = {
  page: string
  anchor?: string
  focus?: NotificationFocus
  /** Open this finished import's report instead of navigating. */
  importJobId?: string
}

export type CanAccessPage = (pageId: string) => boolean

/** Page ids the app retired into hubs, with the hub section that absorbed each one. */
export const RETIRED_PAGE_TARGETS: Record<string, { page: string; anchor: string }> = {
  inventory: { page: 'branches', anchor: 'hub:branches:products' },
  loyalty_points: { page: 'promotions', anchor: 'hub:promotions:loyalty' },
  backup: { page: 'settings', anchor: 'hub:settings:backup' },
  users: { page: 'settings', anchor: 'hub:settings:users' },
  returns: { page: 'sales', anchor: 'hub:sales:returns' },
  fees: { page: 'sales', anchor: 'hub:sales:fees' },
}

export const DASHBOARD_LOW_STOCK_ANCHOR = 'low-stock'
export const DASHBOARD_OUT_OF_STOCK_ANCHOR = 'out-of-stock'

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function resolveNotificationTarget(
  item: NotificationLinkItem,
  sectionPageId = '',
  canAccessPage: CanAccessPage = () => true,
): NotificationTarget {
  const kind = String(item.kind || '')

  // A finished import has no page of its own: its report is the destination.
  const importJobId = String(item.importJobId || '').trim()
  if (importJobId) return { page: 'dashboard', importJobId }

  // Stock rows: the Dashboard's matching card; someone who cannot open the Dashboard (stock access
  // only) gets the Branches products list filtered the same way.
  if (kind === 'inventory_out_of_stock' || kind === 'inventory_low_stock') {
    const out = kind === 'inventory_out_of_stock'
    if (canAccessPage('dashboard')) return { page: 'dashboard', anchor: out ? DASHBOARD_OUT_OF_STOCK_ANCHOR : DASHBOARD_LOW_STOCK_ANCHOR }
    return { page: 'branches', anchor: 'hub:branches:products', focus: { type: 'inventory-products', stockFilter: out ? 'out' : 'low' } }
  }

  // Anything about one sale opens that sale.
  const saleId = positiveInteger(item.saleId)
  if (saleId) return { page: 'sales', anchor: 'hub:sales:sales', focus: { type: 'sale', saleId } }

  // Sign-ins from a new country live on the Users section's Devices tab.
  if (kind.startsWith('security_device_')) {
    return { page: 'settings', anchor: 'hub:settings:users', focus: { type: 'users-devices' } }
  }

  const rawPage = String(item.pageId || sectionPageId || 'dashboard')
  const retired = RETIRED_PAGE_TARGETS[rawPage]
  const page = retired ? retired.page : rawPage
  const anchor = item.anchor || retired?.anchor || undefined

  // A record the row names (a product, a supplier): land on it, not just on the list.
  const search = String(item.search || '').trim()
  if (search && (page === 'products' || page === 'contacts')) {
    return { page, ...(anchor ? { anchor } : {}), focus: { type: 'search', page, search, ...(anchor ? { anchor } : {}) } }
  }
  return { page, ...(anchor ? { anchor } : {}) }
}
