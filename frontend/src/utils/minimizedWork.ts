// F3 slice 2 (Part 424): the minimized-work registry -- the − button on a
// flow parks it as a chip (mobile: in the top bar; desktop: in the
// sidebar, which IS desktop's chrome since the user removed its top bar),
// and clicking the chip restores the flow wherever you are. Framework-free
// module state + subscribe, same shape as utils/dirtyWork.ts, and
// PERSISTED via the F3 draft store so minimized tabs survive reload --
// restore is therefore DECLARATIVE: a chip stores {kind, pageId, payload},
// never a callback. Restoring navigates to the host page and fires
// RESTORE_WORK_EVENT; the host listens and reopens its flow, whose own
// draft (slice 1) repopulates the content.

import { readWorkDraft, writeWorkDraft, clearWorkDraft, scopedWorkDraftKey } from './workDrafts.ts'

export const RESTORE_WORK_EVENT = 'bos:restore-work'

export type MinimizedWorkKind =
  | 'add_product'
  | 'fast_stockin'
  | 'receive_batch'
  | 'create_products_session'
  | 'product_detail'

export type MinimizedWorkPermission = {
  permissionKey: string
  actionKey: string
}

export type MinimizedWorkEntry = {
  /** Unique key -- re-minimizing the same flow replaces its chip. */
  key: string
  kind: MinimizedWorkKind
  /** The sidebar page hosting the flow (live navigationConfig id -- the
   * hubs' ids post-E-phase: 'products', 'branches', 'sales', ...). */
  pageId: string
  /** Chip label ("Add product — Dior 999"). */
  label: string
  /** Optional restore detail (e.g. a product id for a detail tab). */
  payload?: Record<string, unknown>
  /** The exact actor-scoped draft this chip represents. Supplying the exact
   * key lets chip dismissal discard one per-product/session draft without
   * clearing a sibling flow owned by the same user. */
  draftKey?: string
  /** Re-check the action grant when the chip is restored. Permissions can
   * change while a local draft is parked; the chip remains available, but it
   * must not reopen an action the current operator can no longer perform. */
  requiredPermission?: MinimizedWorkPermission
  minimizedAt: number
}

const STORE_BASE_KEY = 'minimized_work'

function registryDraftKey(): string {
  return scopedWorkDraftKey(STORE_BASE_KEY)
}

let activeStoreKey = registryDraftKey()
let entries: MinimizedWorkEntry[] = readWorkDraft<MinimizedWorkEntry[]>(activeStoreKey)?.data ?? []
const listeners = new Set<() => void>()

// The app can change signed-in operator without reloading this module. Re-read
// the registry whenever the actor/org scope changes so one operator never sees
// another operator's parked labels or restores their local draft.
function ensureCurrentScope(): string {
  const nextStoreKey = registryDraftKey()
  if (nextStoreKey === activeStoreKey) return activeStoreKey
  activeStoreKey = nextStoreKey
  entries = readWorkDraft<MinimizedWorkEntry[]>(activeStoreKey)?.data ?? []
  if (pendingRestoreScope !== activeStoreKey) {
    pendingRestore = null
    pendingRestoreScope = null
  }
  return activeStoreKey
}

function persist(): void {
  const storeKey = ensureCurrentScope()
  if (entries.length) writeWorkDraft(storeKey, entries)
  else clearWorkDraft(storeKey)
  for (const listener of listeners) listener()
}

export function minimizeWork(entry: Omit<MinimizedWorkEntry, 'minimizedAt'>): void {
  ensureCurrentScope()
  entries = [...entries.filter((existing) => existing.key !== entry.key), { ...entry, minimizedAt: Date.now() }]
  persist()
}

export function removeMinimizedWork(key: string): void {
  ensureCurrentScope()
  const next = entries.filter((entry) => entry.key !== key)
  if (next.length === entries.length) return
  entries = next
  persist()
}

export function getMinimizedWork(): MinimizedWorkEntry[] {
  ensureCurrentScope()
  return entries
}

export function subscribeMinimizedWork(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Restore = remove the chip + hand the entry to whoever hosts it. The
 * caller (the chrome) navigates to entry.pageId FIRST, then dispatches;
 * hosts listen for RESTORE_WORK_EVENT and open their flow when the kind
 * is theirs. The flow's own draft brings the content back.
 *
 * A host that is NOT yet mounted (first visit to its page this session)
 * can't hear the event, so the entry is ALSO parked as pending; hosts
 * call consumePendingRestore(kind) on mount. Both paths are one-shot.
 */
let pendingRestore: MinimizedWorkEntry | null = null
let pendingRestoreScope: string | null = null

export function dispatchRestore(entry: MinimizedWorkEntry): void {
  const storeKey = ensureCurrentScope()
  removeMinimizedWork(entry.key)
  pendingRestore = entry
  pendingRestoreScope = storeKey
  window.dispatchEvent(new CustomEvent(RESTORE_WORK_EVENT, { detail: { kind: entry.kind, payload: entry.payload || {} } }))
}

export function canRestoreMinimizedWork(
  entry: MinimizedWorkEntry,
  can: (permissionKey: string, actionKey: string) => boolean,
): boolean {
  const required = entry.requiredPermission
  return !required || can(required.permissionKey, required.actionKey)
}

export function consumePendingRestore(kind: MinimizedWorkKind): MinimizedWorkEntry | null {
  const storeKey = ensureCurrentScope()
  if (pendingRestoreScope !== storeKey) return null
  if (pendingRestore?.kind !== kind) return null
  const entry = pendingRestore
  pendingRestore = null
  pendingRestoreScope = null
  return entry
}

/** The event side is one-shot too: a mounted host that handles the event
 * clears pending so a later mount doesn't replay the same restore. */
export function markRestoreHandled(kind: MinimizedWorkKind): void {
  ensureCurrentScope()
  if (pendingRestore?.kind === kind) {
    pendingRestore = null
    pendingRestoreScope = null
  }
}
