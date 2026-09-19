import type { SessionUser } from './auth'

/** A replay consistency fence, not an authentication credential. Deliberately
 * stable across sessions/devices. This does not identify a replaced database
 * at the same origin if its actor/organization IDs are reused. */
export type OfflineSaleOwner = {
  version: 1
  actor_id: number
  organization_id: number | null
  authority: string
  runtime: 'cloudflare-workers'
}

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function parseOfflineSaleOwner(value: unknown): OfflineSaleOwner | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const owner = value as Record<string, unknown>
  if (owner.version !== 1 || owner.runtime !== 'cloudflare-workers' || !positiveId(owner.actor_id)
    || !(owner.organization_id === null || positiveId(owner.organization_id)) || typeof owner.authority !== 'string') return null
  try {
    const url = new URL(owner.authority)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== owner.authority) return null
  } catch { return null }
  return {
    version: 1, actor_id: owner.actor_id, organization_id: owner.organization_id,
    authority: owner.authority, runtime: 'cloudflare-workers',
  }
}

export function canonicalOfflineSaleOwner(user: SessionUser, requestUrl: string): OfflineSaleOwner {
  const owner = parseOfflineSaleOwner({
    version: 1, actor_id: user.id, organization_id: user.organization_id ?? null,
    authority: new URL(requestUrl).origin, runtime: 'cloudflare-workers',
  })
  if (!owner) throw new Error('Authenticated sale ownership is unavailable.')
  return owner
}

export function offlineSaleOwnerMismatch() {
  return {
    code: 'offline_owner_mismatch',
    error: 'Keep the original pending sale. Sign in to its original account and server, or ask an administrator to review it; do not reassign or recreate it.',
  }
}

export function offlineSaleOwnerError(value: unknown, expected: OfflineSaleOwner) {
  if (value == null) return {
    code: 'offline_owner_required',
    error: 'Keep the original pending sale. Update the app and review this ownerless sale before retrying; do not recreate or automatically assign it to the current account.',
  }
  const owner = parseOfflineSaleOwner(value)
  if (!owner || owner.actor_id !== expected.actor_id || owner.organization_id !== expected.organization_id
    || owner.authority !== expected.authority || owner.runtime !== expected.runtime) return offlineSaleOwnerMismatch()
  return null
}
