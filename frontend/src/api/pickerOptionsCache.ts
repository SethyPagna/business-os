import { captureActorReadScope, assertActorReadScope, isActorReadScopeCurrent, invalidateActorReadChannel, type ActorReadScope } from './actorReadScope.ts'

// P9-12 wave 2 item 2: the catalog-bound pickers (supplier/brand/category/
// unit/product-name/barcode -- Contacts, POS, Products, stock actions,
// stock-in, returns) each re-fetched their option list over the network
// every time the surface opened. SupplierPickerField already carried a
// one-off module-scoped cache with a TTL and a sync:update listener; this
// generalizes exactly that shape into ONE shared module so every other
// picker (and any other caller loading the same names, like ProductForm's
// own supplier field, which used to run a second independent fetch) reuses
// the same in-memory entry instead of each growing its own copy.
//
// Deliberately in-memory only (no IndexedDB/localStorage): these lists are
// small, per-session, and already have a durable offline path elsewhere
// (queryCache.ts / localMirrors.ts) for surfaces that need one. This cache
// exists purely to stop the *within-session* refetch-on-every-open pattern.

type CacheEntry<T> = { data: T; at: number; scope: ActorReadScope }

const DEFAULT_TTL_MS = 60_000
const cache = new Map<string, CacheEntry<unknown>>()
const installedListenerChannels = new Set<string>()

function ensureSyncListener(channel: string): void {
  if (installedListenerChannels.has(channel) || typeof window === 'undefined') return
  installedListenerChannels.add(channel)
  window.addEventListener('sync:update', (event: Event) => {
    const detail = (event as CustomEvent<{ channel?: string }>).detail
    if (String(detail?.channel || '') === channel) invalidatePickerOptionsCache(channel)
  })
}

/** Drop the cached entry for `channel` and fence off any in-flight read that
 *  was captured before this call (the same scope-invalidation the rest of
 *  the read stack uses), so a stale response can never overwrite a fresher
 *  invalidation. Call this from create/rename/merge write paths. */
export function invalidatePickerOptionsCache(channel: string): void {
  cache.delete(channel)
  invalidateActorReadChannel(channel)
}

/**
 * Load `channel`'s option list, serving a fresh-enough in-memory copy
 * instead of re-fetching. `loader` runs at most once per TTL window per
 * channel (across every caller sharing that channel name) unless a
 * sync:update for that channel, or an actor/session change, invalidates it
 * first.
 */
export async function loadPickerOptions<T>(channel: string, loader: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  ensureSyncListener(channel)
  const scope = captureActorReadScope(channel)
  const cached = cache.get(channel) as CacheEntry<T> | undefined
  if (cached && isActorReadScopeCurrent(cached.scope) && Date.now() - cached.at < ttlMs) {
    return cached.data
  }
  const data = await loader()
  assertActorReadScope(scope)
  cache.set(channel, { data, at: Date.now(), scope })
  return data
}
