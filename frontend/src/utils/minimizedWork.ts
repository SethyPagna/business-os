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
  | 'edit_product'
  | 'fast_stockin'
  | 'stock_adjust'
  | 'receive_batch'
  | 'create_products_session'
  | 'branch_form'
  | 'fee_form'
  | 'product_detail'

export type MinimizedWorkPermission = {
  permissionKey: string
  actionKey: string
}

type MinimizedWorkEntryBase = {
  /** Unique key -- re-minimizing the same flow replaces its chip. */
  key: string
  /** The sidebar page hosting the flow (live navigationConfig id -- the
   * hubs' ids post-E-phase: 'products', 'branches', 'sales', ...). */
  pageId: string
  /** Optional hub section anchor, for flows hosted below a consolidated page. */
  anchor?: string
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

/** Product edits must point at one exact entity draft. A family-wide fallback
 * could discard or restore a different product's changes. */
export type MinimizedWorkEntry =
  | (MinimizedWorkEntryBase & {
      kind: 'edit_product'
      payload: { productId: string | number }
      draftKey: string
    })
  | (MinimizedWorkEntryBase & {
      kind: Exclude<MinimizedWorkKind, 'edit_product'>
      payload?: Record<string, unknown>
      draftKey?: string
    })

type NewMinimizedWorkEntry = MinimizedWorkEntry extends infer Entry
  ? Entry extends MinimizedWorkEntry
    ? Omit<Entry, 'minimizedAt'>
    : never
  : never

const FALLBACK_PERMISSION_BY_KIND: Partial<Record<MinimizedWorkKind, MinimizedWorkPermission>> = {
  // Keep legacy/malformed parked edit entries safe even if they predate the
  // explicit requiredPermission metadata now written by the host.
  edit_product: { permissionKey: 'products', actionKey: 'edit' },
  fast_stockin: { permissionKey: 'inventory', actionKey: 'adjust' },
  stock_adjust: { permissionKey: 'inventory', actionKey: 'adjust' },
}

/** Fast stock-in has one canonical restore host. Older builds parked it on
 * `branches`, where the current Branches hub no longer mounts Inventory, so
 * normalize persisted entries as they are read as well as newly parked ones. */
export const FAST_STOCK_IN_RESTORE_HOST = {
  pageId: 'products',
  anchor: 'hub:products:stock_changes',
} as const

function normalizeEntry(entry: MinimizedWorkEntry): MinimizedWorkEntry {
  return entry.kind === 'fast_stockin'
    ? { ...entry, ...FAST_STOCK_IN_RESTORE_HOST }
    : entry
}

const STORE_BASE_KEY = 'minimized_work'

function registryDraftKey(): string {
  return scopedWorkDraftKey(STORE_BASE_KEY)
}

let activeStoreKey = registryDraftKey()
let entries: MinimizedWorkEntry[] = (readWorkDraft<MinimizedWorkEntry[]>(activeStoreKey)?.data ?? []).map(normalizeEntry)
const listeners = new Set<() => void>()

// The app can change signed-in operator without reloading this module. Re-read
// the registry whenever the actor/org scope changes so one operator never sees
// another operator's parked labels or restores their local draft.
function ensureCurrentScope(): string {
  const nextStoreKey = registryDraftKey()
  if (nextStoreKey === activeStoreKey) return activeStoreKey
  activeStoreKey = nextStoreKey
  entries = (readWorkDraft<MinimizedWorkEntry[]>(activeStoreKey)?.data ?? []).map(normalizeEntry)
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

export function minimizeWork(entry: NewMinimizedWorkEntry): void {
  ensureCurrentScope()
  const normalized = normalizeEntry({ ...entry, minimizedAt: Date.now() } as MinimizedWorkEntry)
  entries = [...entries.filter((existing) => existing.key !== entry.key), normalized]
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
 * Restore = hand the entry to whoever hosts it. Most flows remove their chip
 * immediately for backward compatibility. Fast stock-in and stock adjustment
 * keep their chip until the destination's lazy modal has actually committed,
 * because their hosts are conditionally mounted Products surfaces.
 * The caller (the chrome) navigates to entry.pageId FIRST, then dispatches;
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
  const normalized = normalizeEntry(entry)
  if (normalized.kind !== 'fast_stockin' && normalized.kind !== 'stock_adjust') removeMinimizedWork(normalized.key)
  pendingRestore = normalized
  pendingRestoreScope = storeKey
  window.dispatchEvent(new CustomEvent(RESTORE_WORK_EVENT, {
    detail: { kind: normalized.kind, payload: normalized.payload || {}, entry: normalized },
  }))
}

export function canRestoreMinimizedWork(
  entry: MinimizedWorkEntry,
  can: (permissionKey: string, actionKey: string) => boolean,
): boolean {
  const required = entry.requiredPermission || FALLBACK_PERMISSION_BY_KIND[entry.kind]
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

/** Read a pending restore without accepting it. Lazy Products flows use this
 * while navigation mounts their destination and modal subtree. */
export function peekPendingRestore(kind: MinimizedWorkKind): MinimizedWorkEntry | null {
  const storeKey = ensureCurrentScope()
  if (pendingRestoreScope !== storeKey) return null
  return pendingRestore?.kind === kind ? pendingRestore : null
}

/** The event side is one-shot too: a mounted host that handles the event
 * clears pending so a later mount doesn't replay the same restore. */
export function markRestoreHandled(kind: MinimizedWorkKind): void {
  ensureCurrentScope()
  if (pendingRestore?.kind === kind) {
    const handled = pendingRestore
    pendingRestore = null
    pendingRestoreScope = null
    if (kind === 'fast_stockin' || kind === 'stock_adjust') removeMinimizedWork(handled.key)
  }
}

/**
 * A permission can be revoked between the chrome's click-time check and the
 * destination host handling the restore event. Put the exact entry back and
 * consume its pending replay so a later permission change cannot reopen it
 * without another explicit operator action.
 */
export function reparkDeniedRestore(entry: MinimizedWorkEntry): void {
  ensureCurrentScope()
  if (pendingRestore?.kind === entry.kind) {
    pendingRestore = null
    pendingRestoreScope = null
  }
  const { minimizedAt: _previousMinimizedAt, ...parked } = entry
  minimizeWork(parked as NewMinimizedWorkEntry)
}
