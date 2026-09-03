import { Suspense, type ComponentType, type CSSProperties, type ReactNode, useMemo, useState, useSyncExternalStore } from 'react'
import { getRegisteredWork, hasDirtyWork, subscribeDirtyWork } from '../../utils/dirtyWork.ts'
import { applyAppUpdate } from '../../utils/appUpdate.ts'
import type { LucideIcon } from 'lucide-react'
import BadgeDollarSign from 'lucide-react/dist/esm/icons/badge-dollar-sign.js'
import BookUser from 'lucide-react/dist/esm/icons/book-user.js'
import Building2 from 'lucide-react/dist/esm/icons/building-2.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import DatabaseBackup from 'lucide-react/dist/esm/icons/database-backup.js'
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open.js'
import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard.js'
import LogOut from 'lucide-react/dist/esm/icons/log-out.js'
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Receipt from 'lucide-react/dist/esm/icons/receipt.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js'
import Server from 'lucide-react/dist/esm/icons/server.js'
import Settings from 'lucide-react/dist/esm/icons/settings.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js'
import Ticket from 'lucide-react/dist/esm/icons/ticket.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import User from 'lucide-react/dist/esm/icons/user.js'
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import { ACCOUNT_NAV_IDS, DEFAULT_MOBILE_PINNED, NAV_ITEMS as NAV_CONFIG_ITEMS, orderNavItems, parseNavSetting, type NavigationItem, type NavigationPermission } from '../shared/navigationConfig'
import { APP_PAGE_INTENT_EVENT } from '../../app/appShellUtils.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'
import MinimizedWorkTray from '../shared/MinimizedWorkTray.tsx'

const QuickPreferenceToggles = lazyRetry(() => import('../shared/QuickPreferenceToggles'), 'quick-preference-toggles')

// Reserves the exact footprint of the two 40px toggle buttons (h-10 w-10,
// gap-2) so there's no layout shift while the chunk loads or retries -- the
// "space is always there" behavior from the original bug report was already
// correct and is preserved here; only the "sometimes renders nothing forever"
// failure mode is what lazyRetry()/this fallback fix.
function QuickPreferenceTogglesFallback() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <div className="h-10 w-10 rounded-xl border border-gray-200 bg-white/85 dark:border-slate-700 dark:bg-slate-900/70" />
      <div className="h-10 w-10 rounded-xl border border-gray-200 bg-white/85 dark:border-slate-700 dark:bg-slate-900/70" />
    </div>
  )
}

type TranslateFn = (key: string) => string
type IntentSource = 'focus' | 'pointer' | 'touch'

interface SidebarUser {
  name?: string | null
  role_name?: string | null
  avatar_path?: string | null
}

interface SidebarSettings {
  ui_nav_order?: unknown
  ui_mobile_pinned?: unknown
  language?: string | null
  customer_portal_logo_image?: string | null
  business_name?: string | null
  ui_sidebar_color?: string | null
  ui_sidebar_text_color?: string | null
}

interface SidebarAppContext {
  page: string
  navigateTo: (pageId: string) => void
  user?: SidebarUser | null
  logout: () => void
  notify: (message: unknown, type?: string, duration?: number) => void
  t: TranslateFn
  settings?: SidebarSettings | null
  hasPermission: (permission: NavigationPermission) => boolean
  canAccessPage: (pageId: string) => boolean
  syncUrl?: string | null
  syncConnected?: boolean
}

type NavigationItemWithIcon = NavigationItem & {
  icon: LucideIcon
}

type UserProfileModalProps = {
  onClose: () => void
}

type SidebarProps = {
  notificationSlot?: ReactNode
  // Desktop's notification bell -- desktop no longer has its own top bar
  // (folded into this component, see the <aside> header row below), so
  // App.tsx passes its desktop-flavored notification slot down here
  // separately from the mobile one above.
  desktopNotificationSlot?: ReactNode
  showQuickPreferences?: boolean
  // Controls the mobile top bar's hide-on-scroll-down / show-on-scroll-up
  // behavior (see useMobileHeaderAutoHide in App.tsx). Defaults to visible
  // so any caller that doesn't pass this (e.g. a future test render) still
  // gets a bar that's actually on screen.
  mobileHeaderVisible?: boolean
}

const useApp = useAppHook as () => SidebarAppContext
const UserProfileModal = lazyRetry(async () => ({
  default: (await import('../users/UserProfileModal')).default as ComponentType<UserProfileModalProps>,
}), 'sidebar-user-profile-modal')

const ICONS_BY_ID: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  notes: Pencil,
  catalog: ShoppingBag,
  loyalty_points: Ticket,
  pos: ShoppingCart,
  products: Package,
  branches: Building2,
  sales: BadgeDollarSign,
  contacts: BookUser,
  users: Users,
  review: ClipboardCheck,
  audit_log: ClipboardList,
  receipt_settings: Receipt,
  backup: DatabaseBackup,
  files: FolderOpen,
  settings: Settings,
  server: Server,
}

function getFallbackLabel(itemId: string, language: string): string {
  void language
  if (itemId === 'server') return 'Sync Server'
  if (itemId === 'catalog') return 'Customer Portal'
  if (itemId === 'loyalty_points') return 'Loyalty Points'
  return ''
}

function getNavLabel(item: NavigationItem, t: TranslateFn, language: string): string {
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

function isDarkColor(hex: string | null | undefined): boolean {
  if (!hex) return false
  const clean = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return false
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 0.35
}

function withAlpha(hex: string | null | undefined, alpha: string): string {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex)) return ''
  const clean = hex.startsWith('#') ? hex.slice(1) : hex
  return `#${clean}${alpha}`
}

function mergeStyles(...styles: Array<CSSProperties | undefined>): CSSProperties {
  return Object.assign({}, ...styles.filter(Boolean))
}

function announcePageIntent(pageId: string, source: IntentSource = 'pointer'): void {
  if (typeof window === 'undefined' || !pageId) return
  window.dispatchEvent(new CustomEvent(APP_PAGE_INTENT_EVENT, {
    detail: { pageId, source },
  }))
}

function getIconForItem(itemId: string): LucideIcon {
  return ICONS_BY_ID[itemId] || LayoutDashboard
}

function isNavigationItemWithIcon(item: NavigationItemWithIcon | undefined): item is NavigationItemWithIcon {
  return !!item
}

export default function Sidebar({ notificationSlot = null, desktopNotificationSlot = null, showQuickPreferences = false, mobileHeaderVisible = true }: SidebarProps = {}) {
  const {
    page,
    navigateTo,
    user,
    logout,
    notify,
    t,
    settings,
    hasPermission,
    canAccessPage,
    syncUrl,
    syncConnected,
  } = useApp()

  const [moreOpen, setMoreOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  // The footer account row is a full-width toggle that expands into an account
  // panel -- Profile / Settings / Receipt Settings / Update / Exit -- so those
  // stop being separate sidebar nav rows and live under the account instead
  // (user request). The same panel opens as a dropdown from the mobile header
  // avatar.
  const [accountOpen, setAccountOpen] = useState(false)
  // The explicit "Refresh / check for update" action. Both the reload-safety
  // guard and the skip-waiting handshake live in utils/appUpdate.ts so this
  // menu entry and AppUpdateToast.tsx cannot drift apart -- see that module
  // for why an in-flight online sale and unsaved editor work are the only two
  // blockers (the POS cart and the offline queue both survive a reload).
  //
  // The two window.alert() calls this used to make are gone: a native modal
  // alert is the blocking popup this app deliberately does not use, and
  // renderAccountAction closes the panel before running the action anyway, so
  // an inline message here would never be read. The refusal goes through the
  // app's own non-blocking notification channel instead.
  const runAppUpdate = async () => {
    const refused = await applyAppUpdate()
    if (!refused) return
    notify(refused === 'sale-in-flight'
      ? (t('wait_for_sale_before_update') || 'Wait for the current sale to finish before updating the app.')
      : (t('save_or_discard_before_update') || 'Save or discard your unfinished work before updating the app.'), 'warning', 6000)
  }

  // N2: which pages currently hold registered unsaved work -- drives the
  // amber dot on their nav items. Registry changes (open/close of a dirty
  // surface) re-render via the external store; isDirty() itself is cheap.
  const registeredWork = useSyncExternalStore(subscribeDirtyWork, getRegisteredWork, getRegisteredWork)
  const dirtyPageIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of registeredWork) {
      try { if (entry.isDirty()) ids.add(entry.pageId) } catch { /* treat as clean */ }
    }
    return ids
  }, [registeredWork])

  // Real bug found and fixed this session: this used to filter on a plain
  // strict `hasPermission(item.permission)`, which can never return true
  // for a 'review' tier value (hasPermission is deliberately strict-
  // boolean, see cloudflare/src/lib/permissions.ts's own comment on why).
  // That meant every Review-Required-tier user for a REVIEW_TIER_KEYS
  // section (Products/Inventory/Branches/Returns/Fees/Contacts) had their
  // sidebar link hidden entirely, even though AppContext.tsx's own
  // canAccessPage() already correctly lets them open the page (only
  // specific actions inside it get queued for review, not the whole
  // page) -- link hidden, page reachable, the exact "sidebar and guard
  // disagree" bug class navigationConfig.test.ts already exists to catch
  // for the null-vs-string-permission case, just not this tier case. Also
  // fixes the same-shape gap for a user holding only one of Settings'
  // narrower business_identity/sales_policy/drive_credentials grants
  // (this session's Settings per-field permission work) and for
  // products_image_only users -- canAccessPage() already special-cases
  // both. Switched to canAccessPage(item.id), which every page id already
  // has a real entry for (navigationConfig.test.ts's own cross-check
  // enforces that), so this is a strict improvement, not a behavior
  // change for anyone who already saw their correct link.
  const visibleItems = useMemo<NavigationItemWithIcon[]>(() => {
    const orderedIds = parseNavSetting(settings?.ui_nav_order, [])
    const allowedItems = NAV_CONFIG_ITEMS
      .filter((item) => canAccessPage(item.id) && !ACCOUNT_NAV_IDS.has(item.id))
      .map((item) => ({ ...item, icon: getIconForItem(item.id) }))
    return orderNavItems(allowedItems, orderedIds)
  }, [canAccessPage, settings?.ui_nav_order])

  const mobilePinnedIds = useMemo<string[]>(() => {
    const saved = parseNavSetting(settings?.ui_mobile_pinned, DEFAULT_MOBILE_PINNED)
    return saved.slice(0, 4)
  }, [settings?.ui_mobile_pinned])

  const pinnedItems = useMemo<NavigationItemWithIcon[]>(() => {
    const byId = new Map(visibleItems.map((item) => [item.id, item]))
    return mobilePinnedIds.map((id) => byId.get(id)).filter(isNavigationItemWithIcon)
  }, [visibleItems, mobilePinnedIds])

  const drawerItems = visibleItems.filter((item) => !mobilePinnedIds.includes(item.id))

  const language = settings?.language || 'en'
  const brandLogo = settings?.customer_portal_logo_image || ''
  const brandName = settings?.business_name || 'Business OS'
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

  const textStyle: CSSProperties | undefined = sidebarTextColor ? { color: sidebarTextColor } : undefined
  const subduedTextStyle: CSSProperties | undefined = sidebarTextColor ? { color: sidebarTextColor, opacity: 0.72 } : undefined
  const activeStyle: CSSProperties | undefined = sidebarTextColor
    ? {
        color: sidebarTextColor,
        backgroundColor: withAlpha(sidebarTextColor, isDark ? '24' : '18') || undefined,
      }
    : undefined
  const mobileInactiveStyle: CSSProperties | undefined = sidebarTextColor ? { color: sidebarTextColor, opacity: 0.74 } : undefined
  const mobileActiveStyle = mergeStyles(
    sidebarTextColor ? { color: sidebarTextColor } : undefined,
    sidebarTextColor ? { backgroundColor: withAlpha(sidebarTextColor, isDark ? '24' : '18') || undefined } : undefined,
  )

  // Account panel actions -- rendered inside the desktop footer expander and
  // the mobile header dropdown. Settings / Receipt Settings are gated the same
  // way their old nav rows were; Profile / Update / Exit are always available
  // to a logged-in user. Update is blue, Exit red, matching the old ☰ menu.
  type AccountAction = { id: string; label: string; icon: LucideIcon; onClick: () => void; tone?: 'blue' | 'red' }
  const accountActions: AccountAction[] = [
    { id: 'profile', label: t('profile') || 'Profile', icon: User, onClick: () => setProfileOpen(true) },
    ...(canAccessPage('settings') ? [{ id: 'settings', label: t('settings') || 'Settings', icon: Settings, onClick: () => navigateTo('settings') } as AccountAction] : []),
    ...(canAccessPage('receipt_settings') ? [{ id: 'receipt_settings', label: t('receipt_settings') || 'Receipt Settings', icon: Receipt, onClick: () => navigateTo('receipt_settings') } as AccountAction] : []),
    { id: 'update', label: t('refresh_app') || 'Update', icon: RefreshCw, onClick: runAppUpdate, tone: 'blue' },
    { id: 'logout', label: t('logout') || 'Exit', icon: LogOut, onClick: logout, tone: 'red' },
  ]
  const accountActionToneClass = (tone?: 'blue' | 'red') => (
    tone === 'blue'
      ? 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20'
      : tone === 'red'
        ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
  )
  const renderAccountAction = (item: AccountAction) => {
    const Icon = item.icon
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => { setAccountOpen(false); item.onClick() }}
        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors ${accountActionToneClass(item.tone)}`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </button>
    )
  }

  return (
    <>
      {/* h-full (not a `calc(100vh-3.5rem)` vh recomputation) deliberately --
          this <aside> is the immediate flex child of App.tsx's
          `flex min-h-0 flex-1 overflow-hidden` row, whose own real height is
          already exactly (app-root's h-screen/dvh height minus the h-14
          topbar) via flex layout, not vh math. Redeclaring that same
          quantity here via a raw, non-dvh-aware `100vh` calc could drift
          from the row's real (dvh-based) height whenever the browser's
          dynamic toolbar/keyboard changes the visible viewport mid-session
          (100vh tracks the largest possible viewport, not the current one,
          so it doesn't move in lockstep with the row's actual dvh-driven
          height) -- on this page in particular, which scrolls further than
          most, that gap showed up as a solid dark strip of empty space
          below the sidebar's own last item once the two heights diverged.
          h-full inherits the parent's real, already-correct height instead
          of re-deriving a competing one, so there's nothing left to drift. */}
      <aside className={`sticky top-0 hidden h-full w-[220px] flex-shrink-0 flex-col border-r min-h-0 md:flex ${!sidebarBg ? 'border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900' : 'border-transparent'}`}>
        {/* Desktop no longer gets its own top bar (App.tsx used to render a
            separate h-14 row above the whole layout with the logo, brand
            name, notification bell, and theme/language toggles) -- per the
            "for large screen remove topbar for pages, just merge into
            sidebar" request, all of that except the brand name (explicitly
            asked to drop) now lives here as the aside's own header row. */}
        <div className={`flex flex-shrink-0 items-center gap-2 border-b p-3 ${borderClass}`}>
          <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full ${brandLogo ? 'ring-1 ring-slate-200/80 dark:ring-slate-700/70' : 'border border-slate-200/80'}`} style={!brandLogo ? { background: 'var(--ui-accent)' } : undefined}>
            {brandLogo ? (
              <img src={brandLogo} alt={brandName} loading="eager" decoding="async" fetchPriority="high" className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-items-center text-xs font-semibold text-white">
                {brandName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <MinimizedWorkTray variant="desktop" />
            {desktopNotificationSlot}
            {showQuickPreferences ? (
              <Suspense fallback={<QuickPreferenceTogglesFallback />}>
                <QuickPreferenceToggles />
              </Suspense>
            ) : null}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 pt-4">
          <div className="space-y-0.5">
            {visibleItems.map((item) => {
              const Icon = item.icon
              const isActiveItem = page === item.id
              const label = getNavLabel(item, t, language)
              return (
                <button
                  key={item.id}
                  aria-label={label}
                  data-bos-nav-id={item.id}
                  onFocus={() => announcePageIntent(item.id, 'focus')}
                  onClick={() => navigateTo(item.id)}
                  onPointerEnter={() => announcePageIntent(item.id, 'pointer')}
                  className={`${sidebarBg ? `flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${hoverClass} ${textClass} ${isActiveItem ? activeClass : ''}` : `sidebar-item flex w-full items-center gap-2 text-left ${isActiveItem ? 'active' : ''}`} ${item.id === 'server' ? 'mt-2' : ''}`}
                  style={isActiveItem ? activeStyle : textStyle}
                >
                  <span className="flex min-w-[20px] justify-center">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate">{label}</span>
                  {/* N2: dirty-work dot -- this page holds unsaved work */}
                  {dirtyPageIds.has(item.id) ? (
                    <span className="ml-auto h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" title={t('unsaved_work_title') || 'Unsaved work on this page'} />
                  ) : null}
                  {item.id === 'server' && syncUrl ? (
                    <span className={`${dirtyPageIds.has(item.id) ? '' : 'ml-auto '}h-2 w-2 flex-shrink-0 rounded-full ${syncConnected ? 'bg-green-400' : 'bg-yellow-400'}`} />
                  ) : null}
                </button>
              )
            })}
          </div>
        </nav>

        <div className={`border-t p-3 ${borderClass}`}>
          {/* The account expander -- Profile / Settings / Receipt Settings /
              Update / Exit -- opens upward above the account row. Rendered in
              a neutral panel so its item tones read regardless of a custom
              sidebar colour. Settings & Receipt Settings used to be their own
              nav rows; they live here now. */}
          {accountOpen ? (
            <div className="mb-2 space-y-0.5 rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              {accountActions.map(renderAccountAction)}
            </div>
          ) : null}
          {/* Full-width account row -- the whole row is the toggle: click to
              expand/collapse the panel above. */}
          <button
            type="button"
            onClick={() => setAccountOpen((open) => !open)}
            aria-expanded={accountOpen}
            aria-label={t('account') || 'Account'}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${hoverClass || 'hover:bg-gray-100 dark:hover:bg-slate-800'}`}
            style={textStyle}
          >
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'var(--ui-accent)22' }}>
              {user?.avatar_path ? (
                <img src={user.avatar_path} alt={user?.name || 'User'} className="h-8 w-8 rounded-full object-cover" loading="lazy" decoding="async" />
              ) : (
                <span className="text-sm font-bold" style={{ color: 'var(--ui-accent)' }}>
                  {user?.name?.[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-sm font-medium ${textClass || 'text-gray-900 dark:text-white'}`} style={textStyle}>
                {user?.name}
              </div>
              <div className={`truncate text-xs ${subTextClass || 'text-gray-400'}`} style={subduedTextStyle}>
                {user?.role_name || t('no_role') || 'No role'}
              </div>
            </div>
            <ChevronUp className={`h-4 w-4 flex-shrink-0 transition-transform ${accountOpen ? 'rotate-180' : ''} ${subTextClass || 'text-gray-400'}`} style={subduedTextStyle} />
          </button>
        </div>
      </aside>

      {/* iPhone notch / Dynamic Island: a bare h-16 fixed header sits flush
          against the physical top edge, so its buttons render partially
          under the status bar/notch on any device with a safe-area inset.
          pt-[env(...)] pushes the flex row down inside a taller box whose
          background still extends fully behind the notch; App.tsx's <main>
          padding-top is matched to this same total height. */}
      <header
        className={`fixed left-0 right-0 top-0 z-40 flex h-[calc(4rem+env(safe-area-inset-top))] items-center justify-between border-b border-gray-200 bg-white pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] transition-transform duration-300 ease-in-out dark:border-slate-800 dark:bg-slate-900 md:hidden ${mobileHeaderVisible ? 'translate-y-0' : '-translate-y-full'}`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-slate-100 dark:border-slate-700 dark:bg-slate-800/80">
            {brandLogo ? (
              <img src={brandLogo} alt={brandName} className="h-full w-full object-cover" loading="eager" decoding="async" fetchPriority="high" />
            ) : (
              <span className="grid h-full w-full place-items-center text-base font-semibold text-white" style={{ background: 'var(--ui-accent)' }}>
                {brandName.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
        </div>
        <div className="mx-2 min-w-0 flex-1">
          <MinimizedWorkTray variant="mobile" />
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {notificationSlot}
          {showQuickPreferences ? (
            <Suspense fallback={<QuickPreferenceTogglesFallback />}>
              <QuickPreferenceToggles />
            </Suspense>
          ) : null}
          <div className="relative z-50 flex-shrink-0">
            <button type="button" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-label={t('account') || 'Account'} className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50/90 p-0.5 dark:bg-blue-900/30">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/40">
                {user?.avatar_path ? (
                  <img src={user.avatar_path} alt={user?.name || 'User'} className="h-10 w-10 object-cover" loading="lazy" decoding="async" />
                ) : (
                  <span className="text-base font-bold text-blue-600 dark:text-blue-400">
                    {user?.name?.[0]?.toUpperCase()}
                  </span>
                )}
              </div>
            </button>
            {accountOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAccountOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-1 flex items-center gap-2.5 border-b border-gray-100 px-2.5 py-2 dark:border-gray-700">
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/40">
                      {user?.avatar_path ? (
                        <img src={user.avatar_path} alt={user?.name || 'User'} className="h-8 w-8 object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{user?.name?.[0]?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900 dark:text-white">{user?.name}</div>
                      <div className="truncate text-xs text-gray-400">{user?.role_name || t('no_role') || 'No role'}</div>
                    </div>
                  </div>
                  {accountActions.map(renderAccountAction)}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <nav className="safe-area-inset-bottom fixed bottom-0 left-0 right-0 z-40 flex h-14 items-stretch border-t border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:hidden">
        {pinnedItems.map((item) => {
          const Icon = item.icon
          const isActiveItem = page === item.id
          const label = getNavLabel(item, t, language)
          return (
            <button
              key={item.id}
              aria-label={label}
              data-bos-nav-id={item.id}
              onFocus={() => announcePageIntent(item.id, 'focus')}
              onClick={() => { navigateTo(item.id); setMoreOpen(false) }}
              onPointerEnter={() => announcePageIntent(item.id, 'pointer')}
              onTouchStart={() => announcePageIntent(item.id, 'touch')}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${!sidebarTextColor ? (isActiveItem ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400') : ''}`}
              style={isActiveItem ? mobileActiveStyle : mobileInactiveStyle}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="block max-w-[68px] truncate whitespace-nowrap text-center text-[9.5px] font-medium leading-3">
                {label}
              </span>
            </button>
          )
        })}
        <button
          aria-label={t('more') || 'More'}
          data-bos-nav-id="more"
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 transition-colors ${!sidebarTextColor ? (moreOpen ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400') : ''}`}
          style={moreOpen ? mobileActiveStyle : mobileInactiveStyle}
        >
          <MoreHorizontal className="h-4 w-4 shrink-0" />
          <span className="block max-w-[68px] truncate whitespace-nowrap text-center text-[9.5px] font-medium leading-3">{t('more') || 'More'}</span>
        </button>
      </nav>

      {moreOpen ? (
        <>
          <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMoreOpen(false)} />
          {/* bottom-[...] matches the bottom nav's actual height (3.55rem +
              safe-area-inset-bottom, see .safe-area-inset-bottom in main.css)
              instead of a flat bottom-16, so this drawer doesn't slide in
              underneath -- and get hidden behind -- the taller nav bar that
              env(safe-area-inset-bottom) produces on notched iPhones. */}
          <div className="fixed bottom-[calc(3.55rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 max-h-[calc(var(--app-vh-100)_*_.7)] overflow-y-auto rounded-t-2xl border-t border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 md:hidden">
            <div className="sticky top-0 bg-white px-3 pb-1 pt-3 dark:bg-gray-900">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>
            <div className="grid grid-cols-4 gap-2 px-3 pb-4">
              {drawerItems.map((item) => {
                const Icon = item.icon
                const isActiveItem = page === item.id
                const label = getNavLabel(item, t, language)
                return (
                  <button
                    key={item.id}
                    aria-label={label}
                    data-bos-nav-id={item.id}
                    onFocus={() => announcePageIntent(item.id, 'focus')}
                    onClick={() => { navigateTo(item.id); setMoreOpen(false) }}
                    onPointerEnter={() => announcePageIntent(item.id, 'pointer')}
                    onTouchStart={() => announcePageIntent(item.id, 'touch')}
                    className={`relative flex flex-col items-center gap-1.5 rounded-xl p-3 text-xs font-medium transition-colors ${!sidebarTextColor ? (isActiveItem ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400') : (isActiveItem ? 'bg-white/70 dark:bg-slate-800/70' : 'bg-gray-50 dark:bg-gray-800')}`}
                    style={isActiveItem ? mobileActiveStyle : mobileInactiveStyle}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-center leading-tight">{label}</span>
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

      {profileOpen ? (
        <Suspense fallback={null}>
          <UserProfileModal onClose={() => setProfileOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
