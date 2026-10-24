// The seeded role permissions: the ONE definition. coreDataInvariants.ts seeds from it (insert-only
// for Manager and Employee), and GET /api/roles/defaults serves it to the role editor, so the server
// seed and the editor's "reset to defaults" can never describe two different Employees.
//
// Default posture (progress.md "Permissions -- default posture"): every page's default permission tier
// is None unless the role is Admin. Manager seeds to the explicit Manager preset below (owner, 21 Oct 2026; it used to be `{}`, which made
// the editor's "Reset to Manager defaults" a no-op). Employee receives only the explicitly
// approved front-line defaults below; unrelated page grants remain absent. Admin is `{all: true}`.
//
// Seeding only inserts Manager/Employee when the code does not exist yet, so an existing
// installation's already-customized roles are never silently reset by a change here. A key that is
// ABSENT from a stored role is "no opinion" for a narrowing switch (products:supplier), so adding a
// switch to the defaults changes no existing role.
export type DefaultRolePermissionValue = boolean | 'review' | 'view'
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, DefaultRolePermissionValue>> = {
  admin: { all: true },
  manager: {
    // The Manager preset the role editor offers (frontend rolePresetDefaults.ts), made the ONE seed
    // (owner, 21 Oct 2026: "make it consistent"). Settings Full is main access only, so every extra a
    // Manager used to get implicitly is listed here: the Website Editor areas, Business identity,
    // Sales policy, Receipt settings and the count-session grants. drive_credentials and ai_providers
    // are deliberately NOT included: Drive control and AI provider keys are a separate, critical grant.
    dashboard: true,
    dashboard_export: true,
    customer_portal: true,
    portal_posts: true,
    portal_faq: true,
    portal_about: true,
    pos: true,
    products: true,
    inventory: true,
    inventory_checks: true,
    inventory_check_show_price: true,
    inventory_check_show_barcode: true,
    inventory_check_show_category: true,
    inventory_check_show_brand: true,
    inventory_check_show_stock: true,
    inventory_check_show_received: true,
    inventory_check_show_sales: true,
    inventory_check_show_customers: true,
    inventory_check_show_cost: false,
    branches: true,
    sales: true,
    returns: true,
    fees: true,
    contacts: true,
    contacts_suppliers: true,
    library: true,
    audit_log: true,
    review: true,
    backup: true,
    settings: true,
    business_identity: true,
    sales_policy: true,
    receipt_settings: true,
  },
  employee: {
    pos: true,
    inventory_checks: true,
    inventory_check_show_price: true,
    inventory_check_show_barcode: true,
    inventory_check_show_category: true,
    inventory_check_show_brand: true,
    inventory_check_show_stock: true,
    inventory_check_show_received: true,
    inventory_check_show_sales: true,
    inventory_check_show_customers: true,
    inventory_check_show_cost: false,
    // Receipt/print settings (page menu + avatar dropdown, Sep 16 2026 owner
    // request) is an operational tool for whoever actually prints receipts,
    // not an admin-only setting -- an Employee needs to change print modes
    // (paper size, contrast, footer) without needing the broader `settings`
    // grant. See routes/settings.ts's settingsBucketPermissionFor() and
    // permissionDefinitions.ts's own 'receipt_settings' row for the rest of
    // this key's plumbing.
    receipt_settings: true,
    // Owner, 5 Oct 2026: front-line staff edit product information and upload
    // images, and nothing else on Products. The section is Full with every other
    // action switched off (an override can only remove what the tier grants), so
    // View, Edit and Image stay on. Evening revision: the DEFAULT selling and
    // wholesale price is its own action, off here (they adjust a price per sale in
    // the POS cart instead). Cost is a separate pair of grants that stays
    // off by default: cost price is never visible or editable to an Employee
    // until an admin turns product_cost_view / product_cost_edit on.
    // Owner, 19 Oct 2026: the supplier is not product information an Employee edits either
    // (products:supplier off). Setting a supplier on a NEW product stays open to a role that can add.
    // No `inventory` key: an Employee never writes physical stock, and no `dashboard` key
    // (owner, 20 Oct 2026: the Dashboard is off by default).
    products: true,
    'products:add': false,
    'products:delete': false,
    'products:bulk_delete': false,
    'products:variant': false,
    'products:import': false,
    'products:import_replace_all': false,
    'products:export': false,
    'products:merge_duplicates': false,
    'products:zero_qty_cleanup': false,
    'products:manage_lookups': false,
    'products:price': false,
    'products:supplier': false,
    'products:history': false,
    product_cost_view: false,
    product_cost_edit: false,
    sales: true,
    'sales:status': true,
    'sales:customer': true,
    'sales:add_items': true,
    'sales:amend': true,
    'sales:bulk': false,
    'sales:import': false,
    'sales:export': false,
    returns: true,
    'returns:bulk': false,
    'returns:export': false,
    // Owner, 20 Oct 2026: Contacts is Full for the Employee (was Review); the financial-history,
    // bulk and supplier-tab switches below still keep the money and supplier side closed.
    contacts: true,
    'contacts:bulk': false,
    'contacts:financial_history': false,
    contacts_suppliers: false,
  },
}
