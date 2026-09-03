// permissionActions.ts -- the per-ACTION half of the permission model.
//
// `permissions.ts`/`permissionDefinitions.ts` answer "does this role have
// the products key, and at which tier". This file answers the next question
// down, the one an admin actually asks: "with Review Required on Products,
// can this person still hit the Export button?"
//
// ONE source of truth, deliberately: this same table drives BOTH
//   (a) the read-only matrix rendered in PermissionEditor.tsx, and
//   (b) the real runtime gating of the buttons themselves
//       (via `actionAllowed()` below).
// They cannot drift apart, because there is only one table. Before this
// file existed the two were separate prose: each section's
// `reviewDescription` string claimed what Review Required allowed, while
// the pages themselves gated nothing at all -- so the UI documented a
// policy that was never enforced. See the Products export note below for a
// concrete, confirmed instance of that gap.
//
// EVERY row here was read off the real route handler, not inferred from
// the section's prose description. Where the code and the old prose
// disagreed, the code won and the prose was corrected.

export type ActionOutcome =
  // Applies immediately, same as Full Access.
  | 'allow'
  // Accepted, but written to the pending_actions review queue instead of
  // applied -- an admin approves or rejects it later.
  | 'queue'
  // Applies immediately, but with a reduced payload (today only Contacts'
  // edit, which drops every field except `name`).
  | 'limited'
  // Rejected. The backend 403s; the UI should not offer the control.
  | 'block'

export interface PermissionAction {
  /** Stable id, unique within its permission key. */
  key: string
  tKey: string
  label: string
  /** Outcome under the Review Required tier. */
  review: ActionOutcome
  /**
   * Outcome under Full Access. Omitted means 'allow' -- the overwhelmingly
   * common case. Set explicitly only where Full Access alone is genuinely
   * not enough (see `requiresKey`).
   */
  full?: ActionOutcome
  /**
   * A SECOND permission key that must also be granted, on top of this
   * section's own tier, even at Full Access. Today only Products' bulk
   * "replace all" import, which additionally requires `destructive_delete`
   * (enforced in cloudflare/src/routes/importJobs.ts).
   */
  requiresKey?: string
}

/**
 * Actions per permission key, in the order they appear on the page.
 *
 * Under the `none` tier every action is blocked -- each of these routers
 * has a router-wide `getPermissionTier(...) === 'none' -> 403` gate, so
 * `none` never needs to be spelled out per row.
 */
export const PERMISSION_ACTIONS: Record<string, PermissionAction[]> = {
  // cloudflare/src/routes/products.ts, plus routes/importJobs.ts for the
  // import rows.
  //
  // tKeys are unique per SECTION+action ('perm_act_products_add', not a
  // shared 'perm_act_add'): the English labels legitimately differ per
  // section ("Add product" vs "Add fee"), so a shared key would render one
  // section's label on every sibling row the moment the packs translate it.
  products: [
    { key: 'view', tKey: 'perm_act_products_view', label: 'View and search', review: 'allow' },
    // POST / -> maybeQueueForReview (products.ts ~844)
    { key: 'add', tKey: 'perm_act_products_add', label: 'Add product', review: 'queue' },
    // PUT /:id -> maybeQueueForReview (products.ts ~920)
    { key: 'edit', tKey: 'perm_act_products_edit', label: 'Edit product', review: 'queue' },
    // DELETE /:id -> maybeQueueForReview (products.ts ~1013)
    { key: 'delete', tKey: 'perm_act_products_delete', label: 'Delete product', review: 'queue' },
    // POST /bulk-delete-jobs -> explicit 403 for the review tier
    // (products.ts ~1077), NOT queued: a 10k-row delete is not something
    // the queue replays.
    { key: 'bulk_delete', tKey: 'perm_act_products_bulk_delete', label: 'Bulk delete', review: 'block' },
    // POST /variant -> strict hasPermission() (products.ts ~1139)
    { key: 'variant', tKey: 'perm_act_products_variant', label: 'Add variant', review: 'block' },
    // POST /upload-image -> strict hasPermission() (products.ts ~1809)
    { key: 'image', tKey: 'perm_act_products_image', label: 'Upload product image', review: 'block' },
    // importJobs.ts ~58 -> strict hasPermission()
    { key: 'import', tKey: 'perm_act_products_import', label: 'Import', review: 'block' },
    // importJobs.ts ~200 -> additionally requires destructive_delete
    { key: 'import_replace_all', tKey: 'perm_act_products_import_replace_all', label: 'Import: replace all', review: 'block', requiresKey: 'destructive_delete' },
    // Export was, until this change, gated by NOTHING at all, despite the
    // Products section's own reviewDescription claiming "export requires
    // Full Access" ever since the tier shipped -- documented policy and
    // enforced behavior simply disagreed.
    //
    // Honest scope of the fix: export is assembled client-side from rows
    // ALREADY loaded into the page (buildProductExportScopes reads
    // products/filtered/selectedProducts -- it never calls the server), and
    // a review-tier user is legitimately allowed to view those rows. So
    // hiding the button enforces the stated policy and stops the accidental
    // path, but it is NOT a confidentiality boundary: the same rows remain
    // readable through the products API that populated the page. Making
    // export a genuine security boundary would mean moving it behind a
    // server route that re-checks the tier and streams the file -- a real
    // change, not a checkbox, and deliberately not attempted here.
    { key: 'export', tKey: 'perm_act_products_export', label: 'Export', review: 'block' },
    // POST /merge-duplicates -> strict hasPermission() (products.ts ~1277)
    { key: 'merge_duplicates', tKey: 'perm_act_products_merge_duplicates', label: 'Merge duplicates', review: 'block' },
    // POST /zero-quantity-delete -> strict hasPermission() (products.ts ~1560)
    { key: 'zero_qty_cleanup', tKey: 'perm_act_products_zero_qty', label: 'Zero-quantity cleanup', review: 'block' },
    // POST /lookups/replace -> strict hasPermission() (products.ts ~1639)
    { key: 'manage_lookups', tKey: 'perm_act_products_manage_lookups', label: 'Manage brands, categories, units', review: 'block' },
  ],

  // cloudflare/src/routes/inventory.ts, plus routes/batches.ts (receive/
  // manage lots ride the 'adjust' action -- Branches.tsx's own
  // canReceiveStock already reads can('inventory', 'adjust')) and
  // routes/importJobs.ts for the import row.
  inventory: [
    { key: 'view', tKey: 'perm_act_inventory_view', label: 'View and search', review: 'allow' },
    // PUT /reasons -> maybeQueueForReview (inventory.ts ~967). The only
    // Inventory write with no live-state staleness risk, so the only one
    // that queues.
    { key: 'edit_reasons', tKey: 'perm_act_inventory_edit_reasons', label: 'Edit saved reasons list', review: 'queue' },
    // POST /adjust -> 403 for review (inventory.ts ~1189). Also covers
    // batches.ts's write routes (receive batch stock, fast stock-in,
    // edit/deactivate a lot) -- all strict Full-Access writes that mutate
    // the same live stock this action names.
    { key: 'adjust', tKey: 'perm_act_inventory_adjust', label: 'Adjust / receive stock', review: 'block' },
    // POST /transfer -> 403 for review (inventory.ts ~1583)
    { key: 'transfer', tKey: 'perm_act_inventory_transfer', label: 'Transfer stock', review: 'block' },
    // POST /move-row -> 403 for review (inventory.ts ~1655)
    { key: 'move_row', tKey: 'perm_act_inventory_move_row', label: 'Move stock between rows', review: 'block' },
    // POST /dated-stock-count/* -> 403 for review (inventory.ts ~1485+)
    { key: 'stock_count', tKey: 'perm_act_inventory_stock_count', label: 'Dated stock count', review: 'block' },
    // routes/importJobs.ts: the 'inventory' and 'stock_actions' import
    // types -- strict full-grant checks there ('stock_actions' needs
    // products+inventory+sales all at Full Access).
    { key: 'import', tKey: 'perm_act_inventory_import', label: 'Stock imports (inventory / stock-action files)', review: 'block' },
  ],

  // cloudflare/src/routes/branches.ts
  branches: [
    { key: 'view', tKey: 'perm_act_branches_view', label: 'View and search', review: 'allow' },
    { key: 'add', tKey: 'perm_act_branches_add', label: 'Add branch', review: 'queue' },
    { key: 'edit', tKey: 'perm_act_branches_edit', label: 'Edit branch', review: 'queue' },
    // Queues, and the applier re-checks "not default" / "no stock left"
    // at approval time rather than trusting the request-time check.
    { key: 'delete', tKey: 'perm_act_branches_delete', label: 'Delete branch', review: 'queue' },
    // POST /transfer, /transfer-bulk -> 403 for review (branches.ts ~281, ~443)
    { key: 'transfer', tKey: 'perm_act_branches_transfer', label: 'Transfer stock between branches', review: 'block' },
    // POST /stock-integrity/repair -> 403 for review (branches.ts ~164)
    { key: 'repair_stock', tKey: 'perm_act_branches_repair_stock', label: 'Repair misplaced stock', review: 'block' },
  ],

  // cloudflare/src/routes/returns.ts
  returns: [
    { key: 'view', tKey: 'perm_act_returns_view', label: 'View and search', review: 'allow' },
    // POST / and POST /supplier carry no tier check beyond the router-wide
    // gate, so a review-tier user creates returns directly, by design.
    { key: 'add', tKey: 'perm_act_returns_add', label: 'Create return', review: 'allow' },
    // PATCH /:id -> 403 for review (returns.ts ~781): editing reverses and
    // re-applies batch restocking against live state.
    { key: 'edit', tKey: 'perm_act_returns_edit', label: 'Edit return', review: 'block' },
    // There is no third returns action. The retired one gated settling a
    // price difference on an uneven replacement exchange; a return no longer
    // nets against its replacement, so there is no difference to settle and
    // nothing to gate. Removed rather than left unreachable -- a permission
    // nobody can exercise is a permission that lies to whoever reads the role
    // screen. (tests/returnOptions.test.ts pins that its key stays gone.)
  ],

  // cloudflare/src/routes/fees.ts
  fees: [
    { key: 'view', tKey: 'perm_act_fees_view', label: 'View and search', review: 'allow' },
    { key: 'add', tKey: 'perm_act_fees_add', label: 'Add fee', review: 'allow' },
    { key: 'edit', tKey: 'perm_act_fees_edit', label: 'Edit fee', review: 'allow' },
    // DELETE /:id -> maybeQueueForReview (fees.ts ~263). The only Fees
    // action that does not apply directly.
    { key: 'delete', tKey: 'perm_act_fees_delete', label: 'Delete fee', review: 'queue' },
  ],

  // cloudflare/src/routes/contacts.ts (all three tabs share this key),
  // plus routes/importJobs.ts for the import row.
  contacts: [
    { key: 'view', tKey: 'perm_act_contacts_view', label: 'View and search', review: 'allow' },
    { key: 'add', tKey: 'perm_act_contacts_add', label: 'Add contact', review: 'allow' },
    // PUT -> applies directly but every column except `name` is dropped
    // for a review-tier user (contacts.ts ~637).
    { key: 'edit', tKey: 'perm_act_contacts_edit', label: 'Edit contact (name only)', review: 'limited' },
    // DELETE -> 403 for review (contacts.ts ~710)
    { key: 'delete', tKey: 'perm_act_contacts_delete', label: 'Delete contact', review: 'block' },
    // POST /bulk-delete-jobs -> 403 for review (contacts.ts ~748)
    { key: 'bulk_delete', tKey: 'perm_act_contacts_bulk_delete', label: 'Bulk delete', review: 'block' },
    // POST /merge -> 403 for review (contacts.ts ~492)
    { key: 'merge', tKey: 'perm_act_contacts_merge', label: 'Merge duplicates', review: 'block' },
    // The Conflicts tab can also persist keep/reopen decisions and rewrite
    // historical sale-to-customer links. Keep those controls behind one
    // explicit Full-only capability instead of exposing buttons that a
    // review-tier user can click only to receive a 403.
    { key: 'resolve_conflicts', tKey: 'perm_act_contacts_resolve_conflicts', label: 'Resolve contact and sale-link conflicts', review: 'block' },
    // routes/importJobs.ts: the customers/suppliers/delivery_contacts
    // import types -- strict full-grant checks there.
    { key: 'import', tKey: 'perm_act_contacts_import', label: 'Import contacts', review: 'block' },
    // Export on all three contact tabs (Customers/Suppliers/Delivery) was,
    // like the Products export before it, gated by NOTHING. Same honest
    // scope as the Products note above: export is assembled client-side from
    // rows ALREADY loaded into the page (each tab's visibleContacts), never
    // from the server, and a review-tier user may legitimately view those
    // rows -- so hiding the button enforces the stated policy but is NOT a
    // confidentiality boundary. Modeled here so it is no longer the one
    // contact-tab control absent from the permission editor.
    { key: 'export', tKey: 'perm_act_contacts_export', label: 'Export', review: 'block' },
  ],

  // View-tier sections also need action rows: the middle tier is still
  // meaningful here (reads allowed, writes blocked), and Full roles may be
  // narrowed with an explicit per-action switch.
  sales: [
    { key: 'export', tKey: 'perm_act_sales_export', label: 'Export sales', review: 'allow' },
    { key: 'import', tKey: 'perm_act_sales_import', label: 'Import sales', review: 'block' },
    { key: 'status', tKey: 'perm_act_sales_status', label: 'Change or cancel sale status', review: 'block' },
    { key: 'customer', tKey: 'perm_act_sales_customer', label: 'Change linked customer', review: 'block' },
  ],

  promotions: [
    { key: 'manage', tKey: 'perm_act_promotions_manage', label: 'Create, edit, and delete promotion rules', review: 'block' },
  ],
}

// 'view' (Part 557) is the read-only middle tier for VIEW_TIER_KEYS sections.
// It allows rows marked read-safe and blocks writes; action overrides may
// further narrow a Full or View role without widening the selected tier.
export type PermissionTierValue = 'full' | 'review' | 'view' | 'none'

/** The action rows for a permission key, or [] when it has none defined. */
export function actionsForKey(permissionKey: string): PermissionAction[] {
  return PERMISSION_ACTIONS[permissionKey] || []
}

/** What `action` does at `tier`. `none` blocks everything; `view` allows only
 * the actions a section marks read-safe (review: 'allow'), blocking writes. */
export function outcomeAt(action: PermissionAction, tier: PermissionTierValue): ActionOutcome {
  if (tier === 'none') return 'block'
  if (tier === 'view') return action.review === 'allow' ? 'allow' : 'block'
  if (tier === 'review') return action.review
  return action.full ?? 'allow'
}

/**
 * Runtime gate for a single button: true when the action can actually be
 * performed (or submitted for approval) at this tier.
 *
 * 'queue' and 'limited' both count as allowed -- the control stays usable,
 * because the user CAN act; the outcome is just different (their change is
 * queued for approval, or narrowed to the fields they may edit). Only
 * 'block' hides/disables the control. Use `outcomeAt()` directly when the
 * caller needs to tell those apart, e.g. to label a button "Submit for
 * approval" instead of "Save".
 *
 * `hasKey` resolves any additional `requiresKey` grant -- pass the app's
 * own `hasPermission`, which is already strict about the 'review' string.
 */
export function actionAllowed(
  permissionKey: string,
  actionKey: string,
  tier: PermissionTierValue,
  hasKey: (key: string) => boolean = () => false,
  isBlocked: (permissionKey: string, actionKey: string) => boolean = () => false,
): boolean {
  const action = actionsForKey(permissionKey).find((entry) => entry.key === actionKey)
  // A per-action override switched off by an admin wins over everything
  // else -- checked BEFORE the missing-row fallback below so that an
  // override on an action this table does not model still takes effect.
  if (isBlocked(permissionKey, actionKey)) return false
  // An action with no row defined is not silently denied -- that would
  // turn a typo in a call site into an invisible permission bug. Fall back
  // to the plain tier check: anything but 'none' may proceed.
  if (!action) return tier !== 'none'
  if (outcomeAt(action, tier) === 'block') return false
  if (action.requiresKey && !hasKey(action.requiresKey)) return false
  return true
}

// ---------------------------------------------------------------------------
// Per-action overrides -- mirrors cloudflare/src/lib/permissions.ts exactly.
// ---------------------------------------------------------------------------
// Stored alongside the ordinary keys under a namespaced `section:action`
// key, e.g. `{ products: true, "products:delete": false }`. Unknown keys
// were always ignored, so older records and older clients both cope.
//
// ONE-WAY BY DESIGN: an override can only REMOVE an action the tier already
// granted, never add one it withholds. Widening would require every route
// to accept "your tier says no but an override says yes", and any route
// that forgot would silently disagree with the UI -- showing a button that
// 403s, or gating a write in the UI that the API still performs. Narrowing
// cannot fail that way: an unwired route is simply no more permissive than
// before, which is the direction a permission bug should fail in.

/** Storage key for one action override. Must match the backend's. */
export function actionOverrideKey(section: string, action: string): string {
  return `${String(section || '').trim().toLowerCase()}:${String(action || '').trim().toLowerCase()}`
}

/**
 * True when `section:action` has been explicitly switched off for this
 * permission map. Only an explicit `false` counts -- an absent key or any
 * other value leaves the tier's own answer standing, so a typo in an
 * override key can never accidentally block something.
 */
export function isActionOverriddenOff(
  permissions: Record<string, unknown> | null | undefined,
  section: string,
  action: string,
): boolean {
  if (!permissions) return false
  return permissions[actionOverrideKey(section, action)] === false
}
