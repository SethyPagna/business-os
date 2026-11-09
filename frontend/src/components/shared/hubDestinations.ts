// The admin subpage registry: which sections each hub page offers a given caller. Kept apart from hubNavigation.ts (the location and guard helpers the
// storefront-shared AppContext and App import) so no admin page's section list, labels or permission keys ride in the storefront closure.
// tests/chunkBoundaryPolicy.test.ts pins that no storefront chunk carries it.
export type HubAccess = {
  getPermissionTier: (key: string) => string
  hasPermission: (key: string) => boolean
  canAccessPage?: (pageId: string) => boolean
  /** Per-ACTION grant -- AppContext's `can(section, action)`. Sections whose
   *  own page gates them on an action (Products' Stock-in Sessions and
   *  Duplicates) are withheld from a caller that cannot answer for actions:
   *  offering a section the page will then refuse to render is worse than
   *  not offering it. Pages with no action-gated section never read it. */
  can?: (permissionKey: string, actionKey: string) => boolean
}
export type HubDestination = { id: string; key: string; label: string }

/** These are the existing host section ids, not additional page routes. */
export function getHubDestinations(page: string, access: HubAccess): HubDestination[] {
  const can = (key: string) => access.can ? access.can(key, 'view') : access.getPermissionTier(key) !== 'none'
  const act = (key: string, action: string) => access.can ? access.can(key, action) : false
  const inventoryChecks = access.canAccessPage ? access.canAccessPage('inventory') : can('inventory_checks')
  const rows: Array<[string, string, string, boolean]> = page === 'branches' ? [
    ['overview', 'overview', 'Overview', can('branches')],
    ['transfers', 'transfer', 'Transfer', can('branches')],
    ['rfid', 'rfid', 'RFID', can('inventory')],
  ] : page === 'inventory' ? [
    ['products', 'products', 'Products', inventoryChecks],
    ['sessions', 'inventory_check_sessions', 'Sessions', inventoryChecks],
    ['issues', 'issues', 'Issues', inventoryChecks],
  ] : page === 'sales' ? [
    ['sales', 'sales', 'Sales', can('sales')],
    ['returns', 'returns', 'Returns', can('returns')],
    ['fees', 'fees', 'Expenses', can('fees')],
    ['orders', 'oo_tab', 'Orders', can('online_orders')],
    ['reports', 'reports', 'Reports', can('sales') || can('returns') || can('fees')],
  ] : page === 'contacts' ? [
    ['customers', 'customers', 'Customers', can('contacts')],
    ['suppliers', 'suppliers', 'Suppliers', can('contacts') && access.hasPermission('contacts_suppliers')],
    ['delivery', 'pos_delivery', 'Delivery', can('contacts')],
    ['duplicates', 'possible_duplicates', 'Conflicts', can('contacts')],
  ] : page === 'promotions' ? [
    ['rules', 'promo_tab_rules', 'Rules', can('promotions')],
    // A product discount is a price change (owner, 6 Oct 2026): the editor needs Edit product and the price action.
    ['discounts', 'promo_tab_discounts', 'Discounts', can('products') && act('products', 'edit') && act('products', 'price')],
    ['loyalty', 'loyalty_points', 'Loyalty Points', can('customer_portal')],
  ] : page === 'settings' ? [
    ['settings', 'settings', 'Settings', ['settings', 'business_identity', 'sales_policy', 'drive_credentials'].some(can)],
    ['users', 'users', 'Users', access.hasPermission('all')],
    ['backup', 'backup', 'Backup', can('backup')],
  ] : page === 'products' ? [
    // The Products page's own four sections (Products.tsx's
    // activeProductSection). Products is reached through canAccessPage
    // before this is asked, so its two always-on sections need no extra
    // tier; the other two mirror the page's per-action gates exactly --
    // canAdjustInventoryStock = can('inventory', 'adjust') and
    // canMergeDuplicates = can('products', 'merge_duplicates').
    ['products', 'products', 'Products', can('products')],
    // Owner, 5 Oct 2026 (evening): an Employee sees only the main Products page, so both ledger sections also
    // need the products:history action (the Worker's stock-ledger / stock-in-sessions reads need the same).
    ['stock_changes', 'stock_change_ledger', 'Stock Changes', can('products') && act('products', 'history')],
    ['stock_in_sessions', 'stock_in_sessions', 'Stock-in Sessions', can('products') && act('products', 'history') && act('inventory', 'adjust')],
    ['duplicates', 'product_duplicates_section', 'Conflicts', can('products') && act('products', 'merge_duplicates')],
  ] : page === 'review' ? [
    ['review', 'review_queue', 'Review queue', can('review')],
    ['audit', 'audit_log', 'Audit Log', can('audit_log')],
    ['deleted', 'legacy_deleted_sales', 'Deleted sales (old system)', can('audit_log') && access.getPermissionTier('audit_log') === 'full'],
  ] : []
  return rows.filter((row) => row[3]).map(([id, key, label]) => ({ id, key, label }))
}
