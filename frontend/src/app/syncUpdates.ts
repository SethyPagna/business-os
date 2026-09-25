import { createContext, createElement, useEffect, useMemo, useReducer, type ReactNode } from 'react'

// Live-sync broadcasts, from the window 'sync:update' event to React state.
//
// Why this exists (I7 performance audit, 26 Sep 2026): every 'sync:update'
// used to become its own React state update, debounced per channel. A
// reconnect or a foreground resume dispatches ~17 channels in one loop
// (api/http.ts RECONNECT_REFRESH_CHANNELS, web-api.ts
// FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS), so one reconnect meant ~17
// app-wide renders and ~17 rounds of page reloads.
//
// Now every channel that arrives inside one window is collected into ONE
// SyncUpdate. The window 'sync:update' events themselves are untouched: the
// read-cache invalidators (api/http.ts, api/methods.ts,
// api/pickerOptionsCache.ts) and the component-level listeners
// (ProductForm, SupplierPickerField) still see one event per channel.
//
// Two views of the same stream live in SyncContext:
//   - `syncUpdate`  the coalesced window. New code reads this, through
//                   hooks/useSyncReload.ts, and asks syncHas(update, channel).
//   - `syncChannel` the legacy one-channel-at-a-time view that the 17 existing
//                   page effects compare with `syncChannel.channel === X`.
//                   A string cannot equal two channels at once, so a coalesced
//                   object with only its first channel exposed would silently
//                   drop every other channel's reload (the reconnect burst's
//                   first channel is 'settings': Customers, Suppliers,
//                   Returns, Users and the review queue would never reload).
//                   SyncProvider therefore steps this view through the
//                   window's channels, one commit each. It goes away once
//                   every page reads `syncUpdate` instead (phase 2).

/** One channel inside a coalesced window, with the detail its event carried. */
export type SyncEntry = {
  channel: string
  reason: string | null
  source: string | null
}

/** Everything that arrived in one coalescing window, delivered as ONE state update. */
export type SyncUpdate = {
  channels: ReadonlySet<string>
  /** One per distinct channel, in arrival order. */
  entries: readonly SyncEntry[]
  /** Compat: the first entry's channel/reason/source. */
  channel: string
  reason: string | null
  source: string | null
  /** Strictly increasing across updates, so it is safe to use as "already handled" marker. */
  ts: number
}

/** The legacy one-channel view that `syncChannel` has always had. */
export type SyncChannelUpdate = {
  channel: string
  reason?: string | null
  source?: string | null
  ts: number
}

export type SyncContextCoreValue = {
  syncConnected: boolean
  syncServerUnreachable: boolean
  /** The coalesced window. Read it through useSyncReload / syncHas. */
  syncUpdate: SyncUpdate | null
  /** Legacy per-channel view, stepped through each window's channels. */
  syncChannel: SyncChannelUpdate | null
}

export const FALLBACK_SYNC_CONTEXT: SyncContextCoreValue = {
  syncConnected: false,
  syncServerUnreachable: false,
  syncUpdate: null,
  syncChannel: null,
}

export const SyncContext = createContext<SyncContextCoreValue | null>(null)

type SyncChannelLike = { channels?: ReadonlySet<string>; channel?: string | null } | null | undefined

/**
 * Did this update carry `channel`? Works on a coalesced SyncUpdate (checks
 * every channel in the window) and on a legacy one-channel value alike.
 */
export function syncHas(update: SyncChannelLike, channel: string): boolean {
  if (!update || !channel) return false
  if (update.channels) return update.channels.has(channel)
  return update.channel === channel
}

const CACHE_REFRESH_REASON = 'cache-refresh'

// Adds `entry` to a window, keeping each channel's first position. A later
// event for the same channel replaces the earlier detail -- the old
// per-channel debounce kept the last one too -- except that a background
// 'cache-refresh' never masks a real change: Products skips cache-refresh
// events for tables it is not showing, so letting one overwrite a genuine
// 'products' update would lose that reload.
function withEntry(entries: readonly SyncEntry[], entry: SyncEntry): SyncEntry[] {
  const index = entries.findIndex((existing) => existing.channel === entry.channel)
  if (index < 0) return [...entries, entry]
  const existing = entries[index]
  if (entry.reason === CACHE_REFRESH_REASON && existing.reason !== CACHE_REFRESH_REASON) return [...entries]
  const next = [...entries]
  next[index] = entry
  return next
}

function buildSyncUpdate(entries: readonly SyncEntry[], ts: number): SyncUpdate {
  const first = entries[0]
  return {
    channels: new Set(entries.map((entry) => entry.channel)),
    entries,
    channel: first.channel,
    reason: first.reason,
    source: first.source,
    ts,
  }
}

/**
 * Folds `next` into an update that has not been handled yet (used by
 * useSyncReload while its page is inactive). The result carries the newest
 * ts and every channel from both.
 */
export function mergeSyncUpdates(pending: SyncUpdate | null, next: SyncUpdate): SyncUpdate {
  if (!pending) return next
  const entries = next.entries.reduce<readonly SyncEntry[]>(withEntry, pending.entries)
  return buildSyncUpdate(entries, next.ts)
}

// Two windows flushing inside the same millisecond must still get distinct
// ts values, or a consumer that remembers "last handled ts" would skip the
// second. Module-level so a coalescer rebuilt by an effect re-run continues
// the same sequence.
let lastIssuedSyncTs = 0
function nextSyncTs(now: number): number {
  lastIssuedSyncTs = Math.max(now, lastIssuedSyncTs + 1)
  return lastIssuedSyncTs
}

export type SyncCoalescer = {
  push: (entry: SyncEntry) => void
  /** Cancels a window that has not flushed yet; its channels are dropped. */
  dispose: () => void
}

type SyncCoalescerOptions = {
  windowMs: number
  onFlush: (update: SyncUpdate) => void
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
}

/**
 * Collects every channel pushed within `windowMs` of the first one into a
 * single SyncUpdate. The window is fixed from its first event (not re-armed
 * by later ones), so a channel that keeps firing cannot postpone delivery.
 */
export function createSyncCoalescer({
  windowMs,
  onFlush,
  setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimer = (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now = Date.now,
}: SyncCoalescerOptions): SyncCoalescer {
  let entries: readonly SyncEntry[] = []
  let timer: unknown = null

  const flush = () => {
    timer = null
    const collected = entries
    entries = []
    if (collected.length > 0) onFlush(buildSyncUpdate(collected, nextSyncTs(now())))
  }

  return {
    push(entry) {
      if (!entry.channel) return
      entries = withEntry(entries, entry)
      if (timer == null) timer = setTimer(flush, windowMs)
    },
    dispose() {
      if (timer != null) clearTimer(timer)
      timer = null
      entries = []
    },
  }
}

/** The legacy one-channel values a coalesced window steps through, in arrival order. */
export function legacySyncSteps(update: SyncUpdate): SyncChannelUpdate[] {
  return update.entries.map((entry) => ({
    channel: entry.channel,
    reason: entry.reason,
    source: entry.source,
    ts: update.ts,
  }))
}

type LegacyStepState = {
  shown: SyncChannelUpdate | null
  queue: readonly SyncChannelUpdate[]
  lastQueuedTs: number
}
type LegacyStepAction = { type: 'enqueue'; update: SyncUpdate } | { type: 'advance' }

const INITIAL_LEGACY_STEP_STATE: LegacyStepState = { shown: null, queue: [], lastQueuedTs: 0 }

export function legacyStepReducer(state: LegacyStepState, action: LegacyStepAction): LegacyStepState {
  if (action.type === 'enqueue') {
    // StrictMode runs effects twice in development; queue each window once.
    if (action.update.ts <= state.lastQueuedTs) return state
    return {
      ...state,
      queue: [...state.queue, ...legacySyncSteps(action.update)],
      lastQueuedTs: action.update.ts,
    }
  }
  if (state.queue.length === 0) return state
  const [next, ...rest] = state.queue
  return { ...state, shown: next, queue: rest }
}

/**
 * Shows each channel of each window as its own `syncChannel` value, one
 * commit per channel, so every existing `syncChannel.channel === X` effect
 * still sees its channel. Nothing is dropped when a new window lands while
 * the previous one is still stepping: its channels queue behind.
 */
export function useLegacySyncChannel(update: SyncUpdate | null): SyncChannelUpdate | null {
  const [state, dispatch] = useReducer(legacyStepReducer, INITIAL_LEGACY_STEP_STATE)
  useEffect(() => {
    if (update) dispatch({ type: 'enqueue', update })
  }, [update])
  // Consumers' effects for the shown step run in the same commit, before
  // this parent effect, so each step is observed before the next replaces it.
  useEffect(() => {
    if (state.queue.length > 0) dispatch({ type: 'advance' })
  }, [state])
  return state.shown
}

type SyncProviderProps = {
  syncUpdate: SyncUpdate | null
  syncConnected: boolean
  syncServerUnreachable: boolean
  children?: ReactNode
}

/**
 * Supplies SyncContext. A child of AppProvider so stepping the legacy view
 * re-renders only SyncContext readers, never the whole AppProvider.
 */
export function SyncProvider({ syncUpdate, syncConnected, syncServerUnreachable, children }: SyncProviderProps) {
  const syncChannel = useLegacySyncChannel(syncUpdate)
  const value = useMemo<SyncContextCoreValue>(() => ({
    syncConnected,
    syncServerUnreachable,
    syncUpdate,
    syncChannel,
  }), [syncConnected, syncServerUnreachable, syncUpdate, syncChannel])
  return createElement(SyncContext.Provider, { value }, children)
}
