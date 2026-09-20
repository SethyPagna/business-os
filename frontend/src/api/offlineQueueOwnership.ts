import { STORAGE_KEYS } from '../constants.ts'
import { getSyncServerUrl } from './httpState.ts'

export type OfflineSaleOwner = {
  version: 1
  actor_id: number
  organization_id: number | null
  authority: string
  runtime: 'cloudflare-workers'
}

export const OFFLINE_OWNER_REVIEW_MESSAGE = 'Keep this pending sale. Sign in to its original account and server to sync it. Older unowned sales need review in the current app; do not recreate or discard them.'

// Only normalize trusted authenticated-user shapes, never retained queue owners.
export function authenticatedOrganizationId(user: Record<string, unknown>): number | null {
  const snake = Object.prototype.hasOwnProperty.call(user, 'organization_id')
  const camel = Object.prototype.hasOwnProperty.call(user, 'organizationId')
  if (snake && camel && user.organization_id !== user.organizationId) throw new Error(OFFLINE_OWNER_REVIEW_MESSAGE)
  const value = snake ? user.organization_id : camel ? user.organizationId : null
  if (value !== null && (!Number.isSafeInteger(value) || Number(value) <= 0)) throw new Error(OFFLINE_OWNER_REVIEW_MESSAGE)
  return value as number | null
}

// Keep this validator identical to the standalone service worker counterpart.
// Ownership is a consistency fence; the server still obtains identity from auth.
export function normalizeOfflineSaleOwner(value: unknown): OfflineSaleOwner | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const owner = value as Record<string, unknown>
  if (owner.version !== 1 || !Number.isSafeInteger(owner.actor_id) || Number(owner.actor_id) <= 0) return null
  if (owner.organization_id !== null && (!Number.isSafeInteger(owner.organization_id) || Number(owner.organization_id) <= 0)) return null
  if (owner.runtime !== 'cloudflare-workers' || typeof owner.authority !== 'string') return null
  try {
    const url = new URL(owner.authority)
    if (!/^https?:$/.test(url.protocol) || url.origin !== owner.authority) return null
  } catch { return null }
  return { version: 1, actor_id: Number(owner.actor_id), organization_id: owner.organization_id as number | null, authority: owner.authority, runtime: 'cloudflare-workers' }
}

export function offlineSaleOwnersMatch(left: unknown, right: unknown): boolean {
  const a = normalizeOfflineSaleOwner(left)
  const b = normalizeOfflineSaleOwner(right)
  return Boolean(a && b && a.actor_id === b.actor_id && a.organization_id === b.organization_id && a.authority === b.authority && a.runtime === b.runtime)
}

// Captured synchronously BEFORE the initial request/await. Never derive a queued
// sale's owner from whichever account happens to be signed in when a retry runs.
export function captureOfflineSaleOwner(): OfflineSaleOwner {
  let user: Record<string, unknown> = {}
  try {
    // Keep this low-level transport helper independent of the auth UI chunk.
    // Storage property access itself can throw on restricted WebKit profiles.
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.USER) || window.localStorage.getItem(STORAGE_KEYS.USER)
    user = raw ? JSON.parse(raw) : {}
  } catch { /* Deny admission when the authenticated bootstrap is unavailable. */ }
  let authority = ''
  try { authority = new URL(getSyncServerUrl() || window.location.origin).origin } catch { /* fail closed */ }
  const owner = normalizeOfflineSaleOwner({ version: 1, actor_id: user.id, organization_id: authenticatedOrganizationId(user), authority, runtime: 'cloudflare-workers' })
  if (!owner) throw new Error(OFFLINE_OWNER_REVIEW_MESSAGE)
  return owner
}

export function stampOfflineSaleOwner(payload: Record<string, unknown>): Record<string, unknown> {
  // A supplied owner is an immutable replay identity, never a license to adopt
  // old work. Fresh callers supply none; existing identities must still match.
  const owner = captureOfflineSaleOwner()
  if (payload.offline_owner !== undefined && !offlineSaleOwnersMatch(payload.offline_owner, owner)) throw new Error(OFFLINE_OWNER_REVIEW_MESSAGE)
  return { ...payload, offline_owner: owner }
}

export function sameQueuedSaleRevision(left: Record<string, unknown> | undefined, right: Record<string, unknown>): boolean {
  return Boolean(left && left._seq === right._seq && left.id === right.id && left.updated_at === right.updated_at
    && left.status === right.status && left.sync_lease === right.sync_lease
    && JSON.stringify(left.payload) === JSON.stringify(right.payload))
}
