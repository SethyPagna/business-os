export const NAV_ITEMS = [
  { id: 'dashboard', key: 'dashboard', permission: null },
  { id: 'catalog', key: 'catalog', permission: 'customer_portal' },
  { id: 'loyalty_points', key: 'loyalty_points', permission: 'customer_portal' },
  { id: 'pos', key: 'pos', permission: 'pos' },
  { id: 'products', key: 'products', permission: 'products' },
  { id: 'inventory', key: 'inventory', permission: 'inventory' },
  { id: 'branches', key: 'branches', permission: 'inventory' },
  { id: 'sales', key: 'sales', permission: 'sales' },
  { id: 'returns', key: 'returns', permission: 'sales' },
  { id: 'contacts', key: 'contacts', permission: 'contacts' },
  { id: 'users', key: 'users', permission: 'users' },
  { id: 'audit_log', key: 'audit_log', permission: 'audit_log' },
  { id: 'receipt_settings', key: 'receipt_settings', permission: 'settings' },
  { id: 'backup', key: 'backup', permission: 'backup' },
  { id: 'settings', key: 'settings', permission: 'settings' },
  { id: 'files', key: 'files', permission: 'settings' },
  { id: 'server', key: 'server', permission: 'settings' },
]

export const DEFAULT_MOBILE_PINNED = ['dashboard', 'pos', 'products', 'sales']

export function parseNavSetting(value, fallback = []) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim()) : fallback
  } catch (_) {
    return fallback
  }
}

export function orderNavItems(items, orderedIds = []) {
  const orderMap = new Map(orderedIds.map((id, index) => [id, index]))
  const known = []
  const unknown = []

  for (const item of items) {
    if (orderMap.has(item.id)) known.push(item)
    else unknown.push(item)
  }

  known.sort((a, b) => orderMap.get(a.id) - orderMap.get(b.id))
  return [...known, ...unknown]
}
