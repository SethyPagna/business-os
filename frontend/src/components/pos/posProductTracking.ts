import { effectivePermissions, type PermissionUser } from '../../utils/permissions.ts'

export type PosTrackingState = { scope: string; status: 'loading' | 'ready' | 'failed'; ids: Set<number> }

export function posTrackingFingerprint(user: (PermissionUser & { id?: unknown; organization_id?: unknown; organization_group_id?: unknown; organization_public_id?: unknown }) | null | undefined, authReady: boolean, branch: string): string {
  const authority = effectivePermissions(user)
  return JSON.stringify([authReady, user?.id ?? null, user?.organization_id ?? null,
    user?.organization_group_id ?? null, user?.organization_public_id ?? null, branch,
    authority.isAdmin, Object.entries(authority.merged).sort(([a], [b]) => a.localeCompare(b))])
}

/** An empty (even successful/cached) index is only a hint, never date-less proof. */
export function needsPosTrackingSheet(state: PosTrackingState, scope: string, productId: number): boolean {
  return state.scope !== scope || state.status !== 'ready' || state.ids.has(productId)
}

export function provesUntrackedLots(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const result = value as { batches?: unknown; known_positive_quantity?: unknown }
  return Array.isArray(result.batches) && result.batches.length === 0
    && typeof result.known_positive_quantity === 'number' && result.known_positive_quantity === 0
}

/** One pending card intent. A new actor/branch or tap invalidates prior work,
 * including A -> B -> A and requests that ignore AbortSignal. */
export function createPosTrackingOwner() {
  let scope = '', generation = 0, request = 0
  let controller: AbortController | null = null
  return {
    scope(next: string) {
      if (scope !== next) { scope = next; generation++; request++; controller?.abort() }
      return `${generation}:${scope}`
    },
    cancel() { request++; controller?.abort(); controller = null },
    async prove(read: (signal: AbortSignal) => Promise<unknown>, publish: (untracked: boolean) => void) {
      controller?.abort()
      const current = ++request
      const currentGeneration = generation
      const ownController = new AbortController()
      controller = ownController
      let untracked = false
      try { untracked = provesUntrackedLots(await read(ownController.signal)) } catch { /* use the blocking sheet */ }
      if (current === request && currentGeneration === generation && !ownController.signal.aborted) {
        controller = null
        publish(untracked)
      }
    },
  }
}
