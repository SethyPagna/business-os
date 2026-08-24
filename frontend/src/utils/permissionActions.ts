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
  products: [
    { key: 'view', tKey: 'perm_act_view', label: 'View and search', review: 'allow' },
    // POST / -> maybeQueueForReview (products.ts ~844)
    { key: 'add', tKey: 'perm_act_add', label: 'Add product', review: 'queue' },
    // PUT /:id -> maybeQueueForReview (products.ts ~920)
    { key: 'edit', tKey: 'perm_act_edit', label: 'Edit product', review: 'queue' },
    // DELETE /:id -> maybeQueueForReview (products.ts ~1013)
    { key: 'delete', tKey: 'perm_act_delete', label: 'Delete product', review: 'queue' },
    // POST /bulk-delete-jobs -> explicit 403 for the review tier
    // (products.ts ~1077), NOT queued: a 10k-row delete is not something
    // the queue replays.
    { key: 'bulk_delete', tKey: 'perm_act_bulk_delete', label: 'Bulk delete', review: 'block' },
    // POST /variant -> strict hasPermission() (products.ts ~1139)
    { key: 'variant', tKey: 'perm_act_variant', label: 'Add variant', review: 'block' },
    // POST /upload-image -> strict hasPermission() (products.ts ~1809)
    { key: 'image', tKey: 'perm_act_image', label: 'Upload product image', review: 'block' },
    // importJobs.ts ~58 -> strict hasPermission()
    { key: 'import', tKey: 'perm_act_import', label: 'Import', review: 'block' },
    // importJobs.ts ~200 -> additionally requires destructive_delete
    { key: 'import_replace_all', tKey: 'perm_act_import_replace_all', label: 'Import: replace all', review: 'block', requiresKey: 'destructive_delete' },
    // Export was, until this change, gated by NOTHING at all -- it is
    // built client-side from already-loaded rows, so there was no server
    // route to check and no frontend check either. The Products section's
    // own reviewDescription has claimed "export requires Full Access"
    // since the tier shipped, so the documented policy and the enforced
    // behavior disagreed: a Review Required user could export the entire
    // catalogue. Treated as the loophole it is and enforced from here.
    { key: 'export', tKey: 'perm_act_export', label: 'Export', review: 'block' },
    // POST /merge-duplicates -> strict hasPermission() (products.ts ~1277)
    { key: 'merge_duplicates', tKey: 'perm_act_merge_duplicates', label: 'Merge duplicates', review: 'block' },
    // POST /zero-quantity-delete -> strict hasPermission() (products.ts ~1560)
    { key: 'zero_qty_cleanup', tKey: 'perm_act_zero_qty', label: 'Zero-quantity cleanup', review: 'block' },
    // POST /lookups/replace -> strict hasPermission() (products.ts ~1639)
    { key: 'manage_lookups', tKey: 'perm_act_manage_lookups', label: 'Manage brands, categories, units', review: 'block' },
  ],

  // cloudflare/src/routes/inventory.ts
  inventory: [
    { key: 'view', tKey: 'perm_act_view', label: 'View and search', review: 'allow' },
    // PUT /reasons -> maybeQueueForReview (inventory.ts ~967). The only
    // Inventory write with no live-state staleness risk, so the only one
    // that queues.
    { key: 'edit_reasons', tKey: 'perm_act_edit_reasons', label: 'Edit saved reasons list', review: 'queue' },
    // POST /adjust -> 403 for review (inventory.ts ~1189)
    { key: 'adjust', tKey: 'perm_act_adjust', label: 'Adjust stock', review: 'block' },
    // POST /transfer -> 403 for review (inventory.ts ~1583)
    { key: 'transfer', tKey: 'perm_act_transfer', label: 'Transfer stock', review: 'block' },
    // POST /move-row -> 403 for review (inventory.ts ~1655)
    { key: 'move_row', tKey: 'perm_act_move_row', label: 'Move stock between rows', review: 'block' },
    // POST /dated-stock-count/* -> 403 for review (inventory.ts ~1485+)
    { key: 'stock_count', tKey: 'perm_act_stock_count', label: 'Dated stock count', review: 'block' },
  ],

  // cloudflare/src/routes/branches.ts
  branches: [
    { key: 'view', tKey: 'perm_act_view', label: 'View and search', review: 'allow' },
    { key: 'add', tKey: 'perm_act_add', label: 'Add branch', review: 'queue' },
    { key: 'edit', tKey: 'perm_act_edit', label: 'Edit branch', review: 'queue' },
    // Queues, and the applier re-checks "not default" / "no stock left"
    // at approval time rather than trusting the request-time check.
    { key: 'delete', tKey: 'perm_act_delete', label: 'Delete branch', review: 'queue' },
    // POST /transfer, /transfer-bulk -> 403 for review (branches.ts ~281, ~443)
    { key: 'transfer', tKey: 'perm_act_transfer', label: 'Transfer stock between branches', review: 'block' },
    // POST /stock-integrity/repair -> 403 for review (branches.ts ~164)
    { key: 'repair_stock', tKey: 'perm_act_repair_stock', label: 'Repair misplaced stock', review: 'block' },
  ],

  // cloudflare/src/routes/returns.ts
  returns: [
    { key: 'view', tKey: 'perm_act_view', label: 'View and search', review: 'allow' },
    // POST / and POST /supplier carry no tier check beyond the router-wide
    // gate, so a review-tier user creates returns directly, by design.
    { key: 'add', tKey: 'perm_act_add', label: 'Create return', review: 'allow' },
    // PATCH /:id -> 403 for review (returns.ts ~781): editing reverses and
    // re-applies batch restocking against live state.
    { key: 'edit', tKey: 'perm_act_edit', label: 'Edit return', review: 'block' },
  ],

  // cloudflare/src/routes/fees.ts
  fees: [
    { key: 'view', tKey: 'perm_act_view', label: 'View and search', review: 'allow' },
    { key: 'add', tKey: 'perm_act_add', label: 'Add fee', review: 'allow' },
    { key: 'edit', tKey: 'perm_act_edit', label: 'Edit fee', review: 'allow' },
    // DELETE /:id -> maybeQueueForReview (fees.ts ~263). The only Fees
    // action that does not apply directly.
    { key: 'delete', tKey: 'perm_act_delete', label: 'Delete fee', review: 'queue' },
  ],

  // cloudflare/src/routes/contacts.ts (all three tabs share this key)
  contacts: [
    { key: 'view', tKey: 'perm_act_view', label: 'View and search', review: 'allow' },
    { key: 'add', tKey: 'perm_act_add', label: 'Add contact', review: 'allow' },
    // PUT -> applies directly but every column except `name` is dropped
    // for a review-tier user (contacts.ts ~637).
    { key: 'edit', tKey: 'perm_act_edit', label: 'Edit contact (name only)', review: 'limited' },
    // DELETE -> 403 for review (contacts.ts ~710)
    { key: 'delete', tKey: 'perm_act_delete', label: 'Delete contact', review: 'block' },
    // POST /bulk-delete-jobs -> 403 for review (contacts.ts ~748)
    { key: 'bulk_delete', tKey: 'perm_act_bulk_delete', label: 'Bulk delete', review: 'block' },
    // POST /merge -> 403 for review (contacts.ts ~492)
    { key: 'merge', tKey: 'perm_act_merge', label: 'Merge duplicates', review: 'block' },
  ],
}

export type PermissionTierValue = 'full' | 'review' | 'none'

/** The action rows for a permission key, or [] when it has none defined. */
export function actionsForKey(permissionKey: string): PermissionAction[] {
  return PERMISSION_ACTIONS[permissionKey] || []
}

/** What `action` does at `tier`. `none` blocks everything. */
export function outcomeAt(action: PermissionAction, tier: PermissionTierValue): ActionOutcome {
  if (tier === 'none') return 'block'
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
): boolean {
  const action = actionsForKey(permissionKey).find((entry) => entry.key === actionKey)
  // An action with no row defined is not silently denied -- that would
  // turn a typo in a call site into an invisible permission bug. Fall back
  // to the plain tier check: anything but 'none' may proceed.
  if (!action) return tier !== 'none'
  if (outcomeAt(action, tier) === 'block') return false
  if (action.requiresKey && !hasKey(action.requiresKey)) return false
  return true
}
