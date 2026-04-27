export const PERMISSION_DEFS = [
  { key: 'all', tKey: 'perm_all', label: 'Administrator (full access)' },
  { key: 'pos', tKey: 'perm_pos', label: 'Point of Sale' },
  { key: 'products', tKey: 'perm_products', label: 'Products' },
  { key: 'inventory', tKey: 'perm_inventory', label: 'Inventory & Branches' },
  { key: 'sales', tKey: 'perm_sales', label: 'Sales History' },
  { key: 'contacts', tKey: 'perm_contacts', label: 'Contacts (Customers / Suppliers)' },
  { key: 'customer_portal', tKey: 'perm_customer_portal', label: 'Customer Portal' },
  { key: 'users', tKey: 'perm_users', label: 'User Management' },
  { key: 'audit_log', tKey: 'perm_audit_log', label: 'Audit Log' },
  { key: 'settings', tKey: 'perm_settings', label: 'Settings (personal device)' },
  { key: 'backup', tKey: 'perm_backup', label: 'Backup' },
]

export default function PermissionEditor({ permissions, onChange, t }) {
  const translate = (key, fallback) => {
    if (typeof t !== 'function') return fallback
    const value = t(key)
    return value && value !== key ? value : fallback
  }

  const labelFor = (permission) => translate(permission.tKey, permission.label)
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

      <div className="space-y-1.5">
        {PERMISSION_DEFS.map((permission) => {
          const active = !!perms[permission.key]
          return (
            <div
              key={permission.key}
              onClick={() => toggle(permission.key)}
              className={`flex cursor-pointer select-none items-center gap-3 rounded-xl border p-2.5 transition-colors ${
                active
                  ? 'border-blue-200 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30'
                  : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50'
              }`}
            >
              <div
                className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                  active ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-600'
                }`}
              >
                {active ? <span className="text-xs font-bold text-white">OK</span> : null}
              </div>
              <span className={`text-sm font-medium ${active ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
                {labelFor(permission)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
