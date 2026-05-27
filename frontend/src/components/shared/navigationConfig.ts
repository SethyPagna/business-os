export type NavigationPermission =
  | null
  | 'audit_log'
  | 'backup'
  | 'contacts'
  | 'customer_portal'
  | 'inventory'
  | 'pos'
  | 'products'
  | 'sales'
  | 'settings'
  | 'users'

export type NavigationItem = {
  id: string
  key: string
  permission: NavigationPermission
}

export const NAV_ITEMS: NavigationItem[] = [
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

export function parseNavSetting(value: unknown, fallback: string[] = []): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : fallback
  } catch {
    return fallback
  }
}

export function orderNavItems<T extends { id: string }>(items: T[], orderedIds: string[] = []): T[] {
  const orderMap = new Map(orderedIds.map((id, index) => [id, index]))
  const known: T[] = []
  const unknown: T[] = []

  for (const item of items) {
    if (orderMap.has(item.id)) known.push(item)
    else unknown.push(item)
  }

  known.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
  return [...known, ...unknown]
}
