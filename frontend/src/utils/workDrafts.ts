import { STORAGE_KEYS } from '../constants.ts'

// F3 (Part 424, slice 1): the ONE draft store behind every in-progress
// flow -- extracted from ProductForm's Part-388 "Canva-level" persistence
// so add-product, fast stock-in (batch-in), and any future detail tab all
// persist the same way instead of each growing its own localStorage
// dialect. Deliberately framework-free (plain functions, no hooks), same
// reasoning as utils/dirtyWork.ts: modals, pages, and contexts can all
// reach it without prop-drilling; components wire their own effects.
//
// Contract (unchanged from Part 388):
//   - a draft is { at, data } under one key; writes are debounced by the
//     caller (scheduleWorkDraftWrite returns the cancel);
//   - restore drops a draft older than the server's own updated_at when
//     one is given -- never resurrect stale edits over newer server data;
//   - storage being full/blocked/unavailable is ALWAYS non-fatal: the
//     flow still works, it just doesn't survive a reload.

export type WorkDraft<T> = { at: number; data: T }

type PendingWorkDraft = {
  data: unknown
  timer: number
}

const pendingWorkDrafts = new Map<string, PendingWorkDraft>()
let lifecycleFlushInstalled = false

function persistWorkDraft<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })) } catch { /* full/blocked -- non-fatal */ }
}

function installLifecycleFlush(): void {
  if (lifecycleFlushInstalled || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  lifecycleFlushInstalled = true

  // iOS can freeze or terminate a Home Screen web app immediately after it
  // moves to the background. A debounced localStorage write is therefore not
  // allowed to depend on its timer getting another turn. pagehide also covers
  // Safari's back-forward cache path; visibilitychange covers app switching.
  window.addEventListener('pagehide', flushPendingWorkDrafts)
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPendingWorkDrafts()
    })
  }
}

export function scopedWorkDraftKey(baseKey: string): string {
  let userId = 'anonymous'
  let organizationId = 'default'
  try {
    const rawUser = sessionStorage.getItem(STORAGE_KEYS.USER) || localStorage.getItem(STORAGE_KEYS.USER) || ''
    const user = rawUser ? JSON.parse(rawUser) as Record<string, unknown> : {}
    userId = String(user.id || user.username || 'anonymous').replace(/[^a-z0-9_-]+/gi, '_')
    organizationId = String(user.organization_public_id || user.organizationId || user.organization_id || 'default').replace(/[^a-z0-9_-]+/gi, '_')
  } catch {}
  const cleanBase = String(baseKey || 'draft').replace(/[^a-z0-9_-]+/gi, '_')
  return `businessos_draft_${organizationId}_${userId}_${cleanBase}`
}

export function flushPendingWorkDrafts(): void {
  for (const [key, pending] of pendingWorkDrafts) {
    window.clearTimeout(pending.timer)
    pendingWorkDrafts.delete(key)
    persistWorkDraft(key, pending.data)
  }
}

// Flush exactly one form's pending debounce. Components use this from their
// unmount/key-change cleanup so a minimize/close cannot lose the last edit,
// without turning the ordinary per-change cleanup into a synchronous write.
export function flushPendingWorkDraft(key: string): boolean {
  const pending = pendingWorkDrafts.get(key)
  if (!pending) return false
  window.clearTimeout(pending.timer)
  pendingWorkDrafts.delete(key)
  persistWorkDraft(key, pending.data)
  return true
}

export function readWorkDraft<T>(key: string, options?: { notOlderThanMs?: number }): WorkDraft<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; data?: T; form?: T }
    // `form` is Part 388's original field name for the product draft --
    // accepted on read so existing saved drafts survive this extraction.
    const data = (parsed?.data ?? parsed?.form) as T | undefined
    if (data == null) {
      localStorage.removeItem(key)
      return null
    }
    const at = Number(parsed?.at) || 0
    const floor = Number(options?.notOlderThanMs) || 0
    if (floor && at <= floor) {
      localStorage.removeItem(key)
      return null
    }
    return { at, data }
  } catch {
    return null
  }
}

export function writeWorkDraft<T>(key: string, data: T): void {
  const pending = pendingWorkDrafts.get(key)
  if (pending) window.clearTimeout(pending.timer)
  pendingWorkDrafts.delete(key)
  persistWorkDraft(key, data)
}

export function clearWorkDraft(key: string): void {
  const pending = pendingWorkDrafts.get(key)
  if (pending) window.clearTimeout(pending.timer)
  pendingWorkDrafts.delete(key)
  try { localStorage.removeItem(key) } catch { /* fine */ }
}

/**
 * Debounced write; returns the cancel for the caller's effect cleanup.
 * 800ms matches Part 388's cadence -- fast enough that a crash loses at
 * most a keystroke or two, slow enough not to hammer storage per key.
 */
export function scheduleWorkDraftWrite<T>(key: string, data: T, delayMs = 800): () => void {
  installLifecycleFlush()
  const previous = pendingWorkDrafts.get(key)
  if (previous) window.clearTimeout(previous.timer)

  const pending: PendingWorkDraft = {
    data,
    timer: window.setTimeout(() => {
      if (pendingWorkDrafts.get(key) !== pending) return
      pendingWorkDrafts.delete(key)
      persistWorkDraft(key, data)
    }, delayMs),
  }
  pendingWorkDrafts.set(key, pending)

  return () => {
    if (pendingWorkDrafts.get(key) !== pending) return
    window.clearTimeout(pending.timer)
    pendingWorkDrafts.delete(key)
  }
}
