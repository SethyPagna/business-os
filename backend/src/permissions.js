'use strict'

const PERMISSION_SECTIONS = [
  {
    key: 'admin',
    label: 'Administration',
    items: [
      { key: 'all', label: 'Administrator (full access)', sensitivity: 'critical' },
      { key: 'users', label: 'Users and roles', sensitivity: 'critical' },
      { key: 'audit_log', label: 'Audit log', sensitivity: 'high' },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    items: [
      { key: 'pos', label: 'Point of Sale', sensitivity: 'normal' },
      { key: 'products', label: 'Products and variants', sensitivity: 'normal' },
      { key: 'inventory', label: 'Inventory, branches, stock transfer', sensitivity: 'high' },
      { key: 'sales', label: 'Sales and returns', sensitivity: 'high' },
      { key: 'contacts', label: 'Customers, suppliers, delivery contacts', sensitivity: 'normal' },
      { key: 'customer_portal', label: 'Customer portal content', sensitivity: 'normal' },
    ],
  },
  {
    key: 'sensitive',
    label: 'Sensitive settings',
    items: [
      { key: 'settings', label: 'Device and basic settings', sensitivity: 'normal' },
      { key: 'business_identity', label: 'Business identity, logo, public profile', sensitivity: 'high' },
      { key: 'sales_policy', label: 'Sales, return, and financial policy', sensitivity: 'high' },
      { key: 'security_settings', label: 'Security and sign-in settings', sensitivity: 'critical' },
      { key: 'drive_credentials', label: 'Google Drive credentials', sensitivity: 'critical' },
      { key: 'backup', label: 'Backup export', sensitivity: 'high' },
      { key: 'backup_restore', label: 'Backup restore and reset', sensitivity: 'critical' },
      { key: 'destructive_delete', label: 'Destructive delete actions', sensitivity: 'critical' },
    ],
  },
]

const PERMISSION_DEFS = PERMISSION_SECTIONS.flatMap((section) => (
  section.items.map((item) => ({ ...item, section: section.key, sectionLabel: section.label }))
))

const DEFAULT_ROLE_PERMISSIONS = {
  admin: { all: true },
  manager: {
    pos: true,
    products: true,
    inventory: true,
    sales: true,
    contacts: true,
    customer_portal: true,
    audit_log: true,
  },
  employee: {
    pos: true,
    products: true,
    contacts: true,
  },
}

const SENSITIVE_PERMISSION_KEYS = new Set([
  'all',
  'users',
  'backup_restore',
  'drive_credentials',
  'security_settings',
  'business_identity',
  'sales_policy',
  'destructive_delete',
])

const ENTITY_PERMISSION_MAP = new Map([
  ['product', 'products'],
  ['products', 'products'],
  ['category', 'products'],
  ['categories', 'products'],
  ['unit', 'products'],
  ['units', 'products'],
  ['supplier', 'contacts'],
  ['suppliers', 'contacts'],
  ['customer', 'contacts'],
  ['customers', 'contacts'],
  ['contact', 'contacts'],
  ['contacts', 'contacts'],
  ['delivery_contact', 'contacts'],
  ['delivery_contacts', 'contacts'],
  ['inventory', 'inventory'],
  ['stock', 'inventory'],
  ['stock_transfer', 'inventory'],
  ['branch', 'inventory'],
  ['branches', 'inventory'],
  ['sale', 'sales'],
  ['sales', 'sales'],
  ['return', 'sales'],
  ['returns', 'sales'],
  ['portal', 'customer_portal'],
  ['customer_portal', 'customer_portal'],
  ['setting', 'settings'],
  ['settings', 'settings'],
  ['file', 'settings'],
  ['files', 'settings'],
  ['backup', 'backup'],
  ['restore', 'backup_restore'],
  ['reset', 'backup_restore'],
  ['user', 'users'],
  ['users', 'users'],
  ['role', 'users'],
  ['roles', 'users'],
  ['import', 'products'],
  ['imports', 'products'],
])

const SENSITIVE_ENTITY_KEYS = new Set([
  'backup',
  'restore',
  'reset',
  'user',
  'users',
  'role',
  'roles',
  'security',
  'drive_credentials',
])

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase()
}

function getPermissionDefinition(key) {
  const normalized = normalizeKey(key)
  return PERMISSION_DEFS.find((permission) => permission.key === normalized) || null
}

function isSensitivePermissionKey(key) {
  const normalized = normalizeKey(key)
  if (SENSITIVE_PERMISSION_KEYS.has(normalized)) return true
  const definition = getPermissionDefinition(normalized)
  return definition?.sensitivity === 'critical'
}

function permissionForActionHistory({ entity, scope } = {}) {
  const entityKey = normalizeKey(entity)
  const scopeKey = normalizeKey(scope)
  return ENTITY_PERMISSION_MAP.get(entityKey)
    || ENTITY_PERMISSION_MAP.get(scopeKey)
    || (scopeKey && scopeKey !== 'global' ? scopeKey : '')
}

function isSensitiveActionHistory({ entity, scope, payload } = {}) {
  const entityKey = normalizeKey(entity)
  const scopeKey = normalizeKey(scope)
  if (SENSITIVE_ENTITY_KEYS.has(entityKey) || SENSITIVE_ENTITY_KEYS.has(scopeKey)) return true
  const permission = permissionForActionHistory({ entity, scope })
  if (isSensitivePermissionKey(permission)) return true
  if (payload && typeof payload === 'object') {
    const explicitSensitivity = normalizeKey(payload.sensitivity || payload.permissionSensitivity)
    if (explicitSensitivity === 'critical' || explicitSensitivity === 'sensitive') return true
    const explicitPermission = normalizeKey(payload.permission || payload.permissionKey)
    if (explicitPermission && isSensitivePermissionKey(explicitPermission)) return true
  }
  return false
}

function hasPermissionValue(permissions = {}, key) {
  const normalized = normalizeKey(key)
  if (!normalized) return true
  if (permissions.all) return true
  if (permissions[normalized]) return true
  if (normalized === 'backup_restore' && permissions.backup) return true
  if (normalized === 'drive_credentials' && permissions.settings) return true
  if (normalized === 'business_identity' && permissions.settings) return true
  if (normalized === 'sales_policy' && permissions.settings) return true
  return false
}

module.exports = {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DEFS,
  PERMISSION_SECTIONS,
  hasPermissionValue,
  isSensitiveActionHistory,
  isSensitivePermissionKey,
  permissionForActionHistory,
}
