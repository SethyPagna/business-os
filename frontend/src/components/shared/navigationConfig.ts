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
  | 'receipt_settings'
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
  // inventory nav entry removed (E1): Inventory renders as sections of the
  // Branches hub now; canAccessPage lets inventory grant-holders through
  // the branches door. Its 'inventory' permission key is untouched.
  // Branch used to share Inventory's own permission key -- split into its
  // own 'branches' key so a person can be granted one without the other,
  // per the standing "every page gets its own permission" decision. See
  // lib/permissions.ts's ENTITY_PERMISSION_MAP comment for the backend
  // half of this split.
  { id: 'branches', key: 'branches', permission: 'branches' },
  { id: 'sales', key: 'sales', permission: 'sales' },
  // returns/fees nav entries removed (E2): their components are sections
  // of the Sales hub now; canAccessPage lets returns/fees grant-holders
  // through the sales door.
  { id: 'contacts', key: 'contacts', permission: 'contacts' },
  // users/audit_log/backup nav entries removed (E3/E4): their components
  // are sections of Review & Logs / Settings now; canAccessPage opens the
  // host pages for their grant-holders.
  // Review/Approval queue -- step (3) of the "Permissions UI redesign"
  // item, Full Access only, same gate pattern Users already uses (see
  // that item's own note on why the review page needs its own explicit
  // grant rather than falling back to any section's own tier).
  { id: 'review', key: 'review', permission: 'review' },
  // Own permission key (Sep 16 2026 owner request: "Receipt settings should
  // also show for employees as well" / "should be in page menu as well").
  // Used to gate on the blanket 'settings' grant (itself loosened from
  // 'all'), which meant an Employee -- who prints receipts all day and needs
  // to change paper/contrast modes -- could never reach this page without
  // also being handed the whole admin Settings section. Its own key lets the
  // default Employee role carry it (coreDataInvariants.ts) while an admin
  // can still turn it off per role in the Permission Editor (settings
  // section, 'receipt_settings' row). Matches AppContext.tsx's
  // PAGE_PERMISSIONS guard and routes/settings.ts's settingsBucketPermissionFor.
  { id: 'receipt_settings', key: 'receipt_settings', permission: 'receipt_settings' },
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

// Pages that are still real NAV_ITEMS (so canAccessPage / permissions keep
// working through their existing ids) but no longer render as their own
// sidebar nav rows -- they live under the footer account expander instead
// (Sidebar.tsx). The Settings nav-order/pinning editor excludes them too, so
// it can't offer to reorder or pin a row that the nav no longer shows.
// 'receipt_settings' was removed from this set (Sep 16 2026 owner request:
// "Receipt settings should be in page menu as well") -- it is now a normal
// page-menu entry (desktop sidebar row, mobile home tile, mobile drawer)
// on top of ALSO staying in the account expander/avatar dropdown
// (Sidebar.tsx's accountActions lists it explicitly, independent of this
// set), giving it two deliberate entry points rather than carving one out.
export const ACCOUNT_NAV_IDS = new Set(['settings'])

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
