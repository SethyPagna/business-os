// permissionActions.ts -- the per-ACTION half of the permission model.
//
// `permissions.ts`/`permissionDefinitions.ts` answer "does this role have
// the products key, and at which tier". This file answers the next question
// down, the one an admin actually asks: "with Partial Access on Products,
// can this person still hit the Export button?"
//
// One table drives both the rows PermissionEditor.tsx renders and the real
// runtime gating of the buttons (via `actionAllowed()` below), so the two
// cannot drift apart. Every row is read off the real route handler, not
// inferred from a section's prose description, and
// cloudflare/scripts/test-permission-catalog-parity-pure.cjs compares the
// rows with the Worker's gates.

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
   * section's own tier, even at Full Access. Only Products' replace-all and
   * replace-columns imports use it: they also require `destructive_delete`
   * (cloudflare/src/lib/importEngine.ts, missingDestructiveImportPermission).
   */
  requiresKey?: string
  /**
   * Review Required outcome of the page control behind this row, when that control is stricter than the badge: an
   * edit that merges or changes an image queues, but the merge and image tools themselves need Full Access.
   */
  controlReview?: ActionOutcome
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
    { key: 'add', tKey: 'perm_act_products_add', label: 'Add product', review: 'queue' },
    // An edit that would merge two products is queued too; switching merge_duplicates off refuses it instead.
    { key: 'edit', tKey: 'perm_act_products_edit', label: 'Edit product', review: 'queue' },
    { key: 'delete', tKey: 'perm_act_products_delete', label: 'Delete product', review: 'queue' },
    // Refused, never queued: the review queue cannot replay a delete of thousands of rows.
    { key: 'bulk_delete', tKey: 'perm_act_products_bulk_delete', label: 'Bulk delete', review: 'block' },
    // Also needs the Add action at Full.
    { key: 'variant', tKey: 'perm_act_products_variant', label: 'Add variant', review: 'block' },
    { key: 'image', tKey: 'perm_act_products_image', label: 'Upload product images and edits that change them', review: 'queue', controlReview: 'block' },
    { key: 'import', tKey: 'perm_act_products_import', label: 'Import', review: 'block' },
    // Covers replace-all and replace-columns imports; both also need destructive_delete.
    { key: 'import_replace_all', tKey: 'perm_act_products_import_replace_all', label: 'Import: replace all and replace columns', review: 'block', requiresKey: 'destructive_delete' },
    // Browser-only: the file is built from rows the page already loaded, so this hides the button but is not a data
    // boundary; the products API returns the same rows to anyone who can view.
    { key: 'export', tKey: 'perm_act_products_export', label: 'Export', review: 'block' },
    { key: 'merge_duplicates', tKey: 'perm_act_products_merge_duplicates', label: 'Merge duplicates and edits that merge', review: 'queue', controlReview: 'block' },
    { key: 'zero_qty_cleanup', tKey: 'perm_act_products_zero_qty', label: 'Zero-quantity cleanup', review: 'block' },
    { key: 'manage_lookups', tKey: 'perm_act_products_manage_lookups', label: 'Manage brands, categories, units', review: 'block' },
    // The DEFAULT selling and wholesale price, off for the Employee default. PUT /:id, /bulk-price-adjust, the
    // receipt-time selling price and a merge price choice other than the rule all require it.
    { key: 'price', tKey: 'perm_act_products_price', label: 'Change selling and wholesale price', review: 'queue' },
    // The Products sub-pages: Stock Changes, Stock-in Sessions and a product's sales and supplier history. Off for
    // the Employee default, who see only the main Products page.
    { key: 'history', tKey: 'perm_act_products_history', label: 'Stock changes, sessions and product history', review: 'allow' },
  ],

  // cloudflare/src/routes/inventory.ts, plus routes/batches.ts (receive/
  // manage lots ride the 'adjust' action -- Branches.tsx's own
  // canReceiveStock already reads can('inventory', 'adjust')) and
  // routes/importJobs.ts for the import row.
  inventory: [
    { key: 'view', tKey: 'perm_act_inventory_view', label: 'View and search', review: 'allow' },
    // PUT /reasons queues (maybeQueueForReview). The only Inventory write with
    // no live-state staleness risk, so the only one that queues.
    { key: 'edit_reasons', tKey: 'perm_act_inventory_edit_reasons', label: 'Edit saved reasons list', review: 'queue' },
    // POST /adjust answers 403 for Partial Access. Also covers batches.ts's
    // write routes (receive batch stock, fast stock-in, edit/deactivate a
    // lot): strict Full Access writes that mutate the same live stock this
    // action names.
    { key: 'adjust', tKey: 'perm_act_inventory_adjust', label: 'Adjust / receive stock', review: 'block' },
    // POST /transfer answers 403 for Partial Access.
    { key: 'transfer', tKey: 'perm_act_inventory_transfer', label: 'Transfer stock', review: 'block' },
    // POST /move-row answers 403 for Partial Access.
    { key: 'move_row', tKey: 'perm_act_inventory_move_row', label: 'Move stock between rows', review: 'block' },
    // POST /dated-stock-count/* answers 403 for Partial Access.
    { key: 'stock_count', tKey: 'perm_act_inventory_stock_count', label: 'Dated stock count', review: 'block' },
    // routes/importJobs.ts: the 'inventory' and 'stock_actions' import
    // types -- strict full-grant checks there ('stock_actions' needs
    // products+inventory+sales all at Full Access).
    { key: 'import', tKey: 'perm_act_inventory_import', label: 'Stock imports (inventory / stock-action files)', review: 'block' },
  ],

  // cloudflare/src/routes/branches.ts
  branches: [
    { key: 'view', tKey: 'perm_act_branches_view', label: 'View and search', review: 'allow' },
    { key: 'edit', tKey: 'perm_act_branches_edit', label: 'Edit branch', review: 'queue' },
    // POST /transfer and /transfer-bulk answer 403 for Partial Access.
    { key: 'transfer', tKey: 'perm_act_branches_transfer', label: 'Transfer stock between branches', review: 'block' },
    // POST /stock-integrity/repair answers 403 for Partial Access.
    { key: 'repair_stock', tKey: 'perm_act_branches_repair_stock', label: 'Repair misplaced stock', review: 'block' },
    // Browser-only export: Partial Access keeps it, and the switch lets an
    // administrator narrow it.
    { key: 'export', tKey: 'export', label: 'Export', review: 'allow' },
  ],

  // cloudflare/src/routes/returns.ts
  returns: [
    { key: 'view', tKey: 'perm_act_returns_view', label: 'View and search', review: 'allow' },
    // POST / and POST /supplier carry no tier check beyond the router-wide
    // gate, so a review-tier user creates returns directly, by design.
    { key: 'add', tKey: 'perm_act_returns_add', label: 'Create return', review: 'allow' },
    // PATCH /:id answers 403 for Partial Access: editing reverses and
    // re-applies batch restocking against live state.
    { key: 'edit', tKey: 'perm_act_returns_edit', label: 'Edit return', review: 'block' },
    // Multi-return field/status updates and their grouped Undo/Redo share
    // one explicit capability. Individual create/edit remain independent.
    { key: 'bulk', tKey: 'perm_act_returns_bulk', label: 'Change multiple returns at once', review: 'block' },
    // Export packages rows already visible to the caller; the action
    // controls whether the UI offers it.
    { key: 'export', tKey: 'perm_act_returns_export', label: 'Export returns', review: 'block' },
    // There is no returns import or price-difference action: a return does not
    // net against its replacement, so there is nothing to gate, and a
    // permission nobody can exercise would lie to whoever reads the role
    // screen (tests/returnOptions.test.ts pins that its key stays gone).
  ],

  // cloudflare/src/routes/fees.ts
  fees: [
    { key: 'view', tKey: 'perm_act_fees_view', label: 'View and search', review: 'allow' },
    { key: 'add', tKey: 'perm_act_fees_add', label: 'Add expense', review: 'allow' },
    { key: 'edit', tKey: 'perm_act_fees_edit', label: 'Edit expense', review: 'allow' },
    // DELETE /:id queues (maybeQueueForReview): the only Fees action that
    // does not apply directly.
    { key: 'delete', tKey: 'perm_act_fees_delete', label: 'Delete expense', review: 'queue' },
    // Export packages rows the caller may already read; an explicit false
    // narrows it.
    { key: 'export', tKey: 'export', label: 'Export', review: 'allow' },
  ],

  // cloudflare/src/routes/contacts.ts (all three tabs share this key),
  // plus routes/importJobs.ts for the import row.
  contacts: [
    { key: 'view', tKey: 'perm_act_contacts_view', label: 'View and search', review: 'allow' },
    { key: 'add', tKey: 'perm_act_contacts_add', label: 'Add contact', review: 'allow' },
    // PUT applies directly, but every column except `name` is dropped for a
    // Partial Access user.
    { key: 'edit', tKey: 'perm_act_contacts_edit', label: 'Edit contact (name only)', review: 'limited' },
    // DELETE answers 403 for Partial Access.
    { key: 'delete', tKey: 'perm_act_contacts_delete', label: 'Delete contact', review: 'block' },
    // Selection mode, multi-row mutations, merge/import workflows, and their
    // replay entry points require this umbrella capability in addition to
    // any narrower action switch below.
    { key: 'bulk', tKey: 'perm_act_contacts_bulk', label: 'Select and change multiple contacts', review: 'block' },
    // POST /bulk-delete-jobs answers 403 for Partial Access.
    { key: 'bulk_delete', tKey: 'perm_act_contacts_bulk_delete', label: 'Bulk delete', review: 'block' },
    // POST /merge answers 403 for Partial Access.
    { key: 'merge', tKey: 'perm_act_contacts_merge', label: 'Merge duplicates', review: 'block' },
    // The Conflicts tab can also persist keep/reopen decisions and rewrite
    // historical sale-to-customer links. Keep those controls behind one
    // explicit Full-only capability instead of exposing buttons that a
    // review-tier user can click only to receive a 403.
    { key: 'resolve_conflicts', tKey: 'perm_act_contacts_resolve_conflicts', label: 'Resolve contact and sale-link conflicts', review: 'block' },
    // routes/importJobs.ts: the customers/suppliers/delivery_contacts
    // import types -- strict full-grant checks there.
    { key: 'import', tKey: 'perm_act_contacts_import', label: 'Import contacts', review: 'block' },
    // Export on all three contact tabs (Customers/Suppliers/Delivery) is
    // browser-only, like Products export: it is assembled from rows already
    // loaded into the page (each tab's visibleContacts) and a Partial Access
    // user may view those rows, so hiding the button enforces the stated
    // policy but is NOT a confidentiality boundary.
    { key: 'export', tKey: 'perm_act_contacts_export', label: 'Export', review: 'block' },
    // Customer invoices, purchase history, and delivery-contact reports reveal
    // financial activity. Keep this independent from the directory/search
    // grant so a cashier can find a customer without opening their history.
    { key: 'financial_history', tKey: 'perm_act_contacts_financial_history', label: 'View contact invoices and purchase history', review: 'block' },
  ],

  // View-tier sections also need action rows: the middle tier is still
  // meaningful here (reads allowed, writes blocked), and Full roles may be
  // narrowed with an explicit per-action switch.
  sales: [
    // GET /sales and every sales read, plus Reports and the POS catalog, ride
    // getActionTier(user, 'sales', 'view') in the Worker. Stored as
    // 'sales:view': false, one-way like every override: an absent key leaves
    // the tier's answer standing, so a role keeps Sales until an admin
    // switches it off. review:'allow' keeps the View tier reading.
    { key: 'view', tKey: 'perm_act_sales_view', label: 'View sales and reports', review: 'allow' },
    { key: 'export', tKey: 'perm_act_sales_export', label: 'Export sales', review: 'allow' },
    { key: 'import', tKey: 'perm_act_sales_import', label: 'Import sales', review: 'block' },
    { key: 'status', tKey: 'perm_act_sales_status', label: 'Change or cancel sale status', review: 'block' },
    { key: 'customer', tKey: 'perm_act_sales_customer', label: 'Change linked customer', review: 'block' },
    { key: 'customer_reassign', tKey: 'perm_act_sales_customer_reassign', label: 'Reassign customer (off: sale name only)', review: 'block' },
    // POST /:id/items answers 403 unless Full. Adding goods to a recorded
    // sale moves stock and raises what the customer owes, so it has its own
    // switch rather than riding the coarse 'sales' grant or `status`, and it
    // can never be queued for review: the stock movement is immediate.
    { key: 'add_items', tKey: 'perm_act_sales_add_items', label: 'Add items to a recorded sale', review: 'block' },
    // POST /:id/amendments answers 403 unless Full. Amending changes a
    // recorded sale's contents, customer fee, or actual courier cost, may move
    // stock in either direction, and changes what the customer owes. It is
    // separate from `add_items`: a shop may want a senior cashier who can add
    // a forgotten item but cannot take one back off a paid sale. Like
    // add_items it can never be queued for review: the stock movement is
    // immediate.
    { key: 'amend', tKey: 'perm_act_sales_amend', label: 'Amend a recorded sale (change quantities, remove or replace lines, correct delivery fee or actual delivery cost)', review: 'block' },
    // Multi-sale status/field updates and their grouped Undo/Redo share this
    // explicit capability. Individual actions above remain independently
    // grantable to front-line staff.
    { key: 'bulk', tKey: 'perm_act_sales_bulk', label: 'Change multiple sales at once', review: 'block' },
  ],

  promotions: [
    { key: 'manage', tKey: 'perm_act_promotions_manage', label: 'Create, edit, and delete promotion rules', review: 'block' },
  ],

  // POS is an on/off key: on reads as Full, off as None.
  pos: [
    { key: 'manage_address_presets', tKey: 'manage_address_presets', label: 'Manage saved address options', review: 'block' },
  ],
}

// 'view' is the read-only middle tier for VIEW_TIER_KEYS sections.
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
  const outcome = tier === 'review' && action.controlReview ? action.controlReview : outcomeAt(action, tier)
  if (outcome === 'block') return false
  if (action.requiresKey && !hasKey(action.requiresKey)) return false
  return true
}

// ---------------------------------------------------------------------------
// Per-action overrides -- mirrors cloudflare/src/lib/permissions.ts exactly.
// ---------------------------------------------------------------------------
// Stored alongside the ordinary keys under a namespaced `section:action`
// key, e.g. `{ products: true, "products:delete": false }`. Unknown keys
// are ignored, so older records and older clients both cope.
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
  if (permissions[actionOverrideKey(section, action)] !== false) return false
  return !isViewImpliedByWrite(permissions, section, action)
}

// Contacts: Add and Edit imply View. Mirrors the Worker's
// isActionBlocked in cloudflare/src/lib/permissions.ts: a stored contacts:view
// = false only takes effect once Add and Edit are both switched off too.
const CONTACTS_WRITES_IMPLYING_VIEW = ['add', 'edit']

/** True while Add or Edit is still on, which keeps View on (and locked). */
export function isViewImpliedByWrite(
  permissions: Record<string, unknown> | null | undefined,
  section: string,
  action: string,
): boolean {
  if (section !== 'contacts' || action !== 'view') return false
  return CONTACTS_WRITES_IMPLYING_VIEW.some((write) => permissions?.[actionOverrideKey(section, write)] !== false)
}

/**
 * The permission map after an admin clicks one action row in the role editor.
 * Returns the SAME object when the click is refused (View while Add or Edit is
 * on), and drops a stale View switch-off when Add or Edit is handed back, so
 * View does not silently turn off again the day a write is switched off.
 */
export function toggleActionOverrideMap<T extends Record<string, unknown>>(permissions: T, section: string, action: string): T {
  const key = actionOverrideKey(section, action)
  const switchingOff = permissions[key] !== false
  if (switchingOff && isViewImpliedByWrite(permissions, section, action)) return permissions
  const next: Record<string, unknown> = { ...permissions }
  if (switchingOff) next[key] = false
  else delete next[key]
  const restoresWrite = section === 'contacts' && !switchingOff && CONTACTS_WRITES_IMPLYING_VIEW.includes(action)
  if (restoresWrite) delete next[actionOverrideKey(section, 'view')]
  return next as T
}
