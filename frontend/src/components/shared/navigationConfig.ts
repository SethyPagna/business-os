export type NavigationPermission =
  | null
  | 'all'
  | 'audit_log'
  | 'backup'
  | 'branches'
  | 'contacts'
  | 'customer_portal'
  | 'dashboard'
  | 'fees'
  | 'inventory'
  | 'pos'
  | 'products'
  | 'promotions'
  | 'returns'
  | 'review'
  | 'sales'
  | 'settings'
  | 'users'

export type NavigationItem = {
  id: string
  key: string
  permission: NavigationPermission
}

export const NAV_ITEMS: NavigationItem[] = [
  { id: 'dashboard', key: 'dashboard', permission: 'dashboard' },
  // Personal per-user scratchpad -- no permission gate beyond being logged
  // in, same as dashboard. Used to be a floating-button-only feature with
  // no real page; now it's a normal nav destination too (see
  // components/notes/NotesPage.tsx). The edge-docked quick-access bump
  // (NotesWidget.tsx) still exists as a shortcut into this same page.
  { id: 'notes', key: 'notes', permission: null },
  { id: 'catalog', key: 'catalog', permission: 'customer_portal' },
  // loyalty_points nav entry removed (G2): Loyalty Points is a section
  // of the Promotions page now; canAccessPage lets customer_portal
  // holders through the promotions door for it.
  // G1's promotion engine page -- its own permission key, per the standing
  // "every page gets its own permission" decision (same as branches/returns).
  { id: 'promotions', key: 'promotions', permission: 'promotions' },
  { id: 'pos', key: 'pos', permission: 'pos' },
  { id: 'products', key: 'products', permission: 'products' },
  { id: 'inventory', key: 'inventory', permission: 'inventory' },
  // Branch used to share Inventory's own permission key -- split into its
  // own 'branches' key so a person can be granted one without the other,
  // per the standing "every page gets its own permission" decision. See
  // lib/permissions.ts's ENTITY_PERMISSION_MAP comment for the backend
  // half of this split.
  { id: 'branches', key: 'branches', permission: 'branches' },
  { id: 'sales', key: 'sales', permission: 'sales' },
  { id: 'returns', key: 'returns', permission: 'returns' },
  { id: 'fees', key: 'fees', permission: 'fees' },
  { id: 'contacts', key: 'contacts', permission: 'contacts' },
  { id: 'users', key: 'users', permission: 'users' },
  // Review/Approval queue -- step (3) of the "Permissions UI redesign"
  // item, Full Access only, same gate pattern Users already uses (see
  // that item's own note on why the review page needs its own explicit
  // grant rather than falling back to any section's own tier).
  { id: 'review', key: 'review', permission: 'review' },
  { id: 'audit_log', key: 'audit_log', permission: 'audit_log' },
  // 'settings': matches AppContext.tsx's PAGE_PERMISSIONS guard for this
  // page, loosened from 'all' -- the inline receipt fields on the main
  // Settings page (tax_rate, footer) were already reachable by any
  // 'settings' user, so gating the standalone page behind super-admin-only
  // 'all' was an inconsistency rather than an intentional restriction.
  { id: 'receipt_settings', key: 'receipt_settings', permission: 'settings' },
  { id: 'backup', key: 'backup', permission: 'backup' },
  { id: 'settings', key: 'settings', permission: 'settings' },
  // Library is now view-by-default for any authenticated user (this
  // session's explicit ask) -- browsing/previewing needs no permission at
  // all, only upload/download/rename/delete require real Full Access to
  // `library` (enforced inside FilesPage.tsx/files.ts, not at the nav
  // gate). Loosened from 'settings' to null so the link itself always
  // shows, matching AppContext.tsx's canAccessPage() unconditional 'files'
  // case and cloudflare/src/routes/files.ts's GET route.
  { id: 'files', key: 'files', permission: null },
  // 'server' (the "Sync Server" settings page/top-bar button) removed from
  // the nav on request -- the page itself still exists and is still
  // directly reachable (SyncErrorBanner's "Go to server" link during a
  // real connectivity problem still navigates there), it's just no longer
  // a permanent, always-visible entry point during normal use. See
  // App.tsx's top bar and Sidebar.tsx for the matching removal.
]

export const DEFAULT_MOBILE_PINNED = ['dashboard', 'pos', 'products', 'sales']

export function parseNavSetting(value: unknown, fallback: string[] = []): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : fallback
  } catch {
    return fallback
  }
}

export function orderNavItems<T extends { id: string }>(items: T[], orderedIds: string[] = []): T[] {
  const orderMap = new Map(orderedIds.map((id, index) => [id, index]))
  const known: T[] = []
  const unknown: T[] = []

  for (const item of items) {
    if (orderMap.has(item.id)) known.push(item)
    else unknown.push(item)
  }

  known.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
  return [...known, ...unknown]
}
