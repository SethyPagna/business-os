// The ONE table that says which area of the business an audit row belongs to.
//
// The Audit Log page organises its rows "all / by section / by user". A section
// is derived here, on the Worker, from the row's own entity, so the section
// filter, the per-section counts and the row badge cannot disagree. Adding a
// new writer means adding its entity below; test-audit-log-sections-pure.cjs
// fails when a written entity has no section, and an entity nobody listed is
// 'other' rather than a guess.

export const AUDIT_SECTION_IDS = [
  'sales',
  'products',
  'contacts',
  'users',
  'settings',
  'expenses',
  'returns',
  'website',
  'system',
] as const

export type AuditSectionId = typeof AUDIT_SECTION_IDS[number]
export type AuditSection = AuditSectionId | 'other'

export const AUDIT_OTHER_SECTION = 'other'

// Entity keys are stored lower-case. Plural table names are listed where a
// legacy writer left the entity empty and only filled table_name.
export const AUDIT_SECTION_ENTITIES: Record<AuditSectionId, readonly string[]> = {
  sales: [
    'sale', 'sale_creation', 'sale_item', 'sales', 'payment_method', 'pos_address_presets',
    'promotion', 'promotion_rule', 'promotions', 'shift_session', 'shift',
  ],
  products: [
    'product', 'products', 'product_group', 'product_batch', 'product_image', 'brand', 'category', 'unit',
    'stock', 'stock_transfer', 'stock_transfers', 'stock_session', 'stock_session_operations',
    'inventory', 'inventory_movements', 'inventory_reason', 'import_job', 'branch_stock_integrity',
  ],
  contacts: [
    'customer', 'customers', 'supplier', 'suppliers', 'delivery_contact', 'delivery_contacts', 'supplier_cascade',
    // G38: website members and their links to customers (routes/portalMembers.ts).
    'portal_member',
  ],
  users: ['user', 'users', 'role', 'roles'],
  settings: [
    'settings', 'branch', 'ai_provider_config', 'telegram', 'telegram_webhook', 'telegram_summary',
  ],
  expenses: ['fee', 'fees', 'fee_label'],
  returns: [
    'return', 'returns', 'return_create', 'return_reason', 'return_reason_presets', 'supplier_return',
  ],
  website: ['website', 'portal_submission', 'customer_portal'],
  system: [
    'system', 'backup', 'file', 'note', 'audit_log', 'data-integrity', 'pending_action', 'action_history',
  ],
}

// Legacy rows with neither entity nor table_name are placed by their action.
export const AUDIT_SECTION_KEYLESS_ACTIONS: Record<AuditSectionId, readonly string[]> = {
  sales: ['sale', 'sale_settlement'],
  products: ['stock_add', 'stock_remove', 'stock_adjust', 'stock_set', 'bulk_import', 'image_import', 'transfer'],
  contacts: [],
  users: ['login', 'logout', 'reset_password', 'password_reset'],
  settings: [],
  expenses: [],
  returns: ['return'],
  website: [],
  system: ['factory_reset', 'data_reset', 'reset_data', 'backup_export', 'backup_restore', 'repair', 'upload'],
}

function invert(table: Record<AuditSectionId, readonly string[]>): Record<string, AuditSectionId> {
  const flat: Record<string, AuditSectionId> = {}
  for (const section of AUDIT_SECTION_IDS) {
    for (const key of table[section]) flat[key] = section
  }
  return flat
}

export const AUDIT_ENTITY_SECTION: Record<string, AuditSectionId> = invert(AUDIT_SECTION_ENTITIES)
export const AUDIT_KEYLESS_ACTION_SECTION: Record<string, AuditSectionId> = invert(AUDIT_SECTION_KEYLESS_ACTIONS)

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function auditRowKey(entity: unknown, tableName: unknown): string {
  return normalizeKey(entity) || normalizeKey(tableName)
}

export function auditSectionOf(entity: unknown, tableName: unknown, action: unknown): AuditSection {
  const key = auditRowKey(entity, tableName)
  if (key) return AUDIT_ENTITY_SECTION[key] ?? AUDIT_OTHER_SECTION
  return AUDIT_KEYLESS_ACTION_SECTION[normalizeKey(action)] ?? AUDIT_OTHER_SECTION
}

export function isAuditSection(value: string): value is AuditSection {
  return value === AUDIT_OTHER_SECTION || (AUDIT_SECTION_IDS as readonly string[]).includes(value)
}
