// The ONE vocabulary for audit rows: what an action is called, and what a
// record TYPE is called, in both language packs.
//
// Two readers now need these words -- the Audit Log page and the per-record
// Records floats (a return, a product, a contact) -- and before this module
// only the page had them, inline, and only for actions. Entities were rendered
// by Title-Casing the raw column: `delivery_contact` printed "Delivery
// Contact" in the Khmer pack too, on the one filter whose whole job is letting
// someone pick the kind of record they are looking for.
//
// Rules:
//   1. A key here maps to an EXISTING pack key wherever the app already has
//      that word. A second Khmer string for "Product" is a second thing to
//      keep correct.
//   2. An unknown action/entity falls back to the readable Title Case, never
//      to a raw snake_case identifier and never to a blank. The vocabulary is
//      open by construction -- it comes from whatever rows the table holds --
//      so the fallback is the normal path for anything new, not an error.

/** `(key, fallback) => translated`, the shape every caller here already has. */
export type LabelFn = (key: string, fallback: string) => string

/** snake_case / camelCase -> "Title Case Words". The universal fallback. */
export function titleCaseIdentifier(raw: string): string {
  return String(raw || '')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

/**
 * audit_logs.action -> [pack key, English fallback].
 *
 * Lifted verbatim from AuditLog.tsx's own inline map so the page's labels do
 * not change; it now has one more consumer instead of one more copy.
 */
export const AUDIT_ACTION_LABELS: Record<string, [string, string]> = {
  create: ['create', 'Create'],
  update: ['edit', 'Update'],
  delete: ['delete', 'Delete'],
  sale: ['sale', 'Sale'],
  login: ['login', 'Login'],
  logout: ['logout', 'Logout'],
  stock_add: ['stock_in', 'Stock Add'],
  stock_remove: ['stock_out', 'Stock Remove'],
  stock_adjust: ['adjust_stock', 'Adjust'],
  stock_set: ['adjust_stock', 'Set stock'],
  stock_in_line_edit: ['stock_in_line_edit_action', 'Stock-in line edit'],
  bulk_import: ['bulk_import', 'Bulk Import'],
  image_import: ['image_import', 'Image Import'],
  upload: ['upload_file', 'Upload'],
  data_reset: ['data_reset', 'Data Reset'],
  factory_reset: ['factory_reset', 'Factory Reset'],
  transfer: ['stock_transfer', 'Transfer'],
  reset_password: ['reset_password', 'Reset Password'],
  repair: ['repair', 'Repair'],
  return: ['returns', 'Return'],
  // Replays. The Audit Log page printed these as "action undo" -- the pack has
  // owned both words since the sale float shipped.
  action_undo: ['undo', 'Undo'],
  action_redo: ['redo', 'Redo'],
}

/**
 * audit_logs.entity (or the legacy table_name) -> [pack key, English fallback].
 *
 * Every entity that writes a before/after row is listed. That set is not a
 * guess: cloudflare/src/lib/audit.ts's changedFields() is called by users,
 * roles, products, contacts (customer / supplier / delivery_contact),
 * promotions, settings, fees and returns, and the transfer, stock-session,
 * shift and sale writers were already recording their own pairs. A fixture per
 * entity is pinned in frontend/tests/auditLogEntityLabels.test.ts.
 */
export const AUDIT_ENTITY_LABELS: Record<string, [string, string]> = {
  product: ['product', 'Product'],
  product_group: ['product_group', 'Product Group'],
  product_batch: ['batch', 'Received date'],
  product_image: ['image', 'Image'],
  customer: ['customer', 'Customer'],
  supplier: ['supplier', 'Supplier'],
  delivery_contact: ['delivery_contact', 'Delivery Contact'],
  user: ['user', 'User'],
  role: ['role', 'Role'],
  promotion: ['promotion', 'Promotion'],
  promotion_rule: ['promotion', 'Promotion'],
  settings: ['settings', 'Settings'],
  fee: ['expense', 'Expense'],
  fee_label: ['expense', 'Expense'],
  return: ['return', 'Return'],
  // The create row is written under its own entity because it is keyed by a
  // receipt id; to a reader it is the same kind of record.
  return_create: ['return', 'Return'],
  return_reason: ['reason', 'Reason'],
  sale: ['sale', 'Sale'],
  sale_item: ['sale_item', 'Sale item'],
  stock: ['stock', 'Stock'],
  stock_transfer: ['stock_transfer', 'Stock Transfer'],
  stock_session: ['stock_in_session', 'Stock-in session'],
  shift_session: ['shift', 'Shift'],
  branch: ['branch', 'Branch'],
  brand: ['brand', 'Brand'],
  inventory: ['inventory', 'Inventory'],
  inventory_reason: ['reason', 'Reason'],
  backup: ['backup', 'Backup'],
  note: ['note', 'Note'],
  file: ['files', 'Library'],
  audit_log: ['audit_log', 'Audit Log'],
  system: ['system', 'System'],
}

/** What an action is called, in the reader's language. */
export function auditActionLabel(action: unknown, label: LabelFn): string {
  const key = String(action ?? '').toLowerCase().trim()
  if (!key) return ''
  const entry = AUDIT_ACTION_LABELS[key]
  return entry ? label(entry[0], entry[1]) : titleCaseIdentifier(key)
}

/** What a record TYPE is called, in the reader's language. */
export function auditEntityLabel(entity: unknown, label: LabelFn): string {
  const key = String(entity ?? '').toLowerCase().trim()
  if (!key) return ''
  const entry = AUDIT_ENTITY_LABELS[key]
  return entry ? label(entry[0], entry[1]) : titleCaseIdentifier(key)
}
