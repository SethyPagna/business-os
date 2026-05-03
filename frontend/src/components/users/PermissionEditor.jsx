export const PERMISSION_SECTIONS = [
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

export const PERMISSION_DEFS = PERMISSION_SECTIONS.flatMap((section) => (
  section.permissions.map((permission) => ({ ...permission, section: section.key }))
))

export default function PermissionEditor({ permissions, onChange, t }) {
  const translate = (key, fallback) => {
    if (typeof t !== 'function') return fallback
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  const labelFor = (permission) => translate(permission.tKey, permission.label)
  const sensitivityLabel = (value) => {
    if (value === 'critical') return translate('permission_sensitive_critical', 'Sensitive')
    if (value === 'high') return translate('permission_sensitive_high', 'Review')
    return translate('permission_sensitive_normal', 'Standard')
  }
  const perms = typeof permissions === 'string' ? JSON.parse(permissions || '{}') : (permissions || {})

  const toggle = (key) => {
    const next = { ...perms }
    if (next[key]) delete next[key]
    else next[key] = true

    if (key === 'all' && next.all) {
      onChange({ all: true })
      return
    }

    if (key !== 'all') delete next.all
    onChange(next)
  }

  const activeCount = Object.keys(perms).filter((key) => perms[key]).length

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {activeCount} {translate('permissions', activeCount === 1 ? 'permission' : 'permissions')}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange({ all: true })} className="text-xs text-blue-500 hover:underline">
            {translate('select_all', 'All')}
          </button>
          <span className="text-gray-300">|</span>
          <button type="button" onClick={() => onChange({})} className="text-xs text-red-500 hover:underline">
            {translate('deselect_all', 'Clear')}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {PERMISSION_SECTIONS.map((section) => (
          <section key={section.key} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-3 dark:border-zinc-700 dark:bg-zinc-800/60">
            <div className="mb-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {translate(section.tKey, section.label)}
              </div>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {translate(`${section.tKey}_desc`, section.description)}
              </p>
            </div>
            <div className="space-y-1.5">
              {section.permissions.map((permission) => {
                const active = !!perms[permission.key]
                const sensitive = permission.sensitivity === 'critical' || permission.sensitivity === 'high'
                return (
                  <button
                    type="button"
                    key={permission.key}
                    onClick={() => toggle(permission.key)}
                    className={`flex w-full cursor-pointer select-none items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                      active
                        ? 'border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30'
                        : 'border-transparent bg-white/70 hover:bg-gray-50 dark:bg-zinc-900/40 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <div
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                        active ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {active ? <span className="text-[10px] font-bold text-white">OK</span> : null}
                    </div>
                    <span className={`min-w-0 flex-1 text-sm font-medium ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                      {labelFor(permission)}
                    </span>
                    {sensitive ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        permission.sensitivity === 'critical'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                      }`}>
                        {sensitivityLabel(permission.sensitivity)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
