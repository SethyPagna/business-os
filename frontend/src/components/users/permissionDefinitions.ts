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
  //   'review' (default) -> the amber "Review" that queues writes for
  //                         approval (REVIEW_TIER_KEYS in permissions.ts).
  //   'view'             -> a teal "View" -- the page/data is visible but
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
  // The key that opens the module on an on/off section (no `tier`). The editor's Full level sets this key and
  // nothing else, so a module's costs, destructive imports and similar extras stay separate switches.
  lead?: true
  // A second lead key drawn as its own row under the module's main row, with its own None / Full cells.
  subRow?: true
  // The switch chip's word (`short` is the English pack text) and, for a grant that needs a warning, the
  // tooltip that goes with it.
  shortTKey?: string
  short?: string
  hintTKey?: string
  hint?: string
}

export interface PermissionSection {
  key: string
  tKey: string
  label: string
  description: string
  permissions: PermissionDefinition[]
}

// One section per sidebar page, in the order NAV_ITEMS
// (components/shared/navigationConfig.ts) renders them. PermissionEditor.tsx
// only iterates PERMISSION_SECTIONS -> section.permissions, so this data
// decides the rendered layout. A section's label is the page's real name in
// lang/en.json, the string the sidebar itself renders, and per-tab detail
// lives in its `description`.
//
// A key sits under the page that enforces it:
//   - `destructive_delete` gates only the replace-all and replace-columns
//     product imports (the import picker and the Worker's import jobs), so it
//     is listed under Products, not Settings.
//   - `business_identity`/`sales_policy`/`drive_credentials` have no frontend call site of
//     their own; each is its own explicit grant (owner, 21 Oct 2026: Full = main access
//     only; the Worker has no fallback between keys), grouped under Settings, the page
//     whose sub-areas they name. `security_settings` has no row: no Worker route reads it.
//   - Receipts, the four Website Editor areas, the Library and AI provider keys are separate
//     grants too and keep their own rows and sections.
export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    key: 'full_access',
    tKey: 'perm_section_full_access',
    label: 'Full Administrator Access',
    description: 'Every module and action, including all Shifts. Turn it off to set each module.',
    permissions: [
      { key: 'all', tKey: 'perm_all', label: 'Administrator (full access)', sensitivity: 'critical' },
    ],
  },
  {
    key: 'dashboard',
    tKey: 'perm_section_dashboard',
    label: 'Dashboard',
    description: 'The Dashboard page. Export is a separate switch.',
    permissions: [
      { key: 'dashboard', tKey: 'perm_dashboard', label: 'Dashboard', sensitivity: 'normal', lead: true },
      // Independent of the page-access key above -- a role can have
      // dashboard: true, dashboard_export: false ("View, no export")
      // as well as the usual true/true ("Full access") and false/*
      // ("No access", export is unreachable without the page anyway).
      // Not a tier: true / Review Required key -- Dashboard has no
      // create/edit/delete workflow to queue, this is a plain second
      // boolean grant, same shape as e.g. 'backup' vs 'backup_restore'.
      { key: 'dashboard_export', tKey: 'perm_dashboard_export', label: 'Export dashboard data', sensitivity: 'normal', shortTKey: 'export', short: 'Export' },
    ],
  },
  {
    key: 'customer_portal',
    tKey: 'perm_section_customer_portal',
    label: 'Website Editor',
    description: 'Edit the public website in four separate areas: Posts, FAQ, About and site setup. Full turns all four on.',
    permissions: [
      // Per-area write grants -- mirror cloudflare/src/routes/settings.ts's
      // PORTAL_*_KEYS buckets. Each is plain Full/None (no tier): the editor
      // section + its save self-gate on the matching key, and the backend
      // POST /settings rejects any customer_portal_* key the caller lacks.
      { key: 'portal_posts', tKey: 'perm_portal_posts', label: 'Manage posts & promos', sensitivity: 'normal', shortTKey: 'perm_short_posts', short: 'Posts' },
      { key: 'portal_faq', tKey: 'perm_portal_faq', label: 'Manage FAQ', sensitivity: 'normal', shortTKey: 'faq', short: 'FAQ' },
      { key: 'portal_about', tKey: 'perm_portal_about', label: 'Manage About section', sensitivity: 'normal', shortTKey: 'about', short: 'About' },
      // The catch-all "portal config": branding, media, theme, catalog display,
      // social links, AI assistant, maps, translations, publishing, loyalty,
      // and submission moderation.
      { key: 'customer_portal', tKey: 'perm_customer_portal', label: 'Manage portal config', sensitivity: 'normal', shortTKey: 'perm_short_site_setup', short: 'Site setup' },
    ],
  },
  {
    key: 'promotions',
    tKey: 'perm_section_promotions',
    label: 'Promotions',
    description: 'View: see the rules. Full: create, edit and delete them.',
    permissions: [
      // View-tier section (Part 557 slice 4): the promotion RULE list read
      // (routes/promotions.ts GET /rules) admits a 'view' grant; every write
      // (POST/PUT/DELETE /rules) stays strict requireKey('promotions')
      // (hasPermission === true), which a 'view' value fails. Reading the
      // ACTIVE rule set (/rules/active) needs no grant at all -- POS/storefront
      // pricing is not "managing promotions".
      {
        key: 'promotions',
        tKey: 'perm_promotions',
        label: 'Promotions',
        sensitivity: 'high',
        tier: true,
        middleTier: 'view',
        reviewTKey: 'perm_promotions_view_desc',
        reviewDescription: 'View: see the promotion rule list, but New rule, edit and delete are hidden and refused. Full Access is required to manage promotions.',
      },
    ],
  },
  {
    key: 'pos',
    tKey: 'perm_section_pos',
    label: 'POS',
    description: 'Checkout. Also opens Shifts: close, reopen or amend your own shifts.',
    permissions: [
      { key: 'pos', tKey: 'perm_pos', label: 'POS', sensitivity: 'normal', lead: true },
    ],
  },
  {
    key: 'products',
    tKey: 'perm_section_products',
    label: 'Products',
    description: 'Products and imports. Costs and destructive imports are separate. Opening stock also needs Inventory › Adjust / receive.',
    permissions: [
      // tier: true -- add, edit and delete queue via maybeQueueForReview() (lib/reviewGate.ts); an edit that
      // would merge two products queues too. Every other action is Full only (utils/permissionActions.ts lists
      // them), and export is enforced in the browser.
      {
        key: 'products',
        tKey: 'perm_products',
        label: 'Products',
        sensitivity: 'normal',
        tier: true,
        reviewTKey: 'perm_products_review_desc',
        reviewDescription: 'Under Review, viewing and searching products works directly. Adding, editing, or deleting a product goes to the Review/Approval queue for an admin to approve or reject. So does an edit that would merge this product into another one, unless Merge duplicates is switched off for the role, which refuses that edit. Import, export, merge-duplicates, and the zero-quantity cleanup tool all require Full Access.',
      },
      { key: 'product_cost_view', tKey: 'perm_product_cost_view', label: 'View product costs', sensitivity: 'high', shortTKey: 'perm_short_cost_view', short: 'See costs' },
      { key: 'product_cost_edit', tKey: 'perm_product_cost_edit', label: 'Edit product costs', sensitivity: 'high', shortTKey: 'perm_short_cost_edit', short: 'Enter costs' },
      // Gates the replace-all and replace-columns product imports, in the import picker and in the Worker
      // (lib/importEngine.ts missingDestructiveImportPermission).
      { key: 'destructive_delete', tKey: 'perm_destructive_delete', label: 'Destructive imports: replace all and replace columns', sensitivity: 'critical', shortTKey: 'perm_short_destructive_imports', short: 'Destructive imports' },
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
        shortTKey: 'perm_short_image_only',
        short: 'Image-only access',
        exclusiveWithTier: 'products',
        alsoClearsKeys: [
          'products_image_only_show_price',
          // products_image_only_show_vip is not listed any more: the key no
          // longer exists (2026-09-04 ruling deleted the tier). Nothing is
          // stranded -- 0 users and 0 roles held it when production was
          // checked -- and a role that somehow still carries the stale key just
          // carries an inert boolean nothing reads.
          'products_image_only_show_wholesale',
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
      // The 'products_image_only_show_vip' row is deleted (2026-09-04 ruling):
      // the tier it revealed was the wholesale price under a wrong name, and
      // migration 0111 emptied special_price_*, so the grant could only ever
      // have exposed two permanently empty columns. Wholesale is the survivor.
      { key: 'products_image_only_show_wholesale', tKey: 'perm_products_image_only_show_wholesale', label: 'Image-only role: show wholesale price', sensitivity: 'normal' },
      { key: 'products_image_only_show_barcode', tKey: 'perm_products_image_only_show_barcode', label: 'Image-only role: show barcode', sensitivity: 'normal' },
      { key: 'products_image_only_show_category', tKey: 'perm_products_image_only_show_category', label: 'Image-only role: show category', sensitivity: 'normal' },
      { key: 'products_image_only_show_brand', tKey: 'perm_products_image_only_show_brand', label: 'Image-only role: show brand', sensitivity: 'normal' },
      { key: 'products_image_only_show_stock', tKey: 'perm_products_image_only_show_stock', label: 'Image-only role: show stock quantity', sensitivity: 'normal' },
      // K6 (Part 387): the last two view rows of the "view everything,
      // touch nothing" arrangement. Branch stock rides the row's attached
      // per-branch array; batches opens the read-only lot list (the server
      // strips unit cost / paid-credit state for this grant).
      { key: 'products_image_only_show_branch_stock', tKey: 'perm_products_image_only_show_branch_stock', label: 'Image-only role: show per-branch stock', sensitivity: 'normal' },
      { key: 'products_image_only_show_batches', tKey: 'perm_products_image_only_show_batches', label: 'Image-only role: show received dates (no costs)', sensitivity: 'normal' },
    ],
  },
  {
    key: 'inventory',
    tKey: 'perm_section_inventory',
    label: 'Inventory',
    description: 'Stock levels, adjustments and transfers. Counting is set by Inventory check sessions.',
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
        reviewDescription: 'Under Review, viewing inventory works directly. Editing the saved reasons list goes to the Review/Approval queue for an admin to approve or reject. Stock adjustments, branch transfers, and moving stock between rows all require Full Access.',
      },
      { key: 'inventory_checks', tKey: 'perm_inventory_checks', label: 'Inventory check sessions', sensitivity: 'normal', lead: true, subRow: true },
      ...[
        ['price', 'Show selling prices'], ['barcode', 'Show barcodes and SKUs'],
        ['category', 'Show categories'], ['brand', 'Show brands'], ['stock', 'Show recorded stock'],
        ['received', 'Show received dates'], ['sales', 'Show units sold'], ['customers', 'Show customer counts'],
        ['cost', 'Show costs when permitted'],
      ].map(([field, label]) => ({
        key: `inventory_check_show_${field}`, tKey: `perm_inventory_check_show_${field}`, label,
        sensitivity: 'normal' as const,
      })),
    ],
  },
  {
    key: 'branches',
    tKey: 'perm_section_branches',
    label: 'Branches',
    description: 'Branch details, exports and stock transfers between branches.',
    permissions: [
      // Canonical branch identities are fixed: the editor therefore exposes
      // no create/delete claim. Review Required can view/export and submit
      // detail edits for approval; stock transfer and repair remain Full-only.
      {
        key: 'branches',
        tKey: 'perm_branches',
        label: 'Branches',
        sensitivity: 'high',
        tier: true,
        reviewTKey: 'perm_branches_review_desc',
        reviewDescription: 'Under Review, viewing and exporting branches works directly. Editing canonical branch details goes to the Review/Approval queue. Transferring stock and repairing misplaced stock require Full Access.',
      },
    ],
  },
  {
    key: 'sales',
    tKey: 'perm_section_sales',
    label: 'Sales',
    description: 'View: read sales and reports. Full: change sales and open Shifts.',
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
        reviewDescription: 'View: see every sale, stat, report and export, but Cancel, change status, edit customer, and Import are hidden and refused. Full Access is required to change or import sales.',
      },
    ],
  },
  {
    key: 'returns',
    tKey: 'perm_section_returns',
    label: 'Returns',
    description: 'Customer returns. Has its own switch, separate from Sales.',
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
        reviewDescription: 'Under Review, viewing, searching, and creating a return all work directly. Editing an existing return requires Full Access. There is no delete action for returns in this app.',
      },
    ],
  },
  {
    key: 'fees',
    tKey: 'perm_section_fees',
    label: 'Expenses',
    description: 'Expenses: tax, delivery and other charges.',
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
        label: 'Expenses',
        sensitivity: 'high',
        tier: true,
        reviewTKey: 'perm_fees_review_desc',
        reviewDescription: 'Under Review, create, edit, search, and export work directly. Only delete goes to the Review/Approval queue for an admin to approve or reject.',
      },
    ],
  },
  {
    key: 'contacts',
    tKey: 'perm_section_contacts',
    label: 'Contacts',
    description: 'The Customers, Suppliers and Delivery tabs. The Suppliers section is a separate switch.',
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
        reviewDescription: 'Under Review, viewing, searching, and adding a contact all work directly. Editing an existing contact is limited to the name field -- every other change is silently dropped, with a warning shown after saving. Deleting a contact requires Full Access.',
      },
      // Supplier privacy (Part 383 R2): the Suppliers tab (and every
      // /suppliers endpoint -- list with contact details, duplicates,
      // merge, edit) is admin territory unless this is granted on top of
      // the contacts permission above. Employees without it still see
      // supplier NAMES on batches and in the supplier pickers (the
      // fields=names read stays open) -- this key gates the contact
      // records themselves.
      { key: 'contacts_suppliers', tKey: 'perm_contacts_suppliers', label: 'Suppliers section', sensitivity: 'high', shortTKey: 'suppliers', short: 'Suppliers' },
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
    label: 'Review queue',
    description: 'Approve or refuse changes waiting for review. View shows the queue only.',
    permissions: [
      // View-tier section (Part 557 slice 5): reading the pending queue
      // (routes/reviewQueue.ts GET / and GET /:id) admits a 'view' grant; the
      // two writes (POST /:id/approve, /:id/reject) re-check strict
      // hasPermission('review') (=== true), which a 'view' value fails. The
      // submitter's own /mine + /:id/resubmit routes never needed 'review' and
      // are unaffected.
      {
        key: 'review',
        tKey: 'perm_review',
        label: 'Review and approval queue',
        sensitivity: 'critical',
        tier: true,
        middleTier: 'view',
        reviewTKey: 'perm_review_view_desc',
        reviewDescription: 'View: watch the pending approval queue, but Approve and Reject are hidden and refused. Acting on requests needs Full Access here; approving also needs Full access to each request’s own section and action (for example Products: Edit product), plus the price, image or cost permission when the request changes one. Nobody can approve their own request. Rejecting needs only Full Access here.',
      },
    ],
  },
  {
    key: 'audit_log',
    tKey: 'perm_section_audit_log',
    label: 'Audit Log',
    description: 'View: your own actions. Full: everyone’s. The log cannot be reset.',
    permissions: [
      // View-tier section (Part 557 slice 7), where 'view' is OWN-scoped rather
      // than read-only (the whole page is read-only anyway): 'view' = see only
      // your own audit entries (routes/compat.ts GET /system/audit-logs forces
      // userId = self for a view tier); 'full' = see everyone's, and is the only
      // tier that unlocks the cross-user legacy deleted-sales ledger + the
      // retention-purge endpoint (both keep strict denyUnless('audit_log')).
      {
        key: 'audit_log',
        tKey: 'perm_audit_log',
        label: 'Audit log',
        sensitivity: 'high',
        tier: true,
        middleTier: 'view',
        reviewTKey: 'perm_audit_log_view_desc',
        reviewDescription: 'View: see your OWN actions in the audit log. Full Access is required to see every user’s actions and the deleted-sales evidence ledger.',
      },
    ],
  },
  {
    key: 'backup',
    tKey: 'perm_section_backup',
    label: 'Backup',
    description: 'Export a backup. Restore / reset is a separate switch.',
    permissions: [
      { key: 'backup', tKey: 'perm_backup', label: 'Backup export', sensitivity: 'high', lead: true },
      { key: 'backup_restore', tKey: 'perm_backup_restore', label: 'Backup restore and reset', sensitivity: 'critical', shortTKey: 'perm_short_restore_reset', short: 'Restore / reset', hintTKey: 'perm_backup_restore_desc', hint: 'Restores a backup or resets business data. The audit log is never reset.' },
    ],
  },
  {
    key: 'settings',
    tKey: 'perm_section_settings',
    label: 'Settings',
    // Full changes every setting and nothing else (owner, 21 Oct 2026): Identity, Policies, Receipts and Google Drive
    // here, the Website Editor areas, the Library and AI provider keys are separate switches. The one thing with no row
    // is the system checks (runtime.ts), which the text names. One plain line, 120 characters at most, in both packs.
    description: 'View: read. Full: change settings and run system checks. Identity, Policies, Receipts and Drive are separate switches.',
    permissions: [
      // View-tier section (Part 557): reading settings is open to any signed-in
      // user already (routes/settings.ts GET / strips secrets and serves the
      // map to every cashier), and saving is gated on a strict `settings ===
      // true` (POST /), so a 'view' value can SEE settings but every save is
      // refused. None / View / Full.
      {
        key: 'settings',
        tKey: 'perm_settings',
        label: 'Device and basic settings',
        sensitivity: 'normal',
        tier: true,
        middleTier: 'view',
        reviewTKey: 'perm_settings_view_desc',
        reviewDescription: 'View: this person can open Settings and see every value, but the Save button is disabled and any save is refused. Full Access is required to change settings.',
      },
      { key: 'business_identity', tKey: 'perm_business_identity', label: 'Business identity, logo, public profile', sensitivity: 'high', shortTKey: 'perm_short_identity', short: 'Business identity' },
      { key: 'sales_policy', tKey: 'perm_sales_policy', label: 'Sales, return, and financial policy', sensitivity: 'high', shortTKey: 'perm_short_policies', short: 'Policies' },
      // Own key (Sep 16 2026 owner request), separate from the plain
      // `settings` grant -- the standalone Receipt Settings page (print
      // modes, footer, template) is an operational tool for whoever prints
      // receipts, not an admin-only setting. Defaults ON for Employee (see
      // coreDataInvariants.ts's DEFAULT_ROLE_PERMISSIONS); an admin can still
      // turn it off per role here. Enforced server-side by
      // routes/settings.ts's settingsBucketPermissionFor() on
      // receipt_template/receipt_footer/receipt_print_settings, and gates
      // the page itself via AppContext.tsx's PAGE_PERMISSIONS.
      { key: 'receipt_settings', tKey: 'perm_receipt_settings', label: 'Receipt / print settings', sensitivity: 'normal', shortTKey: 'receipts', short: 'Receipts' },
      { key: 'drive_credentials', tKey: 'perm_drive_credentials', label: 'Google Drive credentials', sensitivity: 'critical', shortTKey: 'google_drive', short: 'Google Drive' },
    ],
  },
  {
    key: 'library',
    tKey: 'perm_section_library',
    label: 'Library',
    description: 'Uploaded files and media. Anyone can browse; this switch allows upload, download, rename and delete.',
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
        lead: true,
      },
      // The AI provider keys and saved AI answers shown on the Library page (routes/ai.ts gates every route on
      // this key). A separate, critical switch: Settings Full no longer includes it.
      { key: 'ai_providers', tKey: 'perm_ai_providers', label: 'AI provider keys', sensitivity: 'critical', shortTKey: 'perm_short_ai_providers', short: 'AI keys' },
    ],
  },
]

export const PERMISSION_DEFS: PermissionDefinition[] = PERMISSION_SECTIONS.flatMap((section) => (
  section.permissions.map((permission) => ({ ...permission, section: section.key }))
))
