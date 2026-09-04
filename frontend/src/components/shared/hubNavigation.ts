import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAVIGATION_EVENT, getAdminPageFromPath } from '../../app/pathRouting.ts'

export type HubAccess = {
  getPermissionTier: (key: string) => string
  hasPermission: (key: string) => boolean
}
export type HubDestination = { id: string; key: string; label: string }

/** These are the existing host section ids, not additional page routes. */
export function getHubDestinations(page: string, access: HubAccess): HubDestination[] {
  const can = (key: string) => access.getPermissionTier(key) !== 'none'
  const rows: Array<[string, string, string, boolean]> = page === 'branches' ? [
    ['overview', 'overview', 'Overview', can('branches')],
    ['products', 'products', 'Products', can('inventory')],
    ['transfers', 'transfer', 'Transfer', can('branches')],
    ['rfid', 'rfid', 'RFID', can('inventory')],
  ] : page === 'sales' ? [
    ['sales', 'sales', 'Sales', can('sales')],
    ['returns', 'returns', 'Returns', can('returns')],
    ['fees', 'fees', 'Expenses', can('fees')],
    ['reports', 'reports', 'Reports', can('sales') || can('returns') || can('fees')],
  ] : page === 'contacts' ? [
    ['customers', 'customers', 'Customers', true],
    ['suppliers', 'suppliers', 'Suppliers', access.hasPermission('contacts_suppliers')],
    ['delivery', 'pos_delivery', 'Delivery', true],
    ['duplicates', 'possible_duplicates', 'Conflicts', true],
  ] : page === 'promotions' ? [
    ['rules', 'promo_tab_rules', 'Rules', can('promotions')],
    ['discounts', 'promo_tab_discounts', 'Discounts', can('products')],
    ['loyalty', 'loyalty_points', 'Loyalty Points', can('customer_portal')],
  ] : page === 'settings' ? [
    ['settings', 'settings', 'Settings', ['settings', 'business_identity', 'sales_policy', 'drive_credentials'].some(can)],
    ['users', 'users', 'Users', access.hasPermission('all')],
    ['backup', 'backup', 'Backup', can('backup')],
  ] : page === 'review' ? [
    ['review', 'review_queue', 'Review queue', can('review')],
    ['audit', 'audit_log', 'Audit Log', can('audit_log')],
    ['deleted', 'legacy_deleted_sales', 'Deleted sales (old system)', access.getPermissionTier('audit_log') === 'full'],
  ] : []
  return rows.filter((row) => row[3]).map(([id, key, label]) => ({ id, key, label }))
}

export const hubAnchor = (page: string, section: string): string => `hub:${page}:${section}`

export function resolveHubSection(page: string, pathname: string, hash: string, allowed: readonly string[], fallback: string): string {
  const prefix = `#hub:${page}:`
  const requested = hash.startsWith(prefix) ? hash.slice(prefix.length) : ''
  if (allowed.includes(requested)) return requested
  const legacy: Record<string, string> = {
    '/returns': 'returns', '/fees': 'fees', '/inventory': 'products',
    '/users': 'users', '/backup': 'backup', '/backups': 'backup',
    '/audit': 'audit', '/audit-log': 'audit', '/delivery-contacts': 'delivery',
    '/loyalty': 'loyalty', '/loyalty-points': 'loyalty',
  }
  const oldSection = legacy[pathname.toLowerCase().replace(/\/$/, '')]
  if (oldSection && allowed.includes(oldSection)) return oldSection
  return allowed.includes(fallback) ? fallback : (allowed[0] || '')
}

export function navigationHash(currentPage: string, nextPage: string, currentHash: string, anchor?: string): string {
  if (anchor !== undefined) return anchor ? `#${anchor.replace(/^#/, '')}` : ''
  return currentPage !== nextPage && currentHash.startsWith('#hub:') ? '' : currentHash
}

/** A section switch unmounts its body, so it needs the same dirty guard as a page switch. */
export function needsNavigationGuard(currentPage: string, nextPage: string, currentHash: string, nextHash: string): boolean {
  return currentPage !== nextPage || (currentHash !== nextHash && (currentHash.startsWith('#hub:') || nextHash.startsWith('#hub:')))
}

export function mobileGroupAction(expanded: string | null, page: string, sections: readonly HubDestination[], inline: boolean): { expanded: string | null; navigate: boolean } {
  return inline && sections.length > 0
    ? { expanded: expanded === page ? null : page, navigate: false }
    : { expanded: null, navigate: true }
}

/** Hosts keep their bodies and state ownership; only committed navigation changes sections.
 * Hidden retained hosts listen to their own destination, never another page's hash.
 */
export function useHubSection<S extends string>(page: string, initial: S | (() => S), allowed: readonly string[], navigateTo: (page: string, anchor?: string) => void): [S, (section: S) => void] {
  const [section, setSection] = useState<S>(() => {
    const fallback = typeof initial === 'function' ? initial() : initial
    if (typeof window === 'undefined' || getAdminPageFromPath(window.location.pathname) !== page) return fallback
    return resolveHubSection(page, window.location.pathname, window.location.hash, allowed, fallback) as S
  })
  const current = useRef({ allowed, section })
  current.current = { allowed, section }
  useEffect(() => {
    const publish = (id: string) => {
      // Seal the initial/restored body into this entry without adding a layer.
      // Existing non-hub anchors (Settings fields, notifications) keep their meaning.
      if (getAdminPageFromPath(window.location.pathname) !== page || !id) return
      if (window.location.hash && !window.location.hash.startsWith('#hub:')) return
      const anchor = hubAnchor(page, id)
      if (window.location.hash === `#${anchor}`) return
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${anchor}`)
      window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, {
        detail: { page, path: window.location.pathname, anchor },
      }))
    }
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ page: string; path?: string; anchor?: string | null }>).detail
      if (detail?.page !== page) return
      const state = current.current
      const next = resolveHubSection(page, detail.path || window.location.pathname, detail.anchor ? `#${detail.anchor}` : '', state.allowed, state.section)
      setSection(next as S)
      publish(next)
    }
    window.addEventListener(APP_NAVIGATION_EVENT, onNavigate)
    publish(allowed.includes(section) ? section : allowed[0] || '')
    return () => window.removeEventListener(APP_NAVIGATION_EVENT, onNavigate)
  }, [page, allowed.join('|')])
  const choose = useCallback((id: S) => {
    if (current.current.allowed.includes(id)) navigateTo(page, hubAnchor(page, id))
  }, [navigateTo, page])
  return [(allowed.includes(section) ? section : allowed[0] || '') as S, choose]
}
