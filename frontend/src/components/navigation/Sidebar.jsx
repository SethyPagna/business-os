import { useMemo, useState } from 'react'
import {
  BadgeDollarSign,
  BookUser,
  Boxes,
  Building2,
  ClipboardList,
  DatabaseBackup,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Package,
  Receipt,
  RotateCcw,
  Server,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Ticket,
  Users,
} from 'lucide-react'
import { useApp } from '../../AppContext'
import UserProfileModal from '../users/UserProfileModal'
import { DEFAULT_MOBILE_PINNED, NAV_ITEMS as NAV_CONFIG_ITEMS, orderNavItems, parseNavSetting } from '../shared/navigationConfig'
import QuickPreferenceToggles from '../shared/QuickPreferenceToggles'
import NotificationCenter from '../shared/NotificationCenter'

const ICONS_BY_ID = {
  dashboard: LayoutDashboard,
  catalog: ShoppingBag,
  loyalty_points: Ticket,
  pos: ShoppingCart,
  products: Package,
  inventory: Boxes,
  branches: Building2,
  sales: BadgeDollarSign,
  returns: RotateCcw,
  contacts: BookUser,
  users: Users,
  audit_log: ClipboardList,
  receipt_settings: Receipt,
  backup: DatabaseBackup,
  files: FolderOpen,
  settings: Settings,
  server: Server,
}

function getFallbackLabel(itemId, language) {
  void language
  if (itemId === 'server') return 'Sync Server'
  if (itemId === 'catalog') return 'Customer Portal'
  if (itemId === 'loyalty_points') return 'Loyalty Points'
  return ''
}

function getNavLabel(item, t, language) {
  if (item.id === 'server') {
    const label = t('sync_server_title')
    return label && label !== 'sync_server_title' ? label : getFallbackLabel(item.id, language)
  }
  if (item.id === 'catalog') {
    const label = t('customer_portal')
    return label && label !== 'customer_portal' ? label : getFallbackLabel(item.id, language)
  }
  if (item.id === 'loyalty_points') {
    const label = t('loyalty_points')
    return label && label !== 'loyalty_points' ? label : getFallbackLabel(item.id, language)
  }
  return t(item.key)
}

function isDarkColor(hex) {
  if (!hex) return false
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return false
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 0.35
}

function withAlpha(hex, alpha) {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex)) return ''
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  return `#${clean}${alpha}`
}

function mergeStyles(...styles) {
  return Object.assign({}, ...styles.filter(Boolean))
}

export default function Sidebar() {
  const {
    page,
    navigateTo,
    user,
    logout,
    t,
    settings,
    hasPermission,
    syncUrl,
    syncConnected,
  } = useApp()

  const [moreOpen, setMoreOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  const visibleItems = useMemo(() => {
    const orderedIds = parseNavSetting(settings?.ui_nav_order, [])
    const allowedItems = NAV_CONFIG_ITEMS
      .filter((item) => item.permission === null || hasPermission(item.permission))
      .map((item) => ({ ...item, icon: ICONS_BY_ID[item.id] }))
    return orderNavItems(allowedItems, orderedIds)
  }, [hasPermission, settings?.ui_nav_order])

  const mobilePinnedIds = useMemo(() => {
    const saved = parseNavSetting(settings?.ui_mobile_pinned, DEFAULT_MOBILE_PINNED)
    return saved.slice(0, 4)
  }, [settings?.ui_mobile_pinned])

  const pinnedItems = useMemo(() => {
    const byId = new Map(visibleItems.map((item) => [item.id, item]))
    return mobilePinnedIds.map((id) => byId.get(id)).filter(Boolean)
  }, [visibleItems, mobilePinnedIds])

  const drawerItems = visibleItems.filter((item) => !mobilePinnedIds.includes(item.id))

  const language = settings?.language || 'en'
  const brandLogo = settings?.customer_portal_logo_image || ''
  const brandName = settings?.business_name || 'Business OS'
  const mobileBrandName = brandName.length > 7 ? `${brandName.slice(0, 7)}...` : brandName
  const sidebarBg = settings?.ui_sidebar_color || ''
  const sidebarTextColor = settings?.ui_sidebar_text_color || ''
  const isDark = sidebarBg ? isDarkColor(sidebarBg) : null
  const textClass = isDark === true ? 'text-white' : isDark === false ? 'text-gray-800' : ''
  const subTextClass = isDark === true ? 'text-white/60' : isDark === false ? 'text-gray-500' : ''
  const borderClass = isDark === true
    ? 'border-white/10'
    : isDark === false
      ? 'border-gray-200'
      : 'border-gray-200 dark:border-slate-800'
  const activeClass = sidebarBg
    ? (isDark ? 'bg-white/15 text-white font-semibold' : 'bg-black/10 text-gray-900 font-semibold')
    : 'active'
  const hoverClass = sidebarBg ? (isDark ? 'hover:bg-white/10' : 'hover:bg-black/5') : ''

  const textStyle = sidebarTextColor ? { color: sidebarTextColor } : undefined
  const subduedTextStyle = sidebarTextColor ? { color: sidebarTextColor, opacity: 0.72 } : undefined
  const activeStyle = sidebarTextColor
    ? {
        color: sidebarTextColor,
        backgroundColor: withAlpha(sidebarTextColor, isDark ? '24' : '18') || undefined,
      }
    : undefined
  const mobileInactiveStyle = sidebarTextColor ? { color: sidebarTextColor, opacity: 0.74 } : undefined
  const mobileActiveStyle = mergeStyles(
    sidebarTextColor ? { color: sidebarTextColor } : undefined,
    sidebarTextColor ? { backgroundColor: withAlpha(sidebarTextColor, isDark ? '24' : '18') || undefined } : undefined,
  )

  return (
    <>
      <aside className={`sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[220px] flex-shrink-0 flex-col border-r min-h-0 md:flex ${!sidebarBg ? 'border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900' : 'border-transparent'}`}>
        <nav className="flex-1 overflow-y-auto p-3 pt-4">
          <div className="space-y-0.5">
            {visibleItems.map((item) => {
              const Icon = item.icon
              const isActiveItem = page === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => navigateTo(item.id)}
                  className={`${sidebarBg ? `flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${hoverClass} ${textClass} ${isActiveItem ? activeClass : ''}` : `sidebar-item flex w-full items-center gap-2 text-left ${isActiveItem ? 'active' : ''}`} ${item.id === 'server' ? 'mt-2' : ''}`}
                  style={isActiveItem ? activeStyle : textStyle}
                >
                  <span className="flex min-w-[20px] justify-center">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{getNavLabel(item, t, language)}</span>
                  {item.id === 'server' && syncUrl ? (
                    <span className={`ml-auto h-2 w-2 flex-shrink-0 rounded-full ${syncConnected ? 'bg-green-400' : 'bg-yellow-400'}`} />
                  ) : null}
                </button>
              )
            })}
          </div>
        </nav>

        <div className={`border-t p-3 ${borderClass}`}>
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--ui-accent)22' }}>
              {user?.avatar_path ? (
                <img src={user.avatar_path} alt={user?.name || 'User'} className="h-8 w-8 rounded-full object-cover" />
              ) : (
                <span className="text-sm font-bold" style={{ color: 'var(--ui-accent)' }}>
                  {user?.name?.[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <button type="button" onClick={() => setProfileOpen(true)} className="min-w-0 flex-1 text-left">
              <div className={`truncate text-sm font-medium ${textClass || 'text-gray-900 dark:text-white'}`} style={textStyle}>
                {user?.name}
              </div>
              <div className={`truncate text-xs ${subTextClass || 'text-gray-400'}`} style={subduedTextStyle}>
                {user?.role_name || t('no_role') || 'No role'}
              </div>
            </button>
            <button
              onClick={logout}
              className={`transition-colors hover:text-red-500 ${textClass ? 'opacity-60 hover:opacity-100' : 'text-gray-400'}`}
              title={t('logout')}
              style={textStyle}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <header className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900 md:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            {brandLogo ? (
              <img src={brandLogo} alt={brandName} className="h-full w-full object-contain p-0.5" />
            ) : (
              <span className="grid h-full w-full place-items-center text-base font-semibold text-white" style={{ background: 'var(--ui-accent)' }}>
                {brandName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-base font-bold text-gray-900 dark:text-white" style={textStyle}>
              {mobileBrandName}
            </span>
            {syncUrl ? <span className={`h-2 w-2 flex-shrink-0 rounded-full ${syncConnected ? 'bg-green-400' : 'bg-yellow-400'}`} /> : null}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <NotificationCenter compact visibility="mobile" />
          <QuickPreferenceToggles />
          <button type="button" onClick={() => setProfileOpen(true)} className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50/90 p-0.5 dark:bg-blue-900/30">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/40">
              {user?.avatar_path ? (
                <img src={user.avatar_path} alt={user?.name || 'User'} className="h-10 w-10 object-cover" />
              ) : (
                <span className="text-base font-bold text-blue-600 dark:text-blue-400">
                  {user?.name?.[0]?.toUpperCase()}
                </span>
              )}
            </div>
          </button>
        </div>
      </header>

      <nav className="safe-area-inset-bottom fixed bottom-0 left-0 right-0 z-40 flex h-14 items-stretch border-t border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:hidden">
        {pinnedItems.map((item) => {
          const Icon = item.icon
          const isActiveItem = page === item.id
          return (
            <button
              key={item.id}
              onClick={() => { navigateTo(item.id); setMoreOpen(false) }}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${!sidebarTextColor ? (isActiveItem ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400') : ''}`}
              style={isActiveItem ? mobileActiveStyle : mobileInactiveStyle}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-[62px] truncate text-[10px] font-medium">{getNavLabel(item, t, language)}</span>
            </button>
          )
        })}
        <button
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${!sidebarTextColor ? (moreOpen ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400') : ''}`}
          style={moreOpen ? mobileActiveStyle : mobileInactiveStyle}
        >
          <MoreHorizontal className="h-4 w-4" />
          <span className="text-[10px] font-medium">{t('more') || 'More'}</span>
        </button>
      </nav>

      {moreOpen ? (
        <>
          <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMoreOpen(false)} />
          <div className="fixed bottom-16 left-0 right-0 z-40 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:hidden">
            <div className="sticky top-0 bg-white px-3 pb-1 pt-3 dark:bg-gray-900">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>
            <div className="grid grid-cols-4 gap-2 px-3 pb-4">
              {drawerItems.map((item) => {
                const Icon = item.icon
                const isActiveItem = page === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => { navigateTo(item.id); setMoreOpen(false) }}
                    className={`relative flex flex-col items-center gap-1.5 rounded-xl p-3 text-xs font-medium transition-colors ${!sidebarTextColor ? (isActiveItem ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400') : (isActiveItem ? 'bg-white/70 dark:bg-slate-800/70' : 'bg-gray-50 dark:bg-gray-800')}`}
                    style={isActiveItem ? mobileActiveStyle : mobileInactiveStyle}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-center leading-tight">{getNavLabel(item, t, language)}</span>
                    {item.id === 'server' && syncUrl ? (
                      <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${syncConnected ? 'bg-green-400' : 'bg-yellow-400'}`} />
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      ) : null}

      {profileOpen ? <UserProfileModal onClose={() => setProfileOpen(false)} /> : null}
    </>
  )
}
