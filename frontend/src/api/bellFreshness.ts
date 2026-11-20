// The bell may be up to 5 minutes old for everyone (owner, 11 Nov); the acting device re-reads what its own write can change.
// A write maps to nothing (the till's own new sale), to everything (stock and products: `?fresh=1`) or to the bell sections it
// resolves (`?fresh=a,b`: every other /api/sales write, a portal review, an import cancel/delete/retry). Only a named set also
// wakes the panel at once (onBellResolved); "everything" waits for the next read, because it costs a catalog walk.
//
// No imports: apiFetch (http.ts) calls noteOwnWriteForBell from its after-mutation hook, and notificationSummary.ts imports
// http.ts, so this module has to sit under both.

type BellRead = 'summary' | 'items'
type BellWrite = null | 'all' | string[]
type Pending = { all: boolean; names: Set<string> }

const newPending = (): Pending => ({ all: false, names: new Set() })
const pending: Record<BellRead, Pending> = { summary: newPending(), items: newPending() }
const listeners = new Set<(sections: string[]) => void>()

const pathOnly = (path: string): string => String(path || '').split(/[?#]/)[0].replace(/\/+$/, '')

/** The ONE mapping from a write (its cached-read invalidation prefixes and path) to the bell reads it forces. */
export function bellWriteFor(prefixes: readonly string[] | null, path?: string): BellWrite {
  const p = pathOnly(path ?? '')
  if (p === '/api/sales') return null
  if (/^\/api\/sales\//.test(p)) return prefixes !== null && prefixes.length === 0 ? null : ['sales']
  if (/^\/api\/portal\/submissions\/[^/]+\/review$/.test(p)) return ['portal']
  if (/^\/api\/import-jobs\/[^/]+(?:\/(?:cancel|delete|retry))?$/.test(p) && !/\/(?:preflight|start|approve|dismiss)$/.test(p)) return ['imports']
  return prefixes === null || prefixes.includes('inventory') || prefixes.includes('products') ? 'all' : null
}

export function noteOwnWriteForBell(prefixes: readonly string[] | null, path?: string): void {
  const write = bellWriteFor(prefixes, path)
  if (!write) return
  for (const read of ['summary', 'items'] as const) {
    if (write === 'all') pending[read].all = true
    else for (const name of write) pending[read].names.add(name)
  }
  if (write !== 'all') for (const listener of [...listeners]) listener(write)
}

/** Calls `listener` with the sections of every own write that names some; returns the unsubscribe. */
export function onBellResolved(listener: (sections: string[]) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Consumes the pending write for one read kind: '1' (everything), 'a,b' (those sections) or '' (a plain read). */
export function takeBellFresh(read: BellRead): string {
  const value = peekBellFresh(read)
  pending[read] = newPending()
  return value
}

/** What the next read of this kind will ask for (does not consume it). */
export function peekBellFresh(read: BellRead): string {
  const { all, names } = pending[read]
  return all ? '1' : [...names].sort().join(',')
}

/** A read that carried `fresh` and failed puts it back, so the next attempt still asks for the fresh answer. */
export function restoreBellFresh(read: BellRead, fresh: string): void {
  if (fresh === '1') pending[read].all = true
  else for (const name of fresh.split(',')) if (name) pending[read].names.add(name)
}

/** The panel's own refresh button: the next read, summary and items, is a full recompute. */
export function requestFreshBell(): void {
  pending.summary.all = true
  pending.items.all = true
}

export function bellPath(path: string, fresh: string): string {
  if (!fresh) return path
  return `${path}${path.includes('?') ? '&' : '?'}fresh=${fresh}`
}

export { createBellFollowUp, getSectionLifetimeSeconds, onBellAnswer } from './bellFollowUp.ts'
