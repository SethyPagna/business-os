import { actorWriteAccount } from './actorReadScope.ts'
import { authenticatedOrganizationId, currentWriteAuthority } from './offlineQueueOwnership.ts'

// A retry record (a frozen request and its client_request_id) belongs to the
// page origin, server and organization it was saved against: the same user id on
// another server or in another organization never loads it, so it is never sent
// there. Server and organization are an offline sale owner's
// (captureOfflineSaleOwner), read from the account writes are signed for: the
// numeric organization id, which every stored shape of one account carries
// (sign-in, bootstrap, own-profile save), so the scope never changes under it.
// With no account known (signed out, a session that just expired, or
// organization fields that disagree) there is no scope: nothing is read, moved
// or saved until the account is known again.

function pageOrigin(): string {
  try { return window.location?.origin || '' } catch { return '' }
}

function retryRecordScope(): string | null {
  try {
    const account = actorWriteAccount()
    if (!account) return null
    const organization = authenticatedOrganizationId(account)
    return encodeURIComponent(JSON.stringify([pageOrigin(), currentWriteAuthority(), organization == null ? '' : String(organization)]))
  } catch { return null }
}

/** Under no account the key names a scope nothing is ever saved in. */
export function retryRecordKey(prefix: string, ...parts: unknown[]): string {
  return `${prefix}${retryRecordScope() ?? 'no-account'}:${parts.map(String).join(':')}`
}

export function assertRetryRecordAccount(): void {
  if (retryRecordScope() == null) throw new Error('Sign in again before sending this request.')
}

// A record whose key names no scope names no server either. Retry records live
// in this tab's sessionStorage, so it was saved in this tab, against the server
// the tab was started with. That server is noted once per tab at bootstrap
// (web-api.ts) in the tab's own sessionStorage, under a pending-record prefix so
// every reset keeps it; an unscoped record loads only there.
const LEGACY_SERVER = 'businessos_pending_retry_server_v1'
type TabStore = Pick<Storage, 'getItem' | 'setItem'>

function tabStore(): TabStore | null {
  try { if (window.sessionStorage) return window.sessionStorage } catch { /* no window */ }
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

export function noteRetryRecordServer(store: TabStore | null | undefined = tabStore()): void {
  try {
    if (store && store.getItem(LEGACY_SERVER) == null) store.setItem(LEGACY_SERVER, currentWriteAuthority())
  } catch { /* no tab storage */ }
}

export function legacyRetryRecordsReadable(store: TabStore | null | undefined = tabStore()): boolean {
  noteRetryRecordServer(store)
  try { return !!store && store.getItem(LEGACY_SERVER) === currentWriteAuthority() } catch { return false }
}

/** On the tab's own server, an unscoped record moves, byte for byte, to the scope
 *  it is first read under; from then on only that scope reads it. On any other
 *  server it stays where it is, unread. */
export function adoptLegacyRetryRecord(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined, legacyKey: string, scopedKey: string): void {
  try {
    if (!storage || retryRecordScope() == null || storage.getItem(scopedKey) != null || !legacyRetryRecordsReadable()) return
    const legacy = storage.getItem(legacyKey)
    if (legacy == null) return
    storage.setItem(scopedKey, legacy)
    if (storage.getItem(scopedKey) === legacy) storage.removeItem(legacyKey)
  } catch { /* unreadable storage adopts nothing */ }
}
