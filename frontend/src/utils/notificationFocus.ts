// The hand-off a notification click leaves for its destination (NOTIF-V2). A destination page that is
// already mounted listens for the event; one that mounts later reads the queued value on mount -- the
// same two-way pattern components/shared/entityLinkFocus.ts uses for products and contacts, extended
// to the three destinations that had none: one sale's detail, the Users section's Devices tab, and
// the Branches products list filtered by stock state.
import { queueEntitySearch } from '../components/shared/entityLinkFocus.ts'
import type { NotificationFocus } from './notificationTargets.ts'

export const SALE_FOCUS_KEY = 'bos:sales:focus'
export const SALE_FOCUS_EVENT = 'bos:sale-focus'
export const USERS_FOCUS_KEY = 'bos:users:focus'
export const USERS_FOCUS_EVENT = 'bos:users-focus'
// Written by Dashboard.openInventoryOverview and read by BranchesHubPage / Inventory; the shape is theirs.
export const INVENTORY_FOCUS_KEY = 'bos:dashboard:inventory-focus'

function queue(key: string, value: unknown, event?: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked (iOS "Block All Cookies"): the navigation still lands on the right page.
    return
  }
  if (event) window.dispatchEvent(new CustomEvent(event))
}

/** Queue what the destination should focus; call right before navigateTo(). */
export function queueNotificationFocus(focus: NotificationFocus | undefined): void {
  if (!focus) return
  if (focus.type === 'search') {
    queueEntitySearch(focus.page, focus.search, focus.anchor)
  } else if (focus.type === 'sale') {
    queue(SALE_FOCUS_KEY, { saleId: focus.saleId }, SALE_FOCUS_EVENT)
  } else if (focus.type === 'users-devices') {
    queue(USERS_FOCUS_KEY, { tab: 'devices' }, USERS_FOCUS_EVENT)
  } else if (focus.type === 'inventory-products') {
    queue(INVENTORY_FOCUS_KEY, { section: 'products', tab: 'products', stockFilter: focus.stockFilter })
  }
}

/** Read-and-clear a queued value; null when nothing (or something unreadable) is queued. */
export function takeQueuedFocus<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  let raw: string | null = null
  try { raw = window.sessionStorage.getItem(key) } catch { return null }
  if (!raw) return null
  try { window.sessionStorage.removeItem(key) } catch { /* nothing to clear where storage is unusable */ }
  try { return JSON.parse(raw) as T } catch { return null }
}
