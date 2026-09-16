// N2 (Part 387): the shared dirty-work registry behind the navigation
// guard. Anything holding unsaved/in-progress work registers itself here
// (an open product form with edits, a receive-batch entry, an import
// mid-review); AppContext's navigateTo() consults the registry before
// switching pages and, when something is dirty, opens the three-option
// guard (Save & Leave / Discard & Leave / Stay) instead of silently
// stranding the work. A `beforeunload` handler (AppContext) covers browser
// close/reload, and the sidebar shows a dot on pages with dirty work.
//
// Deliberately framework-free (plain module state + subscribe) so modals,
// pages, and the context can all reach it without prop-drilling. The POS
// cart intentionally NEVER registers: multi-order carts persist across
// navigation by design (the drafts feature) -- leaving POS loses nothing.

export type DirtyWorkEntry = {
  /** Unique key -- re-registering the same key replaces the old entry. */
  key: string
  /** The sidebar page the work lives on (navigationConfig id). */
  pageId: string
  /** Human label shown in the guard modal ("Product form -- Dior 999"). */
  label: string
  /** Consulted at navigation time -- return false once saved/cleared. */
  isDirty: () => boolean
  /**
   * Optional "Save & Leave" hook: resolve true when saved (navigation
   * proceeds), false/throw to keep the user on the page. Entries without
   * one simply don't offer Save & Leave for their work.
   */
  save?: () => Promise<boolean> | boolean
  /** Optional cleanup for "Discard & Leave" (clear draft state etc.). */
  discard?: () => void
}

const entries = new Map<string, DirtyWorkEntry>()
const listeners = new Set<() => void>()
// Stable snapshot for useSyncExternalStore -- rebuilt only when the
// registry CHANGES (register/unregister), not per read.
let snapshot: DirtyWorkEntry[] = []

function notify(): void {
  snapshot = [...entries.values()]
  for (const listener of listeners) listener()
}

export function registerDirtyWork(entry: DirtyWorkEntry): () => void {
  entries.set(entry.key, entry)
  notify()
  return () => {
    if (entries.get(entry.key) === entry) {
      entries.delete(entry.key)
      notify()
    }
  }
}

/** Every registered entry (dirty or not) -- stable identity between changes. */
export function getRegisteredWork(): DirtyWorkEntry[] {
  return snapshot
}

/** Only the entries whose work is actually dirty right now. */
export function getDirtyWork(): DirtyWorkEntry[] {
  return snapshot.filter((entry) => {
    try { return entry.isDirty() } catch { return false }
  })
}

export function hasDirtyWork(): boolean {
  return getDirtyWork().length > 0
}

export function subscribeDirtyWork(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// S4-21: the modal close guard reads the SAME registry the navigation
// guard reads. A form declares its dirtiness ONCE -- here -- and five
// consumers act on that one declaration: navigateTo() and popstate
// (AppContext), beforeunload (AppContext), the sidebar's per-page dot,
// the app-update gate (utils/appUpdate.ts), and now the ✕ on the modal
// the work actually lives in (utils/closeGuard.ts).
//
// Additive only: nothing above changed shape. These exist so closeGuard.ts
// never keeps its own copy of "is this dirty" -- two dirty models in one
// app is precisely what this registry was created to prevent.

/** One entry by key, or undefined when nothing is registered under it. */
export function getWorkEntry(key: string): DirtyWorkEntry | undefined {
  return entries.get(key)
}

/** Is the work registered under this key dirty right now? */
export function isWorkDirty(key: string): boolean {
  const entry = entries.get(key)
  if (!entry) return false
  try { return entry.isDirty() } catch { return false }
}

/**
 * Run ONE entry's discard hook -- the same cleanup "Discard & Leave" runs,
 * so discarding from a modal's ✕ and discarding from the navigation guard
 * can never disagree about what a discard means (both clear the draft, so
 * work the operator just discarded cannot resurrect at the next open).
 * Returns true when an entry existed, whether or not it had a hook.
 */
export function discardWork(key: string): boolean {
  const entry = entries.get(key)
  if (!entry) return false
  try { entry.discard?.() } catch { /* closing anyway */ }
  return true
}
