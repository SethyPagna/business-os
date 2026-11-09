import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAVIGATION_EVENT, getAdminPageFromPath } from '../../app/pathRouting.ts'

import type { HubDestination } from './hubDestinations.ts'

export const hubAnchor = (page: string, section: string): string => `hub:${page}:${section}`

/** Root URLs can host the configured landing hub; a section anchor identifies it. */
export function getHubPageFromLocation(pathname: string, hash: string): string {
  const page = getAdminPageFromPath(pathname)
  if (page) return page
  return pathname === '/' ? (hash.match(/^#hub:(branches|inventory|sales|contacts|promotions|settings|review):/)?.[1] || '') : ''
}

/** The root landing page has no route identity until its visible host publishes
 * the body it actually chose. Hidden retained hosts must never claim that URL. */
export function sealRootHubSection(page: string, section: string, activePage: string): boolean {
  if (typeof window === 'undefined' || page !== activePage || !section
    || window.location.pathname !== '/' || window.location.hash) return false
  const anchor = hubAnchor(page, section)
  if (getHubPageFromLocation('/', `#${anchor}`) !== page) return false
  window.history.replaceState(window.history.state, '', `/${window.location.search}#${anchor}`)
  window.dispatchEvent(new CustomEvent(APP_NAVIGATION_EVENT, { detail: { page, path: '/', anchor } }))
  return true
}

const LEGACY_SECTION_PATHS: Record<string, string> = {
  '/returns': 'returns', '/fees': 'fees',
  '/users': 'users', '/backup': 'backup', '/backups': 'backup',
  '/audit': 'audit', '/audit-log': 'audit', '/delivery-contacts': 'delivery',
  '/loyalty': 'loyalty', '/loyalty-points': 'loyalty',
}

/**
 * The section the LOCATION itself names -- the committed `#hub:<page>:<id>`
 * anchor, or a legacy path that still maps to one -- and '' when it names
 * none.
 *
 * This is what the CHROME (the mobile top bar's title, the navigation
 * layer's active/unfolded state) must read, and the reason it is a separate
 * export from resolveHubSection: the fallback resolveHubSection applies when
 * the URL is silent belongs to the HOST page, and the chrome does not have
 * it. The chrome used to guess with `localStorage['bos:hub:<page>:active']`,
 * i.e. the last section visited. For Sales and Contacts that happens to
 * agree, because their hosts seed themselves from the same key; for Products
 * (fixed 'products'), Promotions ('rules'/'loyalty'), Review and Branches it
 * does not. So on any entry that carries no anchor -- a cold PWA launch on
 * /products, a bookmark, a page tap that cleared a foreign hub hash -- the
 * bar titled itself with the sub page last visited while the body rendered
 * the page's own default: the reported "it still shows the page i back
 * from".
 *
 * '' is a real answer -- page level, no section claimed -- not a cue to
 * guess. The host publishes its choice a tick later (useHubSection's
 * `publish`) and the chrome follows the committed route from then on.
 */
export function resolveChromeSection(page: string, pathname: string, hash: string, allowed: readonly string[]): string {
  const prefix = `#hub:${page}:`
  const requested = hash.startsWith(prefix) ? hash.slice(prefix.length) : ''
  if (allowed.includes(requested)) return requested
  const oldSection = LEGACY_SECTION_PATHS[pathname.toLowerCase().replace(/\/$/, '')]
  return oldSection && allowed.includes(oldSection) ? oldSection : ''
}

export function resolveHubSection(page: string, pathname: string, hash: string, allowed: readonly string[], fallback: string): string {
  const located = resolveChromeSection(page, pathname, hash, allowed)
  if (located) return located
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
    if (typeof window === 'undefined' || getHubPageFromLocation(window.location.pathname, window.location.hash) !== page) return fallback
    return resolveHubSection(page, window.location.pathname, window.location.hash, allowed, fallback) as S
  })
  const current = useRef({ allowed, section })
  current.current = { allowed, section }
  useEffect(() => {
    const publish = (id: string) => {
      // Seal the initial/restored body into this entry without adding a layer.
      // Existing non-hub anchors (Settings fields, notifications) keep their meaning.
      if (getHubPageFromLocation(window.location.pathname, window.location.hash) !== page || !id) return
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
