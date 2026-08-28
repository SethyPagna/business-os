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
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })) } catch { /* full/blocked -- non-fatal */ }
}

export function clearWorkDraft(key: string): void {
  try { localStorage.removeItem(key) } catch { /* fine */ }
}

/**
 * Debounced write; returns the cancel for the caller's effect cleanup.
 * 800ms matches Part 388's cadence -- fast enough that a crash loses at
 * most a keystroke or two, slow enough not to hammer storage per key.
 */
export function scheduleWorkDraftWrite<T>(key: string, data: T, delayMs = 800): () => void {
  const timer = window.setTimeout(() => writeWorkDraft(key, data), delayMs)
  return () => window.clearTimeout(timer)
}
