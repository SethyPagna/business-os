export type PermissionSensitivity = 'normal' | 'high' | 'critical'

export interface PermissionDefinition {
  key: string
  tKey: string
  label: string
  sensitivity: PermissionSensitivity
  section?: string
}

export interface PermissionSection {
  key: string
  tKey: string
  label: string
  description: string
  permissions: PermissionDefinition[]
}

export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    key: 'admin',
    tKey: 'perm_section_admin',
    label: 'Administration',
    description: 'Users, roles, audit, and full control.',
    permissions: [
      { key: 'all', tKey: 'perm_all', label: 'Administrator (full access)', sensitivity: 'critical' },
      { key: 'users', tKey: 'perm_users', label: 'Users and roles', sensitivity: 'critical' },
      { key: 'audit_log', tKey: 'perm_audit_log', label: 'Audit log', sensitivity: 'high' },
    ],
  },
  {
    key: 'operations',
    tKey: 'perm_section_operations',
    label: 'Operations',
    description: 'Daily store workflows and customer-facing work.',
    permissions: [
      { key: 'pos', tKey: 'perm_pos', label: 'Point of Sale', sensitivity: 'normal' },
      { key: 'products', tKey: 'perm_products', label: 'Products and variants', sensitivity: 'normal' },
      { key: 'inventory', tKey: 'perm_inventory', label: 'Inventory, branches, stock transfer', sensitivity: 'high' },
      { key: 'sales', tKey: 'perm_sales', label: 'Sales and returns', sensitivity: 'high' },
      { key: 'contacts', tKey: 'perm_contacts', label: 'Customers, suppliers, delivery contacts', sensitivity: 'normal' },
      { key: 'customer_portal', tKey: 'perm_customer_portal', label: 'Customer Portal', sensitivity: 'normal' },
    ],
  },
  {
    key: 'sensitive',
    tKey: 'perm_section_sensitive',
    label: 'Sensitive settings',
    description: 'These should normally stay with admins or require approval.',
    permissions: [
      { key: 'settings', tKey: 'perm_settings', label: 'Device and basic settings', sensitivity: 'normal' },
      { key: 'business_identity', tKey: 'perm_business_identity', label: 'Business identity, logo, public profile', sensitivity: 'high' },
      { key: 'sales_policy', tKey: 'perm_sales_policy', label: 'Sales, return, and financial policy', sensitivity: 'high' },
      { key: 'security_settings', tKey: 'perm_security_settings', label: 'Security and sign-in settings', sensitivity: 'critical' },
      { key: 'drive_credentials', tKey: 'perm_drive_credentials', label: 'Google Drive credentials', sensitivity: 'critical' },
      { key: 'backup', tKey: 'perm_backup', label: 'Backup export', sensitivity: 'high' },
      { key: 'backup_restore', tKey: 'perm_backup_restore', label: 'Backup restore and reset', sensitivity: 'critical' },
      { key: 'destructive_delete', tKey: 'perm_destructive_delete', label: 'Destructive delete actions', sensitivity: 'critical' },
    ],
  },
]

export const PERMISSION_DEFS: PermissionDefinition[] = PERMISSION_SECTIONS.flatMap((section) => (
  section.permissions.map((permission) => ({ ...permission, section: section.key }))
))
