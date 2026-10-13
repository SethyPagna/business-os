import { isActorSessionQuarantined } from '../api/actorReadScope.ts'
import { captureOfflineSaleOwner, normalizeOfflineSaleOwner, offlineSaleOwnersMatch, type OfflineSaleOwner } from '../api/offlineQueueOwnership.ts'

// A POS checkout whose request was sent with no confirmed answer yet. A
// confirmed sign-out, or another organization signing in on the device, clears
// the till's orders; these are copied out first, bound to the account,
// organization and server that sent them, so that account finds them again and
// re-ringing the sale cannot record it twice. Nothing here sends: the till's
// recovery banner checks the receipt, and a resend still needs a click.

const ORDERS_PREFIX = 'businessos_pos_orders_'
export const UNRESOLVED_CHECKOUT_PREFIX = 'businessos_pos_checkout_unresolved_v1:'

type Order = Record<string, unknown> & { id?: unknown; checkoutRequestId?: unknown; checkoutPayload?: { offline_owner?: unknown } }
type TillUser = { id?: unknown; organization_id?: unknown } | null | undefined

const recordKey = (owner: OfflineSaleOwner) => UNRESOLVED_CHECKOUT_PREFIX + encodeURIComponent(JSON.stringify([owner.authority, owner.organization_id, owner.actor_id]))
const pendingId = (order: Order) => (typeof order.checkoutRequestId === 'string' ? order.checkoutRequestId.trim() : '')

function store(kind: 'local' | 'session'): Storage | null {
  try { return (kind === 'local' ? window.localStorage : window.sessionStorage) || null } catch { return null }
}

function orders(raw: string | null | undefined): Order[] {
  try {
    const value: unknown = JSON.parse(raw || 'null')
    return Array.isArray(value) ? value.filter((order): order is Order => !!order && typeof order === 'object' && !Array.isArray(order)) : []
  } catch { return [] }
}

/** Before a reset clears the till's orders: copy out every unresolved checkout. */
export function keepUnresolvedPosCheckouts(): void {
  const local = store('local')
  if (!local) return
  const kept = new Map<string, Order[]>()
  for (const kind of ['local', 'session'] as const) {
    const source = store(kind)
    try {
      for (let index = 0; source && index < source.length; index += 1) {
        const key = source.key(index)
        if (!key?.startsWith(ORDERS_PREFIX)) continue
        for (const order of orders(source.getItem(key))) {
          const owner = pendingId(order) ? normalizeOfflineSaleOwner(order.checkoutPayload?.offline_owner) : null
          if (!owner) continue
          const target = recordKey(owner)
          const list = kept.get(target) ?? orders(local.getItem(target))
          if (!list.some((entry) => pendingId(entry) === pendingId(order))) list.push(order)
          kept.set(target, list)
        }
      }
    } catch { /* an unreadable store has nothing to copy */ }
  }
  for (const [key, list] of kept) {
    try { local.setItem(key, JSON.stringify(list)) } catch { /* full or blocked: nothing more can be kept */ }
  }
}

/** The signed-in account's kept checkouts, put back into its till once: the
 *  orders are written (and read back) before the kept copy is removed, and the
 *  first of them becomes the open order so its recovery banner shows. */
export function restoreUnresolvedPosCheckouts(user: TillUser, tillScope: string): void {
  const local = store('local')
  if (!local || !user?.id || isActorSessionQuarantined()) return
  let owner: OfflineSaleOwner
  try { owner = captureOfflineSaleOwner() } catch { return }
  if (owner.actor_id !== Number(user.id) || owner.organization_id !== (user.organization_id ?? null)) return
  const key = recordKey(owner)
  try {
    const kept = orders(local.getItem(key)).filter((order) => pendingId(order) && offlineSaleOwnersMatch(order.checkoutPayload?.offline_owner, owner))
    if (!kept.length) { local.removeItem(key); return }
    const ordersKey = `${ORDERS_PREFIX}${tillScope}`
    const session = store('session')
    const saved = orders(local.getItem(ordersKey) || session?.getItem(ordersKey))
    const missing = kept.filter((order) => !saved.some((entry) => pendingId(entry) === pendingId(order)))
      .map((order, index) => ({ ...order, label: `Order ${saved.length + index + 1}` }))
    const merged = [...saved, ...missing]
    const serialized = JSON.stringify(merged)
    const counterKey = `businessos_pos_counter_${tillScope}`
    const counter = String(Math.max(merged.length + 1, Number.parseInt(local.getItem(counterKey) || '', 10) || 0))
    for (const target of [local, session]) {
      try {
        target?.setItem(ordersKey, serialized)
        if (missing.length) target?.setItem(`businessos_pos_active_${tillScope}`, String(missing[0].id))
        target?.setItem(counterKey, counter)
      } catch { /* the local copy decides below */ }
    }
    if (local.getItem(ordersKey) === serialized) local.removeItem(key)
  } catch { /* kept copy stays for the next attempt */ }
}
