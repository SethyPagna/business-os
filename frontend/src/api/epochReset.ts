// What a tab does when the database gets a new data epoch (a restore, a branch cutover, a forced maintenance clear; CACHE-LIFECYCLE R2).
//
//   drops    the memory read cache (cacheClearAll also fences every read already in flight) and the product search index, in
//            memory and on disk
//   refreshes the page being shown, through the same staggered channel events a reconnect uses: only mounted screens answer them
//   keeps    drafts, carts, unsent checkouts, the signed-in account and the service worker. The server checks every one of them at
//            submit, so a stale cart is refused there instead of being deleted here.
//   never    reloads. The only update path is the "Restart now" bar.
import { cacheClearAll, dispatchGlobalDataRefresh } from './http.ts'
import { DATA_EPOCH_EVENT, isEpochTag } from './dataEpoch.ts'
import { readStoredRuntimeDescriptor, writeStoredRuntimeDescriptor } from '../platform/runtime/clientRuntime.ts'

let installed = false

export function resetClientForNewDataEpoch(epoch: string): void {
  if (isEpochTag(epoch)) {
    try { writeStoredRuntimeDescriptor({ ...readStoredRuntimeDescriptor(), dataEpoch: epoch }) } catch { /* storage may be blocked */ }
  }
  cacheClearAll()
  // Loaded on demand: the index is an admin-only chunk, and a static import here would pull it into the storefront's closure.
  void import('./productSearchIndex.ts').then((index) => index.resetProductSearchIndexForNewEpoch()).catch(() => {})
  dispatchGlobalDataRefresh()
}

export function installDataEpochReset(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener(DATA_EPOCH_EVENT, (event) => {
    const epoch = (event as CustomEvent<{ epoch?: unknown }>).detail?.epoch
    if (isEpochTag(epoch)) resetClientForNewDataEpoch(epoch)
  })
}

export const __dataEpochResetTest = { reset(): void { installed = false } }
