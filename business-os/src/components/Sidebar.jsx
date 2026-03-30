import { useApp } from '../AppContext'

const NAV_ITEMS = [
  { id: 'dashboard',        icon: '📊', key: 'dashboard',        permission: null },
  { id: 'pos',              icon: '🛒', key: 'pos',              permission: 'pos' },
  { id: 'products',         icon: '📦', key: 'products',         permission: 'products' },
  { id: 'inventory',        icon: '🏭', key: 'inventory',        permission: 'inventory' },
  { id: 'branches',         icon: '🏪', key: 'branches',         permission: 'inventory' },
  { id: 'sales',            icon: '💰', key: 'sales',            permission: 'sales' },
  { id: 'contacts',         icon: '👥', key: 'contacts',         permission: null },
  { id: 'users',            icon: '👤', key: 'users',            permission: 'users' },
  { id: 'audit_log',        icon: '📋', key: 'audit_log',        permission: 'audit_log' },
  { id: 'receipt_settings', icon: '🧾', key: 'receipt_settings', permission: 'settings' },
  { id: 'backup',           icon: '💾', key: 'backup',           permission: 'backup' },
  { id: 'settings',         icon: '⚙️',  key: 'settings',         permission: 'settings' },
]

export default function Sidebar() {
  const { page, navigateTo, user, logout, t, settings, hasPermission } = useApp()

  const visibleItems = NAV_ITEMS.filter(item =>
    item.permission === null || hasPermission(item.permission)
  )

  return (
    <aside className="w-56 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col h-screen sticky top-0 flex-shrink-0">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-white text-lg">🏢</span>
          </div>
          <div className="overflow-hidden">
            <div className="font-bold text-gray-900 dark:text-white text-sm truncate">
              {settings.business_name || 'Business OS'}
            </div>
            <div className="text-xs text-gray-400">v2.1.0</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto">
        <div className="space-y-0.5">
          {visibleItems.map(item => (
            <button
              key={item.id}
              onClick={() => navigateTo(item.id)}
              className={`sidebar-item w-full text-left ${page === item.id ? 'active' : ''}`}
            >
              <span className="text-base">{item.icon}</span>
              <span>{t(item.key)}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="p-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/40 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-blue-600 dark:text-blue-400 font-bold text-sm">
              {user?.name?.[0]?.toUpperCase()}
            </span>
          </div>
          <div className="flex-1 overflow-hidden">
            <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{user?.name}</div>
            <div className="text-xs text-gray-400 truncate">{user?.role_name || 'No role'}</div>
          </div>
          <button onClick={logout} className="text-gray-400 hover:text-red-500 transition-colors" title={t('logout')}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  )
}
