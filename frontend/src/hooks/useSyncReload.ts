import { useContext, useEffect, useRef } from 'react'
import { SyncContext, mergeSyncUpdates, syncHas, type SyncUpdate } from '../app/syncUpdates.ts'

type SyncReloadOptions = {
  /** A hidden (kept-mounted) page passes false; its events wait until it is shown. */
  isActive?: boolean
}

// Reloads a page when a live-sync window carries one of `channels`.
//
// Replaces the pattern the I7 audit found in every list page:
//
//   useEffect(() => {
//     if (!isActive || syncChannel?.channel !== 'products') return
//     void load()
//   }, [isActive, load, syncChannel?.channel, syncChannel?.ts])
//
// `load` changes identity on every search, filter or page change, so that
// effect re-ran for the LAST broadcast each time -- one old event made every
// later search load twice. Here the handler is read through a ref (a new
// handler never re-runs anything) and each window is handled at most once,
// keyed by its strictly increasing ts.
//
// Windows that arrive while the page is inactive are merged and handled once,
// when it becomes active. Windows from before the page mounted are not
// replayed: a page loads fresh on mount anyway.
export function useSyncReload(
  channels: readonly string[],
  handler: (update: SyncUpdate) => void,
  { isActive = true }: SyncReloadOptions = {},
): void {
  const syncUpdate = useContext(SyncContext)?.syncUpdate ?? null
  const handlerRef = useRef(handler)
  const lastSeenTsRef = useRef(syncUpdate?.ts ?? 0)
  const pendingRef = useRef<SyncUpdate | null>(null)
  // A caller's inline array literal is a new array each render; key on content.
  const channelKey = channels.join('\n')

  // Declared before the effect below, so it runs first in the same commit.
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (syncUpdate && syncUpdate.ts > lastSeenTsRef.current) {
      lastSeenTsRef.current = syncUpdate.ts
      const watched = channelKey.split('\n')
      if (watched.some((channel) => syncHas(syncUpdate, channel))) {
        pendingRef.current = mergeSyncUpdates(pendingRef.current, syncUpdate)
      }
    }
    if (!isActive || !pendingRef.current) return
    const update = pendingRef.current
    pendingRef.current = null
    handlerRef.current(update)
  }, [channelKey, isActive, syncUpdate])
}
