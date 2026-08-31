export type PermissionSensitivity = 'normal' | 'high' | 'critical'

export interface PermissionDefinition {
  key: string
  tKey: string
  label: string
  sensitivity: PermissionSensitivity
  section?: string
  // True only for a permission key with a real, end-to-end-wired Review
  // Required tier: getPermissionTier()/isReviewRequired() (cloudflare/src/
  // lib/permissions.ts) checked by REVIEW_TIER_KEYS, at least one write
  // route actually branching via lib/reviewGate.ts's maybeQueueForReview()
  // instead of writing directly, and a matching applier registered in
  // lib/reviewApply.ts so an approved row actually gets replayed. Keep in
  // sync with frontend/src/utils/permissions.ts's own REVIEW_TIER_KEYS
  // set. Only set this once that full chain exists for the key -- picking
  // "Review Required" in the UI for a key that isn't actually wired would
  // silently do nothing (queue nothing, apply nothing), the exact
  // looks-wired-but-isn't class this project's own QA framework warns
  // about. PermissionEditor.tsx falls back to the plain Full/None checkbox
  // for every key without this flag.
  tier?: boolean
  // The flavor of the MIDDLE tier this `tier: true` section offers:
  //   'review' (default) -> the amber "Partial Access" that queues writes for
  //                         approval (REVIEW_TIER_KEYS in permissions.ts).
  //   'view'             -> a teal "View only" -- the page/data is visible but
  //                         every write is blocked (VIEW_TIER_KEYS). Used for
  //                         coarse admin areas with no approval queue.
  // A key is in exactly one of REVIEW_/VIEW_TIER_KEYS; this field just tells
  // the editor which middle option + label + color to render.
  middleTier?: 'review' | 'view'
  // Only meaningful alongside `tier: true`. Plain-English explanation of
  // exactly what Review Required restricts for THIS section -- shown via
  // an `i` info tooltip next to the tier picker (PermissionEditor.tsx),
  // same pattern InventoryMovementsSurface.tsx already uses for its own
  // "grouped movement history" info button. Every section's Review
  // Required scope is different (see the per-section spec in
  // progress.md's "Permissions UI redesign" item -- fees only queues
  // delete, contacts allows add directly but limits edit, etc.), so this
  // is per-key rather than one generic sentence. reviewTKey is checked
  // first (for translation); reviewDescription is the English fallback
  // used both directly and as translate()'s own fallback argument.
  // PermissionEditor.tsx falls back further to a generic sentence when
  // neither is set, so adding `tier: true` without also adding these
  // doesn't crash -- it just shows a vaguer tooltip than it should.
  reviewTKey?: string
  reviewDescription?: string
  // Mutual-exclusivity link between a plain boolean permission and a
  // `tier: true` permission elsewhere in this same list (both currently
  // only used for `products_image_only` <-> `products`, but written
  // generically rather than hardcoded to that one pair). When set, this
  // boolean can only be turned ON while the named tier key is currently
  // 'none' -- PermissionEditor.tsx disables the checkbox otherwise, since
  // real Full/Review Required access to that section always overrides
  // this narrower one and having both set on the same role is never a
  // meaningful combination, just a confusing one. Conversely, setting the
  // named tier key to 'full' or 'review' clears this boolean (and
  // whatever `alsoClearsKeys` lists) automatically, so a role can never
  // end up with both at once.
  exclusiveWithTier?: string
  // Only meaningful together with `exclusiveWithTier`. Other boolean keys
  // that only ever matter alongside this one (e.g. the five "show X"
  // sub-toggles that only apply to the image-only role) -- cleared in the
  // same step this permission is cleared by the tier override above, so
  // they don't linger on as orphaned, inert `true` values in a role's
  // stored permissions.
  alsoClearsKeys?: string[]
}

export interface PermissionSection {
  key: string
  tKey: string
  label: string
  description: string
  permissions: PermissionDefinition[]
}

// Reorganized (this session) to mirror the real sidebar, one section per
// nav page, in the same top-to-bottom order NAV_ITEMS
// (components/shared/navigationConfig.ts) renders them -- replacing the
// old thematic Administration/Operations/Sensitive-settings buckets, per
// explicit user instruction: "separate it according to pages in the
// sidebar, then go into detail in their sections." Every permission key
// that existed before still exists below with its `key`/`tier`/
// `reviewTKey`/`reviewDescription` unchanged -- this is a regrouping, not
// a behavior change, so nothing about what Full/Review Required/None
// actually does was touched. PermissionEditor.tsx itself needed no
// changes: it only iterates PERMISSION_SECTIONS -> section.permissions,
// so this data reshuffle is enough to change the rendered layout.
//
// Two label corrections made while moving these, both confirmed against
// the real page name in lang/en.json (the same string the sidebar itself
// renders), not guessed:
//   - 'products' was "Products and variants" -> now "Products" (the nav
//     item, App.tsx page header, and en.json's own `products` key all say
//     "Products"; "and variants" was describing the page's contents, not
//     its name, and had caused real confusion per the user's own report).
//   - 'contacts' was "Customers, suppliers, delivery contacts" -> now
//     "Contacts" (matches the `contacts` nav item/page name; the
//     Customers/Suppliers/Delivery-tab detail now lives in this section's
//     `description` instead of doubling as the permission's label).
//   - 'library' was "Library (uploaded files and assets)" -> now
//     "Library" (matches the `files` nav item's real sidebar label,
//     "Library", confirmed in en.json; the parenthetical detail moved to
//     this section's `description`).
//
// Two keys moved to the page that actually enforces them, confirmed by
// grep against real usage rather than assumed from the old bucket names:
//   - `destructive_delete` was filed under "Sensitive settings" but is
//     only ever checked in components/products/import/BulkImportModal.tsx
//     (gates the "replace all" bulk-import action) -- it belongs under
//     Products, not Settings, and is listed there now.
//   - `business_identity`/`sales_policy`/`security_settings`/
//     `drive_credentials` have no frontend call site of their own today
//     (cloudflare/src/lib/permissions.ts falls each of them back to the
//     plain `settings` grant -- confirmed by reading that file, not
//     assumed) -- these stay grouped under Settings as that page's own
//     finer-grained detail, since that IS the page whose sub-areas they
//     name.
export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    key: 'full_access',
    tKey: 'perm_section_full_access',
    label: 'Full Administrator Access',
    description: 'Overrides every section below -- full access to every page and action, with nothing gated.',
    permissions: [
      { key: 'all', tKey: 'perm_all', label: 'Administrator (full access)', sensitivity: 'critical' },
    ],
  },
  {
    key: 'dashboard',
    tKey: 'perm_section_dashboard',
    label: 'Dashboard',
    description: 'The Dashboard page and its export tools. Full Access or None for the page itself, plus an independent export toggle so a role can view without being able to export.',
    permissions: [
      { key: 'dashboard', tKey: 'perm_dashboard', label: 'Dashboard', sensitivity: 'normal' },
      // Independent of the page-access key above -- a role can have
      // dashboard: true, dashboard_export: false ("View only, no export")
      // as well as the usual true/true ("Full access") and false/*
      // ("No access", export is unreachable without the page anyway).
      // Not a tier: true / Review Required key -- Dashboard has no
      // create/edit/delete workflow to queue, this is a plain second
      // boolean grant, same shape as e.g. 'backup' vs 'backup_restore'.
      { key: 'dashboard_export', tKey: 'perm_dashboard_export', label: 'Export dashboard data', sensitivity: 'normal' },
    ],
  },
  {
    key: 'customer_portal',
    tKey: 'perm_section_customer_portal',
    label: 'Customer Portal',
    description: 'Covers both the public Customer Portal page and the Loyalty Points page.',
    permissions: [
      { key: 'customer_portal', tKey: 'perm_customer_portal', label: 'Customer Portal', sensitivity: 'normal' },
    ],
  },
  {
    key: 'promotions',
    tKey: 'perm_section_promotions',
    label: 'Promotions',
    description: 'Managing promotion rules and per-product discounts on the Promotions page. Reading active promotions (POS pricing, storefront display) needs no grant -- every logged-in user prices with the same rules.',
    permissions: [
      // Full Access / None only -- a promotion is storefront-wide pricing;
      // there is no meaningful "review" middle tier for it today.
      { key: 'promotions', tKey: 'perm_promotions', label: 'Promotions', sensitivity: 'high' },
    ],
  },
  {
    key: 'pos',
    tKey: 'perm_section_pos',
    label: 'Point of Sale',
    description: 'Full Access or None only -- no partial tier for checkout itself.',
    permissions: [
      { key: 'pos', tKey: 'perm_pos', label: 'Point of Sale', sensitivity: 'normal' },
    ],
  },
  {
    key: 'products',
    tKey: 'perm_section_products',
    label: 'Products',
    description: 'The Products page, including its bulk-import tools. "Products (conditions hidden)" below is a separate, narrower way into this same page -- a role can have real Products access (Full or Review Required) OR that narrower option, never both at once; granting real access always overrides and disables the narrower one.',
    permissions: [
      // tier: true -- Products' Review Required tier is wired end to end:
      // create/update/delete all queue via lib/reviewGate.ts's
      // maybeQueueForReview() (unlike Fees, nothing applies directly under
      // this tier -- every write goes to the queue). Import/export are
      // gated by the strict `hasPermission()` used in routes/importJobs.ts
      // and the export routes, which already rejects the 'review' string
      // value (not === true), so they're correctly unreachable without any
      // extra code. Merge-duplicates and zero-quantity-cleanup are
      // separate maintenance tools, also strict-`hasPermission()`-gated
      // (Full Access only), not part of this tier's add/edit/delete scope.
      {
        key: 'products',
        tKey: 'perm_products',
        label: 'Products',
        sensitivity: 'normal',
        tier: true,
        reviewTKey: 'perm_products_review_desc',
        reviewDescription: 'Under Review Required, viewing and searching products works directly. Adding, editing, or deleting a product goes to the Review/Approval queue for an admin to approve or reject. Import, export, merge-duplicates, and the zero-quantity cleanup tool all require Full Access.',
      },
      // Moved here from the old "Sensitive settings" bucket -- confirmed
      // by source (components/products/import/BulkImportModal.tsx) that
      // this only gates the bulk-import "replace all" action on Products,
      // nothing settings-related. See this file's header comment.
      { key: 'destructive_delete', tKey: 'perm_destructive_delete', label: 'Bulk import: "replace all" (destructive)', sensitivity: 'critical' },
      // Part 241: a genuinely different SHAPE of access than the
      // Full/Review/None tier above (field-restricted, not a gradient on
      // the same full view) -- deliberately a plain boolean, not part of
      // the `products` tier picker. A user with real `products` access
      // (full or review) never hits this restriction even if it's also
      // set on their role; it only matters for someone whose ONE route
      // into this page is this key. See cloudflare/src/lib/
      // productWrites.ts's isImageOnlyUser()/IMAGE_ONLY_BASE_FIELDS for
      // the enforced shape: always sees name + image, can only ever
      // change the image. What else this role can see (price, barcode,
      // category, brand, stock) is no longer bundled into this one key --
      // see the five checkboxes right below, added Part 243 so an org can
      // opt this role into each field individually instead of a single
      // hardcoded all-or-nothing decision.
      //
      // Renamed from "Image upload only (restricted view: name + image)"
      // and given `exclusiveWithTier`/`alsoClearsKeys` (per explicit user
      // request): real Products access (Full or Review Required, set via
      // the tier picker just above) always overrides this option, and the
      // two are no longer allowed to both be set on the same role at
      // once -- PermissionEditor.tsx disables this checkbox while
      // `products` is anything other than None, and switching `products`
      // to Full/Review Required clears this key (and the five show-*
      // toggles below it) automatically.
      {
        key: 'products_image_only',
        tKey: 'perm_products_image_only',
        label: 'Products (conditions hidden \u2014 image only)',
        sensitivity: 'normal',
        exclusiveWithTier: 'products',
        alsoClearsKeys: [
          'products_image_only_show_price',
          'products_image_only_show_vip',
          'products_image_only_show_barcode',
          'products_image_only_show_category',
          'products_image_only_show_brand',
          'products_image_only_show_stock',
          'products_image_only_show_branch_stock',
          'products_image_only_show_batches',
        ],
      },
      // Part 243: each of these unlocks ONE extra field for the
      // `products_image_only` role above -- hidden by default (the
      // permission key simply absent/false), shown only once explicitly
      // granted. Deliberately five separate booleans rather than one
      // "show more" toggle, so an org can mix and match (e.g. show
      // category + stock but keep price hidden). Meaningless for anyone
      // who already has real `products` access, same scoping note as
      // `products_image_only` itself. See cloudflare/src/lib/
      // productWrites.ts's IMAGE_ONLY_OPTIONAL_FIELDS for the field-key
      // mapping enforced server-side, and ProductsImageOnlyView.tsx for
      // where the UI reads these same keys via useApp().hasPermission().
      { key: 'products_image_only_show_price', tKey: 'perm_products_image_only_show_price', label: 'Image-only role: show selling price', sensitivity: 'normal' },
      { key: 'products_image_only_show_vip', tKey: 'perm_products_image_only_show_vip', label: 'Image-only role: show VIP price', sensitivity: 'normal' },
      { key: 'products_image_only_show_barcode', tKey: 'perm_products_image_only_show_barcode', label: 'Image-only role: show barcode', sensitivity: 'normal' },
      { key: 'products_image_only_show_category', tKey: 'perm_products_image_only_show_category', label: 'Image-only role: show category', sensitivity: 'normal' },
      { key: 'products_image_only_show_brand', tKey: 'perm_products_image_only_show_brand', label: 'Image-only role: show brand', sensitivity: 'normal' },
      { key: 'products_image_only_show_stock', tKey: 'perm_products_image_only_show_stock', label: 'Image-only role: show stock quantity', sensitivity: 'normal' },
      // K6 (Part 387): the last two view rows of the "view everything,
      // touch nothing" arrangement. Branch stock rides the row's attached
      // per-branch array; batches opens the read-only lot list (the server
      // strips unit cost / paid-credit state for this grant).
      { key: 'products_image_only_show_branch_stock', tKey: 'perm_products_image_only_show_branch_stock', label: 'Image-only role: show per-branch stock', sensitivity: 'normal' },
      { key: 'products_image_only_show_batches', tKey: 'perm_products_image_only_show_batches', label: 'Image-only role: show batches/lots (no costs)', sensitivity: 'normal' },
    ],
  },
  {
    key: 'inventory',
    tKey: 'perm_section_inventory',
    label: 'Inventory',
    description: 'Stock levels, adjustments, and branch transfers.',
    permissions: [
      // tier: true -- Inventory's Review Required tier is wired end to
      // end, in the same mixed shape Branches uses: editing the saved
      // reasons list (`PUT /reasons`) queues via maybeQueueForReview()
      // (no live-state risk -- replaying it later is exactly as safe as
      // applying it now). Stock adjustments, branch transfers, and moving
      // stock between rows all mutate live batch/stock state that could go
      // stale between a Review Required user's request and an admin's
      // approval, so -- same discipline as Branches' transfer/repair
      // routes -- they're explicitly blocked outright for this tier
      // (Part 152/153) rather than queued unsafely or silently left open.
      {
        key: 'inventory',
        tKey: 'perm_inventory',
        label: 'Inventory and stock transfer',
        sensitivity: 'high',
        tier: true,
        reviewTKey: 'perm_inventory_review_desc',
        reviewDescription: 'Under Review Required, viewing inventory works directly. Editing the saved reasons list goes to the Review/Approval queue for an admin to approve or reject. Stock adjustments, branch transfers, and moving stock between rows all require Full Access.',
      },
    ],
  },
  {
    key: 'branches',
    tKey: 'perm_section_branches',
    label: 'Branches',
    description: 'Branch records and inter-branch stock movement.',
    permissions: [
      // tier: true -- Branch used to be folded into the 'inventory' key
      // above; split into its own key so it can be granted independently
      // (see cloudflare/src/lib/permissions.ts's ENTITY_PERMISSION_MAP
      // comment for the backend half of this split). Review Required tier
      // is wired end to end: create/update queue directly (no live-state
      // risk), delete also queues but its applier re-checks "not the
      // default branch" / "no stock left" at approval time, not just at
      // request time. Transferring stock and repairing misplaced stock
      // both move real quantities and are deliberately Full-Access-only
      // for now -- a Review Required user can view branches and submit a
      // create/edit/delete for approval, but cannot transfer stock between
      // branches.
      {
        key: 'branches',
        tKey: 'perm_branches',
        label: 'Branches',
        sensitivity: 'high',
        tier: true,
        reviewTKey: 'perm_branches_review_desc',
        reviewDescription: 'Under Review Required, viewing branches works directly. Creating, editing, or deleting a branch goes to the Review/Approval queue for an admin to approve or reject. Transferring stock between branches and repairing misplaced stock both require Full Access.',
      },
    ],
  },
  {
    key: 'sales',
    tKey: 'perm_section_sales',
    label: 'Sales',
    description: 'None / View only / Full. View only shows every sale, stat, report and export but blocks writes (cancel, change status, edit customer, import).',
    permissions: [
      // View-tier section (Part 557 slice 2): all sales READS
      // (list/stats/reports/export) admit a 'view' grant; the writes
      // (routes/sales.ts PATCH /:id/status, /:id/customer, and the import
      // job) stay strict hasPermission('sales'), which a 'view' value fails.
      // Creating a sale is separate -- POS checkout carries its own 'pos'
      // grant, so a view-sales cashier still can't ring one up here.
      {
        key: 'sales',
        tKey: 'perm_sales',
        label: 'Sales',
        sensitivity: 'high',
        tier: true,
        middleTier: 'view',
        reviewTKey: 'perm_sales_view_desc',
        reviewDescription: 'View only: see every sale, stat, report and export, but Cancel, change status, edit customer, and Import are hidden and refused. Full Access is required to change or import sales.',
      },
    ],
  },
  {
    key: 'returns',
    tKey: 'perm_section_returns',
    label: 'Returns',
    description: 'Its own permission key, independent of Sales.',
    permissions: [
      // tier: true -- Returns' Review Required tier is wired end to end:
      // the router-wide gate admits a review-tier user for reads, POST /
      // (create a return) has no extra tier check so it applies directly,
      // and PATCH /:id (edit) is explicitly blocked for review (Part 154)
      // since editing reverses and re-applies batch restocking against
      // live, possibly-stale state -- same reasoning as Inventory's
      // adjust/transfer above. Returns has no delete route in this app at
      // all, so the original spec's "delete goes to review" line has
      // nothing to wire; nothing queues into pending_actions for Returns,
      // so there's no applier in lib/reviewApply.ts, by design.
      {
        key: 'returns',
        tKey: 'perm_returns',
        label: 'Returns',
        sensitivity: 'high',
        tier: true,
        reviewTKey: 'perm_returns_review_desc',
        reviewDescription: 'Under Review Required, viewing, searching, and creating a return all work directly. Editing an existing return requires Full Access. There is no delete action for returns in this app.',
      },
    ],
  },
  {
    key: 'fees',
    tKey: 'perm_section_fees',
    label: 'Fees',
    description: 'Tax, delivery, and other charges.',
    permissions: [
      // tier: true -- 'fees' is the one section whose Review Required tier
      // is actually wired end to end today (DELETE /api/fees/:id queues
      // via lib/reviewGate.ts when the tier is 'review'; lib/reviewApply.ts
      // has a registered fees/delete/fee applier for approval). Under
      // Review Required, everything on the Fees page works directly --
      // create, edit, search -- except delete, which goes into the
      // Review/Approval queue for an admin to approve or reject. See
      // routes/fees.ts's own comments for the exact rule.
      {
        key: 'fees',
        tKey: 'perm_fees',
        label: 'Fees',
        sensitivity: 'high',
        tier: true,
        reviewTKey: 'perm_fees_review_desc',
        reviewDescription: 'Under Review Required, create, edit, and search all work directly. Only delete goes to the Review/Approval queue for an admin to approve or reject.',
      },
    ],
  },
  {
    key: 'contacts',
    tKey: 'perm_section_contacts',
    label: 'Contacts',
    description: 'Covers all three Contacts tabs: Customers, Suppliers, and Delivery.',
    permissions: [
      // tier: true -- Contacts' Review Required tier is wired end to end,
      // narrower than Products/Inventory/Returns: POST (create) has no
      // tier restriction at all and applies directly (spec: "add directly,
      // no review needed"), PUT (edit) silently drops every submitted
      // field except `name` for a review-tier user (backend response
      // flags `partial: true` + which fields were dropped, Part 157, so
      // the frontend can surface a clear warning instead of a plain
      // "Updated" toast), and DELETE is blocked outright. Since add
      // applies directly and edit never queues, nothing here goes into
      // pending_actions -- no applier registered in lib/reviewApply.ts,
      // same shape as Library.
      {
        key: 'contacts',
        tKey: 'perm_contacts',
        label: 'Contacts',
        sensitivity: 'normal',
        tier: true,
        reviewTKey: 'perm_contacts_review_desc',
        reviewDescription: 'Under Review Required, viewing, searching, and adding a contact all work directly. Editing an existing contact is limited to the name field -- every other change is silently dropped, with a warning shown after saving. Deleting a contact requires Full Access.',
      },
      // Supplier privacy (Part 383 R2): the Suppliers tab (and every
      // /suppliers endpoint -- list with contact details, duplicates,
      // merge, edit) is admin territory unless this is granted on top of
      // the contacts permission above. Employees without it still see
      // supplier NAMES on batches and in the supplier pickers (the
      // fields=names read stays open) -- this key gates the contact
      // records themselves.
      { key: 'contacts_suppliers', tKey: 'perm_contacts_suppliers', label: 'Suppliers section', sensitivity: 'high' },
    ],
  },
  // Users & roles management is DELIBERATELY admin-only (Part 557 slice 3):
  // every route in cloudflare/src/routes/users.ts gates on
  // isAdminControlUser(actor) (the reserved `admin` username, the `admin`
  // role code, or an explicit `permissions.all` grant) -- the plain `users`
  // permission key is checked NOWHERE on the backend, and Users.tsx's own
  // canManage is hasPermission('all'). A per-role `users` toggle here would
  // therefore be a fake control: granting it to a non-admin showed the empty
  // Users section but every read/write was refused. So there is no `users`
  // section in this editor -- managing users requires the Admin role, and
  // SettingsHubPage gates the section on hasPermission('all') to match.
  {
    key: 'review',
    tKey: 'perm_section_review',
    label: 'Review',
    description: 'The Review/Approval queue for every section’s Review Required tier above. Full Access or None only, same admin-control gate shape as user management.',
    permissions: [
      // Review/Approval queue for the Review Required permission tier (see
      // progress.md's "Permissions UI redesign" item). Full Access/None
      // only -- no partial tier for this page itself.
      { key: 'review', tKey: 'perm_review', label: 'Review and approval queue', sensitivity: 'critical' },
    ],
  },
  {
    key: 'audit_log',
    tKey: 'perm_section_audit_log',
    label: 'Audit Log',
    description: 'View-only history of every action across the app.',
    permissions: [
      { key: 'audit_log', tKey: 'perm_audit_log', label: 'Audit log', sensitivity: 'high' },
    ],
  },
  {
    key: 'backup',
    tKey: 'perm_section_backup',
    label: 'Backup',
    description: 'Exporting a backup and restoring/resetting from one are separate, independently-grantable actions -- restoring or resetting is far more dangerous than exporting.',
    permissions: [
      { key: 'backup', tKey: 'perm_backup', label: 'Backup export', sensitivity: 'high' },
      { key: 'backup_restore', tKey: 'perm_backup_restore', label: 'Backup restore and reset', sensitivity: 'critical' },
    ],
  },
  {
    key: 'settings',
    tKey: 'perm_section_settings',
    label: 'Settings',
    description: "Also covers the standalone Receipt Settings page, which gates on this same grant. The four detail rows below are this page's own finer-grained areas -- each currently mirrors the plain Settings grant one-for-one (see cloudflare/src/lib/permissions.ts) until they're each wired to their own independent check.",
    permissions: [
      // View-tier section (Part 557): reading settings is open to any signed-in
      // user already (routes/settings.ts GET / strips secrets and serves the
      // map to every cashier), and saving is gated on a strict `settings ===
      // true` (POST /), so a 'view' value can SEE settings but every save is
      // refused. None / View only / Full.
      {
        key: 'settings',
        tKey: 'perm_settings',
        label: 'Device and basic settings',
        sensitivity: 'normal',
        tier: true,
        middleTier: 'view',
        reviewTKey: 'perm_settings_view_desc',
        reviewDescription: 'View only: this person can open Settings and see every value, but the Save button is disabled and any save is refused. Full Access is required to change settings.',
      },
      { key: 'business_identity', tKey: 'perm_business_identity', label: 'Business identity, logo, public profile', sensitivity: 'high' },
      { key: 'sales_policy', tKey: 'perm_sales_policy', label: 'Sales, return, and financial policy', sensitivity: 'high' },
      { key: 'security_settings', tKey: 'perm_security_settings', label: 'Security and sign-in settings', sensitivity: 'critical' },
      { key: 'drive_credentials', tKey: 'perm_drive_credentials', label: 'Google Drive credentials', sensitivity: 'critical' },
    ],
  },
  {
    key: 'library',
    tKey: 'perm_section_library',
    label: 'Library',
    description: 'Uploaded files and media assets. Browsing/searching/previewing the Library needs no permission at all -- any authenticated user can reach the page. This grant controls management actions only: upload, bulk download, rename, and delete. The page still falls back to the Settings grant as a transitional OR (Part 156, kept deliberately so no existing installation is locked out) -- grant this key directly going forward.',
    permissions: [
      // Full Access / None only -- deliberately no three-way tier flag
      // here. This section had a Review Required middle tier through Part
      // 156, but the library view/manage split (this session) made view
      // free for everyone and every management action Full-Access-only,
      // so there's no longer a distinct middle ground for the review tier
      // to grant -- it would behave identically to None. Removed from
      // both cloudflare/src/lib/permissions.ts's and
      // frontend/src/utils/permissions.ts's REVIEW_TIER_KEYS in the same
      // session; see those files' comments for the full reasoning.
      {
        key: 'library',
        tKey: 'perm_library',
        label: 'Library',
        sensitivity: 'normal',
      },
    ],
  },
]

export const PERMISSION_DEFS: PermissionDefinition[] = PERMISSION_SECTIONS.flatMap((section) => (
  section.permissions.map((permission) => ({ ...permission, section: section.key }))
))
