import { useEffect, useRef, useSyncExternalStore } from 'react'
import { refreshTwinDismissals, supersedeTwinDismissalReads } from './twinDismissalsTransport.ts'
import { useSync } from '../../AppContext.tsx'
import {
  NO_TWIN_DISMISSALS,
  getTwinDismissals,
  setTwinDismissals,
  subscribeTwinDismissals,
  type TwinDismissals,
} from '../../utils/productTwinDismissals.ts'

// The staff shell mounts this once: the "Keep both" rulings behind the Duplicate tag (utils/productTwinDismissals.ts) are read when an account signs in and
// again after a products change anywhere (a 'products' sync update, as the product search index revalidates).
const SYNC_REFRESH_DELAY_MS = 1_500

// `enabled` is false for a signed-out shell and for an account that can open none of the lists that show the tag.
export function useTwinDismissalsLoader(accountKey: string, enabled: boolean): void {
  const { syncChannel } = useSync() as { syncChannel?: { channel?: string; reason?: string; ts?: number } | null }
  const productsChange = syncChannel?.channel === 'products' && syncChannel.reason !== 'cache-refresh' ? Number(syncChannel.ts || 0) : 0
  const loadedFor = useRef('')

  useEffect(() => {
    if (!enabled || !accountKey) {
      supersedeTwinDismissalReads()
      loadedFor.current = ''
      setTwinDismissals(NO_TWIN_DISMISSALS)
      return undefined
    }
    // A new account reads at once; a later products change waits a moment so a burst of writes is one read.
    const delay = loadedFor.current === accountKey ? SYNC_REFRESH_DELAY_MS : 0
    loadedFor.current = accountKey
    const timer = setTimeout(() => { void refreshTwinDismissals() }, delay)
    return () => clearTimeout(timer)
  }, [accountKey, enabled, productsChange])
}

// The shell renders this beside its other hosts: the hook subscribes to the sync context, and a component of its own keeps a sync update from re-rendering the shell.
export function TwinDismissalsLoader({ accountKey, enabled }: { accountKey: string; enabled: boolean }): null {
  useTwinDismissalsLoader(accountKey, enabled)
  return null
}

// For a list that memoises its groups: the loaded set, as a dependency, so the groups are rebuilt when a ruling arrives.
export function useTwinDismissals(): TwinDismissals {
  return useSyncExternalStore(subscribeTwinDismissals, getTwinDismissals, getTwinDismissals)
}
